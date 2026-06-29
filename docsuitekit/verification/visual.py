"""
Visual fidelity verification via SSIM and Multimodal LLM Vision Audit.

Two-layer approach:
    Layer 1 (fast): Structural Similarity Index (SSIM) — compares rendered bitmaps.
    Layer 2 (audit): Multimodal LLM (Groq llama3.2-vision, Mistral Pixtral, or Ollama).
        Only triggered if SSIM drops below thresholds, indicating potential
        font/layout shift that bitwise comparison may exaggerate.
"""

import base64
import io
import json
import logging
import re
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import fitz
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity as ssim

from docsuitekit.config import (
    OLLAMA_VISION_MODEL, GROQ_VISION_MODEL, MISTRAL_VISION_MODEL,
    GROQ_API_KEY, MISTRAL_API_KEY, VERIFY_CLIENT,
    THRESHOLD_FORMAT_CONVERT
)
from docsuitekit.core.result import VisualStatus

logger = logging.getLogger(__name__)

# Bitmaps compared at this DPI
_SCAN_DPI = 150

# Limit LLM audit to the most ambiguous pages to save time/cost
_MAX_LLM_PAGES = 1

# ── Public entry point ─────────────────────────────────────────────────────────

def verify_visual_fidelity(
    source_path: Path,
    output_path: Path,
    threshold: float = THRESHOLD_FORMAT_CONVERT,
    max_llm_pages: int = _MAX_LLM_PAGES,
) -> Tuple[VisualStatus, float]:
    """
    Verify visual layout preservation between source and output.
    Returns (Status, Score).
    """
    try:
        # Layer 1: Global SSIM check
        ssim_score, problematic_pages = _run_ssim_analysis(source_path, output_path)
        logger.debug("Visual Layer 1 (SSIM): %.4f (fails: %d)", ssim_score, len(problematic_pages))

        if ssim_score >= threshold:
            return VisualStatus.MATCH, round(ssim_score, 4)

        # Layer 2: LLM Vision Audit (if SSIM is low but not garbage)
        if 0.15 < ssim_score < threshold and problematic_pages:
            audit_pass = _run_vision_audit(
                source_path, output_path, problematic_pages[:max_llm_pages]
            )
            if audit_pass:
                logger.info("Vision Audit: PRESERVED (overrode SSIM drop)")
                return VisualStatus.PRESERVED, round(ssim_score, 4)

        return VisualStatus.SHIFT if ssim_score > 0.3 else VisualStatus.LOSS, round(ssim_score, 4)

    except Exception as exc:
        logger.error("Visual verification failed: %s", exc)
        return VisualStatus.UNKNOWN, 0.0


# ── Layer 1: SSIM bitwise comparison ───────────────────────────────────────────

def _run_ssim_analysis(src: Path, out: Path) -> Tuple[float, List[int]]:
    """Compare page bitmaps. Returns (Average SSIM, List of non-matching page indices)."""
    src_doc = fitz.open(str(src))
    out_doc = fitz.open(str(out))
    
    # We compare as many pages as both have
    page_count = min(len(src_doc), len(out_doc))
    scores = []
    failed = []

    mat = fitz.Matrix(_SCAN_DPI/72, _SCAN_DPI/72)

    for i in range(page_count):
        # Render src and out pages
        s_pix = src_doc[i].get_pixmap(matrix=mat, colorspace=fitz.csGRAY)
        o_pix = out_doc[i].get_pixmap(matrix=mat, colorspace=fitz.csGRAY)
        
        # Convert to numpy arrays
        s_img = np.frombuffer(s_pix.samples, dtype=np.uint8).reshape(s_pix.h, s_pix.w)
        o_img = np.frombuffer(o_pix.samples, dtype=np.uint8).reshape(o_pix.h, o_pix.w)

        # Resize output to match source if minor dimension mismatch
        if s_img.shape != o_img.shape:
            o_pil = Image.fromarray(o_img).resize((s_pix.w, s_pix.h), Image.Resampling.LANCZOS)
            o_img = np.array(o_pil)

        score = ssim(s_img, o_img)
        scores.append(score)
        if score < 0.90:  # Individual page fail threshold
            failed.append(i)

    src_doc.close()
    out_doc.close()

    avg_score = sum(scores) / len(scores) if scores else 0.0
    return avg_score, failed


# ── Layer 2: LLM Vision Audit ──────────────────────────────────────────────────

def _run_vision_audit(src_path: Path, out_path: Path, pages: List[int]) -> bool:
    """
    Asks a VLM to judge if layout shifts are structural or just rendering artifacts.
    """
    if not pages: return False

    page_idx = pages[0]
    logger.info("Triggering Vision Audit for page %d...", page_idx)

    # Prepare images
    src_b64 = _get_page_b64(src_path, page_idx)
    out_b64 = _get_page_b64(out_path, page_idx)

    prompt = (
        "Attached are two images of the same document page: [ORIGINAL] and [CONVERTED]. "
        "The automated system detected a visual shift. Your task is to determine if the "
        "layout, font appearance, and element positions are meaningfully preserved. "
        "Ignore minor anti-aliasing differences. Look for missing text, table breakage, "
        "or significant image distortion.\n\n"
        "Respond ONLY with this JSON format:\n"
        '{"preserved": true/false, "reason": "brief explanation"}'
    )

    try:
        if VERIFY_CLIENT == "groq" and GROQ_API_KEY:
            return _groq_vision_call(prompt, src_b64, out_b64)
        if VERIFY_CLIENT == "mistral" and MISTRAL_API_KEY:
            return _mistral_vision_call(prompt, src_b64, out_b64)
        
        # Default to Ollama
        import ollama
        resp = ollama.generate(
            model=OLLAMA_VISION_MODEL,
            prompt=prompt,
            images=[src_b64, out_b64]
        )
        return _parse_vlm_json(resp.get("response", ""))
    except Exception as exc:
        logger.warning("Vision Audit failed: %s", exc)
        return False


def _get_page_b64(path: Path, page_idx: int) -> str:
    doc = fitz.open(str(path))
    page = doc[page_idx]
    pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)) # Standard 108 DPI
    img_bytes = pix.tobytes("png")
    doc.close()
    return base64.b64encode(img_bytes).decode("utf-8")


def _groq_vision_call(prompt: str, src_b64: str, out_b64: str) -> bool:
    import httpx
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{src_b64}"}},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{out_b64}"}},
            ]
        }
    ]
    payload = {"model": GROQ_VISION_MODEL, "messages": messages, "temperature": 0.0, "response_format": {"type": "json_object"}}
    
    resp = httpx.post(url, headers=headers, json=payload, timeout=60)
    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    return _parse_vlm_json(content)

def _mistral_vision_call(prompt: str, src_b64: str, out_b64: str) -> bool:
    import httpx
    url = "https://api.mistral.ai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {MISTRAL_API_KEY}", "Content-Type": "application/json"}
    
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": f"data:image/png;base64,{src_b64}"},
                {"type": "image_url", "image_url": f"data:image/png;base64,{out_b64}"},
            ]
        }
    ]
    payload = {"model": MISTRAL_VISION_MODEL, "messages": messages, "temperature": 0.0}
    
    resp = httpx.post(url, headers=headers, json=payload, timeout=60)
    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    return _parse_vlm_json(content)

def _parse_vlm_json(text: str) -> bool:
    try:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            data = json.loads(match.group(0))
            logger.info("VLM Reason: %s", data.get("reason", "N/A"))
            return bool(data.get("preserved", False))
    except Exception:
        pass
    return "true" in text.lower()[:100]
