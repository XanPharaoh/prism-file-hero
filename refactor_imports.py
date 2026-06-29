import os
from pathlib import Path

ROOT = Path(r"d:\prism-file-hero\docsuitekit")

REPLACEMENTS = {
    "from core.":         "from docsuitekit.core.",
    "from engines.":      "from docsuitekit.engines.",
    "from verification.": "from docsuitekit.verification.",
    "from config import": "from docsuitekit.config import",
    "import core":        "import docsuitekit.core",
    "import engines":     "import docsuitekit.engines",
    "import verification":"import docsuitekit.verification",
}

def refactor():
    count = 0
    for file_path in ROOT.rglob("*.py"):
        if file_path.name == "refactor_imports.py":
            continue
            
        content = file_path.read_text(encoding="utf-8")
        original = content
        
        for old, new in REPLACEMENTS.items():
            content = content.replace(old, new)
            
        if content != original:
            file_path.write_text(content, encoding="utf-8")
            print(f"Refactored: {file_path.relative_to(ROOT.parent)}")
            count += 1
    
    print(f"\nTotal files updated: {count}")

if __name__ == "__main__":
    refactor()
