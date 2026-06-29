import logging
import difflib
import time
from pathlib import Path
from typing import List, Optional, Tuple

import fitz
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity   # skimage, NOT OpenCV

from docsuitekit.core.result import ComparisonReport, PageComparisonDetail

logger = logging.getLogger(__name__)

_DEFAULT_SSIM_THRESHOLD = 0.95
_DEFAULT_DPI            = 150
_DEFAULT_MAX_DIFF_LINES = 50


def compare_pdfs(
    source_path: Path,
    target_path: Path,
    dpi: int = _DEFAULT_DPI,
    ssim_threshold: float = _DEFAULT_SSIM_THRESHOLD,
    max_diff_lines: int = _DEFAULT_MAX_DIFF_LINES,
) -> ComparisonReport:
    """
    Two-layer document comparison: textual differential and visual SSIM.

    Textual layer:
        PyMuPDF extracts text per page. difflib.SequenceMatcher computes
        a ratio (0–1) and a full opcode diff (additions, deletions, changes).
        Because PDFs are coordinate-based, whitespace normalisation is applied
        before comparison to reduce false positives from layout artifacts.

    Visual layer (SSIM):
        Pages are rasterized to grayscale NumPy arrays at the specified DPI.
        skimage.metrics.structural_similarity evaluates luminance, contrast,
        and structural covariance — filtering anti-aliasing noise while
        accurately detecting real geometric layout shifts, overflows, or
        missing graphical elements.

        NOTE: Uses skimage.metrics, NOT cv2.quality.QualitySSIM_compute().
        The OpenCV contrib interface requires a non-default build and is
        substantially more cumbersome. skimage is the correct tool here.

    dpi: rasterisation resolution. 150 is a good speed/accuracy trade-off.
         Increase to 200–300 for detecting fine-grained table border changes.
    ssim_threshold: pages with SSIM below this are flagged as visual mismatches.
    max_diff_lines: caps stored diff lines per page to control memory usage.
    """
    t0 = time.monotonic()

    try:
        src_doc = fitz.open(str(source_path))
        tgt_doc = fitz.open(str(target_path))
    except Exception as exc:
        return ComparisonReport(
            source_path=source_path,
            target_path=target_path,
            source_page_count=0,
            target_page_count=0,
            page_count_match=False,
            page_details=[],
            overall_text_similarity=0.0,
            overall_ssim=0.0,
            has_differences=True,
            elapsed_seconds=time.monotonic() - t0,
            error=f"Failed to open document(s): {exc}",
        )

    src_count   = len(src_doc)
    tgt_count   = len(tgt_doc)
    comparable  = min(src_count, tgt_count)
    details: List[PageComparisonDetail] = []
    text_scores, ssim_scores = [], []

    for i in range(comparable):
        # ── Textual comparison ─────────────────────────────────────────────
        src_lines = _extract_normalised_lines(src_doc, i)
        tgt_lines = _extract_normalised_lines(tgt_doc, i)
        ratio, added, removed, changed = _text_diff(src_lines, tgt_lines)

        # ── Visual comparison (SSIM) ───────────────────────────────────────
        src_arr = _rasterize_gray(src_doc, i, dpi)
        tgt_arr = _rasterize_gray(tgt_doc, i, dpi)
        ssim    = _compute_ssim(src_arr, tgt_arr)

        text_scores.append(ratio)
        ssim_scores.append(ssim)

        details.append(PageComparisonDetail(
            page_index=i,
            text_similarity=round(ratio, 4),
            ssim_score=round(ssim, 4),
            added_lines=added[:max_diff_lines],
            removed_lines=removed[:max_diff_lines],
            changed_lines=changed[:max_diff_lines],
            visual_match=ssim >= ssim_threshold,
        ))

    src_doc.close()
    tgt_doc.close()

    overall_text = float(np.mean(text_scores)) if text_scores else 0.0
    overall_ssim = float(np.mean(ssim_scores)) if ssim_scores else 0.0

    has_diff = (
        src_count != tgt_count
        or any(not p.visual_match for p in details)
        or any(p.added_lines or p.removed_lines or p.changed_lines for p in details)
    )

    return ComparisonReport(
        source_path=source_path,
        target_path=target_path,
        source_page_count=src_count,
        target_page_count=tgt_count,
        page_count_match=(src_count == tgt_count),
        page_details=details,
        overall_text_similarity=round(overall_text, 4),
        overall_ssim=round(overall_ssim, 4),
        has_differences=has_diff,
        elapsed_seconds=round(time.monotonic() - t0, 3),
    )


def export_html_report(report: ComparisonReport, output_path: Path) -> None:
    """Write a self-contained HTML diff report to output_path."""
    rows = []
    for p in report.page_details:
        clean    = not (p.added_lines or p.removed_lines or p.changed_lines) and p.visual_match
        status   = "✅" if clean else "⚠️"
        add_html = "".join(f"<div class='add'>+ {ln}</div>" for ln in p.added_lines)
        rem_html = "".join(f"<div class='rem'>− {ln}</div>" for ln in p.removed_lines)
        chg_html = "".join(f"<div class='chg'>~ {ln}</div>" for ln in p.changed_lines)
        rows.append(
            f"<tr><td>{p.page_index + 1}</td><td>{status}</td>"
            f"<td>{p.text_similarity:.1%}</td><td>{p.ssim_score:.4f}</td>"
            f"<td>{'✅' if p.visual_match else '❌'}</td>"
            f"<td>{add_html}{rem_html}{chg_html}</td></tr>"
        )

    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>PDF Comparison — {report.source_path.name} vs {report.target_path.name}</title>
