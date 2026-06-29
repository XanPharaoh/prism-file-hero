import logging
import time
from pathlib import Path
from typing import Optional, Tuple

from docsuitekit.core.result import ConversionResult, ConversionStatus

logger = logging.getLogger(__name__)


def pdf_to_word(
    input_path: Path,
    output_path: Path,
    use_ocr: bool = False,
    page_range: Optional[Tuple[int, int]] = None,
    prefer_docling: bool = True,
) -> ConversionResult:
    """
    Convert PDF to DOCX using a two-engine pipeline.

    Primary — Docling:
        Uses DocLayNet for spatial layout classification (text blocks, figures,
        tables, headings, captions) and TableFormer for table structure
        recognition. These models run locally on CPU or GPU via PyTorch.

        Docling builds an internal hierarchical document representation that
        correctly recovers reading order in multi-column layouts, groups
        caption text with its associated figure, and maps individual table
        cells before serialising the entire structure to DOCX XML.

        Memory note: Docling loads vision models (~500 MB–1 GB) on first
        call. Subsequent calls within the same process reuse loaded weights.
        On machines with < 8 GB RAM, monitor for OOM on very large PDFs.

        IMPORTANT — model references:
        The underlying models are DocLayNet (layout) and TableFormer (tables),
        both developed by IBM Research. Any reference to a "Heron" layout model
        in third-party documentation is unverified against Docling's canonical
        model registry and should be treated with caution until confirmed
        against the installed docling release's model manifest.

    Fallback — pdf2docx:
        Coordinate-based reconstruction without AI models. Maps PDF text
        block coordinates to Word paragraph positions, infers table structure
        from drawn vector lines. Fast and low-memory. Suitable for simple
        single-column documents. Cannot recover multi-column reading order
        and cannot OCR image-only pages.

    use_ocr:      Enable Tesseract OCR pass for scanned/image-only PDFs.
                  Only honoured by Docling; pdf2docx has no OCR capability.
    page_range:   0-indexed (start, end) tuple, end exclusive.
                  None = convert all pages.
    prefer_docling: False bypasses Docling entirely and calls pdf2docx
                    directly — useful for large batches of simple documents.
    """
    t0 = time.monotonic()

    if prefer_docling:
        result = _docling_convert(input_path, output_path, use_ocr, page_range, t0)
        if result.succeeded:
            return result
        logger.warning(
            "Docling failed (%s); falling back to pdf2docx.", result.error
        )
        return _pdf2docx_convert(
            input_path, output_path, page_range, t0, fallback_reason=result.error
        )

    return _pdf2docx_convert(input_path, output_path, page_range, t0)


# ── Docling engine ─────────────────────────────────────────────────────────────

def _docling_convert(
    input_path: Path,
    output_path: Path,
    use_ocr: bool,
    page_range: Optional[Tuple[int, int]],
    t0: float,
) -> ConversionResult:
    try:
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
    except ImportError:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="Docling",
            error="docling not installed. Run: pip install docling",
            elapsed_seconds=time.monotonic() - t0,
        )

    try:
        pipeline_options = PdfPipelineOptions(
            do_ocr=use_ocr,
            do_table_structure=True,
        )

        converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(
                    pipeline_options=pipeline_options
                )
            }
        )

        # Docling v2+ accepts page_range at convert() level in some builds.
        # Providing it both ways maximises version compatibility.
        convert_kwargs = {"source": str(input_path)}
        if page_range is not None:
            convert_kwargs["page_range"] = page_range

        conv_res = converter.convert(**convert_kwargs)
        doc = conv_res.document

        output_path.parent.mkdir(parents=True, exist_ok=True)

        exported = _attempt_docling_docx_export(doc, output_path)
        if not exported:
            raise RuntimeError(
                "No viable DOCX export method found in the installed Docling version. "
                "Confirm docling >= 2.0 is installed and includes the DOCX backend. "
                "Run: python -c \"from docling.document_converter import DocumentConverter; "
                "print(dir(DocumentConverter().convert('x').document))\" "
                "and verify 'export_to_docx' appears in the output."
            )

        pages_processed = None
        if hasattr(conv_res, "pages"):
            pages_processed = len(list(conv_res.pages))

        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="Docling",
            elapsed_seconds=time.monotonic() - t0,
            metadata={
                "pages_processed": pages_processed,
                "ocr_enabled":     use_ocr,
                "page_range":      page_range,
                "layout_model":    "DocLayNet",
                "table_model":     "TableFormer",
            },
        )

    except Exception as exc:
        logger.debug("Docling error detail: %s", exc, exc_info=True)
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="Docling",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )


