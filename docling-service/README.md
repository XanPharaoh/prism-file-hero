# Docling PDF Extraction Service

A Python FastAPI service providing superior PDF parsing capabilities for Prism File Hero using [Docling](https://github.com/DS4SD/docling).

## Features

- **High-quality PDF parsing** via Docling's DocumentConverter
- **Table extraction** with structured data (headers, rows, confidence scores)
- **Full text extraction** in reading order (markdown format)
- **Per-page content** breakdown
- **Batch processing** of multiple PDFs
- **OCR support** for scanned documents
- **Confidence scoring** for extracted data
- **CORS enabled** for frontend integration

## Quick Start

### Local Development

```bash
cd docling-service

# Create virtual environment
python -m venv .venv
.venv\Scripts\activate  # Windows
source .venv/bin/activate  # Linux/Mac

# Install dependencies
pip install -r requirements.txt

# Run the service
python main.py
# or
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Service runs at `http://localhost:8000`

### Docker

```bash
# Build and run
docker-compose up --build

# Or with Docker directly
docker build -t docling-service .
docker run -p 8000:8000 docling-service
```

## API Endpoints

### Health Check

```
GET /health
```

Response:
```json
{
  "status": "healthy",
  "service": "docling-extraction",
  "version": "1.0.0",
  "converter_ready": true
}
```

### Extract PDF

```
POST /extract
Content-Type: multipart/form-data
```

Form field: `file` (PDF file)

Response includes:
- `full_text`: Complete document text in markdown
- `tables`: All extracted tables with headers and rows
- `pages`: Per-page content breakdown
- `metadata`: Document info and processing stats
- `overall_confidence`: Quality score (0-1)

### Extract Tables Only

```
POST /extract/tables
Content-Type: multipart/form-data
```

Optimized for table-focused workflows (e.g., PDF to Excel conversion).

### Batch Processing

```
POST /extract/batch
Content-Type: multipart/form-data
```

Accept multiple files. Returns summary with per-file results.

## Frontend Integration

The service returns JSON compatible with the existing Prism File Hero frontend:

```typescript
interface TableData {
  headers: string[];
  rows: string[][];
  confidence: number;
}

interface ExtractionResponse {
  success: boolean;
  full_text: string;
  tables: TableData[];
  overall_confidence: number;
}
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `8000` | Service port |
| `PYTHONUNBUFFERED` | `1` | Unbuffered logging |

## File Size Limits

- Maximum upload: 100MB
- Supported format: PDF only
