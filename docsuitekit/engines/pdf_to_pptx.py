import io
import logging
import time
from pathlib import Path
from typing import Optional

import fitz
from pptx import Presentation
from pptx.util import Emu

from docsuitekit.core.result import ConversionResult, ConversionStatus

logger = logging.getLogger(__name__)

# Unit conversion: 1 PDF point = 1/72 inch; 1 EMU = 1/914400 inch
# Therefore: 1 PDF point = 914400 / 72 = 12700 EMU
_PT_TO_EMU = 12700


def pdf_to_pptx(
    input_path: Path,
    output_path: Path,
    dpi: int = 150,
    add_slide_notes: bool = True,
    jpeg_quality: int = 85,
) -> ConversionResult:
    """
    Convert each PDF page to a PowerPoint slide by high-resolution rasterization.

    Why rasterization and not semantic text extraction?
    ─────────────────────────────────────────────────────────────────────────
    PowerPoint's layout system operates on named placeholder boxes, master
    slide templates, and theme-bound typography. There is no structural mapping
    between arbitrary PDF coordinate tuples and PowerPoint's placeholder model.

    Attempting to reconstruct editable text boxes from PDF coordinates produces:
    - Fragmented text runs split at arbitrary character boundaries
    - Completely wrong column assignment in multi-column layouts
    - Loss of all vector graphics, charts, and formula rendering

    For all practical presentation use cases — screen projection, PDF review
    annotation, stakeholder distribution — image-per-slide is the correct
    architecture. It faithfully preserves every visual element on every page
    regardless of font availability, transparency, or complex vector content.

    Slide dimensions:
    ─────────────────────────────────────────────────────────────────────────
    Slide dimensions are set to match the first page's PDF point dimensions
    converted to EMU. This eliminates letterboxing and scaling artefacts for
    standard page sizes. For mixed-size PDFs (portrait + landscape pages),
    the first page sets the presentation canvas and subsequent differently-
    sized pages are centred with letterboxing — the intended behaviour for
    mixed-orientation documents.

    dpi guidance:
    ─────────────────────────────────────────────────────────────────────────
    150 DPI  — adequate for screen review and standard projectors (default)
    200 DPI  — recommended for 4K displays and high-resolution projectors
    300 DPI  — required only when the PPTX itself will be printed directly
               Note: file size scales approximately as (dpi / 150)²
               A 50-page document at 300 DPI is ~4× larger than at 150 DPI

    jpeg_quality: JPEG compression for embedded images (1–95).
        Higher values increase fidelity and file size.
        85 is the standard trade-off for presentation use.
        Use PNG (by setting jpeg_quality=0 or 100 with the PNG path below)
        for pixel-perfect archival quality at the cost of file size.
    """
    t0 = time.monotonic()

    try:
        doc = fitz.open(str(input_path))
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="PyMuPDF + python-pptx",
            error=f"Cannot open PDF: {exc}",
            elapsed_seconds=time.monotonic() - t0,
        )

    total_pages = len(doc)
    if total_pages == 0:
        doc.close()
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="PyMuPDF + python-pptx",
            error="PDF contains no pages.",
            elapsed_seconds=time.monotonic() - t0,
        )

    try:
        prs = Presentation()

        # Derive slide canvas size from first page dimensions.
        # Using the exact PDF page size avoids aspect-ratio distortion
        # that occurs when PowerPoint defaults to 10" × 7.5" (4:3) or
        # 13.33" × 7.5" (16:9) are applied to portrait Letter/A4 PDFs.
        first_page_rect  = doc[0].rect
        slide_width_emu  = int(first_page_rect.width  * _PT_TO_EMU)
        slide_height_emu = int(first_page_rect.height * _PT_TO_EMU)
        prs.slide_width  = Emu(slide_width_emu)
        prs.slide_height = Emu(slide_height_emu)

        # Layout index 6 is the blank layout in all standard PowerPoint
        # theme packs. If a non-standard template is loaded, use:
        # blank_layout = next(l for l in prs.slide_layouts if l.name == 'Blank')
        blank_layout = prs.slide_layouts[6]
        mat = fitz.Matrix(dpi / 72.0, dpi / 72.0)

        for page_idx in range(total_pages):
            page = doc[page_idx]

            # Rasterize page: alpha=False prevents RGBA → JPEG conversion errors
            pix       = page.get_pixmap(matrix=mat, alpha=False)
            img_bytes = _compress_image(pix, jpeg_quality)
            img_fmt   = "jpeg" if jpeg_quality > 0 else "png"

            slide = prs.slides.add_slide(blank_layout)

            # Calculate placement for this page.
            # If this page differs in size from the first (e.g. a landscape
            # appendix in an otherwise portrait document), scale to fit the
            # established slide canvas while maintaining the page's own
            # aspect ratio, centred with equal letterbox margins.
            page_width_emu  = int(page.rect.width  * _PT_TO_EMU)
            page_height_emu = int(page.rect.height * _PT_TO_EMU)

            if page_width_emu != slide_width_emu or page_height_emu != slide_height_emu:
                img_w, img_h = _scale_to_fit(
                    page_width_emu,  page_height_emu,
                    slide_width_emu, slide_height_emu,
                )
                left = (slide_width_emu  - img_w) // 2
                top  = (slide_height_emu - img_h) // 2
                logger.debug(
                    "Page %d: different size (%.0f×%.0f pt vs %.0f×%.0f pt). "
                    "Letterboxed to %d×%d EMU.",
                    page_idx + 1,
                    page.rect.width, page.rect.height,
                    first_page_rect.width, first_page_rect.height,
                    img_w, img_h,
                )
            else:
                img_w, img_h = slide_width_emu, slide_height_emu
                left, top    = 0, 0

            slide.shapes.add_picture(
                io.BytesIO(img_bytes),
                left=Emu(left),
                top=Emu(top),
                width=Emu(img_w),
                height=Emu(img_h),
            )

            if add_slide_notes:
                _set_notes(slide, page_idx + 1, total_pages, input_path.name)

            if (page_idx + 1) % 10 == 0 or page_idx == total_pages - 1:
                logger.info(
                    "pdf_to_pptx progress: %d / %d pages.", page_idx + 1, total_pages
                )

        doc.close()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        prs.save(str(output_path))

        output_size_mb = output_path.stat().st_size / (1024 * 1024)

        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="PyMuPDF + python-pptx",
            elapsed_seconds=time.monotonic() - t0,
            metadata={
                "slides":            total_pages,
                "dpi":               dpi,
                "jpeg_quality":      jpeg_quality,
                "output_size_mb":    round(output_size_mb, 2),
                "slide_width_emu":   slide_width_emu,
                "slide_height_emu":  slide_height_emu,
                # Explicit disclosure: this is a visual conversion only
                "editable_text":     False,
                "selectable_text":   False,
            },
        )

    except Exception as exc:
        doc.close()
        logger.error("pdf_to_pptx error: %s", exc, exc_info=True)
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="PyMuPDF + python-pptx",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )


