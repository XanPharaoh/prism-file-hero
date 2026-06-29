"""
packaging/verify_build.py
Full build verification checklist.  Run after build_orchestrator.py
before tagging a release.
"""

import sys, os, subprocess, hashlib, json, shutil, time
from pathlib import Path

ROOT      = Path(__file__).parent.parent
DIST      = ROOT / "dist"
PACKAGING = ROOT / "packaging"
MODELS_DIR = Path(os.environ.get("APPDATA", ROOT)) / "DocSuiteKit" / "models"

BINARY_CHECKS = {
    "ghostscript": ["gs",        "--version"],
    "qpdf":        ["qpdf",      "--version"],
    "tesseract":   ["tesseract", "--version"],
    "pdftoppm":    ["pdftoppm",  "-v"],
    "soffice":     ["soffice",   "--version"],
}

BINARY_URLS = {
    "ghostscript": "https://github.com/ArtifexSoftware/ghostpdl-downloads/releases",
    "qpdf":        "https://github.com/qpdf/qpdf/releases",
    "tesseract":   "https://github.com/UB-Mannheim/tesseract/wiki",
    "pdftoppm":    "https://github.com/oschwartz10612/poppler-windows/releases",
    "soffice":     "https://www.libreoffice.org/download/",
}

G, R, Y, B, RESET, BOLD = "\033[92m", "\033[91m", "\033[93m", "\033[94m", "\033[0m", "\033[1m"

def ok(m):   print(f"  {G}✓{RESET} {m}")
def fail(m): print(f"  {R}✗{RESET} {m}")
def warn(m): print(f"  {Y}⚠{RESET} {m}")
def section(t): print(f"\n{BOLD}{t}{RESET}\n{'─'*(len(t)+2)}")


class Result:
    def __init__(self):
        self.passed = self.failed = self.warned = 0
        self.failures: list[str] = []

    def record(self, success: bool, msg: str, warning: bool = False) -> bool:
        if success:
            ok(msg);   self.passed += 1
        elif warning:
            warn(msg); self.warned += 1
        else:
            fail(msg); self.failed += 1; self.failures.append(msg)
        return success

    @property
    def ok(self): return self.failed == 0


# ── checks ────────────────────────────────────────────────────────────────────

def check_python_deps(r: Result) -> None:
    section("Python Dependencies")
    pkgs = [
        ("pypdf",          "pypdf"),
        ("pikepdf",        "pikepdf"),
        ("pdf2docx",       "pdf2docx"),
        ("docling",        "docling"),
        ("ocrmypdf",       "ocrmypdf"),
        ("PIL",            "Pillow"),
        ("numpy",          "numpy"),
        ("pandas",         "pandas"),
        ("openpyxl",       "openpyxl"),
        ("pptx",           "python-pptx"),
        ("deep_translator","deep-translator"),
        ("skimage",        "scikit-image"),
        ("PyInstaller",    "pyinstaller"),
    ]
    import importlib
    for imp, dist in pkgs:
        try:
            importlib.import_module(imp)
            r.record(True, dist)
        except ImportError:
            r.record(False, f"{dist} — not installed  (pip install {dist})")


def check_binaries(r: Result) -> None:
    section("External Binaries")
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    for name, cmd in BINARY_CHECKS.items():
        try:
            p = subprocess.run(cmd, capture_output=True, timeout=10, creationflags=flags)
            raw = (p.stdout + p.stderr).decode(errors="ignore").splitlines()
            ver = raw[0].strip()[:60] if raw else "found"
            r.record(True, f"{name:<15} {ver}")
        except (FileNotFoundError, subprocess.TimeoutExpired):
            r.record(False, f"{name:<15} not found on PATH — {BINARY_URLS.get(name,'')}")


def check_models(r: Result) -> None:
    section("AI Model Files")
    tess_base = Path(shutil.which("tesseract") or "x").parent.parent / "tessdata"
    checks = {
        "docling/layout model":    MODELS_DIR / "docling" / "layout"      / "model.safetensors",
        "docling/tableformer":     MODELS_DIR / "docling" / "tableformer" / "pytorch_model.bin",
        "tesseract/eng.traineddata": tess_base / "eng.traineddata",
    }
    for name, path in checks.items():
        if path.exists():
            mb = path.stat().st_size / 1_048_576
            r.record(True, f"{name:<40} ({mb:.1f} MB)")
        else:
            r.record(False, f"{name:<40} missing at {path}")

    # Ollama / LLaVA is optional
    try:
        import urllib.request
        with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=3) as resp:
            models = [m["name"] for m in json.loads(resp.read()).get("models", [])]
        has_llava = any("llava" in m for m in models)
        r.record(has_llava,
                 f"{'ollama/llava':<40} {'found' if has_llava else 'not pulled — visual verification disabled'}",
                 warning=not has_llava)
    except Exception:
        r.record(False, f"{'ollama daemon':<40} not running — visual verification disabled", warning=True)


