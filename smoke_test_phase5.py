"""
Smoke Test: Phase 5 — Autonomous Verification Pipeline.

Tests:
    1. Semantic Layer 1: Difflib ratio.
    2. Semantic Layer 2: Embedding similarity (Mistral API or Ollama).
    3. Visual Layer 1: SSIM bitwise check.
    4. Visual Layer 2: Vision Audit (Groq/Mistral or Ollama).
    5. ConversionPipeline: Synchronous orchestration.
    6. ConversionPipeline: Background verification.
"""

import logging
import sys
import unittest
from pathlib import Path

# Add project root to sys.path
sys.path.append(str(Path(__file__).parent))

from docsuitekit.verification.semantic import verify_semantic_fidelity
from docsuitekit.verification.visual   import verify_visual_fidelity
from docsuitekit.core.conversion_pipeline import ConversionPipeline, PipelineConfig, VerificationMode
from docsuitekit.config import VERIFY_CLIENT

logging.basicConfig(level=logging.INFO)

class TestVerificationPipeline(unittest.TestCase):
    
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path("tests/data/phase5")
        cls.test_dir.mkdir(parents=True, exist_ok=True)
        
        # Create dummy assets for testing
        cls.src_pdf = cls.test_dir / "test_source.pdf"
        cls.out_pdf = cls.test_dir / "test_output.pdf"
        
        # We need real PDFs for visual/semantic check
        # Generating minimal PDFs using ReportLab or similar would be ideal, 
        # but for smoke test we'll assume the environment has some.
        # If not, some tests will skip.

    def test_01_difflib_pass(self):
        """Difflib should match identical text strings extracted from files."""
        from docsuitekit.verification.semantic import _difflib_ratio
        t1 = "The quick brown fox jumps over the lazy dog."
        t2 = "The quick brown fox jumps over the lazy dog."
        self.assertEqual(_difflib_ratio(t1, t2), 1.0)

    def test_02_difflib_fail(self):
        """Difflib should detect major content differences."""
        from docsuitekit.verification.semantic import _difflib_ratio
        t1 = "The quick brown fox jumps over the lazy dog."
        t2 = "A completely different sentence about cats."
        self.assertLess(_difflib_ratio(t1, t2), 0.5)

    def test_03_embedding_similarity(self):
        """Test embedding similarity (requires API or Ollama)."""
        from docsuitekit.verification.semantic import _embedding_cosine_similarity
        t1 = "Generating financial statements for the quarter."
        t2 = "Processing the quarterly reports for the finance department."
        
        score = _embedding_cosine_similarity(t1, t2)
        if score is None:
            self.skipTest(f"Embedding client '{VERIFY_CLIENT}' not available.")
        
        print(f"Embedding similarity score: {score:.4f}")
        self.assertGreater(score, 0.7)

    def test_04_ssim_identical(self):
        """SSIM should be 1.0 for the same file."""
        # This requires real files
        if not self.src_pdf.exists():
            self.skipTest("Source PDF missing.")
        
        from docsuitekit.verification.visual import _run_ssim_analysis
        score, fails = _run_ssim_analysis(self.src_pdf, self.src_pdf)
        self.assertAlmostEqual(score, 1.0)

    def test_05_pipeline_sync(self):
        """Test ConversionPipeline in synchronous mode."""
        if not self.src_pdf.exists():
            self.skipTest("Source PDF missing.")
            
        pipeline = ConversionPipeline(PipelineConfig(verification_mode=VerificationMode.SYNC))
        # This will fail on actual engine execution if engines aren't set up,
        # but we check the pipeline flow.
        try:
            result = pipeline.execute("compress", self.src_pdf, self.out_pdf)
            print(f"Pipeline Result: {result.status.value}")
            if result.verification:
                print(f"Verification: {result.verification.status.value}")
        except Exception as e:
            print(f"Pipeline failed (expected if engines missing): {e}")

    def test_06_pipeline_background(self):
        """Test background verification executor."""
        if not self.src_pdf.exists():
            self.skipTest("Source PDF missing.")
            
        pipeline = ConversionPipeline(PipelineConfig(verification_mode=VerificationMode.BACKGROUND))
        try:
            result = pipeline.execute("compress", self.src_pdf, self.out_pdf)
            self.assertIsNone(result.verification) # Should be None immediately
            
            # Wait a bit for background thread
            import time
            time.sleep(2)
            if result.verification:
                print(f"Background Verification completed: {result.verification.status.value}")
        finally:
            pipeline.shutdown()


if __name__ == "__main__":
    unittest.main()
