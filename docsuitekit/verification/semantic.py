"""
Semantic fidelity verification via local embedding models or cloud LLM APIs.

Design rationale:
    nomic-embed-text or Mistral embeddings evaluate MEANING: two texts conveying
    the same information but formatted differently score > 0.95.

Two-layer approach:
    Layer 1 (always): difflib ratio — CPU only.
    Layer 2 (conditional): Embedding cosine similarity (Ollama or Mistral API).
        Triggered when difflib score falls in the ambiguous 0.50–0.97 range.
"""

import difflib
import logging
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

from docsuitekit.config import (
    OLLAMA_EMBED_MODEL, MISTRAL_EMBED_MODEL,
    MISTRAL_API_KEY, VERIFY_CLIENT,
    THRESHOLD_OCR, THRESHOLD_FORMAT_CONVERT
)
from docsuitekit.core.result import VerificationResult, VerificationStatus

logger = logging.getLogger(__name__)

# nomic-embed-text context window: 8192 tokens ≈ 32 000 chars.
_EMBED_CHAR_LIMIT  = 12_000

# difflib scores above this bypass the LLM call entirely.
_FAST_PASS_FLOOR   = 0.98
_FAST_FAIL_CEILING = 0.35


# ── Public entry point ─────────────────────────────────────────────────────────

def verify_semantic_fidelity(
    source_path: Path,
    output_path: Path,
    threshold: float = THRESHOLD_FORMAT_CONVERT,
    use_embeddings: bool = True,
) -> VerificationResult:
    """
    Verify that the output document preserves the semantic content of the source.
    """
    t0 = time.monotonic()

    src_text = _extract_text(source_path)
    out_text = _extract_text(output_path)

    if not src_text.strip():
        return VerificationResult(
            status=VerificationStatus.SKIPPED,
            error=f"Source document '{source_path.name}' yielded no extractable text.",
        )

    if not out_text.strip():
        return VerificationResult(
            status=VerificationStatus.FAILED,
            semantic_score=0.0,
            error=f"Output document '{output_path.name}' contains no text.",
        )

    # ── Layer 1: difflib fast path ─────────────────────────────────────────────
    difflib_score = _difflib_ratio(src_text, out_text)
    logger.debug("Semantic Layer 1 (difflib): %.4f", difflib_score)

    if difflib_score >= _FAST_PASS_FLOOR:
        return VerificationResult(
            status=VerificationStatus.PASSED,
            semantic_score=round(difflib_score, 4),
        )

    if difflib_score < _FAST_FAIL_CEILING:
        return VerificationResult(
            status=VerificationStatus.FAILED,
            semantic_score=round(difflib_score, 4),
            error=f"Difflib ratio {difflib_score:.3f} indicates severe content loss.",
        )

    # ── Layer 2: Embedding cosine similarity ───────────────────────────────────
    if not use_embeddings:
        final_score = difflib_score
        method = "difflib-only"
    else:
        embed_score = _embedding_cosine_similarity(src_text, out_text)
        if embed_score is None:
            logger.warning("Embedding service unavailable. Using difflib score.")
            final_score = difflib_score
            method = "difflib-only (service unavailable)"
        else:
            logger.debug("Semantic Layer 2 (embedding): %.4f", embed_score)
            final_score = 0.25 * difflib_score + 0.75 * embed_score
            method = f"{VERIFY_CLIENT} embedding"

    final_score = round(final_score, 4)
    status = VerificationStatus.PASSED if final_score >= threshold else VerificationStatus.FAILED

    return VerificationResult(
        status=status,
        semantic_score=final_score,
        error=None if status == VerificationStatus.PASSED else f"Semantic score {final_score:.4f} < {threshold} ({method})",
    )


# ── Text extraction ────────────────────────────────────────────────────────────

def _extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    try:
        if suffix == ".pdf":
            return _extract_pdf(path)
        if suffix in (".docx", ".doc"):
            return _extract_docx(path)
        if suffix in (".xlsx", ".xls", ".csv"):
            return _extract_excel(path)
        if suffix in (".pptx", ".ppt"):
            return _extract_pptx(path)
        if suffix in (".txt", ".md", ".html", ".htm"):
            return _normalise(path.read_text(encoding="utf-8", errors="replace"))
    except Exception as exc:
        logger.warning("Text extraction failed for '%s': %s", path.name, exc)
    return ""


def _extract_pdf(path: Path) -> str:
    import fitz
    doc   = fitz.open(str(path))
    pages = [doc[i].get_text("text") for i in range(len(doc))]
    doc.close()
    return _normalise("\n".join(pages))


def _extract_docx(path: Path) -> str:
    from docx import Document
    doc   = Document(str(path))
    paras = [p.text for p in doc.paragraphs if p.text.strip()]
    return _normalise("\n".join(paras))


def _extract_excel(path: Path) -> str:
    import pandas as pd
    suffix = path.suffix.lower()
    if suffix == ".csv":
        df = pd.read_csv(str(path), dtype=str, on_bad_lines="skip")
    else:
        all_sheets = pd.read_excel(str(path), sheet_name=None, dtype=str)
        df = pd.concat(all_sheets.values(), ignore_index=True)
    return _normalise(df.to_string(index=False, na_rep=""))


def _extract_pptx(path: Path) -> str:
    from pptx import Presentation
    prs  = Presentation(str(path))
    runs = []
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    runs.append(para.text)
    return _normalise("\n".join(runs))


def _normalise(text: str) -> str:
    import re
    text = re.sub(r'\r\n|\r', '\n', text)
    text = re.sub(r'[^\S\n]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def _difflib_ratio(src: str, out: str) -> float:
    cap = 50_000
    return difflib.SequenceMatcher(None, src[:cap].lower(), out[:cap].lower(), autojunk=True).ratio()


def _embedding_cosine_similarity(src_text: str, out_text: str) -> Optional[float]:
    src_sample = _sample_text(src_text)
    out_sample = _sample_text(out_text)

    if VERIFY_CLIENT == "mistral" and MISTRAL_API_KEY:
        return _mistral_embedding(src_sample, out_sample)
    
    # Fallback to Ollama
    try:
        import ollama
        src_resp = ollama.embeddings(model=OLLAMA_EMBED_MODEL, prompt=src_sample)
        out_resp = ollama.embeddings(model=OLLAMA_EMBED_MODEL, prompt=out_sample)
        return _cosine_similarity(src_resp["embedding"], out_resp["embedding"])
    except Exception as exc:
        logger.debug("Ollama embedding failed: %s", exc)
        return None

def _mistral_embedding(src: str, out: str) -> Optional[float]:
    try:
        import httpx
        url = "https://api.mistral.ai/v1/embeddings"
        headers = {"Authorization": f"Bearer {MISTRAL_API_KEY}", "Content-Type": "application/json"}
        payload = {"model": MISTRAL_EMBED_MODEL, "input": [src, out]}
        
        resp = httpx.post(url, headers=headers, json=payload, timeout=30)
        data = resp.json()
        vecs = [item["embedding"] for item in data["data"]]
        return _cosine_similarity(vecs[0], vecs[1])
    except Exception as exc:
        logger.debug("Mistral embedding failed: %s", exc)
        return None

def _cosine_similarity(v1, v2) -> float:
    a, b = np.array(v1), np.array(v2)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

def _sample_text(text: str, limit: int = _EMBED_CHAR_LIMIT) -> str:
    if len(text) <= limit: return text
    third  = limit // 3
    mid    = len(text) // 2
    return text[:third] + "\n...\n" + text[mid - third // 2: mid + third // 2] + "\n...\n" + text[-third:]
