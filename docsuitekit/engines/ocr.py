"""
OCR pipeline: non-destructive hidden text layer over scanned images.

Primary:  OCRmyPDF → Tesseract → precision-aligned invisible text layer
Fallback: pytesseract → plain text extraction (no PDF modification)

The primary path preserves the exact visual appearance of the scanned
document while injecting a selectable, searchable, copy-paste-capable
text layer beneath each image region.

PyInstaller compatibility:
    OCRmyPDF uses importlib.metadata entry_points to discover its internal
    processing plugins at runtime. PyInstaller does not collect entry_points
    metadata by default, causing a silent plugin discovery failure that
    manifests as "No plugins registered" or AttributeError on the first
    ocr() call in a frozen executable.

    The fix is in packaging/hooks/hook-ocrmypdf.py — see that file.
    This module's _setup_environment() provides the runtime PATH/env
    safety net in case the hook has not yet been applied.
"""

import logging
import os
import sys
import time
from enum import Enum
from pathlib import Path
from typing import Callable, List, Optional

import fitz

from docsuitekit.config import GHOSTSCRIPT_BIN, TESSDATA_DIR, TESSERACT_BIN
from docsuitekit.core.binary_resolver import inject_binary_dirs, resolve_binary
from docsuitekit.core.result import ConversionResult, ConversionStatus

logger = logging.getLogger(__name__)


# ── OCR quality presets ────────────────────────────────────────────────────────

class OcrMode(Enum):
    FAST     = "fast"      # No deskew/rotation; legacy Tesseract engine
    STANDARD = "standard"  # Deskew + auto-rotation; LSTM engine (default)
    BEST     = "best"      # Full pipeline: clean, deskew, rotate, lossless


_MODE_PARAMS = {
    OcrMode.FAST: {
        "rotate_pages":               False,
        "deskew":                     False,
        "clean":                      False,
        "optimize":                   0,
        "tesseract_oem":              0,       # Legacy engine — fastest
        "pdfa_image_compression":     "jpeg",
    },
    OcrMode.STANDARD: {
        "rotate_pages":               True,
        "rotate_pages_threshold":     14.0,    # Confidence threshold (degrees)
        "deskew":                     True,
        "clean":                      False,
        "optimize":                   1,       # Lossless PNG recompression
        "tesseract_oem":              1,       # LSTM neural network engine
        "pdfa_image_compression":     "jpeg",
    },
    OcrMode.BEST: {
        "rotate_pages":               True,
        "rotate_pages_threshold":     6.0,     # More aggressive rotation detection
        "deskew":                     True,
        "clean":                      True,    # unpaper despeckling pass
        "optimize":                   2,       # Lossy recompression (JBIG2/JPEG2000)
        "tesseract_oem":              1,
        "pdfa_image_compression":     "lossless",
    },
}


# ── Environment setup ──────────────────────────────────────────────────────────

def _setup_environment() -> bool:
    """
    Inject Tesseract and Ghostscript into the process PATH and set
    TESSDATA_PREFIX before OCRmyPDF is imported.

    OCRmyPDF resolves the Tesseract binary via shutil.which() at the point
    of the first ocr() call. The Ghostscript binary is required by
    OCRmyPDF's internal optimization pass (--optimize 1 or 2).

    TESSDATA_PREFIX convention:
        Tesseract expects TESSDATA_PREFIX to point to the PARENT directory
        of the tessdata/ folder, not to tessdata/ itself.

        Correct:   TESSDATA_PREFIX = /app/bin/tesseract/
        Incorrect: TESSDATA_PREFIX = /app/bin/tesseract/tessdata/

        Tesseract internally constructs:
            {TESSDATA_PREFIX}/tessdata/eng.traineddata

    Returns True if Tesseract binary was located; False if unavailable.
    """
    tesseract   = resolve_binary("bin/tesseract/tesseract.exe") or TESSERACT_BIN
    ghostscript = resolve_binary("bin/gs/gswin64c.exe") or GHOSTSCRIPT_BIN

    inject_binary_dirs([tesseract, ghostscript])

    if TESSDATA_DIR.exists():
        os.environ.setdefault("TESSDATA_PREFIX", str(TESSDATA_DIR.parent))
        logger.debug("TESSDATA_PREFIX → %s", TESSDATA_DIR.parent)
    else:
        logger.warning(
            "tessdata directory not found at '%s'. "
            "Tesseract language models must be present for OCR to function.",
            TESSDATA_DIR,
        )

    available = tesseract is not None and tesseract.exists()
    if not available:
        logger.warning(
            "Tesseract binary not found. OCR features unavailable. "
            "Expected location: bin/tesseract/tesseract.exe"
        )
    return available


