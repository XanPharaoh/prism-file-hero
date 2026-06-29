import os
import sys
import logging
from pathlib import Path
from shutil import which
from typing import Optional

logger = logging.getLogger(__name__)


def get_base_path() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).parent.parent


def resolve_binary(relative_path: str) -> Optional[Path]:
    """
    Locate a bundled binary by its path relative to the application root.
    Falls back to the system PATH if the bundled copy is absent.
    Returns None if the binary cannot be located anywhere.
    """
    candidate = get_base_path() / relative_path
    if candidate.exists():
        return candidate

    # Graceful degradation: try system PATH using the bare filename
    bare_name = Path(relative_path).name
    system_binary = which(bare_name)
    if system_binary:
        logger.warning(
            "Bundled binary not found at '%s'. "
            "Falling back to system PATH: '%s'.",
            candidate, system_binary,
        )
        return Path(system_binary)

    logger.error("Binary not found: '%s'. Feature will be unavailable.", relative_path)
    return None


def inject_binary_dirs(paths: list[Optional[Path]]) -> None:
    """
    Prepend the parent directories of the given binary paths to the process PATH.
    Silently skips any None entries (binaries that were not found).
    """
    dirs = [str(p.parent) for p in paths if p is not None and p.exists()]
    if not dirs:
        return
    existing = os.environ.get("PATH", "").split(os.pathsep)
    # Deduplicate while preserving order
    merged = list(dict.fromkeys(dirs + existing))
    os.environ["PATH"] = os.pathsep.join(merged)