def check_artifacts(r: Result) -> None:
    section("Build Artifacts")
    artifacts = {
        "DocSuiteKit.exe":         DIST / "DocSuiteKit" / "DocSuiteKit.exe",
        "_internal dir":           DIST / "DocSuiteKit" / "_internal",
        "DocSuiteKit-Setup.msi":   DIST / "DocSuiteKit-Setup.msi",
        "product.wxs":             PACKAGING / "product.wxs",
        "License.rtf":             PACKAGING / "License.rtf",
        "Banner.bmp":              PACKAGING / "Banner.bmp",
        "Dialog.bmp":              PACKAGING / "Dialog.bmp",
    }
    for name, path in artifacts.items():
        if path.exists():
            suffix = f" ({path.stat().st_size/1_048_576:.1f} MB)" if path.suffix in (".msi",".exe") else ""
            r.record(True, f"{name:<30}{suffix}")
        else:
            r.record(False, f"{name:<30} missing — run build_orchestrator.py")


def check_exe_smoke(r: Result) -> None:
    section("Executable Smoke Test")
    exe = DIST / "DocSuiteKit" / "DocSuiteKit.exe"
    if not exe.exists():
        r.record(False, "Skipped — executable not present"); return
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    for args, check in [
        (["--version"], lambda p: p.returncode == 0 and b"DocSuiteKit" in p.stdout),
        (["--help"],    lambda p: p.returncode == 0),
    ]:
        try:
            p = subprocess.run([str(exe)] + args, capture_output=True, timeout=30, creationflags=flags)
            label = " ".join(args)
            out   = (p.stdout or b"").decode(errors="ignore").strip()[:60]
            r.record(check(p), f"{label:<12} {out or f'exit {p.returncode}'}")
        except Exception as e:
            r.record(False, f"{' '.join(args):<12} {e}")


def check_msi(r: Result) -> None:
    section("MSI Integrity")
    msi = DIST / "DocSuiteKit-Setup.msi"
    if not msi.exists():
        r.record(False, "MSI not present — skipping"); return
    magic = msi.read_bytes()[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
    r.record(magic, "CFB magic bytes valid")
    sha  = hashlib.sha256(msi.read_bytes()).hexdigest()
    out  = DIST / "DocSuiteKit-Setup.msi.sha256"
    out.write_text(f"{sha}  DocSuiteKit-Setup.msi\n", encoding="utf-8")
    ok(f"SHA-256: {sha[:16]}…  → {out.name}")
    r.passed += 1


def check_signing(r: Result) -> None:
    section("Code Signing (optional)")
    if sys.platform != "win32":
        r.record(False, "Windows only", warning=True); return
    sigcheck = shutil.which("sigcheck64") or shutil.which("sigcheck")
    if not sigcheck:
        warn("sigcheck not on PATH — https://learn.microsoft.com/sysinternals/downloads/sigcheck")
        r.warned += 1; return
    for art in [DIST / "DocSuiteKit" / "DocSuiteKit.exe", DIST / "DocSuiteKit-Setup.msi"]:
        if not art.exists(): continue
        p = subprocess.run([sigcheck, "-nobanner", str(art)], capture_output=True, timeout=15)
        signed = b"Signed" in p.stdout and b"Valid" in p.stdout
        r.record(signed, f"{art.name:<30} {'Signed' if signed else 'Unsigned — SmartScreen warning expected'}", warning=not signed)


def summary(r: Result) -> None:
    print(f"\n{'═'*55}")
    print(f"{BOLD}Verification Summary{RESET}")
    print(f"{'═'*55}")
    print(f"  {G}Passed : {r.passed}{RESET}")
    print(f"  {Y}Warned : {r.warned}{RESET}")
    print(f"  {R}Failed : {r.failed}{RESET}")
    if r.failures:
        print(f"\n{R}Failures:{RESET}")
        for f in r.failures: print(f"  • {f}")
    print()
    if r.ok:
        print(f"{G}{BOLD}✓ Ready for distribution.{RESET}\n")
    else:
        print(f"{R}{BOLD}✗ Resolve failures before distributing.{RESET}\n")


def main() -> int:
    print(f"\n{BOLD}DocSuiteKit Build Verification{RESET}")
    print(f"{'═'*55}")
    print(f"Root  : {ROOT}")
    print(f"Date  : {time.strftime('%Y-%m-%d %H:%M:%S')}")
    r = Result()
    check_python_deps(r)
    check_binaries(r)
    check_models(r)
    check_artifacts(r)
    check_exe_smoke(r)
    check_msi(r)
    check_signing(r)
    summary(r)
    return 0 if r.ok else 1

if __name__ == "__main__":
    sys.exit(main())
