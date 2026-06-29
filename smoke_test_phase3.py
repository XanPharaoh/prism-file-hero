# smoke_test_phase3.py
"""
Integration test for all Phase 3 reconstruction engines.
Requires test fixtures in tests/fixtures/ and Phase 1-2 modules in place.
Run: python smoke_test_phase3.py
"""
import sys
import os
from pathlib import Path

# Add the project root to sys.path to allow absolute imports from docsuitekit
sys.path.append(os.path.abspath("."))

from docsuitekit.engines.pdf_to_word  import pdf_to_word
from docsuitekit.engines.pdf_to_excel import pdf_to_excel
from docsuitekit.engines.pdf_to_pptx  import pdf_to_pptx
from docsuitekit.core.result          import ConversionStatus

FIXTURES = Path("tests/fixtures")
OUT      = Path("tests/output_phase3")
OUT.mkdir(parents=True, exist_ok=True)

src = FIXTURES / "sample.pdf"
if not src.exists():
    print(f"ERROR: Test fixture not found at {src.resolve()}")
    sys.exit(1)


def report(label: str, result) -> None:
    status = result.status.value
    engine = result.engine_used
    fb     = f" [fallback: {result.fallback_reason[:60]}]" if result.fallback_activated else ""
    err    = f"\n   ↳ ERROR: {result.error}" if result.error else ""
    meta   = ""
    if result.metadata:
        meta = "  " + "  ".join(f"{k}={v}" for k, v in result.metadata.items()
                                if v is not None)
    icon = "✅" if result.succeeded else "❌"
    print(f"{icon} {label:<40} [{status}] engine={engine}{fb}{meta}{err}")


# ── PDF to Word ─────────────────────────────────────────────────────────────────
print("\n── PDF → DOCX ────────────────────────────────────────────────────────────")
report("pdf_to_word (Docling primary)",
    pdf_to_word(src, OUT / "output_docling.docx", prefer_docling=True))

report("pdf_to_word (pdf2docx direct)",
    pdf_to_word(src, OUT / "output_pdf2docx.docx", prefer_docling=False))

report("pdf_to_word (page_range 0-2)",
    pdf_to_word(src, OUT / "output_pages0_2.docx",
                prefer_docling=False, page_range=(0, 2)))

# ── PDF to Excel ────────────────────────────────────────────────────────────────
print("\n── PDF → XLSX ────────────────────────────────────────────────────────────")
report("pdf_to_excel (all pages)",
    pdf_to_excel(src, OUT / "output_all.xlsx"))

report("pdf_to_excel (page 1 only, 1-indexed str)",
    pdf_to_excel(src, OUT / "output_p1.xlsx", pages="1"))

# Test with a PDF known to have tables if available
bordered_pdf = FIXTURES / "tables_bordered.pdf"
if bordered_pdf.exists():
    report("pdf_to_excel (bordered tables)",
        pdf_to_excel(bordered_pdf, OUT / "output_bordered.xlsx"))

borderless_pdf = FIXTURES / "tables_borderless.pdf"
if borderless_pdf.exists():
    report("pdf_to_excel (borderless — stream mode)",
        pdf_to_excel(borderless_pdf, OUT / "output_borderless.xlsx"))

# ── PDF to PPTX ─────────────────────────────────────────────────────────────────
print("\n── PDF → PPTX ────────────────────────────────────────────────────────────")
r = pdf_to_pptx(src, OUT / "output_150dpi.pptx", dpi=150)
report("pdf_to_pptx (150 DPI, JPEG)", r)

r_hq = pdf_to_pptx(src, OUT / "output_200dpi.pptx", dpi=200, jpeg_quality=92)
report("pdf_to_pptx (200 DPI, HQ JPEG)", r_hq)

r_png = pdf_to_pptx(src, OUT / "output_png.pptx", dpi=150, jpeg_quality=0)
report("pdf_to_pptx (150 DPI, lossless PNG)", r_png)

# ── Verify slide count matches page count ───────────────────────────────────────
if r.succeeded and r.metadata.get("slides") is not None:
    import fitz
    page_count  = len(fitz.open(str(src)))
    slide_count = r.metadata["slides"]
    match       = "✅" if page_count == slide_count else "❌"
    print(f"\n{match} Slide count check: {slide_count} slides == {page_count} PDF pages")

print(f"\nAll Phase 3 outputs written to: {OUT.resolve()}")
