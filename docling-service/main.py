"""
Docling-based PDF Extraction Service for Prism File Hero.

Provides superior PDF parsing capabilities using Docling's DocumentConverter.
Exposes REST endpoints for health checks, general extraction, and table-focused extraction.
"""

import json
import logging
import os
import tempfile
import time
from typing import Any, Optional

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from docling.document_converter import DocumentConverter
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)-8s] %(name)s: %(message)s",
)
logger = logging.getLogger("docling-service")

app = FastAPI(
    title="Prism File Hero - Docling PDF Extraction Service",
    description="High-quality PDF extraction powered by Docling",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_converter: Optional[DocumentConverter] = None


def get_converter() -> DocumentConverter:
    global _converter
    if _converter is None:
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = True
        pipeline_options.do_table_structure = True
        pipeline_options.table_structure_options.do_cell_matching = True
        _converter = DocumentConverter(
            format_options={
                InputFormat.PDF: pipeline_options,
            }
        )
        logger.info("DocumentConverter initialized with OCR and table structure")
    return _converter


class TableData(BaseModel):
    table_index: int
    page_number: int
    headers: list[str] = []
    rows: list[list[str]] = []
    row_count: int
    column_count: int
    confidence: float = Field(..., ge=0.0, le=1.0)


class PageContent(BaseModel):
    page_number: int
    text: str
    tables: list[TableData] = []


class ExtractionMetadata(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    page_count: int
    file_size_bytes: int
    processing_time_ms: float


class ExtractionResponse(BaseModel):
    success: bool
    metadata: ExtractionMetadata
    pages: list[PageContent] = []
    full_text: str
    tables: list[TableData] = []
    overall_confidence: float = Field(..., ge=0.0, le=1.0)
    error: Optional[str] = None


class TableExtractionResponse(BaseModel):
    success: bool
    tables: list[TableData] = []
    page_count: int
    processing_time_ms: float
    error: Optional[str] = None


def extract_tables_from_doc(doc) -> list[TableData]:
    tables = []
    table_index = 0

    for page_no, page in enumerate(doc.pages.values(), start=1):
        for table in page.tables:
            table_data = table.data
            headers = []
            rows_data = []

            if (
                table_data is not None
                and hasattr(table_data, "grid")
                and table_data.grid
            ):
                all_rows = []
                for row in table_data.grid:
                    row_cells = [
                        str(cell.text).strip()
                        if hasattr(cell, "text") and cell.text
                        else ""
                        for cell in row
                    ]
                    all_rows.append(row_cells)

                if all_rows:
                    headers = all_rows[0]
                    rows_data = all_rows[1:] if len(all_rows) > 1 else []

            cell_count = sum(len(row) for row in rows_data)
            empty_cells = sum(1 for row in rows_data for cell in row if not cell)
            confidence = 1.0 - (empty_cells / max(cell_count, 1))
            confidence = round(max(0.0, min(1.0, confidence)), 4)

            tables.append(
                TableData(
                    table_index=table_index,
                    page_number=page_no,
                    headers=headers,
                    rows=rows_data,
                    row_count=len(rows_data),
                    column_count=len(headers)
                    if headers
                    else (len(rows_data[0]) if rows_data else 0),
                    confidence=confidence,
                )
            )
            table_index += 1

    return tables


def extract_text_from_doc(doc) -> str:
    if hasattr(doc, "export_to_markdown"):
        return doc.export_to_markdown()
    return ""


def extract_pages_from_doc(doc) -> list[PageContent]:
    pages = []
    page_tables = extract_tables_from_doc(doc)

    for page_no, page in enumerate(doc.pages.values(), start=1):
        page_text = ""
        if hasattr(page, "texts"):
            page_text = "\n".join(str(text.text) for text in page.texts if text.text)

        page_tables_list = [t for t in page_tables if t.page_number == page_no]

        pages.append(
            PageContent(
                page_number=page_no,
                text=page_text,
                tables=page_tables_list,
            )
        )

    return pages


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "docling-extraction",
        "version": "1.0.0",
        "converter_ready": _converter is not None,
    }


@app.post("/extract", response_model=ExtractionResponse)
async def extract_pdf(file: UploadFile = File(...)):
    start_time = time.time()
    file_size = 0

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    try:
        file_content = await file.read()
        file_size = len(file_content)

        if file_size == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        if file_size > 100 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File size exceeds 100MB limit")

        logger.info(f"Processing PDF: {file.filename} ({file_size} bytes)")

        converter = get_converter()

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(file_content)
            tmp_path = tmp.name

        try:
            result = converter.convert(tmp_path)
            doc = result.document

            full_text = extract_text_from_doc(doc)
            tables = extract_tables_from_doc(doc)
            pages = extract_pages_from_doc(doc)

            if tables:
                avg_table_confidence = sum(t.confidence for t in tables) / len(tables)
            else:
                avg_table_confidence = 1.0

            processing_time_ms = (time.time() - start_time) * 1000

            metadata = ExtractionMetadata(
                title=file.filename,
                author=None,
                page_count=len(doc.pages),
                file_size_bytes=file_size,
                processing_time_ms=round(processing_time_ms, 2),
            )

            response = ExtractionResponse(
                success=True,
                metadata=metadata,
                pages=pages,
                full_text=full_text,
                tables=tables,
                overall_confidence=round(avg_table_confidence, 4),
                error=None,
            )

            logger.info(
                f"Extraction complete: {len(pages)} pages, {len(tables)} tables, "
                f"{processing_time_ms:.0f}ms"
            )

            return response

        finally:
            os.unlink(tmp_path)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Extraction failed: {str(e)}", exc_info=True)
        processing_time_ms = (time.time() - start_time) * 1000

        return ExtractionResponse(
            success=False,
            metadata=ExtractionMetadata(
                title=file.filename,
                author=None,
                page_count=0,
                file_size_bytes=file_size,
                processing_time_ms=round(processing_time_ms, 2),
            ),
            pages=[],
            full_text="",
            tables=[],
            overall_confidence=0.0,
            error=str(e),
        )


@app.post("/extract/tables", response_model=TableExtractionResponse)
async def extract_tables_endpoint(file: UploadFile = File(...)):
    start_time = time.time()

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    try:
        file_content = await file.read()
        file_size = len(file_content)

        if file_size == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        logger.info(f"Table extraction: {file.filename} ({file_size} bytes)")

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(file_content)
            tmp_path = tmp.name

        try:
            converter = get_converter()
            result = converter.convert(tmp_path)
            doc = result.document

            tables = extract_tables_from_doc(doc)
            processing_time_ms = (time.time() - start_time) * 1000

            response = TableExtractionResponse(
                success=True,
                tables=tables,
                page_count=len(doc.pages),
                processing_time_ms=round(processing_time_ms, 2),
                error=None,
            )

            logger.info(
                f"Table extraction complete: {len(tables)} tables in {processing_time_ms:.0f}ms"
            )
            return response

        finally:
            os.unlink(tmp_path)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Table extraction failed: {str(e)}", exc_info=True)
        processing_time_ms = (time.time() - start_time) * 1000

        return TableExtractionResponse(
            success=False,
            tables=[],
            page_count=0,
            processing_time_ms=round(processing_time_ms, 2),
            error=str(e),
        )


@app.post("/extract/batch")
async def extract_batch(files: list[UploadFile] = File(...)):
    results = []

    for file in files:
        try:
            file_content = await file.read()

            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(file_content)
                tmp_path = tmp.name

            try:
                converter = get_converter()
                result = converter.convert(tmp_path)
                doc = result.document

                tables = extract_tables_from_doc(doc)
                full_text = extract_text_from_doc(doc)

                results.append(
                    {
                        "filename": file.filename,
                        "success": True,
                        "page_count": len(doc.pages),
                        "table_count": len(tables),
                        "tables": [t.model_dump() for t in tables],
                        "full_text": full_text,
                    }
                )
            finally:
                os.unlink(tmp_path)

        except Exception as e:
            logger.error(f"Batch item failed: {file.filename}: {e}")
            results.append(
                {
                    "filename": file.filename,
                    "success": False,
                    "error": str(e),
                }
            )

    return {
        "total": len(files),
        "successful": sum(1 for r in results if r["success"]),
        "failed": sum(1 for r in results if not r["success"]),
        "results": results,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
