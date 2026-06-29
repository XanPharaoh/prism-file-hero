import atexit
import logging
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from docsuitekit.config import OLLAMA_BIN, OLLAMA_HOST, LO_PROFILES_DIR

logger = logging.getLogger(__name__)


class OllamaDaemonManager:
    """
    Manages the Ollama daemon lifecycle within the application process.

    The Ollama runtime is a separate native binary that must be running as
    a background service before any inference calls can succeed. This class
    handles detection, startup, and clean shutdown in a PyInstaller context
    where the daemon cannot be registered as a system service.
    """

    _process: Optional[subprocess.Popen] = None
    _owned: bool = False   # True only if this process spawned the daemon

    @classmethod
    def is_running(cls) -> bool:
        try:
            with urllib.request.urlopen(
                f"{OLLAMA_HOST}/api/tags", timeout=2
            ) as response:
                return response.status == 200
        except (urllib.error.URLError, OSError):
            return False

    @classmethod
    def start(cls, timeout: int = 30) -> bool:
        """
        Attach to a running Ollama daemon or spawn one from the bundled binary.
        Returns True when the daemon is confirmed reachable.
        """
        if cls.is_running():
            logger.info("Ollama daemon already running; attaching to existing instance.")
            cls._owned = False
            return True

        if not OLLAMA_BIN.exists():
            logger.error(
                "Ollama binary not found at '%s'. "
                "LLM verification features will be unavailable.",
                OLLAMA_BIN,
            )
            return False

        logger.info("Spawning Ollama daemon from '%s'.", OLLAMA_BIN)
        creation_flags = (
            subprocess.CREATE_NO_WINDOW
            if hasattr(subprocess, "CREATE_NO_WINDOW")
            else 0
        )
        cls._process = subprocess.Popen(
            [str(OLLAMA_BIN), "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creation_flags,
        )
        cls._owned = True
        atexit.register(cls.stop)   # Guarantee cleanup on interpreter exit

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if cls.is_running():
                logger.info("Ollama daemon ready.")
                return True
            time.sleep(0.5)

        logger.error("Ollama daemon did not become reachable within %ds.", timeout)
        cls.stop()
        return False

    @classmethod
    def stop(cls) -> None:
        if cls._owned and cls._process and cls._process.poll() is None:
            logger.info("Terminating owned Ollama daemon.")
            cls._process.terminate()
            try:
                cls._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                cls._process.kill()
            finally:
                cls._process = None
                cls._owned = False


class LibreOfficeProfileManager:
    """
    Generates isolated LibreOffice user-profile directories.

    LibreOffice cannot safely share a profile directory across concurrent
    headless instances. Each subprocess invocation must receive its own
    --env:UserInstallation path. This manager allocates and cleans up
    those directories without locking or contention.
    """

    def __init__(self, base_dir: Path = LO_PROFILES_DIR):
        self._base = base_dir
        self._base.mkdir(parents=True, exist_ok=True)
        self._counter = 0

    def acquire(self) -> Path:
        self._counter += 1
        profile = self._base / f"profile_{self._counter:06d}"
        profile.mkdir(exist_ok=True)
        return profile

    def release(self, profile: Path) -> None:
        import shutil
        try:
            shutil.rmtree(profile, ignore_errors=True)
        except Exception as exc:
            logger.warning("Failed to remove LibreOffice profile '%s': %s", profile, exc)


# Module-level singleton
lo_profile_manager = LibreOfficeProfileManager()
