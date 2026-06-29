# smoke_test_phase2.py
"""
Quick integration test for all Phase 2 engines.
Requires: a sample.pdf, sample.docx, and sample.html in tests/fixtures/.
Run: python smoke_test_phase2.py
"""
from pathlib import Path
from docsuitekit.engines.pdf_repair    import repair_pdf
from docsuitekit.engines.pdf_compress  import compress_pdf, convert_to_pdfa, CompressionQuality
from docsuitekit.engines.pdf_redact    import redact_predefined, redact_regions
from docsuitekit.engines.pdf_compare   import compare_pdfs, export_html_report
from docsuitekit.engines.office_to_pdf import office_to_pdf
from docsuitekit.engines.html_to_pdf   import html_to_pdf
from docsuitekit.core.result           import ConversionStatus

FIXTURES = Path("tests/fixtures")
OUT      = Path("tests/output_phase2")
OUT.mkdir(parents=True, exist_ok=True)


def check(label: str, result) -> None:
    icon = "✅" if getattr(result, "succeeded", getattr(result, "has_differences", None) is False) else "❌"
    engine = getattr(result, "engine_used", "N/A")
    err    = getattr(result, "error", None)
    fb     = getattr(result, "fallback_activated", False)
    fb_tag = f" [fallback: {result.fallback_reason}]" if fb else ""
    print(f"{icon} {label:<35} engine={engine}{fb_tag}" + (f"  ERROR: {err}" if err else ""))


src = FIXTURES / "sample.pdf"

if not src.exists():
    print(f"⚠️ Fixture not found: {src}. Skipping PDF-based tests.")
else:
    check("repair_pdf",       repair_pdf(src, OUT / "repaired.pdf"))
    check("compress_screen",  compress_pdf(src, OUT / "compressed_screen.pdf",  CompressionQuality.SCREEN))
    check("compress_printer", compress_pdf(src, OUT / "compressed_printer.pdf", CompressionQuality.PRINTER))
    check("pdf_to_pdfa",      convert_to_pdfa(src, OUT / "archive.pdf"))
    check("redact_pii",       redact_predefined(src, OUT / "redacted_pii.pdf", ["ssn", "email"]))
    check("redact_region",    redact_regions(src, OUT / "redacted_region.pdf", [(0, (50, 50, 300, 100))]))

    report = compare_pdfs(src, src)   # Self-comparison should yield 1.0 / 1.0
    check("compare_self",     report)
    export_html_report(report, OUT / "diff_report.html")
    print(f"   compare_self: text={report.overall_text_similarity:.4f}  ssim={report.overall_ssim:.4f}")

if (FIXTURES / "sample.docx").exists():
    check("docx_to_pdf",  office_to_pdf(FIXTURES / "sample.docx", OUT / "from_docx.pdf"))
else:
    print(f"⚠️ Fixture not found: {FIXTURES / 'sample.docx'}")

if (FIXTURES / "sample.xlsx").exists():
    check("xlsx_to_pdf",  office_to_pdf(FIXTURES / "sample.xlsx", OUT / "from_xlsx.pdf"))

if (FIXTURES / "sample.pptx").exists():
    check("pptx_to_pdf",  office_to_pdf(FIXTURES / "sample.pptx", OUT / "from_pptx.pdf"))

check("html_to_pdf",
    html_to_pdf(
        "<html><body><h1>Test</h1><p>Phase 2 smoke test.</p></body></html>",
        OUT / "from_html.pdf",
    )
)

print("\nAll Phase 2 outputs written to:", OUT.resolve())
