"""Shared utility functions for Prism Document Suite."""

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def format_file_size(size_bytes: int) -> str:
    """Human-readable file size string."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    for unit in ("KB", "MB", "GB"):
        size_bytes /= 1024.0
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
    return f"{size_bytes:.1f} TB"


def safe_filename(name: str) -> str:
    """Sanitize a string for use as a filename."""
    name = re.sub(r'[<>:"/\\|?*]', '_', name)
    return name.strip('. ') or "output"


def validate_pdf(path: str) -> bool:
    """Quick check: file exists and starts with %PDF."""
    try:
        with open(path, "rb") as f:
            return f.read(5) == b"%PDF-"
    except (OSError, IOError):
        return False


def get_page_count(path: str) -> int:
    """Get PDF page count without loading full document."""
    try:
        from pypdf import PdfReader
        return len(PdfReader(path).pages)
    except Exception:
        return 0


def create_temp_dir(prefix: str = "prism_") -> str:
    """Create and return a temporary directory path."""
    return tempfile.mkdtemp(prefix=prefix)


def estimate_disk_needed(input_path: str, multiplier: float = 2.0) -> int:
    """Estimate bytes needed for output (heuristic: input × multiplier)."""
    try:
        return int(os.path.getsize(input_path) * multiplier)
    except OSError:
        return 0


def check_disk_space(directory: str, needed_bytes: int) -> bool:
    """Check if directory has enough free space."""
    try:
        usage = shutil.disk_usage(directory)
        return usage.free >= needed_bytes
    except OSError:
        return True  # assume OK if check fails


def open_file_in_system(path: str) -> None:
    """Open a file with the system's default application."""
    path = os.path.normpath(path)
    if sys.platform == "win32":
        os.startfile(path)
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


def open_folder_in_system(path: str) -> None:
    """Open the containing folder with the file selected."""
    path = os.path.normpath(path)
    if sys.platform == "win32":
        subprocess.Popen(["explorer", "/select,", path])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(path)])


def get_output_path(input_path: str, suffix: str, output_dir: str | None = None) -> str:
    """Generate an output path that doesn't overwrite the input.

    Example: input.pdf → input_merged.pdf (or input_merged_2.pdf if exists).
    """
    p = Path(input_path)
    base = f"{p.stem}_{suffix}{p.suffix}"
    directory = output_dir or str(p.parent)
    out = os.path.join(directory, base)
    counter = 2
    while os.path.exists(out):
        out = os.path.join(directory, f"{p.stem}_{suffix}_{counter}{p.suffix}")
        counter += 1
    return out