<style>
  body {{font-family: monospace; margin: 2em; color: #222;}}
  .summary {{background: #f5f5f5; padding: 1em; border-radius: 6px; margin-bottom: 1.5em;}}
  table {{border-collapse: collapse; width: 100%;}}
  th, td {{border: 1px solid #ddd; padding: 6px 10px; vertical-align: top;}}
  th {{background: #e8e8e8;}}
  .add {{color: #2a7a2a;}} .rem {{color: #b22;}} .chg {{color: #885500;}}
  .fail {{background: #fff0f0;}}
</style>
</head><body>
<h2>PDF Comparison Report</h2>
<div class="summary">
  <strong>Source:</strong> {report.source_path.name}<br>
  <strong>Target:</strong> {report.target_path.name}<br>
  <strong>Pages (source / target):</strong> {report.source_page_count} / {report.target_page_count}
  {"✅" if report.page_count_match else "❌ PAGE COUNT MISMATCH"}<br>
  <strong>Overall text similarity:</strong> {report.overall_text_similarity:.1%}<br>
  <strong>Overall SSIM:</strong> {report.overall_ssim:.4f}<br>
  <strong>Differences detected:</strong> {"Yes ⚠️" if report.has_differences else "None ✅"}<br>
  <strong>Elapsed:</strong> {report.elapsed_seconds:.2f}s
</div>
<table>
  <thead>
    <tr>
      <th>Page</th><th>Status</th><th>Text Sim.</th>
      <th>SSIM</th><th>Visual Match</th><th>Diff</th>
    </tr>
  </thead>
  <tbody>{"".join(rows)}</tbody>
</table>
</body></html>"""

    output_path.write_text(html, encoding="utf-8")
    logger.info("HTML comparison report written to '%s'.", output_path)


# ── Private helpers ────────────────────────────────────────────────────────────

def _extract_normalised_lines(doc: fitz.Document, page_idx: int) -> List[str]:
    """
    Extract text from a page and normalise whitespace before comparison.

    Two identical source documents compiled by different PDF generators
    will often produce different raw byte sequences and varying amounts
    of inter-word whitespace. Normalisation collapses these variations
    so that difflib does not flag them as meaningful changes.
    """
    raw = doc[page_idx].get_text("text")
    lines = [" ".join(ln.split()) for ln in raw.splitlines()]
    return [ln for ln in lines if ln]  # Discard blank lines


def _text_diff(
    src_lines: List[str],
    tgt_lines: List[str],
) -> Tuple[float, List[str], List[str], List[str]]:
    """
    Compute a SequenceMatcher ratio and categorise changed lines.

    Returns: (ratio, added_lines, removed_lines, changed_lines)

    'changed_lines' collects replace opcodes where both old and new text
    exist — these represent edits rather than pure insertions or deletions
    and are the most diagnostically useful category for document review.
    """
    matcher = difflib.SequenceMatcher(None, src_lines, tgt_lines, autojunk=False)
    added, removed, changed = [], [], []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "insert":
            added.extend(tgt_lines[j1:j2])
        elif tag == "delete":
            removed.extend(src_lines[i1:i2])
        elif tag == "replace":
            # Represent as paired old→new strings for context
            for old, new in zip(src_lines[i1:i2], tgt_lines[j1:j2]):
                changed.append(f"{old!r} → {new!r}")
            # Handle length mismatches within the replace block
            rem_old = src_lines[i1:i2][len(tgt_lines[j1:j2]):]
            rem_new = tgt_lines[j1:j2][len(src_lines[i1:i2]):]
            removed.extend(rem_old)
            added.extend(rem_new)

    return matcher.ratio(), added, removed, changed


def _rasterize_gray(doc: fitz.Document, page_idx: int, dpi: int) -> np.ndarray:
    """
    Render a PDF page to a grayscale NumPy array at the specified DPI.

    The conversion is: PDF page → PyMuPDF Pixmap → PNG bytes → PIL Image
    → grayscale → NumPy float32 array normalised to [0, 1].

    Grayscale is used for SSIM because:
      1. It eliminates false positives from colour-profile differences
         that do not constitute structural changes.
      2. skimage's SSIM on a 2D array is ~3× faster than multichannel mode.
    """
    mat = fitz.Matrix(dpi / 72.0, dpi / 72.0)
    pix = doc[page_idx].get_pixmap(matrix=mat, colorspace=fitz.csGRAY)
    img = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    return np.array(img, dtype=np.float32) / 255.0


def _compute_ssim(
    src_arr: np.ndarray,
    tgt_arr: np.ndarray,
) -> float:
    """
    Compute SSIM between two grayscale float32 arrays.

    Arrays from different documents will rarely share identical dimensions
    (page sizes can differ subtly between generators). PIL.Image.resize
    scales the target to the source dimensions before comparison so that
    minor DPI or page-size discrepancies do not cause a hard failure.

    data_range=1.0 because the arrays are normalised to [0, 1].
    win_size=7 (default) balances local sensitivity with noise resistance.
    """
    if src_arr.shape != tgt_arr.shape:
        tgt_img = Image.fromarray((tgt_arr * 255).astype(np.uint8))
        tgt_img = tgt_img.resize(
            (src_arr.shape[1], src_arr.shape[0]),
            Image.Resampling.LANCZOS,
        )
        tgt_arr = np.array(tgt_img, dtype=np.float32) / 255.0

    try:
        score, _ = structural_similarity(
            src_arr,
            tgt_arr,
            data_range=1.0,
            full=True,
        )
        return float(score)
    except Exception as exc:
        logger.warning("SSIM computation failed: %s. Returning 0.0.", exc)
        return 0.0
