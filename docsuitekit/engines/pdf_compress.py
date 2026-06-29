import logging
import subprocess
import time
from enum import Enum
from pathlib import Path
from typing import Optional

from docsuitekit.config import GHOSTSCRIPT_BIN
from docsuitekit.core.binary_resolver import resolve_binary
from docsuitekit.core.result import ConversionResult, ConversionStatus

logger = logging.getLogger(__name__)

_GS: Optional[Path] = resolve_binary("bin/gs/gswin64c.exe") or (
    GHOSTSCRIPT_BIN if GHOSTSCRIPT_BIN.exists() else None
)


class CompressionQuality(Enum):
    """
    Maps to Ghostscript's -dPDFSETTINGS presets.
    These control image downsampling, color conversion, and font subsetting.
    """
    SCREEN   = "/screen"    # ~72 DPI  — smallest file, screen viewing only
    EBOOK    = "/ebook"     # ~150 DPI — balanced, suitable for tablets
    PRINTER  = "/printer"   # ~300 DPI — high quality, general print use
    PREPRESS = "/prepress"  # ~300 DPI — color-accurate professional print


def compress_pdf(
    input_path: Path,
    output_path: Path,
    quality: CompressionQuality = CompressionQuality.EBOOK,
) -> ConversionResult:
    """
    Reduce PDF file size using Ghostscript's PDFSETTINGS pipeline.

    Ghostscript achieves compression by downsampling raster images to the
    preset DPI target, removing duplicate font definitions, stripping
    unreferenced metadata objects, and re-encoding image streams.

    Returns original and compressed byte counts in metadata so the caller
    can present a human-readable reduction percentage.
    """
    t0 = time.monotonic()

    if not _GS:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="Ghostscript",
            error="Ghostscript binary not found. Add gswin64c.exe to bin/gs/.",
            elapsed_seconds=time.monotonic() - t0,
        )

    original_bytes = input_path.stat().st_size

    cmd = [
        str(_GS),
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        f"-dPDFSETTINGS={quality.value}",
        "-dNOPAUSE",
        "-dBATCH",
        "-dNOSAFER",
        "-dQUIET",
        f"-sOutputFile={output_path}",
        str(input_path),
    ]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if proc.returncode != 0:
            return ConversionResult(
                status=ConversionStatus.FAILURE,
                input_path=input_path,
                engine_used="Ghostscript",
                error=proc.stderr.strip() or f"Ghostscript exited {proc.returncode}",
                elapsed_seconds=time.monotonic() - t0,
            )

        compressed_bytes = output_path.stat().st_size
        reduction_pct = (
            (1.0 - compressed_bytes / original_bytes) * 100.0
            if original_bytes > 0 else 0.0
        )

        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="Ghostscript",
            elapsed_seconds=time.monotonic() - t0,
            metadata={
                "quality_preset":   quality.name,
                "original_bytes":   original_bytes,
                "compressed_bytes": compressed_bytes,
                "reduction_pct":    round(reduction_pct, 2),
            },
        )
    except subprocess.TimeoutExpired:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="Ghostscript",
            error="Ghostscript timed out after 180s.",
            elapsed_seconds=time.monotonic() - t0,
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="Ghostscript",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )


def convert_to_pdfa(
    input_path: Path,
    output_path: Path,
    pdfa_level: int = 1,
) -> ConversionResult:
    """
    Convert to PDF/A-{level}b (ISO 19005), suitable for long-term archival.

    Ghostscript achieves compliance by:
    - Embedding all referenced fonts into the document payload
    - Converting device-dependent colour spaces to sRGB
    - Flattening transparency layers (strictly prohibited in PDF/A-1b)
    - Stripping JavaScript, encryption, and external content references
    - Setting appropriate XMP metadata conformance markers

    -dPDFACompatibilityPolicy=1 instructs Ghostscript to silently convert
    non-conforming elements rather than aborting on the first violation.

    pdfa_level: 1 = PDF/A-1b (safest, widest viewer support)
                2 = PDF/A-2b (allows JPEG 2000 and optional content layers)
    """
    t0 = time.monotonic()

    if not _GS:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="Ghostscript",
            error="Ghostscript binary not found.",
            elapsed_seconds=time.monotonic() - t0,
        )

    if pdfa_level not in (1, 2, 3):
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="Ghostscript",
            error=f"Invalid PDF/A level '{pdfa_level}'. Must be 1, 2, or 3.",
            elapsed_seconds=time.monotonic() - t0,
        )

    cmd = [
        str(_GS),
        "-sDEVICE=pdfwrite",
        f"-dPDFA={pdfa_level}",
        "-dPDFACompatibilityPolicy=1",
        "-dBATCH",
        "-dNOPAUSE",
        "-dNOSAFER",
        "-dQUIET",
        "-dNOOUTERSAVE",
        "-sColorConversionStrategy=sRGB",
        "-dConvertCMYKImagesToRGB=true",
        "-dEmbedAllFonts=true",
        "-dSubsetFonts=true",
        "-dCompatibilityLevel=1.4",
        f"-sOutputFile={output_path}",
        str(input_path),
    ]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            return ConversionResult(
                status=ConversionStatus.FAILURE,
                input_path=input_path,
                engine_used="Ghostscript",
                error=proc.stderr.strip() or f"Ghostscript exited {proc.returncode}",
                elapsed_seconds=time.monotonic() - t0,
            )
        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="Ghostscript",
            elapsed_seconds=time.monotonic() - t0,
            metadata={"standard": f"PDF/A-{pdfa_level}b"},
        )
    except subprocess.TimeoutExpired:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="Ghostscript",
            error="Ghostscript timed out after 300s.",
            elapsed_seconds=time.monotonic() - t0,
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="Ghostscript",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )
