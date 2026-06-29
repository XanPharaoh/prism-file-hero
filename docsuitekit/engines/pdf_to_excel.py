import logging
import os
import time
from pathlib import Path
from typing import Dict, List, Optional, Union

import fitz
import pandas as pd

from docsuitekit.config import GHOSTSCRIPT_BIN
from docsuitekit.core.binary_resolver import inject_binary_dirs
from docsuitekit.core.result import ConversionResult, ConversionStatus

logger = logging.getLogger(__name__)

# Ghostscript must be on PATH before Camelot is imported.
# Camelot lattice mode converts PDF pages to images internally using GS,
# and resolves the binary at the point of the subprocess call, not at import.
# Injecting here ensures the path is available for the entire module lifetime.
if GHOSTSCRIPT_BIN and GHOSTSCRIPT_BIN.exists():
    inject_binary_dirs([GHOSTSCRIPT_BIN])
    logger.debug("Ghostscript injected into PATH for Camelot: %s", GHOSTSCRIPT_BIN)

# Minimum fill ratio for a table to be considered real content.
# Tables with fewer than 10% non-empty cells are almost certainly
# false positives from decorative lines or form fields.
# Bank statements with high whitespace may fall in the 5-15% range.
_MIN_FILL_RATIO   = 0.05
_MIN_CAMELOT_ACC  = 50.0   # Camelot accuracy score threshold (0–100)
_SHEET_NAME_LIMIT = 31     # Excel enforces a 31-character sheet name limit


def pdf_to_excel(
    input_path: Path,
    output_path: Path,
    pages: Optional[Union[str, List[int]]] = None,
) -> ConversionResult:
    """
    Extract tabular data from a PDF into a multi-sheet Excel workbook.

    Three-strategy extraction cascade:

    Strategy 1 — pdfplumber (primary):
        Identifies table cell boundaries by finding intersections of
        horizontal and vertical vector lines drawn in the PDF's content
        stream. Fastest strategy. Precise for PDFs generated from
        structured data sources (BI tools, financial applications) that
        explicitly draw complete grid borders.

        table_settings tuned for:
        - snap_tolerance=3: merges lines within 3pt as one boundary
        - edge_min_length=10: ignores decorative lines shorter than 10pt

    Strategy 2 — Camelot lattice (first fallback):
        Converts the PDF page to a grayscale image and applies morphological
        edge detection to locate cell boundaries. More robust than pdfplumber
        for tables with dotted, dashed, or stylistically rendered borders
        that do not appear as explicit vector lines in the content stream.
        Requires Ghostscript on PATH (injected above).

    Strategy 3 — Camelot stream (final fallback):
        No border detection. Infers column positions from the statistical
        distribution of horizontal whitespace gaps between text runs.
        The only strategy that can extract borderless tables, but most
        sensitive to dense documents where non-table text creates false
        column alignments.

    pages: None  = all pages
           [0, 2] = pages 0 and 2 (0-indexed)
           "1,3"  = pages 1 and 3 in Camelot's 1-indexed string format
           "1-5"  = pages 1 through 5 in Camelot's range format

    Output:
        Multi-sheet .xlsx workbook. Each extracted table occupies one
        sheet named "P{page}_T{table}" (1-indexed). A "Summary" sheet
        records provenance metadata. Sheets are auto-named to stay within
        Excel's 31-character limit.
    """
    t0 = time.monotonic()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    camelot_pages    = _to_camelot_pages(pages)
    pdfplumber_pages = _to_pdfplumber_pages(input_path, pages)

    # ── Strategy 1: pdfplumber ─────────────────────────────────────────────────
    tables, strategy = _extract_pdfplumber(input_path, pdfplumber_pages)
    if tables:
        logger.info("pdfplumber extracted %d table(s).", len(tables))
    else:
        logger.info("pdfplumber: no qualifying tables found. Trying Camelot lattice.")

        # ── Strategy 2: Camelot lattice ────────────────────────────────────────
        tables, strategy = _extract_camelot(input_path, camelot_pages, flavor="lattice")
        if tables:
            logger.info("Camelot lattice extracted %d table(s).", len(tables))
        else:
            logger.info("Camelot lattice: no qualifying tables. Trying Camelot stream.")

            # ── Strategy 3: Camelot stream ─────────────────────────────────────
            tables, strategy = _extract_camelot(input_path, camelot_pages, flavor="stream")
            if tables:
                logger.info("Camelot stream extracted %d table(s).", len(tables))

    if not tables:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="pdfplumber + Camelot",
            error=(
                "No tables detected using any of the three extraction strategies "
                "(pdfplumber, Camelot lattice, Camelot stream). "
                "Possible causes: (1) tables are embedded as raster images — "
                "run OCR first to create a text layer; "
                "(2) content is formatted with spaces rather than table structure; "
                "(3) the page range specified contains no tabular data."
            ),
            elapsed_seconds=time.monotonic() - t0,
        )

    try:
        sheet_count = _write_excel(tables, strategy, input_path, output_path)
        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used=strategy,
            elapsed_seconds=time.monotonic() - t0,
            metadata={
                "tables_extracted": len(tables),
                "sheets_written":   sheet_count,
                "strategy":         strategy,
                "pages_spec":       str(pages or "all"),
            },
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used=strategy,
            error=f"Excel serialisation failed: {exc}",
            elapsed_seconds=time.monotonic() - t0,
        )