_TESSERACT_READY = _setup_environment()


# ── Language discovery ─────────────────────────────────────────────────────────

def get_available_languages() -> List[str]:
    """
    Return a list of installed Tesseract language codes by scanning
    the tessdata directory for *.traineddata files.

    Examples: ['eng', 'deu', 'fra', 'chi_sim', 'jpn', 'ara']

    Returns an empty list if TESSDATA_DIR does not exist, allowing the
    caller to surface a meaningful error to the user rather than causing
    a silent Tesseract failure inside OCRmyPDF.
    """
    if not TESSDATA_DIR.exists():
        return []
    return sorted(
        p.stem for p in TESSDATA_DIR.glob("*.traineddata")
        if not p.stem.startswith("osd")  # 'osd' is orientation, not a language
    )


# ── Main entry point ───────────────────────────────────────────────────────────

def ocr_pdf(
    input_path: Path,
    output_path: Path,
    languages: Optional[List[str]] = None,
    mode: OcrMode = OcrMode.STANDARD,
    skip_text: bool = True,
    force_ocr: bool = False,
    progress_cb: Optional[Callable[[int, int], None]] = None,
) -> ConversionResult:
    """
    Apply non-destructive OCR to a PDF, producing a searchable output.

    OCRmyPDF analyses each page. For image-only pages, it runs Tesseract
    and embeds a transparent, precision-aligned text layer beneath the
    visible scan pixels. The visual appearance of the document is entirely
    unchanged — no re-rendering, no quality loss from re-compression.

    languages:  Tesseract language codes to use. Defaults to ['eng'].
                Multiple codes enable multilingual page analysis:
                ['eng', 'fra'] processes pages containing both English
                and French text. Language codes must correspond to
                *.traineddata files present in the tessdata directory.

    skip_text:  True = leave pages that already contain a selectable text
                layer untouched. False = process every page regardless.
                Recommended: True for mixed scanned/digital PDFs.

    force_ocr:  True = rasterize and re-OCR even pages with existing text.
                Use only when the existing text layer is known to be corrupt
                or mis-aligned (e.g., from a broken scan-to-PDF pipeline).

    progress_cb: Optional callable(current_page, total_pages) for UI updates.
                 OCRmyPDF does not natively expose per-page progress via its
                 Python API. The callback is driven by page count metadata
                 extracted before the OCR call.
    """
    t0 = time.monotonic()

    if not _TESSERACT_READY:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="OCRmyPDF",
            error=(
                "Tesseract binary not found. "
                "OCR is unavailable without a Tesseract installation."
            ),
            elapsed_seconds=time.monotonic() - t0,
        )

    langs = languages or ["eng"]
    installed = get_available_languages()
    missing = [lg for lg in langs if lg not in installed]
    if missing:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="OCRmyPDF",
            error=(
                f"Language pack(s) not installed: {missing}. "
                f"Available: {installed}. "
                f"Add the corresponding *.traineddata files to {TESSDATA_DIR}."
            ),
            elapsed_seconds=time.monotonic() - t0,
        )

    if progress_cb:
        try:
            doc = fitz.open(str(input_path))
            total_pages = len(doc)
            doc.close()
            progress_cb(0, total_pages)
        except Exception:
            total_pages = 0

    result = _ocrmypdf_run(
        input_path, output_path, langs, mode, skip_text, force_ocr, t0
    )

    if result.succeeded and progress_cb and total_pages:
        progress_cb(total_pages, total_pages)

    if not result.succeeded:
        logger.warning(
            "OCRmyPDF failed (%s); falling back to pytesseract text extraction.",
            result.error,
        )
        return _pytesseract_fallback(input_path, output_path, langs, t0, result.error)

    return result


# ── OCRmyPDF primary engine ────────────────────────────────────────────────────

