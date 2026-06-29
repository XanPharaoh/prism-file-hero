#!/usr/bin/env python3
"""
DocSuiteKit — application entry point and CLI.

PyInstaller compiles this file as the frozen executable's bootstrap.
All engine imports are deferred to subcommand handlers: startup time
stays under 2 seconds regardless of how many optional packages are
installed, because no heavy libraries are imported until they are needed.
"""

import argparse
import logging
import sys
from pathlib import Path


def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        format="%(asctime)s [%(levelname)-8s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        level=level,
        stream=sys.stdout,
    )
    for noisy in ["PIL", "pdfminer", "ocrmypdf", "weasyprint", "httpx", "urllib3"]:
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _startup_checks() -> None:
    """
    Inject bundled binary directories into PATH and start Ollama daemon.
    Must run before any engine is imported.
    """
    from docsuitekit.core.binary_resolver import inject_binary_dirs
    from docsuitekit.config import (
        TESSERACT_BIN, GHOSTSCRIPT_BIN,
        LIBREOFFICE_BIN, QPDF_BIN
    )
    inject_binary_dirs([TESSERACT_BIN, GHOSTSCRIPT_BIN, LIBREOFFICE_BIN, QPDF_BIN])
    # Ollama daemon is started lazily — only when verification or translation is needed


def _print_result(result) -> None:
    icon   = "✅" if result.succeeded else "❌"
    fb     = " [fallback]" if result.fallback_activated else ""
    timing = f"{result.elapsed_seconds:.2f}s"
    print(f"{icon} {result.status.value}  engine={result.engine_used}{fb}  {timing}")
    if result.error:
        print(f"   Error: {result.error}", file=sys.stderr)
    if result.verification:
        v      = result.verification
        score  = f"  semantic={v.semantic_score:.4f}" if v.semantic_score else ""
        visual = f"  visual={v.visual_status.value}"   if v.visual_status  else ""
        print(f"   Verify: {v.status.value}{score}{visual}")
        if v.error:
            print(f"   Verify error: {v.error}", file=sys.stderr)
    if result.output_path:
        size_mb = result.output_path.stat().st_size / (1024 * 1024)
        print(f"   Output: {result.output_path}  ({size_mb:.1f} MB)")


# ── Subcommand handlers ────────────────────────────────────────────────────────

def cmd_convert(args):
    from docsuitekit.core.conversion_pipeline import ConversionPipeline, PipelineConfig, VerificationMode
    mode     = VerificationMode[args.verify.upper()]
    pipeline = ConversionPipeline(PipelineConfig(verification_mode=mode))
    result   = pipeline.execute(
        args.type, Path(args.input), Path(args.output)
    )
    _print_result(result)
    sys.exit(0 if result.succeeded else 1)


def cmd_ocr(args):
    from docsuitekit.engines.ocr import ocr_pdf, OcrMode
    result = ocr_pdf(
        Path(args.input), Path(args.output),
        languages=args.lang.split("+"),
        mode=OcrMode[args.mode.upper()],
    )
    _print_result(result)
    sys.exit(0 if result.succeeded else 1)


def cmd_scan(args):
    import platform
    if platform.system() != "Windows":
        print("ERROR: Scanner acquisition requires Windows.", file=sys.stderr)
        sys.exit(1)
    from docsuitekit.engines.scanner import scan_to_pdf, ScanSettings, ScanMode
    settings = ScanSettings(
        dpi=args.dpi,
        mode=ScanMode[args.mode.upper()],
        auto_deskew=not args.no_deskew,
        ocr_after_scan=args.ocr,
        ocr_languages=args.lang.split("+"),
    )
    result = scan_to_pdf(Path(args.output), scanner_index=args.scanner, settings=settings)
    _print_result(result)
    sys.exit(0 if result.succeeded else 1)


def cmd_verify(args):
    from docsuitekit.verification.pipeline import run_verification, get_default_config
    config = get_default_config(args.type) if args.type else None
    result = run_verification(Path(args.source), Path(args.output), config)
    score  = f"  semantic={result.semantic_score:.4f}" if result.semantic_score else ""
    visual = f"  visual={result.visual_status.value}"   if result.visual_status  else ""
    print(f"Verification: {result.status.value}{score}{visual}")
    if result.error:
        print(f"  Error: {result.error}", file=sys.stderr)
    sys.exit(0 if result.status.value in ("passed", "skipped") else 1)


def cmd_models(args):
    from packaging.post_install_models import download_models, list_available_models
    if args.list:
        list_available_models()
    else:
        download_models(args.models or None)


def cmd_scanners(args):
    import platform
    if platform.system() != "Windows":
        print("Scanner listing requires Windows.")
        sys.exit(0)
    from docsuitekit.engines.scanner import list_scanners
    scanners = list_scanners()
    if not scanners:
        print("No WIA-compatible scanners detected.")
    for i, s in enumerate(scanners):
        print(f"[{i}] {s.name}  ADF={s.has_adf}  Flatbed={s.has_flatbed}")


# ── Argument parser ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        prog="docsuitekit",
        description="Zero-cost, offline document processing suite.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  docsuitekit convert pdf_to_word input.pdf output.docx
  docsuitekit convert compress    input.pdf output.pdf
  docsuitekit convert ocr         scan.pdf  ocr.pdf
  docsuitekit ocr input.pdf output.pdf --lang eng+fra --mode best
  docsuitekit scan output.pdf --dpi 300 --ocr
  docsuitekit verify source.pdf output.docx --type pdf_to_word
  docsuitekit models --list
  docsuitekit models nomic-embed-text llama3.2-vision
        """,
    )
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Enable debug logging")

    sub = parser.add_subparsers(dest="command", required=True)

    # convert
    p = sub.add_parser("convert", help="Convert between document formats.")
    p.add_argument("type",   help="Conversion type (e.g. pdf_to_word, compress, translate)")
    p.add_argument("input",  help="Input file path")
    p.add_argument("output", help="Output file path")
    p.add_argument("--verify", choices=["sync", "background", "skip"], default="sync",
                   help="Verification mode (default: sync)")
    p.set_defaults(func=cmd_convert)

    # ocr
    p = sub.add_parser("ocr", help="Apply non-destructive OCR to a scanned PDF.")
    p.add_argument("input"); p.add_argument("output")
    p.add_argument("--lang", default="eng", help="Tesseract language codes, e.g. eng+fra")
    p.add_argument("--mode", choices=["fast", "standard", "best"], default="standard")
    p.set_defaults(func=cmd_ocr)

    # scan
    p = sub.add_parser("scan", help="Scan from hardware scanner to PDF (Windows only).")
    p.add_argument("output")
    p.add_argument("--scanner",   type=int, default=0)
    p.add_argument("--dpi",       type=int, default=300)
    p.add_argument("--mode",      choices=["bw", "grayscale", "color"], default="color")
    p.add_argument("--lang",      default="eng")
    p.add_argument("--ocr",       action="store_true", help="Run OCR after scanning")
    p.add_argument("--no-deskew", action="store_true")
    p.set_defaults(func=cmd_scan)

    # verify
    p = sub.add_parser("verify", help="Verify fidelity between source and converted document.")
    p.add_argument("source"); p.add_argument("output")
    p.add_argument("--type", default=None, help="Conversion type for threshold selection")
    p.set_defaults(func=cmd_verify)

    # scanners
    p = sub.add_parser("scanners", help="List connected WIA scanners (Windows only).")
    p.set_defaults(func=cmd_scanners)

    # models
    p = sub.add_parser("models", help="Manage local Ollama AI models.")
    p.add_argument("--list", action="store_true", help="List available and installed models")
    p.add_argument("models", nargs="*", help="Model names to download")
    p.set_defaults(func=cmd_models)

    args = parser.parse_args()
    _setup_logging(args.verbose)
    _startup_checks()
    args.func(args)


if __name__ == "__main__":
    main()