# ── Extraction strategies ──────────────────────────────────────────────────────

def _extract_pdfplumber(
    input_path: Path,
    target_pages: Optional[List[int]],
) -> tuple:
    """
    Strategy 1: Vector line intersection via pdfplumber.

    table_settings explanation:
    - vertical_strategy / horizontal_strategy = "lines":
        Only use explicitly drawn PDF lines as boundaries (not text alignment).
        The "lines_strict" variant is more conservative; "text" uses text
        positions as pseudo-borders (useful fallback but causes false positives).
    - snap_tolerance=3:
        Lines within 3 PDF points of each other are merged into one boundary.
        Prevents duplicate-column detection from thick border rendering.
    - intersection_tolerance=3:
        Lines must intersect within 3 points to be considered a grid corner.
    - edge_min_length=10:
        Ignores horizontal/vertical strokes shorter than 10 points, which
        eliminates underlines, form field borders, and decorative rules from
        being misclassified as table edges.
    """
    try:
        import pdfplumber
    except ImportError:
        logger.warning("pdfplumber not installed.")
        return [], "pdfplumber"

    table_settings = {
        "vertical_strategy":      "text",
        "horizontal_strategy":    "text",
        "snap_tolerance":         3,
        "snap_x_tolerance":       3,
        "snap_y_tolerance":       3,
        "join_tolerance":         3,
        "join_x_tolerance":       3,
        "join_y_tolerance":       3,
        "edge_min_length":        10,
        "min_words_vertical":     3,
        "min_words_horizontal":   1,
        "intersection_tolerance": 3,
        "intersection_x_tolerance": 3,
        "intersection_y_tolerance": 3,
        "text_tolerance":         3,
        "text_x_tolerance":       3,
        "text_y_tolerance":       3,
    }

    tables = []
    try:
        with pdfplumber.open(str(input_path)) as pdf:
            pages_to_scan = (
                target_pages if target_pages is not None
                else range(len(pdf.pages))
            )
            for page_idx in pages_to_scan:
                if page_idx >= len(pdf.pages):
                    logger.warning("Page index %d exceeds page count; skipping.", page_idx)
                    continue

                page         = pdf.pages[page_idx]
                page_tables  = page.extract_tables(table_settings=table_settings)
                logger.debug("Page %d: pdfplumber found %d raw tables.", page_idx + 1, len(page_tables))
                logger.debug("Page %d: pdfplumber found %d raw tables.", page_idx + 1, len(page_tables))

                for t_idx, raw_table in enumerate(page_tables):
                    if not raw_table:
                        continue
                    df = _raw_table_to_dataframe(raw_table)
                    if not _is_valid_table(df):
                        logger.debug(
                            "Page %d table %d rejected (fill ratio too low).",
                            page_idx + 1, t_idx + 1,
                        )
                        continue
                    tables.append({
                        "df":        df,
                        "page":      page_idx + 1,   # 1-indexed for display
                        "table_num": t_idx + 1,
                        "accuracy":  None,           # pdfplumber has no accuracy score
                    })
    except Exception as exc:
        logger.debug("pdfplumber extraction error: %s", exc, exc_info=True)
        return [], "pdfplumber"

    return tables, "pdfplumber"


def _extract_camelot(
    input_path: Path,
    camelot_pages: str,
    flavor: str,
) -> tuple:
    """
    Strategies 2 and 3: Camelot lattice and stream extraction.

    Camelot accuracy score (0–100):
        A heuristic estimating confidence in the table extraction.
        Tables scoring below _MIN_CAMELOT_ACC are discarded as likely
        false positives. In stream mode, accuracy scores are generally
        lower than in lattice mode because whitespace heuristics are
        less deterministic than geometric border detection.

    Ghostscript dependency:
        Camelot lattice converts each PDF page to an image using Ghostscript
        before running edge detection. The GS binary path was injected into
        PATH at module load time via inject_binary_dirs(). If GS is absent,
        lattice mode will raise an OSError at the subprocess call level.
        Stream mode does not require GS.
    """
    try:
        import camelot
    except ImportError:
        logger.warning("camelot-py not installed. Run: pip install 'camelot-py[cv]'")
        return [], f"Camelot-{flavor}"

    try:
        raw_tables = camelot.read_pdf(
            str(input_path),
            pages=camelot_pages,
            flavor=flavor,
            suppress_stdout=True,
        )
    except Exception as exc:
        logger.debug("Camelot %s read_pdf error: %s", flavor, exc, exc_info=True)
        return [], f"Camelot-{flavor}"

    tables = []
    for ct in raw_tables:
        if ct.accuracy < _MIN_CAMELOT_ACC:
            logger.debug(
                "Camelot table on page %d rejected: accuracy %.1f < %.1f",
                ct.page, ct.accuracy, _MIN_CAMELOT_ACC,
            )
            continue
        df = ct.df
        if not _is_valid_table(df):
            continue
        tables.append({
            "df":        df,
            "page":      ct.page,    # Camelot is 1-indexed
            "table_num": ct.order,
            "accuracy":  round(ct.accuracy, 1),
            "whitespace": round(ct.whitespace, 1),
        })

    return tables, f"Camelot-{flavor}"


# ── Excel output ───────────────────────────────────────────────────────────────

def _write_excel(
    tables: List[Dict],
    strategy: str,
    input_path: Path,
    output_path: Path,
) -> int:
    """
    Serialise extracted tables to a multi-sheet .xlsx workbook.

    Sheet naming convention: "P{page}_T{table}" (1-indexed, both axes).
    Sheet names are truncated to 31 characters (Excel hard limit) and
    deduplicated with a numeric suffix if collisions exist (rare but
    possible when many tables share the same page/table indices).

    Returns the number of data sheets written (excludes Summary sheet).
    """
    used_names: Dict[str, int] = {}

    def _unique_sheet_name(base: str) -> str:
        base = base[:_SHEET_NAME_LIMIT]
        if base not in used_names:
            used_names[base] = 0
            return base
        used_names[base] += 1
        suffix = f"_{used_names[base]}"
        return base[: _SHEET_NAME_LIMIT - len(suffix)] + suffix

    with pd.ExcelWriter(str(output_path), engine="openpyxl") as writer:
        # Summary sheet — always first for easy inspection
        summary_data = {
            "Source File":         [input_path.name],
            "Extraction Strategy": [strategy],
            "Tables Found":        [len(tables)],
            "Generator":           ["DocSuiteKit pdf_to_excel"],
        }
        pd.DataFrame(summary_data).to_excel(
            writer, sheet_name="Summary", index=False
        )

        for entry in tables:
            df         = entry["df"]
            page       = entry["page"]
            table_num  = entry.get("table_num", 1)
            accuracy   = entry.get("accuracy")
            whitespace = entry.get("whitespace")

            sheet_name = _unique_sheet_name(f"P{page}_T{table_num}")
            df.to_excel(writer, sheet_name=sheet_name, index=False)

            # Annotate the sheet with extraction metadata in cell A1 comment
            # (stored in metadata dict; actual cell annotation done post-write
            # would require openpyxl direct manipulation — deferred to Phase 6 UI)
            logger.debug(
                "Written sheet '%s': %d rows × %d cols, accuracy=%s, whitespace=%s",
                sheet_name, len(df), len(df.columns), accuracy, whitespace,
            )

    return len(tables)


