"""Pluggable OCR backend — supports Pytesseract, EasyOCR, and PaddleOCR.

Usage:
    from ocr_backend import OCRBackend

    engines = OCRBackend.available_engines()       # ["paddleocr", "easyocr", "tesseract"]
    result  = OCRBackend.extract_text(pil_image)   # auto-selects best installed engine
    result  = OCRBackend.extract_text(pil_image, engine="easyocr", lang="fr")
"""

import importlib.util
import shutil
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
from PIL import Image


@dataclass
class TextBlock:
    text: str
    confidence: float  # 0.0–1.0
    bbox: tuple[int, int, int, int] | None = None  # (x0, y0, x1, y1)


@dataclass
class OCRResult:
    text: str
    confidence: float
    blocks: list[TextBlock] = field(default_factory=list)
    engine_used: str = ""
    processing_time: float = 0.0


# ── Language Code Mapping ────────────────────────────────────────────
# Unified format: ISO 639-3 (Tesseract style), mapped to each engine's format.
_LANG_MAP = {
    # iso3 → {engine: engine_code}
    "eng": {"tesseract": "eng", "easyocr": "en", "paddleocr": "en"},
    "fra": {"tesseract": "fra", "easyocr": "fr", "paddleocr": "fr"},
    "deu": {"tesseract": "deu", "easyocr": "de", "paddleocr": "german"},
    "spa": {"tesseract": "spa", "easyocr": "es", "paddleocr": "es"},
    "por": {"tesseract": "por", "easyocr": "pt", "paddleocr": "pt"},
    "ita": {"tesseract": "ita", "easyocr": "it", "paddleocr": "it"},
    "rus": {"tesseract": "rus", "easyocr": "ru", "paddleocr": "ru"},
    "chi_sim": {"tesseract": "chi_sim", "easyocr": "ch_sim", "paddleocr": "ch"},
    "jpn": {"tesseract": "jpn", "easyocr": "ja", "paddleocr": "japan"},
    "kor": {"tesseract": "kor", "easyocr": "ko", "paddleocr": "korean"},
    "ara": {"tesseract": "ara", "easyocr": "ar", "paddleocr": "ar"},
    "hin": {"tesseract": "hin", "easyocr": "hi", "paddleocr": "hi"},
    "tur": {"tesseract": "tur", "easyocr": "tr", "paddleocr": "tr"},
    "nld": {"tesseract": "nld", "easyocr": "nl", "paddleocr": "nl"},
    "pol": {"tesseract": "pol", "easyocr": "pl", "paddleocr": "pl"},
    "afr": {"tesseract": "afr", "easyocr": "af", "paddleocr": "af"},
}

# Engine priority order: best quality → widest availability
_PRIORITY = ["paddleocr", "easyocr", "tesseract"]


