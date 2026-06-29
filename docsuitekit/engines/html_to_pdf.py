import logging
import time
from io import BytesIO
from pathlib import Path
from typing import Optional, Union

from docsuitekit.core.result import ConversionResult, ConversionStatus

logger = logging.getLogger(__name__)


def html_to_pdf(
    source: Union[Path, str],
    output_path: Path,
    base_url: Optional[str] = None,
    css_string: Optional[str] = None,
) -> ConversionResult:
    """
    Render HTML to PDF with a two-engine fallback chain.

    Engine 1 — xhtml2pdf (primary):
        Pure-Python. Zero external binary dependency. Parses the HTML DOM
        alongside CSS and translates each element into ReportLab canvas
        draw operations. Fast, lightweight, and reliable for documents using
        standard Bootstrap-era CSS (floats, basic flexbox, tables, images).

        Limitation: xhtml2pdf does not execute JavaScript and has partial
        support for CSS Grid and modern Flexbox specifications.

    Engine 2 — WeasyPrint (fallback):
        A layout engine that implements the CSS 2.1 and CSS 3 specifications
        far more completely than xhtml2pdf. Handles multi-column layouts,
        CSS Grid, named pages, @media print rules, and SVG embedded content.
        It is significantly heavier than xhtml2pdf due to its Cairo/Pango
        dependency chain, but produces the open-source state-of-the-art for
        web-to-print rendering.

        base_url: passed to WeasyPrint to resolve relative asset paths
        (images, stylesheets). When source is a file Path, the parent
        directory is used automatically if base_url is not specified.

    source: either a Path to an .html file or a raw HTML string.
    css_string: additional CSS injected before rendering (xhtml2pdf only;
                WeasyPrint reads stylesheets from the HTML itself).
    """
    t0 = time.monotonic()
    html_bytes, resolved_base = _resolve_source(source, base_url)

    # ── Primary: xhtml2pdf ─────────────────────────────────────────────────────
    result = _xhtml2pdf_convert(html_bytes, output_path, css_string, t0)
    if result.succeeded:
        return result

    logger.warning(
        "xhtml2pdf failed (%s); falling back to WeasyPrint.", result.error
    )

    # ── Fallback: WeasyPrint ───────────────────────────────────────────────────
    return _weasyprint_convert(
        html_bytes, output_path, resolved_base, t0, fallback_reason=result.error
    )


# ── Engine implementations ─────────────────────────────────────────────────────

def _xhtml2pdf_convert(
    html_bytes: bytes,
    output_path: Path,
    css_string: Optional[str],
    t0: float,
) -> ConversionResult:
    try:
        from xhtml2pdf import pisa

        output_path.parent.mkdir(parents=True, exist_ok=True)
        buf = BytesIO()

        # Optionally inject additional CSS into the HTML payload
        html_content = html_bytes.decode("utf-8", errors="replace")
        if css_string:
            style_tag = f"<style>{css_string}</style>"
            # Inject before </head> if it exists, otherwise prepend
            if "</head>" in html_content:
                html_content = html_content.replace("</head>", f"{style_tag}</head>", 1)
            else:
                html_content = style_tag + html_content

        result = pisa.CreatePDF(html_content, dest=buf)

        if result.err:
            return ConversionResult(
                status=ConversionStatus.FAILURE,
                input_path=output_path,   # No clean input_path concept here
                engine_used="xhtml2pdf",
                error=f"xhtml2pdf reported {result.err} error(s).",
                elapsed_seconds=time.monotonic() - t0,
            )

        output_path.write_bytes(buf.getvalue())
        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=output_path,
            output_path=output_path,
            engine_used="xhtml2pdf",
            elapsed_seconds=time.monotonic() - t0,
        )

    except ImportError:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=output_path,
            engine_used="xhtml2pdf",
            error="xhtml2pdf is not installed.",
            elapsed_seconds=time.monotonic() - t0,
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=output_path,
            engine_used="xhtml2pdf",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )


def _weasyprint_convert(
    html_bytes: bytes,
    output_path: Path,
    base_url: Optional[str],
    t0: float,
    fallback_reason: Optional[str] = None,
) -> ConversionResult:
    try:
        from weasyprint import HTML, CSS
        from weasyprint.text.fonts import FontConfiguration

        output_path.parent.mkdir(parents=True, exist_ok=True)
        font_config = FontConfiguration()

        HTML(
            string=html_bytes.decode("utf-8", errors="replace"),
            base_url=base_url,
        ).write_pdf(
            str(output_path),
            font_config=font_config,
        )

        return ConversionResult(
            status=(
                ConversionStatus.FALLBACK_SUCCESS if fallback_reason
                else ConversionStatus.SUCCESS
            ),
            input_path=output_path,
            output_path=output_path,
            engine_used="WeasyPrint",
            fallback_activated=bool(fallback_reason),
            fallback_reason=fallback_reason,
            elapsed_seconds=time.monotonic() - t0,
        )

    except ImportError:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=output_path,
            engine_used="WeasyPrint",
            fallback_activated=True,
            fallback_reason=fallback_reason,
            error="WeasyPrint is not installed. Run: pip install WeasyPrint",
            elapsed_seconds=time.monotonic() - t0,
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=output_path,
            engine_used="WeasyPrint",
            fallback_activated=True,
            fallback_reason=fallback_reason,
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )


# ── Source resolution ──────────────────────────────────────────────────────────

def _resolve_source(
    source: Union[Path, str],
    base_url: Optional[str],
) -> tuple[bytes, Optional[str]]:
    """
    Normalise source to bytes and resolve the best base_url for asset loading.

    If source is a Path, the file is read and base_url defaults to the
    parent directory URI. If source is a raw HTML string, it is encoded
    directly and base_url is left to the caller's specification.
    """
    if isinstance(source, Path):
        html_bytes = source.read_bytes()
        resolved_base = base_url or source.parent.as_uri()
    else:
        html_bytes = source.encode("utf-8") if isinstance(source, str) else source
        resolved_base = base_url

    return html_bytes, resolved_base
