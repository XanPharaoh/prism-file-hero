import logging
import subprocess
import time
from pathlib import Path
from typing import Optional

import fitz

from docsuitekit.config import QPDF_BIN
from docsuitekit.core.binary_resolver import resolve_binary
from docsuitekit.core.result import ConversionResult, ConversionStatus

logger = logging.getLogger(__name__)

_QPDF: Optional[Path] = resolve_binary("bin/qpdf/bin/qpdf.exe") or (
    QPDF_BIN if QPDF_BIN.exists() else None
)


def repair_pdf(input_path: Path, output_path: Path) -> ConversionResult:
    """
    Attempt structural recovery of a damaged PDF.

    Three-stage strategy:
      1. qpdf --linearize  : forces complete file rebuild, resolves orphaned
                             objects and broken XREF tables. This is the most
                             aggressive recovery mode qpdf offers.
      2. qpdf (plain copy) : qpdf attempts XREF recovery by default even
                             without flags; catches cases linearize misses.
      3. PyMuPDF open+save : lightweight fallback — PyMuPDF's C-level parser
                             performs its own XREF reconstruction on open(),
                             then garbage=4 rebuilds the reference table on save.

    qpdf exit codes: 0 = success, 1 = warnings (output valid), 2 = hard failure.
    Codes 0 and 1 are both treated as success.
    """
    t0 = time.monotonic()

    if _QPDF:
        result = _qpdf_run(["--linearize"], input_path, output_path, t0)
        if result.succeeded:
            return result
        logger.warning("qpdf --linearize failed (%s); trying basic copy.", result.error)

        result = _qpdf_run([], input_path, output_path, t0, prior_error=result.error)
        if result.succeeded:
            return result
        logger.warning("qpdf basic copy failed (%s); falling back to PyMuPDF.", result.error)
    else:
        logger.warning("qpdf binary not found; using PyMuPDF for repair.")

    return _pymupdf_repair(input_path, output_path, t0)


# ── Internal helpers ───────────────────────────────────────────────────────────

def _qpdf_run(
    extra_args: list,
    input_path: Path,
    output_path: Path,
    t0: float,
    prior_error: Optional[str] = None,
) -> ConversionResult:
    try:
        proc = subprocess.run(
            [str(_QPDF)] + extra_args + [str(input_path), str(output_path)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if proc.returncode <= 1:
            return ConversionResult(
                status=(
                    ConversionStatus.FALLBACK_SUCCESS if prior_error
                    else ConversionStatus.SUCCESS
                ),
                input_path=input_path,
                output_path=output_path,
                engine_used="qpdf",
                fallback_activated=bool(prior_error),
                fallback_reason=prior_error,
                elapsed_seconds=time.monotonic() - t0,
                metadata={
                    "mode": extra_args[0] if extra_args else "basic-copy",
                    "qpdf_warnings": proc.stderr.strip() if proc.returncode == 1 else None,
                },
            )
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="qpdf",
            error=proc.stderr.strip() or f"qpdf exited with code {proc.returncode}",
            elapsed_seconds=time.monotonic() - t0,
        )
    except subprocess.TimeoutExpired:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="qpdf",
            error="qpdf timed out after 120s.",
            elapsed_seconds=time.monotonic() - t0,
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="qpdf",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )


def _pymupdf_repair(input_path: Path, output_path: Path, t0: float) -> ConversionResult:
    """
    Open with PyMuPDF (triggers internal XREF recovery) and re-save with
    maximum garbage collection. garbage=4 fully rebuilds the cross-reference
    table and removes all unreferenced objects. clean=True sanitizes streams.
    """
    try:
        doc = fitz.open(str(input_path))
        doc.save(
            str(output_path),
            garbage=4,
            deflate=True,
            clean=True,
        )
        doc.close()
        return ConversionResult(
            status=ConversionStatus.FALLBACK_SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="PyMuPDF",
            fallback_activated=True,
            fallback_reason="qpdf unavailable or failed",
            elapsed_seconds=time.monotonic() - t0,
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="PyMuPDF",
            fallback_activated=True,
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )
