import logging
import os
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Optional

from docsuitekit.config import LIBREOFFICE_BIN
from docsuitekit.core.binary_resolver import resolve_binary
from docsuitekit.core.process_manager import lo_profile_manager
from docsuitekit.core.result import ConversionResult, ConversionStatus

logger = logging.getLogger(__name__)

# Formats LibreOffice will reliably convert to PDF. This list exists primarily
# for input validation so callers receive clear errors rather than silent
# LibreOffice failures on unsupported types.
SUPPORTED_INPUT_FORMATS = {
    ".doc", ".docx", ".odt", ".rtf",    # Word-processor
    ".xls", ".xlsx", ".ods", ".csv",    # Spreadsheet
    ".ppt", ".pptx", ".odp",            # Presentation
    ".html", ".htm",                    # Web (basic — WeasyPrint preferred for complex CSS)
}

_LO: Optional[Path] = resolve_binary("bin/lo/program/soffice.exe") or (
    LIBREOFFICE_BIN if LIBREOFFICE_BIN.exists() else None
)

# LibreOffice inherits the calling process's env, which may contain a
# SAL_USE_VCLPLUGIN or DISPLAY variable that triggers GUI initialisation
# on headless servers. Override to prevent this.
_HEADLESS_ENV = {**os.environ, "SAL_USE_VCLPLUGIN": "svp"}


def office_to_pdf(
    input_path: Path,
    output_path: Path,
    timeout: int = 120,
) -> ConversionResult:
    """
    Convert a Microsoft Office or OpenDocument file to PDF using LibreOffice
    in headless mode.

    Why LibreOffice, not python-docx or xlrd?
    python-docx can read .docx structure but has no PDF rendering capability.
    LibreOffice contains a full, high-fidelity rendering engine that handles
    complex formatting: tracked changes, embedded charts, custom themes,
    pivot tables, and embedded fonts — none of which pure Python libraries
    can reproduce reliably.

    Profile isolation:
    LibreOffice locks its user-profile directory during execution. Running
    two instances against the same profile directory causes one to silently
    produce a corrupt output or exit with a lock error. lo_profile_manager
    allocates a unique temporary profile per invocation and cleans it up
    after the subprocess returns.

    Output path handling:
    LibreOffice names its output based on the input stem:
    "report.docx" → "report.pdf" placed in --outdir. If the caller has
    requested a different output filename, this function renames the file
    after conversion. Both the original and renamed paths are checked in
    case LibreOffice strips or alters characters in the stem.

    timeout: seconds before the subprocess is terminated. Large presentations
    with many embedded images can take 60–90s on slow hardware.
    """
    t0 = time.monotonic()

    if not _LO:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="LibreOffice",
            error=(
                "LibreOffice binary not found. "
                "Place a portable LibreOffice distribution under bin/lo/."
            ),
            elapsed_seconds=time.monotonic() - t0,
        )

    suffix = input_path.suffix.lower()
    if suffix not in SUPPORTED_INPUT_FORMATS:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="LibreOffice",
            error=(
                f"Unsupported input format '{suffix}'. "
                f"Supported: {sorted(SUPPORTED_INPUT_FORMATS)}"
            ),
            elapsed_seconds=time.monotonic() - t0,
        )

    output_dir = output_path.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    profile = lo_profile_manager.acquire()
    # LibreOffice expects a file:/// URI for UserInstallation on Windows.
    # Plain paths work on Linux/macOS but can fail silently on Windows builds.
    profile_uri = profile.as_uri()

    cmd = [
        str(_LO),
        "--headless",
        "--norestore",
        "--nofirststartwizard",
        f"--env:UserInstallation={profile_uri}",
        "--convert-to", "pdf",
        "--outdir", str(output_dir),
        str(input_path),
    ]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=_HEADLESS_ENV,
        )
    except subprocess.TimeoutExpired:
        lo_profile_manager.release(profile)
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="LibreOffice",
            error=f"LibreOffice timed out after {timeout}s.",
            elapsed_seconds=time.monotonic() - t0,
        )
    except Exception as exc:
        lo_profile_manager.release(profile)
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="LibreOffice",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )
    finally:
        lo_profile_manager.release(profile)

    if proc.returncode != 0:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="LibreOffice",
            error=proc.stderr.strip() or f"LibreOffice exited {proc.returncode}",
            elapsed_seconds=time.monotonic() - t0,
        )

    # Locate the file LibreOffice actually created
    lo_output = output_dir / (input_path.stem + ".pdf")
    if not lo_output.exists():
        # LibreOffice sometimes lowercases or strips spaces from the stem
        candidates = list(output_dir.glob("*.pdf"))
        if not candidates:
            return ConversionResult(
                status=ConversionStatus.FAILURE,
                input_path=input_path,
                engine_used="LibreOffice",
                error="Conversion appeared to succeed but no PDF was found in output dir.",
                elapsed_seconds=time.monotonic() - t0,
            )
        lo_output = max(candidates, key=lambda p: p.stat().st_mtime)
        logger.warning(
            "Expected '%s' but found '%s'. Using most-recent PDF.",
            input_path.stem + ".pdf", lo_output.name,
        )

    # Rename to the caller-requested output path if needed
    if lo_output != output_path:
        shutil.move(str(lo_output), str(output_path))

    return ConversionResult(
        status=ConversionStatus.SUCCESS,
        input_path=input_path,
        output_path=output_path,
        engine_used="LibreOffice",
        elapsed_seconds=time.monotonic() - t0,
        metadata={"lo_stderr": proc.stderr.strip() or None},
    )


def batch_office_to_pdf(
    input_paths: List[Path],
    output_dir: Path,
    max_workers: int = 3,
    timeout: int = 120,
) -> List[ConversionResult]:
    """
    Convert multiple Office documents concurrently.

    max_workers is conservatively capped at 4. Each LibreOffice headless
    instance uses ~200–400 MB of RAM. On machines with 8 GB or less,
    exceeding four concurrent instances risks OOM termination. Profile
    isolation ensures no cross-instance locking regardless of concurrency.

    The ThreadPoolExecutor is used rather than ProcessPoolExecutor because
    the bottleneck is the LibreOffice subprocess, not the Python GIL.
    """
    max_workers = min(max_workers, 4)
    output_dir.mkdir(parents=True, exist_ok=True)
    results: List[ConversionResult] = []

    def _convert(p: Path) -> ConversionResult:
        return office_to_pdf(p, output_dir / (p.stem + ".pdf"), timeout=timeout)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_convert, p): p for p in input_paths}
        for future in as_completed(futures):
            try:
                results.append(future.result())
            except Exception as exc:
                results.append(ConversionResult(
                    status=ConversionStatus.FAILURE,
                    input_path=futures[future],
                    engine_used="LibreOffice",
                    error=f"Unhandled executor error: {exc}",
                    elapsed_seconds=0.0,
                ))

    return results