# ── Private helpers ────────────────────────────────────────────────────────────

def _compress_image(pix: fitz.Pixmap, jpeg_quality: int) -> bytes:
    """
    Encode a PyMuPDF Pixmap to compressed image bytes.

    JPEG is used for photographic/continuous-tone content (most scanned PDFs).
    Set jpeg_quality=0 to force PNG (lossless) for technical diagrams, line
    art, or documents where colour precision matters more than file size.
    """
    if jpeg_quality <= 0:
        return pix.tobytes("png")

    from PIL import Image
    import io as _io

    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    buf = _io.BytesIO()
    img.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
    return buf.getvalue()


def _scale_to_fit(
    content_w: int, content_h: int,
    canvas_w: int,  canvas_h: int,
) -> tuple:
    """
    Scale content dimensions to fit within canvas bounds, preserving aspect ratio.
    Returns (scaled_width, scaled_height) both as integers (EMU).
    """
    scale = min(canvas_w / content_w, canvas_h / content_h)
    return int(content_w * scale), int(content_h * scale)


def _set_notes(slide, page_num: int, total: int, source_name: str) -> None:
    """
    Write presenter notes to a slide's notes pane.
    Handles the case where the notes text frame is absent (non-standard layouts).
    """
    try:
        notes_slide = slide.notes_slide
        tf = notes_slide.notes_text_frame
        tf.text = f"Page {page_num} of {total} — Source: {source_name}"
    except Exception as exc:
        logger.debug("Could not set slide notes for page %d: %s", page_num, exc)
