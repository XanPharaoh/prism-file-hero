"""
packaging/create_assets.py
Generates WiX installer assets. Run once before build_orchestrator.py.
Requires: pip install Pillow
"""

import textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

PACKAGING    = Path(__file__).parent
# Ensure assets dir exists relative to root (one level up from packaging)
ROOT         = PACKAGING.parent
ASSETS_DIR   = ROOT / "assets"
ASSETS_DIR.mkdir(exist_ok=True)

DARK         = (28,  36,  54)
MID          = (42,  82, 152)
ACCENT       = (0,  168, 232)
WHITE        = (255, 255, 255)


def _font(size: int) -> ImageFont.FreeTypeFont:
    for name in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def create_banner() -> None:
    """493 × 58 px — shown on every interior installer page."""
    w, h = 493, 58
    img  = Image.new("RGB", (w, h), DARK)
    draw = ImageDraw.Draw(img)
    # Left-to-right gradient across first 200 px
    for x in range(200):
        t = x / 200
        c = tuple(int(DARK[i] + (MID[i] - DARK[i]) * t) for i in range(3))
        draw.line([(x, 0), (x, h)], fill=c)
    # Accent bar along bottom edge
    draw.rectangle([(0, h - 3), (w, h)], fill=ACCENT)
    # Product name + subtitle
    draw.text((16, 7),  "DocSuiteKit",              font=_font(22), fill=WHITE)
    draw.text((16, 38), "Document Processing Suite", font=_font(11), fill=(180, 200, 230))
    # Small logo circle top-right
    lx, ly, lr = w - 44, 10, 18
    draw.ellipse([(lx - lr, ly), (lx + lr, ly + lr * 2)], fill=ACCENT)
    draw.text((lx - 10, ly + 3), "DS", font=_font(16), fill=DARK)
    img.save(PACKAGING / "Banner.bmp", "BMP")
    print(f"  ✓  Banner.bmp  ({w}×{h})")


def create_dialog() -> None:
    """493 × 312 px — left panel on Welcome / Finish pages."""
    w, h = 493, 312
    img  = Image.new("RGB", (w, h), DARK)
    draw = ImageDraw.Draw(img)
    # Vertical gradient
    for y in range(h):
        t = y / h
        c = (int(DARK[0]*(1-t*.3)), int(DARK[1]*(1-t*.1)), min(int(DARK[2]+30*t), 255))
        draw.line([(0, y), (w, y)], fill=c)
    # Diagonal stripe decoration
    for i in range(-60, 80, 14):
        draw.line([(i, 0), (i + h, h)], fill=(*MID, 50), width=7)
    # Logo circle
    cx, cy, cr = 100, 100, 55
    draw.ellipse([(cx-cr, cy-cr), (cx+cr, cy+cr)], fill=ACCENT)
    draw.text((cx - 24, cy - 20), "DS", font=_font(38), fill=DARK)
    # Text
    draw.text((30, 172), "DocSuiteKit",                  font=_font(28), fill=WHITE)
    draw.text((30, 207), "Document Processing Suite",    font=_font(14), fill=(160, 195, 235))
    draw.text((30, 233), "Convert · OCR · Redact · Verify", font=_font(11), fill=(130, 165, 210))
    draw.text((30, h-24), "Version 1.0.0",              font=_font(10), fill=(80, 100, 130))
    # White fade on right edge to blend into installer content panel
    for x in range(w - 20, w):
        alpha = int(255 * (x - (w - 20)) / 20)
        draw.line([(x, 0), (x, h)], fill=(alpha, alpha, alpha))
    img.save(PACKAGING / "Dialog.bmp", "BMP")
    print(f"  ✓  Dialog.bmp  ({w}×{h})")


def create_license_rtf() -> None:
    """RTF licence file required by WiX LicenseAgreementDlg."""
    body = textwrap.dedent("""\
        DOCSUITEKIT SOFTWARE LICENSE AGREEMENT
        Copyright (c) 2025 DocSuiteKit Contributors.  All rights reserved.

        GRANT OF LICENSE
        Permission is hereby granted, free of charge, to any person obtaining a copy
        of this software to use, copy, modify, merge, publish, and distribute it,
        subject to the following conditions:

        The above copyright notice and this permission notice shall be included in all
        copies or substantial portions of the Software.

        DISCLAIMER
        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.  IN NO EVENT
        SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM OR DAMAGES ARISING FROM USE OF THE
        SOFTWARE.

        THIRD-PARTY COMPONENTS
        Ghostscript (AGPL v3 / Commercial), Tesseract OCR (Apache 2.0), LibreOffice
        (MPL 2.0), qpdf (Apache 2.0), Poppler (GPL v2).  Individual licences are in
        the _internal\\licenses\\ folder of the installation directory.

        By installing this software you agree to all terms above.
    """)

    def rtf_escape(text: str) -> str:
        text = text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
        return "\n".join(line + "\\par" for line in text.splitlines())

    rtf = (
        r"{\rtf1\ansi\ansicpg1252\deff0"
        r"{\fonttbl{\f0\fswiss\fcharset0 Segoe UI;}}"
        r"\f0\fs20 "
        + rtf_escape(body)
        + r"}"
    )
    (PACKAGING / "License.rtf").write_text(rtf, encoding="utf-8")
    print("  ✓  License.rtf")


def main() -> None:
    print("\nDocSuiteKit — Generating WiX installer assets")
    print("─" * 46)
    try:
        create_banner()
        create_dialog()
        create_license_rtf()
        print("\n✓ All assets ready.\n")
    except ImportError:
        print("\n✗ Pillow required:  pip install Pillow\n")
        raise

if __name__ == "__main__":
    main()
