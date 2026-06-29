#!/usr/bin/env python3
"""
DocSuiteKit MSI build orchestrator.

Executes the complete packaging pipeline in order:
  1. Prerequisite validation
  2. PyInstaller freeze  → dist/DocSuiteKit/
  3. wix harvest dir     → packaging/payload.wxs
  4. wix build           → dist/DocSuiteKit-{version}.msi
  5. Optional: signtool  → signed MSI
  6. Build verification  → size + content checks
"""

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import List, Optional, Tuple

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT         = Path(__file__).parent.parent.resolve()
PACKAGING    = ROOT / "packaging"
DIST_DIR     = ROOT / "dist"
PAYLOAD_DIR  = DIST_DIR / "DocSuiteKit"
PAYLOAD_WXS  = PACKAGING / "payload.wxs"
PRODUCT_WXS  = PACKAGING / "product.wxs"
SPEC_FILE    = PACKAGING / "build.spec"


# ── Colour helpers (Windows ANSI) ──────────────────────────────────────────────
def _c(colour: str, text: str) -> str:
    codes = {"green": "\033[92m", "red": "\033[91m",
             "yellow": "\033[93m", "cyan": "\033[96m", "reset": "\033[0m"}
    return f"{codes.get(colour, '')}{text}{codes['reset']}"


def info(msg: str)    -> None: print(f"  {_c('cyan',   '→')} {msg}")
def ok(msg: str)      -> None: print(f"  {_c('green',  '✓')} {msg}")
def warn(msg: str)    -> None: print(f"  {_c('yellow', '⚠')} {msg}")
def fail(msg: str)    -> None: print(f"  {_c('red',    '✗')} {msg}", file=sys.stderr)
def header(msg: str)  -> None: print(f"\n{'═'*60}\n  {msg}\n{'═'*60}")


# ── Step runner ────────────────────────────────────────────────────────────────

