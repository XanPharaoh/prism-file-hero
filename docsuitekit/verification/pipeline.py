"""
Verification strategy orchestrator.

Maps conversion types to appropriate verification strategies (Semantic, Visual, or Hybrid)
and sets thresholds based on conversion sensitivity.
"""

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Dict, Optional

from docsuitekit.config import (
    THRESHOLD_OCR, THRESHOLD_FORMAT_CONVERT, THRESHOLD_TRANSLATE
)
from docsuitekit.core.result import VerificationResult, VerificationStatus
from docsuitekit.verification.semantic import verify_semantic_fidelity
from docsuitekit.verification.visual   import verify_visual_fidelity


class VerificationStrategy(Enum):
    SEMANTIC = "semantic"  # Text-only (e.g., Simple OCR)
    VISUAL   = "visual"    # Pixel-only (e.g., Compression)
    HYBRID   = "hybrid"    # Both (e.g., PDF to Word, Translation)


@dataclass
class VerificationConfig:
    strategy: VerificationStrategy
    threshold: float
    use_embeddings: bool = True
    max_llm_pages: int = 1


# ── Strategy Map ──────────────────────────────────────────────────────────────

_STRATEGY_MAP: Dict[str, VerificationConfig] = {
    # Phase 2: Reconstruction
    "pdf_to_word":    VerificationConfig(VerificationStrategy.HYBRID,   THRESHOLD_FORMAT_CONVERT),
    "pdf_to_excel":   VerificationConfig(VerificationStrategy.HYBRID,   THRESHOLD_FORMAT_CONVERT),
    "pdf_to_pptx":    VerificationConfig(VerificationStrategy.VISUAL,   THRESHOLD_FORMAT_CONVERT),
    "pdf_to_html":    VerificationConfig(VerificationStrategy.HYBRID,   THRESHOLD_FORMAT_CONVERT),
    
    # Phase 3: Optimisation
    "compress":       VerificationConfig(VerificationStrategy.VISUAL,   0.92),
    "repair":         VerificationConfig(VerificationStrategy.VISUAL,   0.90),
    "flatten":        VerificationConfig(VerificationStrategy.VISUAL,   0.95),
    
    # Phase 4: Core Engines
    "ocr":            VerificationConfig(VerificationStrategy.SEMANTIC, THRESHOLD_OCR),
    "translate":      VerificationConfig(VerificationStrategy.HYBRID,   THRESHOLD_TRANSLATE),
}


def get_default_config(conversion_type: str) -> VerificationConfig:
    """Return the recommended verification configuration for a given conversion."""
    return _STRATEGY_MAP.get(
        conversion_type, 
        VerificationConfig(VerificationStrategy.HYBRID, THRESHOLD_FORMAT_CONVERT)
    )


# ── Execution ──────────────────────────────────────────────────────────────────

def run_verification(
    source_path: Path,
    output_path: Path,
    config: Optional[VerificationConfig] = None,
    conversion_type: Optional[str] = None,
) -> VerificationResult:
    """
    Execute verification based on the requested strategy.
    """
    if config is None:
        config = get_default_config(conversion_type or "")

    semantic_res = None
    visual_status = None
    visual_score = 0.0

    # 1. Semantic Check
    if config.strategy in (VerificationStrategy.SEMANTIC, VerificationStrategy.HYBRID):
        semantic_res = verify_semantic_fidelity(
            source_path, output_path, 
            threshold=config.threshold,
            use_embeddings=config.use_embeddings
        )

    # 2. Visual Check
    if config.strategy in (VerificationStrategy.VISUAL, VerificationStrategy.HYBRID):
        visual_status, visual_score = verify_visual_fidelity(
            source_path, output_path,
            threshold=config.threshold,
            max_llm_pages=config.max_llm_pages
        )

    # 3. Decision Matrix
    if config.strategy == VerificationStrategy.SEMANTIC:
        return semantic_res

    if config.strategy == VerificationStrategy.VISUAL:
        from docsuitekit.core.result import VisualStatus
        status = VerificationStatus.PASSED if visual_score >= config.threshold or visual_status == VisualStatus.PRESERVED else VerificationStatus.FAILED
        return VerificationResult(
            status=status,
            visual_status=visual_status,
            visual_score=visual_score,
            error=None if status == VerificationStatus.PASSED else f"Visual score {visual_score:.4f} < {config.threshold}"
        )

    if config.strategy == VerificationStrategy.HYBRID:
        # Hybrid pass: both must pass, OR one must pass strongly while the other is acceptable
        s_pass = semantic_res.status == VerificationStatus.PASSED
        from docsuitekit.core.result import VisualStatus
        v_pass = visual_score >= config.threshold or visual_status == VisualStatus.PRESERVED
        
        status = VerificationStatus.PASSED if (s_pass and v_pass) else VerificationStatus.FAILED
        
        error = None
        if not s_pass: error = f"Semantic fail ({semantic_res.semantic_score})"
        if not v_pass: error = (error + " + " if error else "") + f"Visual fail ({visual_score})"

        return VerificationResult(
            status=status,
            semantic_score=semantic_res.semantic_score,
            visual_status=visual_status,
            visual_score=visual_score,
            error=error
        )

    return VerificationResult(status=VerificationStatus.SKIPPED, error="Unknown strategy")