# ── Data quality helpers ───────────────────────────────────────────────────────

def _raw_table_to_dataframe(raw_table: List[List]) -> pd.DataFrame:
    """
    Convert pdfplumber's raw table (list of lists) to a pandas DataFrame.

    pdfplumber returns None for empty cells. These are replaced with empty
    strings. The first row is promoted to column headers when all values are
    non-numeric strings, indicating a header row rather than a data row.
    Duplicate column names are disambiguated with a suffix ("Col_1", "Col_1_2").
    """
    # Normalise: replace None and strip whitespace
    cleaned = [
        [str(cell).strip() if cell is not None else "" for cell in row]
        for row in raw_table
        if any(cell is not None for cell in row)  # Drop fully empty rows
    ]

    if not cleaned:
        return pd.DataFrame()

    first_row = cleaned[0]

    def _looks_like_header(row: List[str]) -> bool:
        non_empty = [c for c in row if c]
        if not non_empty:
            return False
        numeric_count = sum(
            1 for c in non_empty
            if c.replace(".", "").replace("-", "").replace(",", "").replace(" ", "").isdigit()
        )
        return numeric_count / len(non_empty) < 0.5  # Less than half numeric

    if _looks_like_header(first_row) and len(cleaned) > 1:
        # Deduplicate column names
        cols: List[str] = []
        seen: Dict[str, int] = {}
        for c in first_row:
            if c in seen:
                seen[c] += 1
                cols.append(f"{c}_{seen[c]}")
            else:
                seen[c] = 0
                cols.append(c or f"Col_{len(cols) + 1}")
        df = pd.DataFrame(cleaned[1:], columns=cols)
    else:
        df = pd.DataFrame(cleaned)

    return df


def _is_valid_table(df: pd.DataFrame, min_fill_ratio: float = _MIN_FILL_RATIO) -> bool:
    """
    Reject tables that are mostly empty — likely decorative line artefacts.
    A table is valid when at least min_fill_ratio of its cells are non-empty
    and it contains at least 2 rows and 2 columns.
    """
    if df.empty or df.shape[0] < 2 or df.shape[1] < 2:
        return False
    total = df.size
    non_empty = int((df.astype(str).apply(lambda col: col.str.strip() != "")).sum().sum())
    ratio = non_empty / total
    if ratio < min_fill_ratio:
        logger.debug("Table rejected: fill ratio %.2f < %.2f", ratio, min_fill_ratio)
    return ratio >= min_fill_ratio


# ── Page specification converters ──────────────────────────────────────────────

def _to_camelot_pages(pages: Optional[Union[str, List[int]]]) -> str:
    """
    Normalise a pages specification to Camelot's 1-indexed string format.

    Camelot accepts: "all", "1,3,5", "1-5", or combinations like "1-3,7".
    Input list values are assumed 0-indexed and converted (+1) to 1-indexed.
    """
    if pages is None:
        return "all"
    if isinstance(pages, str):
        return pages   # Already in Camelot format; pass through
    if isinstance(pages, (list, tuple)):
        return ",".join(str(p + 1) for p in pages)
    return "all"


def _to_pdfplumber_pages(
    input_path: Path,
    pages: Optional[Union[str, List[int]]],
) -> Optional[List[int]]:
    """
    Normalise a pages specification to a list of 0-indexed integers for pdfplumber.

    Returns None (= all pages) when pages is None or "all".
    Converts Camelot-style 1-indexed strings to 0-indexed integer lists.
    """
    if pages is None or pages == "all":
        return None
    if isinstance(pages, (list, tuple)):
        return [int(p) for p in pages]
    if isinstance(pages, str):
        result: List[int] = []
        for part in pages.split(","):
            part = part.strip()
            if "-" in part:
                start_s, end_s = part.split("-", 1)
                # Camelot range is inclusive on both ends; convert to 0-indexed
                result.extend(range(int(start_s) - 1, int(end_s)))
            elif part.isdigit():
                result.append(int(part) - 1)
        return result
    return None
