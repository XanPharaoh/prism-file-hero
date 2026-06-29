import logging
import re
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import fitz

from docsuitekit.core.result import ConversionResult, ConversionStatus

logger = logging.getLogger(__name__)

# ── Type alias ─────────────────────────────────────────────────────────────────
# (compiled regex, replacement string) — pdf-redactor receives a callable;
# the string is wrapped into a lambda at call time.
RedactionRule = Tuple[re.Pattern, str]

# ── Built-in PII patterns ──────────────────────────────────────────────────────
PATTERN_SSN         = re.compile(r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b")
PATTERN_CREDIT_CARD = re.compile(r"\b(?:\d{4}[-\s]?){3}\d{4}\b")
PATTERN_EMAIL       = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
PATTERN_PHONE_US    = re.compile(
    r"\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"
)
PATTERN_IP_ADDRESS  = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"
)

PREDEFINED_PATTERNS: Dict[str, re.Pattern] = {
    "ssn":          PATTERN_SSN,
    "credit_card":  PATTERN_CREDIT_CARD,
    "email":        PATTERN_EMAIL,
    "phone_us":     PATTERN_PHONE_US,
    "ip_address":   PATTERN_IP_ADDRESS,
}

_FILL_CHAR = "█████"


def redact_patterns(
    input_path: Path,
    output_path: Path,
    rules: List[RedactionRule],
) -> ConversionResult:
    """
    Stream-level redaction via pdf-redactor.

    Surgically excises character data matching each pattern from the PDF's
    raw content streams. The data is permanently destroyed at the byte level —
    not visually covered. A malicious actor cannot recover the redacted content
    via copy-paste, pdftotext, or any scraping tool.

    Falls back to PyMuPDF coordinate-based redaction if pdf-redactor is
    unavailable or fails. The fallback removes content beneath bounding boxes
    but operates on extracted text coordinates rather than raw streams, making
    it slightly less robust against adversarial extraction on complex PDFs.

    rules: list of (compiled_regex, replacement_string) tuples.
    """
    t0 = time.monotonic()
    try:
        import pdf_redactor

        options = pdf_redactor.RedactorOptions()
        options.input_stream  = open(str(input_path), "rb")
        options.output_stream = open(str(output_path), "wb")

        # pdf-redactor expects a callable; wrap each replacement string.
        options.content_filters = [
            (pattern, lambda m, r=replacement: r)
            for pattern, replacement in rules
        ]

        pdf_redactor.redactor(options)
        options.input_stream.close()
        options.output_stream.close()

        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="pdf-redactor",
            elapsed_seconds=time.monotonic() - t0,
            metadata={"rule_count": len(rules)},
        )

    except ImportError:
        logger.warning("pdf-redactor not installed; using PyMuPDF coordinate fallback.")
        return _pymupdf_text_redact(input_path, output_path, rules, t0, "pdf-redactor not installed")
    except Exception as exc:
        logger.warning("pdf-redactor failed (%s); using PyMuPDF fallback.", exc)
        return _pymupdf_text_redact(input_path, output_path, rules, t0, str(exc))


def redact_regions(
    input_path: Path,
    output_path: Path,
    regions: List[Tuple[int, Tuple[float, float, float, float]]],
    fill_color: Tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> ConversionResult:
    """
    Coordinate-based destructive redaction using PyMuPDF.

    PyMuPDF's apply_redactions() permanently removes content beneath each
    annotation rectangle from the content stream — it does not merely draw
    a covering rectangle. Vector graphics, images, and text within the region
    are all destroyed.

    regions: list of (page_index, (x0, y0, x1, y1)) in PDF points (1pt = 1/72").
    fill_color: RGB tuple in 0–1 range for the visible redaction block.
    """
    t0 = time.monotonic()
    try:
        doc = fitz.open(str(input_path))
        count = 0

        for page_idx, coords in regions:
            if page_idx >= len(doc):
                logger.warning("Page index %d out of range (%d pages); skipping.", page_idx, len(doc))
                continue
            page = doc[page_idx]
            page.add_redact_annot(fitz.Rect(*coords), fill=fill_color)
            count += 1

        for page in doc:
            page.apply_redactions(
                images=fitz.PDF_REDACT_IMAGE_REMOVE,
                graphics=True,
            )

        doc.save(str(output_path), garbage=4, deflate=True)
        doc.close()

        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="PyMuPDF",
            elapsed_seconds=time.monotonic() - t0,
            metadata={"regions_redacted": count},
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="PyMuPDF",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )


def redact_predefined(
    input_path: Path,
    output_path: Path,
    pattern_keys: Optional[List[str]] = None,
) -> ConversionResult:
    """
    Convenience wrapper: apply one or more predefined PII pattern groups.
    pattern_keys: subset of PREDEFINED_PATTERNS keys. None = apply all.
    """
    keys = pattern_keys or list(PREDEFINED_PATTERNS.keys())
    unknown = set(keys) - set(PREDEFINED_PATTERNS.keys())
    if unknown:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="pdf-redactor",
            error=f"Unknown pattern keys: {unknown}. "
                  f"Valid options: {sorted(PREDEFINED_PATTERNS)}",
            elapsed_seconds=0.0,
        )
    rules: List[RedactionRule] = [(PREDEFINED_PATTERNS[k], _FILL_CHAR) for k in keys]
    return redact_patterns(input_path, output_path, rules)


# ── PyMuPDF fallback ───────────────────────────────────────────────────────────

def _pymupdf_text_redact(
    input_path: Path,
    output_path: Path,
    rules: List[RedactionRule],
    t0: float,
    fallback_reason: str,
) -> ConversionResult:
    """
    Find pattern matches in extracted text, locate their on-page bounding boxes
    via page.search_for(), and apply coordinate-based redactions.

    Limitation: page.search_for() matches visual text, not raw stream bytes.
    Ligatures, unusual font encodings, or reflow differences can cause misses.
    For sensitive data, prefer pdf-redactor (stream-level) as the primary engine.
    """
    try:
        doc = fitz.open(str(input_path))
        total_redacted = 0

        for page in doc:
            full_text = page.get_text("text")
            for pattern, _ in rules:
                for match in pattern.finditer(full_text):
                    matched_string = match.group(0)
                    # search_for returns a list of fitz.Rect for each visual occurrence
                    for rect in page.search_for(matched_string):
                        page.add_redact_annot(rect, fill=(0, 0, 0))
                        total_redacted += 1

        for page in doc:
            page.apply_redactions(
                images=fitz.PDF_REDACT_IMAGE_REMOVE,
                graphics=True,
            )

        doc.save(str(output_path), garbage=4, deflate=True)
        doc.close()

        return ConversionResult(
            status=ConversionStatus.FALLBACK_SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="PyMuPDF",
            fallback_activated=True,
            fallback_reason=fallback_reason,
            elapsed_seconds=time.monotonic() - t0,
            metadata={"instances_redacted": total_redacted},
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="PyMuPDF",
            fallback_activated=True,
            fallback_reason=fallback_reason,
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )
