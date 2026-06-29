from pathlib import Path
import sys

def _get_base_path() -> Path:
    """Resolve base path for both PyInstaller-frozen and development environments."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).parent

BASE_PATH = _get_base_path()
BIN = BASE_PATH / "bin"

# ── External binary locations ──────────────────────────────────────────────────
GHOSTSCRIPT_BIN  = BIN / "gs"          / "gswin64c.exe"
TESSERACT_BIN    = BIN / "tesseract"   / "tesseract.exe"
TESSDATA_DIR     = BIN / "tesseract"   / "tessdata"
LIBREOFFICE_BIN  = BIN / "lo"          / "program" / "soffice.exe"
QPDF_BIN         = BIN / "qpdf"        / "bin" / "qpdf.exe"
OLLAMA_BIN       = BIN / "ollama"      / "ollama.exe"

# ── Ollama runtime settings ────────────────────────────────────────────────────
OLLAMA_HOST          = "http://localhost:11434"
OLLAMA_EMBED_MODEL   = "nomic-embed-text"
OLLAMA_VISION_MODEL  = "llama3.2-vision"

# ── Cloud LLM API settings ────────────────────────────────────────────────────
# The user requested using APIs instead of hardware-dependent local models.
# These will be loaded from env vars if present, or manually configured here.
import os
GROQ_API_KEY    = os.environ.get("GROQ_API_KEY", "")
MISTRAL_API_KEY = os.environ.get("MISTRAL_API_KEY", "")

# Preferred client for verification: "groq", "mistral", or "ollama"
VERIFY_CLIENT = "groq" if GROQ_API_KEY else ("mistral" if MISTRAL_API_KEY else "ollama")

# Model mappings for Cloud APIs
GROQ_VISION_MODEL    = "llama-3.2-11b-vision-preview"
MISTRAL_VISION_MODEL = "pixtral-12b"
# Mistral embedding model
MISTRAL_EMBED_MODEL  = "mistral-embed"

# ── Verification thresholds (tuned by conversion type) ────────────────────────
THRESHOLD_OCR            = 0.88   # Accounts for spacing/encoding artifacts
THRESHOLD_FORMAT_CONVERT = 0.92   # Format-to-format, no OCR noise
THRESHOLD_TRANSLATE      = 0.85   # Accounts for vocabulary variation
THRESHOLD_HIGH_FIDELITY  = 0.95   # Text-identical expected outputs
SSIM_FAST_PASS           = 0.85   # SSIM score above this skips LLM visual audit

# ── Working directories ────────────────────────────────────────────────────────
TEMP_DIR = Path.home() / ".docsuitekit" / "temp"
TEMP_DIR.mkdir(parents=True, exist_ok=True)

WORK_DIR = TEMP_DIR / "work"
WORK_DIR.mkdir(parents=True, exist_ok=True)

LOG_DIR = TEMP_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

LO_PROFILES_DIR = TEMP_DIR / "lo_profiles"
LO_PROFILES_DIR.mkdir(parents=True, exist_ok=True)

# ── Metadata ──────────────────────────────────────────────────────────────────
DOCSUITE_VERSION = "1.0.0"