def run(
    cmd: List[str],
    cwd: Optional[Path] = None,
    env: Optional[dict] = None,
    timeout: int = 1800,
    step_name: str = "",
) -> subprocess.CompletedProcess:
    """
    Run a subprocess command and raise SystemExit on failure.
    Streams stdout/stderr in real time for long-running steps.
    """
    display = step_name or " ".join(cmd[:3])
    info(f"Running: {' '.join(cmd)}")
    t0 = time.monotonic()

    try:
        result = subprocess.run(
            cmd,
            cwd=str(cwd or ROOT),
            env=env or os.environ,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        fail(f"{display} timed out after {timeout}s.")
        sys.exit(1)
    except FileNotFoundError as e:
        fail(f"Command not found: {cmd[0]}. {e}")
        sys.exit(1)

    elapsed = time.monotonic() - t0
    if result.returncode != 0:
        fail(f"{display} failed (exit {result.returncode}) in {elapsed:.1f}s")
        sys.exit(1)

    ok(f"{display} completed in {elapsed:.1f}s")
    return result


# ── Prerequisite checks ────────────────────────────────────────────────────────

def check_prerequisites(args) -> None:
    header("Step 0: Prerequisite Validation")
    errors = []

    # Python version
    if sys.version_info < (3, 10):
        errors.append(f"Python 3.10+ required; found {sys.version}")
    else:
        ok(f"Python {sys.version.split()[0]}")

    # PyInstaller
    r = subprocess.run(["pyinstaller", "--version"], capture_output=True, text=True)
    if r.returncode == 0:
        ok(f"PyInstaller {r.stdout.strip()}")
    else:
        errors.append("PyInstaller not found. Run: pip install pyinstaller")

    # WiX v4
    r = subprocess.run(["wix", "--version"], capture_output=True, text=True)
    if r.returncode == 0:
        version_str = r.stdout.strip()
        if version_str.startswith("4."):
            ok(f"WiX Toolset {version_str}")
        else:
            errors.append(
                f"WiX v4 required but found {version_str}. "
                f"Install from https://wixtoolset.org/docs/intro/"
            )
    else:
        errors.append(
            "WiX not found. Install: winget install WiXToolset.WiX "
            "or from https://wixtoolset.org"
        )

    # Spec file
    if SPEC_FILE.exists():
        ok(f"Spec file: {SPEC_FILE}")
    else:
        errors.append(f"Spec file not found: {SPEC_FILE}")

    # WiX source files
    if PRODUCT_WXS.exists():
        ok(f"product.wxs: {PRODUCT_WXS}")
    else:
        errors.append(f"product.wxs not found: {PRODUCT_WXS}")

    if errors:
        print()
        for e in errors:
            fail(e)
        sys.exit(1)


# ── Build steps ────────────────────────────────────────────────────────────────

def step_pyinstaller(args) -> None:
    header("Step 1: PyInstaller Freeze")

    if PAYLOAD_DIR.exists():
        if args.skip_freeze:
            ok(f"Skipping freeze (--skip-freeze). Using existing {PAYLOAD_DIR}")
            return
        info(f"Removing existing {PAYLOAD_DIR}")
        shutil.rmtree(PAYLOAD_DIR)

    env = {**os.environ}
    if args.bundle_lo:
        env["BUNDLE_LO"] = "1"
        info("LibreOffice portable will be bundled (BUNDLE_LO=1)")

    run(
        [
            sys.executable, "-m", "PyInstaller",
            str(SPEC_FILE),
            "--noconfirm",
            "--clean",
            "--distpath", str(DIST_DIR),
            "--workpath", str(ROOT / "build"),
        ],
        env=env,
        timeout=1800,
        step_name="PyInstaller",
    )

    if not PAYLOAD_DIR.exists():
        fail(f"PyInstaller succeeded but {PAYLOAD_DIR} was not created.")
        sys.exit(1)

    # Report payload size
    total_size = sum(f.stat().st_size for f in PAYLOAD_DIR.rglob("*") if f.is_file())
    ok(f"Payload size: {total_size / (1024**3):.2f} GB  ({PAYLOAD_DIR})")


def step_wix_harvest(args) -> None:
    header("Step 2: WiX Harvest (payload fragment generation)")

    if PAYLOAD_WXS.exists():
        info(f"Removing stale {PAYLOAD_WXS.name}")
        PAYLOAD_WXS.unlink()

    run(
        [
            "wix", "harvest", "dir",
            str(PAYLOAD_DIR),
            "-o",   str(PAYLOAD_WXS),
            "-srd",             # Suppress root directory component
            "-var", "var.PayloadDir",
            "-ag",              # Auto-generate component GUIDs
            "-cg", "MainPayload",
            "-dr", "INSTALLFOLDER",
        ],
        step_name="wix harvest",
    )

    if not PAYLOAD_WXS.exists():
        fail(f"wix harvest succeeded but {PAYLOAD_WXS} was not created.")
        sys.exit(1)

    component_count = PAYLOAD_WXS.read_text(encoding="utf-8").count("<Component ")
    ok(f"Harvested {component_count} components into {PAYLOAD_WXS.name}")


def step_wix_build(args) -> Tuple[Path, str]:
    header("Step 3: WiX Build (MSI compilation)")

    version   = args.version or "1.0.0"
    msi_name  = f"DocSuiteKit-Setup.msi"
    msi_path  = DIST_DIR / msi_name

    if msi_path.exists():
        info(f"Removing existing {msi_name}")
        msi_path.unlink()

    run(
        [
            "wix", "build",
            str(PRODUCT_WXS),
            str(PAYLOAD_WXS),
            "-d",  f"PayloadDir={PAYLOAD_DIR}",
            "-ext", "WixToolset.UI.wixext",
            "-o",  str(msi_path),
        ],
        timeout=600,
        step_name="wix build",
    )

    if not msi_path.exists():
        fail(f"wix build succeeded but {msi_name} was not created.")
        sys.exit(1)

    size_mb = msi_path.stat().st_size / (1024 * 1024)
    ok(f"MSI created: {msi_path}  ({size_mb:.0f} MB)")
    return msi_path, version


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    if sys.platform == "win32":
        os.system("")

    parser = argparse.ArgumentParser(description="DocSuiteKit MSI Build Orchestrator")
    parser.add_argument("--version",     default="1.0.0",  help="Version string (default: 1.0.0)")
    parser.add_argument("--bundle-lo",   action="store_true",
                        help="Bundle portable LibreOffice (~400–800 MB extra)")
    parser.add_argument("--sign",        default=None, metavar="CERT.PFX",
                        help="Path to code-signing certificate (.pfx)")
    parser.add_argument("--skip-freeze", action="store_true",
                        help="Skip PyInstaller step; reuse existing dist/DocSuiteKit/")
    parser.add_argument("--no-verify",   action="store_true",
                        help="Skip post-build verification")
    args = parser.parse_args()

    build_start = time.monotonic()

    print(_c("cyan", "\n  DocSuiteKit MSI Build Pipeline"))
    print(f"  ROOT: {ROOT}")

    check_prerequisites(args)
    step_pyinstaller(args)
    step_wix_harvest(args)
    msi_path, version = step_wix_build(args)

    if not args.no_verify:
        run([sys.executable, str(PACKAGING / "verify_build.py")], step_name="Build Verification")

    elapsed = time.monotonic() - build_start
    print(f"\n  {_c('green', 'BUILD COMPLETE')} in {elapsed:.0f}s")


if __name__ == "__main__":
    main()
