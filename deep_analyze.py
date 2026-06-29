"""Deep-dive: extract raw PDF text structure for Nedbank, Capitec, TymeBank statements."""
import pymupdf as fitz
import os

PDF_DIR = r"C:\Users\Philander\Downloads\Test accounts"

def show_pdf_structure(path, max_pages=3):
    name = os.path.basename(path)
    doc = fitz.open(path)
    print(f"\n{'='*80}")
    print(f"FILE: {name}")
    print(f"Pages: {doc.page_count}")
    print(f"{'='*80}")
    
    for i in range(min(doc.page_count, max_pages)):
        page = doc[i]
        text = page.get_text()
        lines = text.split('\n')
        print(f"\n--- PAGE {i+1} ({len(lines)} lines) ---")
        for j, line in enumerate(lines):
            stripped = line.rstrip()
            if stripped:
                print(f"  L{j+1:03d}: {stripped[:150]}")
    doc.close()


# Nedbank
for f in ["10. January 2026.pdf", "January 2026.pdf"]:
    path = os.path.join(PDF_DIR, f)
    if os.path.exists(path):
        show_pdf_structure(path)

# Capitec
for f in os.listdir(PDF_DIR):
    if f.startswith("Account Statement") and f.endswith(".pdf"):
        show_pdf_structure(os.path.join(PDF_DIR, f))

# TymeBank
for f in os.listdir(PDF_DIR):
    if "TymeBank" in f and f.endswith(".pdf"):
        show_pdf_structure(os.path.join(PDF_DIR, f))

# FNB with issues
for f in ["Br Terence 2026-01.pdf", "2026-01.pdf"]:
    path = os.path.join(PDF_DIR, f)
    if os.path.exists(path):
        show_pdf_structure(path, max_pages=1)
