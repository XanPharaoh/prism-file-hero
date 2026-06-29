from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional, List


class ConversionStatus(Enum):
    SUCCESS          = "success"
    FALLBACK_SUCCESS = "fallback_success"   # Primary engine failed; fallback succeeded
    DEGRADED         = "degraded"           # Completed but failed verification threshold
    FAILURE          = "failure"


class VerificationStatus(Enum):
    PASSED  = "passed"
    FAILED  = "failed"
    SKIPPED = "skipped"   # Empty corpus or explicitly bypassed
    ERROR   = "error"     # Verification machinery itself failed


class VisualStatus(Enum):
    PRESERVED = "preserved"   # Layout identical
    MODIFIED  = "modified"    # Content same, layout changed
    ALTERED   = "altered"     # Content changed
    ERROR     = "error"


@dataclass
class VerificationResult:
    status:          VerificationStatus
    semantic_score:  Optional[float]     = None
    visual_status:   Optional[str]       = None   # "ssim_pass" | "success" | "failure"
    visual_reasons:  List[str]           = field(default_factory=list)
    error:           Optional[str]       = None


@dataclass
class ConversionResult:
    status:           ConversionStatus
    input_path:       Path
    output_path:      Optional[Path]          = None
    engine_used:      str                     = ""
    fallback_activated: bool                  = False
    fallback_reason:  Optional[str]           = None
    verification:     Optional[VerificationResult] = None
    elapsed_seconds:  float                   = 0.0
    error:            Optional[str]           = None
    metadata:         dict                    = field(default_factory=dict)

    @property
    def succeeded(self) -> bool:
        return self.status in (
            ConversionStatus.SUCCESS,
            ConversionStatus.FALLBACK_SUCCESS,
        )

    def to_dict(self) -> dict:
        v = self.verification
        return {
            "status":        self.status.value,
            "input":         str(self.input_path),
            "output":        str(self.output_path) if self.output_path else None,
            "engine":        self.engine_used,
            "fallback":      self.fallback_activated,
            "fallback_reason": self.fallback_reason,
            "elapsed_s":     round(self.elapsed_seconds, 3),
            "error":         self.error,
            "metadata":      self.metadata,
            "verification":  {
                "status":          v.status.value,
                "semantic_score":  v.semantic_score,
                "visual_status":   v.visual_status,
                "visual_reasons":  v.visual_reasons,
            } if v else None,
        }


@dataclass
class PageComparisonDetail:
    page_index:       int
    text_similarity:  float        # 0–1 from difflib.SequenceMatcher.ratio()
    ssim_score:       float        # 0–1 structural similarity (skimage, NOT OpenCV)
    added_lines:      List[str]    # Capped by max_diff_lines
    removed_lines:    List[str]
    changed_lines:    List[str]
    visual_match:     bool         # True when ssim_score >= configured threshold


@dataclass
class ComparisonReport:
    source_path:            Path
    target_path:            Path
    source_page_count:      int
    target_page_count:      int
    page_count_match:       bool
    page_details:           List[PageComparisonDetail]
    overall_text_similarity: float
    overall_ssim:           float
    has_differences:        bool
    elapsed_seconds:        float
    error:                  Optional[str] = None