def _ocrmypdf_run(
    input_path: Path,
    output_path: Path,
    langs: List[str],
    mode: OcrMode,
    skip_text: bool,
    force_ocr: bool,
    t0: float,
) -> ConversionResult:
    try:
        import ocrmypdf
        from ocrmypdf import ExitCode
    except ImportError:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="OCRmyPDF",
            error="ocrmypdf not installed. Run: pip install ocrmypdf",
            elapsed_seconds=time.monotonic() - t0,
        )

    params = _MODE_PARAMS[mode].copy()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        exit_code = ocrmypdf.ocr(
            input_file=str(input_path),
            output_file=str(output_path),
            language=langs,
            skip_text=skip_text,
            force_ocr=force_ocr,
            progress_bar=False,
            jobs=1,          # Parallel jobs; >1 can cause issues in frozen apps
            **params,
        )

        # ExitCode.already_done_ocr means skip_text=True and all pages had text.
        # This is success — copy the original file as-is.
        if exit_code == ExitCode.already_done_ocr:
            import shutil
            shutil.copy2(str(input_path), str(output_path))
            return ConversionResult(
                status=ConversionStatus.SUCCESS,
                input_path=input_path,
                output_path=output_path,
                engine_used="OCRmyPDF",
                elapsed_seconds=time.monotonic() - t0,
                metadata={
                    "note":      "All pages already contained selectable text; "
                                 "original copied without modification.",
                    "exit_code": exit_code.name,
                    "languages": langs,
                    "mode":      mode.value,
                },
            )

        if exit_code != ExitCode.ok:
            return ConversionResult(
                status=ConversionStatus.FAILURE,
                input_path=input_path,
                engine_used="OCRmyPDF",
                error=f"OCRmyPDF returned exit code: {exit_code.name} ({exit_code.value})",
                elapsed_seconds=time.monotonic() - t0,
            )

        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="OCRmyPDF",
            elapsed_seconds=time.monotonic() - t0,
            metadata={
                "languages": langs,
                "mode":      mode.value,
                "deskew":    params.get("deskew"),
                "clean":     params.get("clean"),
                "optimize":  params.get("optimize"),
            },
        )

    except Exception as exc:
        logger.debug("OCRmyPDF exception detail:", exc_info=True)
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="OCRmyPDF",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )


# ── pytesseract fallback ───────────────────────────────────────────────────────

def _pytesseract_fallback(
    input_path: Path,
    output_path: Path,
    langs: List[str],
    t0: float,
    fallback_reason: str,
) -> ConversionResult:
    """
    Fallback: extract text via pytesseract and write it as plain text alongside
    the original PDF. This does NOT produce a searchable PDF — it cannot
    inject a text layer without OCRmyPDF. The output_path receives a copy of
    the original file, and a companion .txt file is written with the extracted
    text for downstream use.

    This fallback is intentionally limited. Its purpose is to provide partial
    value (extracted text for analysis or indexing) when OCRmyPDF is unavailable,
    rather than silently failing with no output.
    """
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="pytesseract",
            fallback_activated=True,
            fallback_reason=fallback_reason,
            error="pytesseract not installed. Run: pip install pytesseract",
            elapsed_seconds=time.monotonic() - t0,
        )

    try:
        lang_str = "+".join(langs)
        doc      = fitz.open(str(input_path))
        pages_text: List[str] = []
        mat = fitz.Matrix(2.0, 2.0)  # 2× scale = ~144 DPI for A4

        for page in doc:
            pix = page.get_pixmap(matrix=mat, alpha=False)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            text = pytesseract.image_to_string(img, lang=lang_str)
            pages_text.append(text)

        doc.close()

        import shutil
        shutil.copy2(str(input_path), str(output_path))
        txt_path = output_path.with_suffix(".txt")
        txt_path.write_text("\n\n--- PAGE BREAK ---\n\n".join(pages_text), encoding="utf-8")

        return ConversionResult(
            status=ConversionStatus.FALLBACK_SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="pytesseract",
            fallback_activated=True,
            fallback_reason=fallback_reason,
            elapsed_seconds=time.monotonic() - t0,
            metadata={
                "note":       "PDF visual content unchanged. Text extracted to companion .txt file.",
                "txt_output": str(txt_path),
                "pages":      len(pages_text),
            },
        )

    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="pytesseract",
            fallback_activated=True,
            fallback_reason=fallback_reason,
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )
