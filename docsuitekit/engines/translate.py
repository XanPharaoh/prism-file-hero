"""
Layout-preserving cross-lingual PDF translation.

Primary:  pdf2zh (PDFMathTranslate) + Ollama local LLM backend
          Uses DocLayout-YOLO to map text vs non-text regions.
          Protects LaTeX math, inline code, and figure captions
          from being fed to the translation model.

Fallback: argostranslate + PyMuPDF text-block reconstruction
          Extracts text blocks with bounding boxes, translates each,
          and re-inserts at the original coordinates. Layout-imperfect
          but fully offline without pdf2zh dependency.

Ollama model recommendations for translation:
    qwen2.5:7b   — best multilingual coverage (CJK + European)
    mistral:7b   — European languages (EN/FR/DE/ES/IT/PT)
    llama3.1:8b  — Solid general multilingual support
    aya:8b       — Purpose-trained for 23 languages

pdf2zh CLI compatibility note:
    This module targets pdf2zh >= 1.0 (PDFMathTranslate project).
    CLI flag names changed between 0.x and 1.x releases:
    - 0.x used: --trans-lang / --source-lang
    - 1.x uses: --lang-out   / --lang-in
    Subprocess invocation uses 1.x syntax. If you encounter
    "unrecognised argument" errors, verify: pdf2zh --version
"""

import logging
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import fitz

from docsuitekit.core.process_manager import OllamaDaemonManager
from docsuitekit.core.result import ConversionResult, ConversionStatus

logger = logging.getLogger(__name__)


# ── Language code registry ─────────────────────────────────────────────────────
# Maps ISO 639-1 codes to pdf2zh service identifiers and argostranslate codes.
SUPPORTED_LANGUAGES: Dict[str, str] = {
    "en":     "English",
    "zh":     "Chinese (Simplified)",
    "zh-TW":  "Chinese (Traditional)",
    "fr":     "French",
    "de":     "German",
    "es":     "Spanish",
    "it":     "Italian",
    "pt":     "Portuguese",
    "ja":     "Japanese",
    "ko":     "Korean",
    "ru":     "Russian",
    "ar":     "Arabic",
    "hi":     "Hindi",
    "nl":     "Dutch",
    "pl":     "Polish",
    "tr":     "Turkish",
    "sv":     "Swedish",
    "uk":     "Ukrainian",
}

# Regex patterns for math/code regions that must be shielded from translation.
_MATH_PATTERNS = [
    re.compile(r'\$\$.*?\$\$', re.DOTALL),      # Display math $$...$$
    re.compile(r'\$[^$\n]+?\$'),                  # Inline math $...$
    re.compile(r'\\begin\{.*?\}.*?\\end\{.*?\}', re.DOTALL),  # LaTeX environments
    re.compile(r'\\[a-zA-Z]+\{[^}]*\}'),          # LaTeX commands \cmd{arg}
    re.compile(r'`[^`]+`'),                        # Inline code `...`
    re.compile(r'```.*?```', re.DOTALL),           # Code blocks ```...```
]

_PLACEHOLDER_TEMPLATE = "\x00MATH_{idx}\x00"


# ── Main entry point ───────────────────────────────────────────────────────────

def translate_pdf(
    input_path: Path,
    output_path: Path,
    source_lang: str = "en",
    target_lang: str = "zh",
    ollama_model: str = "qwen2.5",
    threads: int = 4,
) -> ConversionResult:
    """
    Translate a PDF while preserving its spatial layout.

    source_lang / target_lang: ISO 639-1 codes from SUPPORTED_LANGUAGES.
    ollama_model: the local Ollama model to use as the translation backend.
    """
    t0 = time.monotonic()

    for code, label in [(source_lang, "source"), (target_lang, "target")]:
        if code not in SUPPORTED_LANGUAGES:
            return ConversionResult(
                status=ConversionStatus.FAILURE,
                input_path=input_path,
                engine_used="pdf2zh",
                error=(
                    f"Unsupported {label} language code '{code}'. "
                    f"Supported codes: {sorted(SUPPORTED_LANGUAGES.keys())}"
                ),
                elapsed_seconds=time.monotonic() - t0,
            )

    if source_lang == target_lang:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="pdf2zh",
            error="Source and target language are identical.",
            elapsed_seconds=time.monotonic() - t0,
        )

    # Ensure Ollama daemon is available before attempting pdf2zh
    if not OllamaDaemonManager.is_running():
        logger.info("Ollama not running; attempting to start it for translation.")
        OllamaDaemonManager.start(timeout=30)

    result = _pdf2zh_translate(
        input_path, output_path, source_lang, target_lang, ollama_model, threads, t0
    )
    if result.succeeded:
        return result

    logger.warning(
        "pdf2zh failed (%s); falling back to argostranslate reconstruction.",
        result.error,
    )
    return _argostranslate_fallback(
        input_path, output_path, source_lang, target_lang, t0,
        fallback_reason=result.error,
    )


# ── pdf2zh primary engine ──────────────────────────────────────────────────────

def _pdf2zh_translate(
    input_path: Path,
    output_path: Path,
    source_lang: str,
    target_lang: str,
    ollama_model: str,
    threads: int,
    t0: float,
) -> ConversionResult:
    if not shutil.which("pdf2zh"):
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="pdf2zh",
            error=(
                "pdf2zh CLI not found. "
                "Install: pip install pdf2zh  and verify 'pdf2zh --version' works."
            ),
            elapsed_seconds=time.monotonic() - t0,
        )

    output_dir = output_path.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        "pdf2zh",
        str(input_path),
        "--output",  str(output_dir),
        "--lang-in",  source_lang,
        "--lang-out", target_lang,
        "--service",  f"ollama:{ollama_model}",
        "--thread",   str(threads),
    ]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,
        )
    except subprocess.TimeoutExpired:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="pdf2zh",
            error="pdf2zh timed out after 600s. Consider translating page ranges.",
            elapsed_seconds=time.monotonic() - t0,
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="pdf2zh",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )

    if proc.returncode != 0:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="pdf2zh",
            error=proc.stderr.strip() or f"pdf2zh exited {proc.returncode}",
            elapsed_seconds=time.monotonic() - t0,
        )

    # pdf2zh appends -{target_lang} to the output stem
    expected = output_dir / f"{input_path.stem}-{target_lang}.pdf"
    if not expected.exists():
        candidates = sorted(
            output_dir.glob("*.pdf"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            return ConversionResult(
                status=ConversionStatus.FAILURE,
                input_path=input_path,
                engine_used="pdf2zh",
                error=f"pdf2zh succeeded but no output PDF found in '{output_dir}'.",
                elapsed_seconds=time.monotonic() - t0,
            )
        expected = candidates[0]

    if expected != output_path:
        shutil.move(str(expected), str(output_path))

    return ConversionResult(
        status=ConversionStatus.SUCCESS,
        input_path=input_path,
        output_path=output_path,
        engine_used="pdf2zh",
        elapsed_seconds=time.monotonic() - t0,
        metadata={
            "source_lang":   source_lang,
            "target_lang":   target_lang,
            "ollama_model":  ollama_model,
            "formula_guard": "DocLayout-YOLO (pdf2zh internal)",
        },
    )


# ── argostranslate fallback ────────────────────────────────────────────────────

def _argostranslate_fallback(
    input_path: Path,
    output_path: Path,
    source_lang: str,
    target_lang: str,
    t0: float,
    fallback_reason: Optional[str] = None,
) -> ConversionResult:
    argo_src = source_lang.split("-")[0]
    argo_tgt = target_lang.split("-")[0]

    try:
        from argostranslate import package as argo_package
        from argostranslate import translate as argo_translate
    except ImportError:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="argostranslate",
            fallback_activated=True,
            fallback_reason=fallback_reason,
            error="argostranslate not installed.",
            elapsed_seconds=time.monotonic() - t0,
        )

    translation_fn = _get_argos_translator(
        argo_package, argo_translate, argo_src, argo_tgt
    )
    if translation_fn is None:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="argostranslate",
            fallback_activated=True,
            fallback_reason=fallback_reason,
            error=f"argostranslate language pair {argo_src}→{argo_tgt} not available.",
            elapsed_seconds=time.monotonic() - t0,
        )

    try:
        src_doc  = fitz.open(str(input_path))
        out_doc  = fitz.open(str(input_path))
        pages_translated = 0

        for page_idx, page in enumerate(src_doc):
            out_page = out_doc[page_idx]
            blocks   = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]

            for block in blocks:
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        original_text = span.get("text", "").strip()
                        if not original_text or len(original_text) < 3:
                            continue

                        protected, placeholders = _protect_formulas(original_text)
                        try:
                            translated_protected = translation_fn(protected)
                        except Exception:
                            continue

                        translated = _restore_formulas(translated_protected, placeholders)
                        if not translated or translated == original_text:
                            continue

                        bbox     = fitz.Rect(span["bbox"])
                        fontsize = span.get("size", 10)
                        fontname = "helv"

                        out_page.add_redact_annot(bbox, fill=(1, 1, 1))
                        out_page.apply_redactions()

                        _insert_fitted_text(
                            out_page, translated, bbox, fontname, fontsize
                        )

            pages_translated += 1

        out_doc.save(str(output_path), garbage=4, deflate=True)
        src_doc.close()
        out_doc.close()

        return ConversionResult(
            status=ConversionStatus.FALLBACK_SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="argostranslate",
            fallback_activated=True,
            fallback_reason=fallback_reason,
            elapsed_seconds=time.monotonic() - t0,
            metadata={
                "source_lang":        source_lang,
                "target_lang":        target_lang,
                "pages_processed":    pages_translated,
                "layout_fidelity":    "coordinate-based",
                "formula_guard":      "regex placeholders",
            },
        )

    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="argostranslate",
            fallback_activated=True,
            fallback_reason=fallback_reason,
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )


def _get_argos_translator(argo_package, argo_translate, src: str, tgt: str):
    def _find_translation():
        installed = argo_translate.get_installed_languages()
        src_obj = next((lg for lg in installed if lg.code == src), None)
        if src_obj is None: return None
        tgt_obj = next((lg for lg in installed if lg.code == tgt), None)
        if tgt_obj is None: return None
        trans = src_obj.get_translation(tgt_obj)
        if trans is None: return None
        return trans.translate

    fn = _find_translation()
    if fn is not None: return fn

    try:
        argo_package.update_package_index()
        available = argo_package.get_available_packages()
        pkg = next((p for p in available if p.from_code == src and p.to_code == tgt), None)
        if pkg is None: return None
        argo_package.install_from_path(pkg.download())
        return _find_translation()
    except Exception:
        return None


def _protect_formulas(text: str) -> Tuple[str, Dict[str, str]]:
    placeholders: Dict[str, str] = {}
    result = text
    idx = 0
    for pattern in _MATH_PATTERNS:
        for match in reversed(list(pattern.finditer(result))):
            placeholder = _PLACEHOLDER_TEMPLATE.format(idx=idx)
            placeholders[placeholder] = match.group(0)
            result = result[:match.start()] + placeholder + result[match.end():]
            idx += 1
    return result, placeholders


def _restore_formulas(text: str, placeholders: Dict[str, str]) -> str:
    for placeholder, original in placeholders.items():
        text = text.replace(placeholder, original)
    return text


def _insert_fitted_text(
    page: fitz.Page,
    text: str,
    bbox: fitz.Rect,
    fontname: str,
    fontsize: float,
    min_fontsize: float = 5.0,
) -> None:
    while fontsize >= min_fontsize:
        try:
            rc = page.insert_textbox(
                bbox,
                text,
                fontname=fontname,
                fontsize=fontsize,
                align=fitz.TEXT_ALIGN_LEFT,
            )
            if rc >= 0: return
        except Exception: pass
        fontsize -= 0.5
    try:
        page.insert_textbox(bbox, text, fontname=fontname, fontsize=min_fontsize)
    except Exception: pass