class OCRBackend:
    """Unified OCR interface with auto-detection and engine caching."""

    _lock = threading.Lock()
    _cache: dict = {}  # engine_name → reader instance (expensive init)

    # ── Discovery ─────────────────────────────────────────────

    @staticmethod
    def available_engines() -> list[str]:
        """Return installed engines in priority order."""
        engines = []
        if importlib.util.find_spec("paddleocr"):
            engines.append("paddleocr")
        if importlib.util.find_spec("easyocr"):
            engines.append("easyocr")
        if shutil.which("tesseract") and importlib.util.find_spec("pytesseract"):
            engines.append("tesseract")
        return engines

    @staticmethod
    def has_any_engine() -> bool:
        return len(OCRBackend.available_engines()) > 0

    @staticmethod
    def best_engine() -> str | None:
        engines = OCRBackend.available_engines()
        return engines[0] if engines else None

    # ── Language Mapping ──────────────────────────────────────

    @staticmethod
    def normalize_language(lang: str, engine: str) -> str:
        """Convert unified lang code to engine-specific code."""
        mapping = _LANG_MAP.get(lang, {})
        return mapping.get(engine, lang)

    @staticmethod
    def supported_languages() -> list[tuple[str, str]]:
        """Return list of (code, name) tuples for UI dropdowns."""
        names = {
            "eng": "English", "fra": "French", "deu": "German", "spa": "Spanish",
            "por": "Portuguese", "ita": "Italian", "rus": "Russian",
            "chi_sim": "Chinese (Simplified)", "jpn": "Japanese", "kor": "Korean",
            "ara": "Arabic", "hin": "Hindi", "tur": "Turkish", "nld": "Dutch",
            "pol": "Polish", "afr": "Afrikaans",
        }
        return [(code, names.get(code, code)) for code in _LANG_MAP]

    # ── Core OCR ──────────────────────────────────────────────

    @staticmethod
    def extract_text(
        image: Image.Image | np.ndarray | str,
        engine: str = "auto",
        lang: str = "eng",
    ) -> OCRResult:
        """Extract text from an image using the specified (or best) engine.

        Args:
            image: PIL Image, numpy array, or file path
            engine: "auto", "tesseract", "easyocr", or "paddleocr"
            lang: Unified language code (ISO 639-3)

        Returns:
            OCRResult with text, confidence, blocks, and timing
        """
        if engine == "auto":
            engine = OCRBackend.best_engine()
            if engine is None:
                return OCRResult(
                    text="", confidence=0.0, engine_used="none",
                    blocks=[TextBlock(text="No OCR engine installed", confidence=0.0)],
                )

        # Normalize image to PIL
        if isinstance(image, str):
            image = Image.open(image)
        if isinstance(image, np.ndarray):
            image = Image.fromarray(image)

        start = time.perf_counter()
        lang_code = OCRBackend.normalize_language(lang, engine)

        if engine == "tesseract":
            result = OCRBackend._run_tesseract(image, lang_code)
        elif engine == "easyocr":
            result = OCRBackend._run_easyocr(image, lang_code)
        elif engine == "paddleocr":
            result = OCRBackend._run_paddleocr(image, lang_code)
        else:
            result = OCRResult(text="", confidence=0.0)

        result.engine_used = engine
        result.processing_time = time.perf_counter() - start
        return result

    @staticmethod
    def extract_text_batch(
        images: list,
        engine: str = "auto",
        lang: str = "eng",
        progress: Callable[[float], None] | None = None,
    ) -> list[OCRResult]:
        """Process multiple images with progress reporting."""
        results = []
        total = len(images)
        for i, img in enumerate(images):
            results.append(OCRBackend.extract_text(img, engine=engine, lang=lang))
            if progress:
                progress((i + 1) / total)
        return results

    # ── Engine Implementations ────────────────────────────────

    @staticmethod
    def _run_tesseract(image: Image.Image, lang: str) -> OCRResult:
        import pytesseract

        data = pytesseract.image_to_data(image, lang=lang, output_type=pytesseract.Output.DICT)
        blocks = []
        confidences = []
        for i, text in enumerate(data["text"]):
            text = text.strip()
            conf = int(data["conf"][i])
            if text and conf > 0:
                blocks.append(TextBlock(
                    text=text,
                    confidence=conf / 100.0,
                    bbox=(data["left"][i], data["top"][i],
                          data["left"][i] + data["width"][i],
                          data["top"][i] + data["height"][i]),
                ))
                confidences.append(conf / 100.0)

        full_text = pytesseract.image_to_string(image, lang=lang).strip()
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
        return OCRResult(text=full_text, confidence=avg_conf, blocks=blocks)

    @staticmethod
    def _run_easyocr(image: Image.Image, lang: str) -> OCRResult:
        import easyocr

        with OCRBackend._lock:
            cache_key = f"easyocr_{lang}"
            if cache_key not in OCRBackend._cache:
                OCRBackend._cache[cache_key] = easyocr.Reader([lang], gpu=False)
            reader = OCRBackend._cache[cache_key]

        img_array = np.array(image)
        raw = reader.readtext(img_array)

        blocks = []
        confidences = []
        texts = []
        for bbox, text, conf in raw:
            texts.append(text)
            confidences.append(conf)
            flat = [int(c) for pt in bbox for c in pt]
            x_coords = flat[0::2]
            y_coords = flat[1::2]
            blocks.append(TextBlock(
                text=text,
                confidence=conf,
                bbox=(min(x_coords), min(y_coords), max(x_coords), max(y_coords)),
            ))

        full_text = "\n".join(texts)
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
        return OCRResult(text=full_text, confidence=avg_conf, blocks=blocks)

    @staticmethod
    def _run_paddleocr(image: Image.Image, lang: str) -> OCRResult:
        from paddleocr import PaddleOCR

        with OCRBackend._lock:
            cache_key = f"paddleocr_{lang}"
            if cache_key not in OCRBackend._cache:
                OCRBackend._cache[cache_key] = PaddleOCR(
                    lang=lang, use_angle_cls=True, show_log=False,
                )
            ocr = OCRBackend._cache[cache_key]

        img_array = np.array(image)
        raw = ocr.ocr(img_array, cls=True)

        blocks = []
        confidences = []
        texts = []
        if raw and raw[0]:
            for line in raw[0]:
                bbox_pts, (text, conf) = line
                texts.append(text)
                confidences.append(conf)
                x_coords = [int(p[0]) for p in bbox_pts]
                y_coords = [int(p[1]) for p in bbox_pts]
                blocks.append(TextBlock(
                    text=text,
                    confidence=conf,
                    bbox=(min(x_coords), min(y_coords), max(x_coords), max(y_coords)),
                ))

        full_text = "\n".join(texts)
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
        return OCRResult(text=full_text, confidence=avg_conf, blocks=blocks)


def get_install_instructions() -> str:
    """Return helpful install instructions for OCR engines."""
    return (
        "No OCR engine detected. Install at least one:\n\n"
        "Option 1 — EasyOCR (easiest, pure pip):\n"
        "  pip install easyocr\n\n"
        "Option 2 — PaddleOCR (best accuracy):\n"
        "  pip install paddlepaddle paddleocr\n\n"
        "Option 3 — Tesseract (most mature):\n"
        "  1. Download Tesseract: https://github.com/tesseract-ocr/tesseract\n"
        "  2. pip install pytesseract\n"
        "  3. Add Tesseract to your system PATH"
    )