def _attempt_docling_docx_export(doc, output_path: Path) -> bool:
    """
    Probe available DOCX export methods across Docling minor versions.

    Docling's DOCX export API changed across v2.x patch releases:
    - Some builds: export_to_docx() returns bytes
    - Some builds: export_to_docx(filename=str) writes to file, returns None
    - Some builds: export_to_docx(output_path=Path) variant

    All three signatures are probed in sequence. Returns True on first success.
    """
    if not hasattr(doc, "export_to_docx"):
        logger.debug(
            "DoclingDocument.export_to_docx() absent. "
            "Installed version may predate DOCX export support."
        )
        return False

    # Attempt 1 — no-argument call returning bytes
    try:
        result = doc.export_to_docx()
        if isinstance(result, (bytes, bytearray)) and result:
            output_path.write_bytes(result)
            logger.debug("Docling DOCX export: bytes return path succeeded.")
            return True
    except TypeError:
        pass
    except Exception as exc:
        logger.debug("export_to_docx() bytes path error: %s", exc)

    # Attempt 2 — filename keyword argument
    try:
        doc.export_to_docx(filename=str(output_path))
        if output_path.exists() and output_path.stat().st_size > 0:
            logger.debug("Docling DOCX export: filename= path succeeded.")
            return True
    except TypeError:
        pass
    except Exception as exc:
        logger.debug("export_to_docx(filename=) error: %s", exc)

    # Attempt 3 — output_path keyword argument
    try:
        doc.export_to_docx(output_path=str(output_path))
        if output_path.exists() and output_path.stat().st_size > 0:
            logger.debug("Docling DOCX export: output_path= path succeeded.")
            return True
    except Exception as exc:
        logger.debug("export_to_docx(output_path=) error: %s", exc)

    return False


# ── pdf2docx fallback ──────────────────────────────────────────────────────────

def _pdf2docx_convert(
    input_path: Path,
    output_path: Path,
    page_range: Optional[Tuple[int, int]],
    t0: float,
    fallback_reason: Optional[str] = None,
) -> ConversionResult:
    """
    Fallback engine: pdf2docx coordinate-based reconstruction.

    pdf2docx processes PDFs by:
      1. Extracting text spans with exact bounding boxes via PyMuPDF
      2. Grouping overlapping/adjacent spans into paragraph blocks
      3. Detecting table structures from drawn horizontal/vertical lines
      4. Emitting python-docx XML primitives for each reconstructed element

    It does not load any AI models and therefore cannot recover:
    - Reading order in multi-column layouts
    - Table semantics without explicit drawn borders
    - Text from image-only pages (use OCR pipeline first)

    For typical single-column corporate documents with standard bordered
    tables, output quality is acceptable and conversion is 10–50× faster
    than Docling.
    """
    try:
        from pdf2docx import Converter
    except ImportError:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="pdf2docx",
            fallback_activated=bool(fallback_reason),
            fallback_reason=fallback_reason,
            error="pdf2docx not installed. Run: pip install pdf2docx",
            elapsed_seconds=time.monotonic() - t0,
        )

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)

        start = page_range[0] if page_range else 0
        end   = page_range[1] if page_range else None

        cv = Converter(str(input_path))
        cv.convert(str(output_path), start=start, end=end)
        cv.close()

        return ConversionResult(
            status=(
                ConversionStatus.FALLBACK_SUCCESS if fallback_reason
                else ConversionStatus.SUCCESS
            ),
            input_path=input_path,
            output_path=output_path,
            engine_used="pdf2docx",
            fallback_activated=bool(fallback_reason),
            fallback_reason=fallback_reason,
            elapsed_seconds=time.monotonic() - t0,
            metadata={"page_range": page_range},
        )

    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="pdf2docx",
            fallback_activated=bool(fallback_reason),
            fallback_reason=fallback_reason,
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )
