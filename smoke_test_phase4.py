# smoke_test_phase4.py
"""
Integration test for Phase 4: OCR, Scanner, and Translation engines.
Run: python smoke_test_phase4.py
"""
import platform
import sys
import os
from pathlib import Path

# Add the project root to sys.path
sys.path.append(os.path.abspath("."))

from docsuitekit.engines.ocr      import ocr_pdf, OcrMode, get_available_languages
from docsuitekit.engines.translate import translate_pdf, SUPPORTED_LANGUAGES
from docsuitekit.core.result       import ConversionStatus

FIXTURES = Path("tests/fixtures")
OUT      = Path("tests/output_phase4")
OUT.mkdir(parents=True, exist_ok=True)

# Try to find a scanned sample; fallback to the standard sample
src = FIXTURES / "sample_scanned.pdf"
if not src.exists():
    src = FIXTURES / "sample.pdf"

if not src.exists():
    print(f"ERROR: No test fixture found in {FIXTURES.resolve()}")
    sys.exit(1)


def report(label: str, result) -> None:
    icon   = "✅" if result.succeeded else "❌"
    status = result.status.value
    engine = result.engine_used
    fb     = f" [fallback: {result.fallback_reason[:50]}]" if result.fallback_activated else ""
    err    = f"\n   ↳ ERROR: {result.error}" if result.error else ""
    meta   = ""
    if result.metadata:
        pairs = [(k, v) for k, v in result.metadata.items() if v is not None]
        meta  = "  " + "  ".join(f"{k}={v}" for k, v in pairs[:4])
    print(f"{icon} {label:<45} [{status}] engine={engine}{fb}{meta}{err}")


# ── Language discovery ──────────────────────────────────────────────────────────
print("\n── Tesseract language discovery ──────────────────────────────────────────")
langs = get_available_languages()
print(f"   Installed languages: {langs or 'NONE — add .traineddata files to bin/tesseract/tessdata/'}")


# ── OCR pipeline ────────────────────────────────────────────────────────────────
print("\n── OCR Pipeline ──────────────────────────────────────────────────────────")
if langs:
    report("ocr_pdf FAST mode",
        ocr_pdf(src, OUT / "ocr_fast.pdf", mode=OcrMode.FAST))

    report("ocr_pdf STANDARD mode",
        ocr_pdf(src, OUT / "ocr_standard.pdf", mode=OcrMode.STANDARD))

    report("ocr_pdf BEST mode",
        ocr_pdf(src, OUT / "ocr_best.pdf", mode=OcrMode.BEST))

    report("ocr_pdf skip_text=False (force re-OCR)",
        ocr_pdf(src, OUT / "ocr_force.pdf",
                mode=OcrMode.STANDARD, skip_text=False))
else:
    print("   ⚠️  Skipping OCR tests — no Tesseract language packs installed.")


# ── Scanner acquisition ─────────────────────────────────────────────────────────
print("\n── Scanner Acquisition (Windows only) ───────────────────────────────────")
if platform.system() == "Windows":
    from docsuitekit.engines.scanner import list_scanners, scan_to_pdf, ScanSettings, ScanMode

    scanners = list_scanners()
    if scanners:
        print(f"   Detected {len(scanners)} scanner(s):")
        for i, s in enumerate(scanners):
            print(f"   [{i}] {s.name}  ADF={s.has_adf}  Flatbed={s.has_flatbed}")

        settings = ScanSettings(dpi=300, mode=ScanMode.GRAYSCALE, auto_deskew=True)
        report("scan_to_pdf (default settings)",
            scan_to_pdf(OUT / "scan_output.pdf", scanner_index=0, settings=settings))

        if langs:
            ocr_settings = ScanSettings(
                dpi=300, mode=ScanMode.GRAYSCALE,
                auto_deskew=True, ocr_after_scan=True, ocr_languages=["eng"],
            )
            report("scan_to_pdf + auto OCR",
                scan_to_pdf(OUT / "scan_ocr.pdf", scanner_index=0, settings=ocr_settings))
    else:
        print("   No scanners connected. Attach a WIA-compatible scanner to test.")
else:
    print(f"   Skipped — WIA is Windows-only (current platform: {platform.system()}).")


# ── Translation pipeline ────────────────────────────────────────────────────────
print("\n── Translation Pipeline ──────────────────────────────────────────────────")
from docsuitekit.core.process_manager import OllamaDaemonManager

ollama_running = OllamaDaemonManager.is_running()
print(f"   Ollama daemon running: {ollama_running}")

if ollama_running:
    report("translate_pdf EN→ZH (pdf2zh + Ollama)",
        translate_pdf(src, OUT / "translated_zh.pdf",
                      source_lang="en", target_lang="zh",
                      ollama_model="qwen2.5"))
else:
    print("   Ollama not running. Testing argostranslate fallback path directly...")

    # Test the fallback independently
    from docsuitekit.engines.translate import _argostranslate_fallback
    import time
    r = _argostranslate_fallback(
        src, OUT / "translated_argo_fallback.pdf",
        source_lang="en", target_lang="fr",
        t0=time.monotonic(),
        fallback_reason="Ollama unavailable (manual fallback test)",
    )
    report("argostranslate fallback EN→FR", r)

print(f"\nAll Phase 4 outputs written to: {OUT.resolve()}")
