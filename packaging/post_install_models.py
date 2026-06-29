"""
Staged AI model downloader for DocSuiteKit.
"""

import json
import logging
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

MODELS: Dict[str, Dict] = {
    "nomic-embed-text": {
        "description": "Text embedding model for semantic similarity verification.",
        "size_gb":     0.27,
        "required":    True,
        "use_case":    "Semantic verification (all conversion types)",
    },
    "llama3.2-vision": {
        "description": "Multimodal vision model for layout audit.",
        "size_gb":     2.0,
        "required":    True,
        "use_case":    "Visual layout verification after conversion",
    },
    "qwen2.5:7b": {
        "description": "Multilingual LLM for document translation.",
        "size_gb":     4.7,
        "required":    False,
        "use_case":    "PDF translation (pdf2zh backend)",
    },
    "gemma3:4b": {
        "description": "Compact LLM for structured data extraction audit.",
        "size_gb":     2.5,
        "required":    False,
        "use_case":    "Excel data extraction verification",
    },
}

_OLLAMA_HOST = "http://localhost:11434"
_CORE_MODELS = [k for k, v in MODELS.items() if v["required"]]


def list_available_models() -> None:
    installed = _get_installed_models()
    print("\nDocSuiteKit AI Model Registry")
    print("═" * 60)
    for name, info in MODELS.items():
        status  = "✅ installed" if name in installed else "⬜ not installed"
        req     = "required" if info["required"] else "optional"
        size    = f"{info['size_gb']:.1f} GB"
        print(f"\n{name}  [{req}]  {size}  {status}")
        print(f"  {info['description']}")
        print(f"  Use case: {info['use_case']}")

    total_installed = sum(MODELS[m]["size_gb"] for m in installed if m in MODELS)
    print(f"\n{'═' * 60}")
    print(f"Installed: {len(installed)} model(s), ~{total_installed:.1f} GB")


def download_models(model_names: Optional[List[str]] = None, skip_existing: bool = True) -> bool:
    targets = model_names or _CORE_MODELS
    if not _ensure_ollama_running():
        print("ERROR: Ollama reachable?", file=sys.stderr)
        return False

    if skip_existing:
        installed = _get_installed_models()
        to_pull   = [m for m in targets if m not in installed]
    else:
        to_pull = targets

    if not to_pull:
        print("All requested models already installed.")
        return True

    for model in to_pull:
        _pull_model(model)
    return True


def _ensure_ollama_running() -> bool:
    # Try reaching it first
    try:
        urllib.request.urlopen(f"{_OLLAMA_HOST}/api/tags", timeout=3)
        return True
    except Exception:
        pass
    
    # Simple attempt to start ollama if found on path
    try:
        subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2)
        return True
    except Exception:
        return False


def _get_installed_models() -> List[str]:
    try:
        with urllib.request.urlopen(f"{_OLLAMA_HOST}/api/tags", timeout=5) as r:
            data = json.loads(r.read())
            return [m["name"].split(":")[0] for m in data.get("models", [])]
    except Exception:
        return []


def _pull_model(model: str) -> bool:
    print(f"Pulling: {model}...")
    try:
        subprocess.run(["ollama", "pull", model], check=True)
        return True
    except Exception as e:
        print(f"Error pulling {model}: {e}")
        return False


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--list", action="store_true")
    parser.add_argument("models", nargs="*")
    args = parser.parse_args()
    if args.list:
        list_available_models()
    else:
        download_models(args.models or None)
