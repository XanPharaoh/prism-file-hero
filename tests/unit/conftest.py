# tests/unit/conftest.py
import pytest
from pathlib import Path

@pytest.fixture
def tmp_pdf(tmp_path) -> Path:
    """Minimal valid 1-page PDF for tests that need a real file."""
    pdf_bytes = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n"
        b"0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF"
    )
    p = tmp_path / "sample.pdf"
    p.write_bytes(pdf_bytes)
    return p
