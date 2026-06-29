# tests/unit/test_core.py
"""Unit tests for config, result contracts, and binary_resolver (no real binaries needed)."""

import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
from docsuitekit.config import (
    DOCSUITE_VERSION, WORK_DIR, LOG_DIR
)
from docsuitekit.core.result import ConversionResult, ConversionStatus


class TestConversionResult:
    def test_success_flag(self):
        r = ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=Path("input.pdf"),
            engine_used="test_engine",
            output_path=None,
            elapsed_seconds=0.1
        )
        assert r.succeeded is True

    def test_failure_carries_error(self):
        r = ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=Path("input.pdf"),
            engine_used="test_engine",
            error="Something went wrong",
            elapsed_seconds=0.1
        )
        assert r.succeeded is False
        assert r.error == "Something went wrong"


class TestBinaryResolver:
    def test_returns_path_when_found(self):
        from docsuitekit.core.binary_resolver import inject_binary_dirs
        import os
        orig_path = os.environ.get("PATH", "")
        # Use a real (but neutral) path for mocking if needed, 
        # or just ensure inject_binary_dirs handles Path objects.
        # Here we mock the Path object to avoid real filesystem checks during unit tests.
        mock_path = MagicMock(spec=Path)
        mock_path.parent = Path("/tmp/fake")
        mock_path.exists.return_value = True
        
        inject_binary_dirs([mock_path])
        
        # Check if the parent of our mock path is in the PATH
        assert str(mock_path.parent) in os.environ.get("PATH", "")
        os.environ["PATH"] = orig_path
