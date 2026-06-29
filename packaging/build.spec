# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for DocSuiteKit.
"""

import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_data_files

# ── Path resolution ────────────────────────────────────────────────────────────
# SPECPATH is injected by PyInstaller: the directory containing this .spec file.
PACKAGING_DIR = Path(SPECPATH)
ROOT          = PACKAGING_DIR.parent
BIN_DIR       = ROOT / "bin"
BUNDLE_LO     = bool(os.environ.get("BUNDLE_LO")) or (BIN_DIR / "lo").exists()

print(f"[build.spec] ROOT       = {ROOT}")
print(f"[build.spec] BIN_DIR    = {BIN_DIR}")
print(f"[build.spec] BUNDLE_LO  = {BUNDLE_LO}")

datas         = []
binaries      = []
hiddenimports = []

_COLLECT_ALL_PACKAGES = [
    "ocrmypdf", "pdfplumber", "camelot", "weasyprint", "pyhanko",
    "docling", "pdf2docx", "argostranslate",
]

for pkg in _COLLECT_ALL_PACKAGES:
    try:
        d, b, h = collect_all(pkg)
        datas         += d
        binaries      += b
        hiddenimports += h
    except Exception as e:
        print(f"[build.spec] WARNING: collect_all('{pkg}') failed: {e}")

hiddenimports += [
    "pkg_resources", "pkg_resources.extern",
    "importlib.metadata", "importlib.resources",
    "ocrmypdf.builtin_plugins",
    "ocrmypdf.builtin_plugins.concurrency",
    "ocrmypdf.builtin_plugins.ghostscript",
    "ocrmypdf.builtin_plugins.optimize",
    "ocrmypdf.builtin_plugins.tesseract_ocr",
    "ocrmypdf.builtin_plugins.unpaper",
    "pdfminer", "pdfminer.high_level", "pdfminer.layout",
    "pdfminer.pdfinterp", "pdfminer.converter", "pdfminer.pdfpage",
    "PIL._imaging", "PIL.Image", "PIL.ImageDraw",
    "numpy", "numpy.core", "scipy", "scipy.ndimage",
    "skimage", "skimage.metrics", "cv2",
    "win32com.client", "win32com.shell", "pythoncom", "pywintypes",
    "fitz", "pypdf", "pdf2docx", "pptx", "xhtml2pdf", "weasyprint",
    "pandas", "pandas.io.formats", "openpyxl",
    "pyhanko.sign", "pyhanko_certvalidator",
    "ollama", "huggingface_hub", "onnxruntime", "argostranslate",
    "docling.document_converter", "pdf2zh", "deskew",
]

datas += [
    (str(ROOT / "assets" / "icon.ico"), "assets"),
]

tessdata = BIN_DIR / "tesseract" / "tessdata"
if tessdata.exists():
    datas += [(str(tessdata / "*.traineddata"), "bin/tesseract/tessdata")]

a = Analysis(
    [str(ROOT / "main.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=list(set(hiddenimports)),
    hookspath=[str(PACKAGING_DIR / "hooks")],
    excludes=["matplotlib", "tkinter", "pytest", "sphinx"],
    noarchive=False,
    optimize=1,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="DocSuiteKit",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=["vcruntime*.dll", "python*.dll", "*.pyd"],
    console=True,
    icon=str(ROOT / "assets" / "icon.ico"),
    version=str(PACKAGING_DIR / "version_info.py"),
)

def _tree_if_exists(src_dir: Path, prefix: str):
    if src_dir.exists():
        return Tree(str(src_dir), prefix=prefix)
    return None

_trees = [
    _tree_if_exists(BIN_DIR / "tesseract", "bin/tesseract"),
    _tree_if_exists(BIN_DIR / "gs",        "bin/gs"),
    _tree_if_exists(BIN_DIR / "qpdf",      "bin/qpdf"),
    _tree_if_exists(BIN_DIR / "ollama",    "bin/ollama"),
]

if BUNDLE_LO:
    t = _tree_if_exists(BIN_DIR / "lo", "bin/lo")
    if t: _trees.append(t)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    *[t for t in _trees if t is not None],
    strip=False,
    upx=False,
    name="DocSuiteKit",
)
