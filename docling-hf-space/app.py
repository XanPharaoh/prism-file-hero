from fastapi import FastAPI, File, UploadFile, HTTPException
import tempfile
import os
import time
import logging

from docling.document_converter import DocumentConverter
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("docling-hf")

app = FastAPI()

_converter = None


def get_converter():
    global _converter
    if _converter is None:
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = False
        pipeline_options.do_table_structure = True
        pipeline_options.table_structure_options.do_cell_matching = True
        _converter = DocumentConverter(
            format_options={InputFormat.PDF: pipeline_options}
        )
        logger.info("Converter initialized")
    return _converter


@app.get("/health")
async def health():
    return {"status": "healthy", "converter_ready": _converter is not None}


@app.post("/extract")
async def extract(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF supported")

    start = time.time()
    content = await file.read()

    if len(content) == 0:
        raise HTTPException(400, "Empty file")
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 50MB)")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        converter = get_converter()
        result = converter.convert(tmp_path)
        doc = result.document

        tables = []
        for page_no, page in enumerate(doc.pages.values(), start=1):
            for table in page.tables:
                if table.data and hasattr(table.data, "grid") and table.data.grid:
                    all_rows = []
                    for row in table.data.grid:
                        row_cells = [
                            str(cell.text).strip()
                            if hasattr(cell, "text") and cell.text
                            else ""
                            for cell in row
                        ]
                        all_rows.append(row_cells)
                    if all_rows:
                        headers = all_rows[0]
                        rows = all_rows[1:] if len(all_rows) > 1 else []
                        cell_count = sum(len(r) for r in rows)
                        empty = sum(1 for r in rows for c in r if not c)
                        confidence = round(1.0 - (empty / max(cell_count, 1)), 4)
                        tables.append(
                            {
                                "table_index": len(tables),
                                "page_number": page_no,
                                "headers": headers,
                                "rows": rows,
                                "row_count": len(rows),
                                "column_count": len(headers)
                                if headers
                                else (len(rows[0]) if rows else 0),
                                "confidence": confidence,
                            }
                        )

        full_text = (
            doc.export_to_markdown() if hasattr(doc, "export_to_markdown") else ""
        )

        elapsed = (time.time() - start) * 1000
        avg_conf = sum(t["confidence"] for t in tables) / len(tables) if tables else 1.0

        return {
            "success": True,
            "metadata": {
                "title": file.filename,
                "author": None,
                "page_count": len(doc.pages),
                "file_size_bytes": len(content),
                "processing_time_ms": round(elapsed, 2),
            },
            "pages": [],
            "full_text": full_text,
            "tables": tables,
            "overall_confidence": round(avg_conf, 4),
            "error": None,
        }
    except Exception as e:
        logger.error(f"Extraction failed: {e}", exc_info=True)
        return {
            "success": False,
            "metadata": {
                "title": file.filename,
                "author": None,
                "page_count": 0,
                "file_size_bytes": len(content),
                "processing_time_ms": round((time.time() - start) * 1000, 2),
            },
            "pages": [],
            "full_text": "",
            "tables": [],
            "overall_confidence": 0.0,
            "error": str(e),
        }
    finally:
        os.unlink(tmp_path)
