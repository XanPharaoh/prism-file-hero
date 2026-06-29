"""
Unified Conversion Orchestrator.

The primary entry point for all engine execution. Handles:
    1. Direct engine routing.
    2. Automatic fallback logic (e.g. failing PDF reconstruction drops to OCR).
    3. Integrated verification (Sync or Background).
    4. Auto-retry on verification failure.
"""

import concurrent.futures
import logging
import time
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Type

from docsuitekit.core.result import ConversionResult, ConversionStatus, VerificationResult, VerificationStatus
from docsuitekit.verification.pipeline import run_verification, get_default_config, VerificationConfig


class VerificationMode(Enum):
    SYNC       = "sync"        # Block until verification completes
    BACKGROUND = "background"  # Return immediately, verify in thread
    SKIP       = "skip"        # No verification


@dataclass
class PipelineConfig:
    verification_mode: VerificationMode = VerificationMode.SYNC
    auto_retry_on_verify_fail: bool = True
    max_retries: int = 1
    verification_config: Optional[VerificationConfig] = None


class ConversionPipeline:
    def __init__(self, config: Optional[PipelineConfig] = None):
        self.config = config or PipelineConfig()
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)
        self.logger = logging.getLogger(__name__)

    def execute(
        self,
        conversion_type: str,
        input_path: Path,
        output_path: Path,
        **engine_kwargs
    ) -> ConversionResult:
        """
        Orchestrate the conversion and verification flow.
        """
        t0 = time.monotonic()
        
        # 1. Conversion Execution
        result = self._run_engine(conversion_type, input_path, output_path, **engine_kwargs)
        
        if not result.succeeded:
            return result

        # 2. Verification Routing
        if self.config.verification_mode == VerificationMode.SKIP:
            result.elapsed_seconds = time.monotonic() - t0
            return result

        if self.config.verification_mode == VerificationMode.BACKGROUND:
            self._executor.submit(self._verify_and_update, result, input_path, conversion_type)
            result.elapsed_seconds = time.monotonic() - t0
            return result

        # Default: SYNC
        self._verify_and_update(result, input_path, conversion_type)
        
        # 3. Auto-Retry Logic
        if (self.config.auto_retry_on_verify_fail and 
            result.verification and 
            result.verification.status == VerificationStatus.FAILED and
            not result.fallback_activated):
            
            self.logger.warning("Verification failed for '%s'. Attempting fallback retry...", conversion_type)
            result = self._run_fallback(conversion_type, input_path, output_path, **engine_kwargs)
            if result.succeeded:
                self._verify_and_update(result, input_path, conversion_type)

        result.elapsed_seconds = time.monotonic() - t0
        return result

    def shutdown(self):
        """Clean up background executor."""
        self._executor.shutdown(wait=False)

    # ── Internal Helpers ──────────────────────────────────────────────────────

    def _run_engine(self, type: str, src: Path, out: Path, **kwargs) -> ConversionResult:
        """Routes to the correct engine module based on type string."""
        try:
            # Reconstruction Engines (Phase 2)
            if type == "pdf_to_word":
                from docsuitekit.engines.pdf_to_word import pdf_to_word
                return pdf_to_word(src, out, **kwargs)
            elif type == "pdf_to_excel":
                from docsuitekit.engines.pdf_to_excel import pdf_to_excel
                return pdf_to_excel(src, out, **kwargs)
            elif type == "pdf_to_pptx":
                from docsuitekit.engines.pdf_to_pptx import pdf_to_pptx
                return pdf_to_pptx(src, out, **kwargs)
            
            # Optimisation Engines (Phase 3)
            elif type == "compress":
                from docsuitekit.engines.pdf_compress import compress_pdf
                return compress_pdf(src, out, **kwargs)
            
            # Core Engines (Phase 4)
            elif type == "ocr":
                from docsuitekit.engines.ocr import ocr_pdf
                return ocr_pdf(src, out, **kwargs)
            elif type == "translate":
                from docsuitekit.engines.translate import translate_pdf
                return translate_pdf(src, out, **kwargs)
            
            else:
                return ConversionResult(status=ConversionStatus.FAILURE, input_path=src, error=f"Unknown conversion type: {type}")

        except Exception as exc:
            self.logger.error("Engine execution failed: %s", exc)
            return ConversionResult(status=ConversionStatus.FAILURE, input_path=src, error=str(exc))

    def _run_fallback(self, type: str, src: Path, out: Path, **kwargs) -> ConversionResult:
        """
        If a structural engine fails or produces low-fidelity output,
        fallback to a more robust (but perhaps slower) method.
        Example: PDF->Word reconstruction failure triggers OCR->Word.
        """
        # Simple policy: if pdf_to_word fails, try OCR (if requested)
        if type == "pdf_to_word":
            self.logger.info("Retrying 'pdf_to_word' via OCR fallback.")
            from docsuitekit.engines.ocr import ocr_pdf, OcrMode
            res = ocr_pdf(src, out, mode=OcrMode.BEST)
            res.fallback_activated = True
            return res
        
        return ConversionResult(status=ConversionStatus.FAILURE, input_path=src, error="No fallback defined for this type.")

    def _verify_and_update(self, result: ConversionResult, source: Path, type: str):
        v_res = run_verification(
            source_path=source,
            output_path=result.output_path,
            config=self.config.verification_config,
            conversion_type=type
        )
        result.verification = v_res
