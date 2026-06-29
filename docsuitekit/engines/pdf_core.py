import logging
import time
from pathlib import Path
from typing import List, Optional, Tuple, Union

import fitz  # PyMuPDF

from docsuitekit.core.result import ConversionResult, ConversionStatus

logger = logging.getLogger(__name__)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _open_or_fail(path: Path, t0: float) -> Tuple[Optional[fitz.Document], Optional[ConversionResult]]:
    try:
        return fitz.open(str(path)), None
    except Exception as exc:
        return None, ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=path,
            engine_used="PyMuPDF",
            error=f"Cannot open '{path.name}': {exc}",
            elapsed_seconds=time.monotonic() - t0,
        )


# ── Merge ──────────────────────────────────────────────────────────────────────

def merge_pdfs(input_paths: List[Path], output_path: Path) -> ConversionResult:
    """Concatenate multiple PDFs, preserving bookmarks and internal links."""
    t0 = time.monotonic()
    try:
        out_doc = fitz.open()
        for path in input_paths:
            src, fail = _open_or_fail(path, t0)
            if fail:
                return fail
            out_doc.insert_pdf(src)
            src.close()
        out_doc.save(str(output_path), garbage=4, deflate=True)
        out_doc.close()
        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_paths[0],
            output_path=output_path,
            engine_used="PyMuPDF",
            elapsed_seconds=time.monotonic() - t0,
            metadata={"merged_count": len(input_paths)},
        )
    except Exception as exc:
        logger.warning("PyMuPDF merge failed (%s); attempting pypdf fallback.", exc)
        return _merge_pypdf_fallback(input_paths, output_path, t0, str(exc))


def _merge_pypdf_fallback(
    paths: List[Path], output_path: Path, t0: float, reason: str
) -> ConversionResult:
    try:
        from pypdf import PdfWriter, PdfReader
        writer = PdfWriter()
        for p in paths:
            for page in PdfReader(str(p)).pages:
                writer.add_page(page)
        with open(output_path, "wb") as f:
            writer.write(f)
        return ConversionResult(
            status=ConversionStatus.FALLBACK_SUCCESS,
            input_path=paths[0],
            output_path=output_path,
            engine_used="pypdf",
            fallback_activated=True,
            fallback_reason=reason,
            elapsed_seconds=time.monotonic() - t0,
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=paths[0],
            engine_used="pypdf",
            fallback_activated=True,
            fallback_reason=reason,
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )


# ── Split ──────────────────────────────────────────────────────────────────────

def split_pdf(
    input_path: Path,
    output_dir: Path,
    page_ranges: Optional[List[Tuple[int, int]]] = None,
) -> List[ConversionResult]:
    """
    Split a PDF into multiple files.
    page_ranges: list of (start, end) tuples (0-indexed, end exclusive).
    None splits into individual pages.
    """
    t0 = time.monotonic()
    output_dir.mkdir(parents=True, exist_ok=True)
    results: List[ConversionResult] = []

    src, fail = _open_or_fail(input_path, t0)
    if fail:
        return [fail]

    total = len(src)
    ranges = page_ranges or [(i, i + 1) for i in range(total)]

    for idx, (start, end) in enumerate(ranges):
        end = min(end, total)
        out_path = output_dir / f"{input_path.stem}_part{idx + 1:04d}.pdf"
        try:
            chunk = fitz.open()
            chunk.insert_pdf(src, from_page=start, to_page=end - 1)
            chunk.save(str(out_path), garbage=4, deflate=True)
            chunk.close()
            results.append(ConversionResult(
                status=ConversionStatus.SUCCESS,
                input_path=input_path,
                output_path=out_path,
                engine_used="PyMuPDF",
                elapsed_seconds=time.monotonic() - t0,
                metadata={"page_range": (start, end)},
            ))
        except Exception as exc:
            results.append(ConversionResult(
                status=ConversionStatus.FAILURE,
                input_path=input_path,
                engine_used="PyMuPDF",
                error=f"Range {start}-{end}: {exc}",
                elapsed_seconds=time.monotonic() - t0,
            ))

    src.close()
    return results


# ── Rotate ─────────────────────────────────────────────────────────────────────

def rotate_pages(
    input_path: Path,
    output_path: Path,
    degrees: int = 90,
    page_indices: Optional[List[int]] = None,
) -> ConversionResult:
    """Rotate pages by a multiple of 90 degrees. Updates rotation matrix only."""
    t0 = time.monotonic()
    if degrees % 90 != 0:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="PyMuPDF",
            error=f"Rotation must be a multiple of 90°, got {degrees}°.",
            elapsed_seconds=time.monotonic() - t0,
        )
    doc, fail = _open_or_fail(input_path, t0)
    if fail:
        return fail
    try:
        targets = page_indices if page_indices is not None else range(len(doc))
        for i in targets:
            page = doc[i]
            page.set_rotation((page.rotation + degrees) % 360)
        doc.save(str(output_path), garbage=4)
        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="PyMuPDF",
            elapsed_seconds=time.monotonic() - t0,
            metadata={"degrees": degrees, "pages_rotated": len(list(targets))},
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="PyMuPDF",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )
    finally:
        doc.close()


# ── Crop ───────────────────────────────────────────────────────────────────────

def crop_pages(
    input_path: Path,
    output_path: Path,
    rect: Tuple[float, float, float, float],
    page_indices: Optional[List[int]] = None,
) -> ConversionResult:
    """
    Non-destructively set CropBox. The underlying content stream is untouched;
    only the rendered viewport changes. rect = (x0, y0, x1, y1) in PDF points.
    """
    t0 = time.monotonic()
    doc, fail = _open_or_fail(input_path, t0)
    if fail:
        return fail
    try:
        crop_rect = fitz.Rect(*rect)
        targets = page_indices if page_indices is not None else range(len(doc))
        for i in targets:
            doc[i].set_cropbox(crop_rect)
        doc.save(str(output_path), garbage=4)
        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="PyMuPDF",
            elapsed_seconds=time.monotonic() - t0,
            metadata={"crop_rect": rect},
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="PyMuPDF",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )
    finally:
        doc.close()


# ── Watermark ──────────────────────────────────────────────────────────────────

def watermark_pdf(
    input_path: Path,
    output_path: Path,
    watermark_source: Union[Path, str],
    overlay: bool = True,
) -> ConversionResult:
    """
    Stamp all pages with a watermark from a PDF or image file.
    overlay=True places it above content (foreground); False for background.
    """
    t0 = time.monotonic()
    doc, fail = _open_or_fail(input_path, t0)
    if fail:
        return fail

    wm_path = Path(watermark_source)
    try:
        if wm_path.suffix.lower() == ".pdf":
            wm_doc = fitz.open(str(wm_path))
        else:
            # Wrap image in a single-page PDF so show_pdf_page works uniformly
            wm_doc = fitz.open()
            img_page = wm_doc.new_page()
            img_page.insert_image(img_page.rect, filename=str(wm_path))

        for page in doc:
            page.show_pdf_page(
                page.rect,
                wm_doc,
                0,
                overlay=overlay,
                keep_proportion=True,
            )

        doc.save(str(output_path), garbage=4, deflate=True)
        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="PyMuPDF",
            elapsed_seconds=time.monotonic() - t0,
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="PyMuPDF",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )
    finally:
        doc.close()
        if "wm_doc" in dir():
            wm_doc.close()
