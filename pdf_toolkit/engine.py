"""Prism Document Suite — Processing Engine.

28 static methods. Zero UI. Pure logic.
Each method follows the contract:
    - Accepts file paths + keyword-only options + optional progress callback
    - Returns dict with output_path, pages_processed, file_size, duration, warnings
    - Raises FileNotFoundError, PermissionError, ValueError, RuntimeError
"""

import difflib
import gc
import io
import os
import time
from pathlib import Path
from typing import Callable

import fitz  # PyMuPDF
from PIL import Image, ImageEnhance, ImageFilter
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4, letter, landscape as rl_landscape
from reportlab.lib.units import inch, cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib import colors


def _result(output_path: str, pages: int, start_time: float, warnings: list[str] | None = None) -> dict:
    """Build a standardized result dict."""
    return {
        "output_path": output_path,
        "pages_processed": pages,
        "file_size": os.path.getsize(output_path) if os.path.exists(output_path) else 0,
        "duration": round(time.perf_counter() - start_time, 2),
        "warnings": warnings or [],
    }


def _parse_page_range(pages: str, total: int) -> set[int]:
    """Parse '1,3,5-8' or 'all' into a set of 0-based indices."""
    if pages.strip().lower() == "all":
        return set(range(total))
    indices = set()
    for part in pages.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            indices.update(range(int(a) - 1, min(int(b), total)))
        else:
            idx = int(part) - 1
            if 0 <= idx < total:
                indices.add(idx)
    return indices


class PDFEngine:

    # ══════════════════════════════════════════════════════════════════════
    # ORGANIZE
    # ══════════════════════════════════════════════════════════════════════

    @staticmethod
    def merge_pdf(input_paths: list[str], output_path: str, *,
                  progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        writer = PdfWriter()
        total = len(input_paths)
        page_count = 0
        for i, f in enumerate(input_paths):
            for page in PdfReader(f).pages:
                writer.add_page(page)
                page_count += 1
            if progress:
                progress((i + 1) / total)
        with open(output_path, "wb") as fh:
            writer.write(fh)
        return _result(output_path, page_count, t)

    @staticmethod
    def split_pdf(input_path: str, output_dir: str, *,
                  mode: str = "single", ranges: list[str] | None = None,
                  every_n: int = 1,
                  progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        reader = PdfReader(input_path)
        stem = Path(input_path).stem
        total = len(reader.pages)
        count = 0

        if mode == "single":
            for i, page in enumerate(reader.pages):
                w = PdfWriter()
                w.add_page(page)
                with open(os.path.join(output_dir, f"{stem}_page_{i+1}.pdf"), "wb") as f:
                    w.write(f)
                count += 1
                if progress:
                    progress((i + 1) / total)

        elif mode == "range" and ranges:
            for r in ranges:
                parts = r.strip().split("-")
                s, e = int(parts[0]), int(parts[-1])
                w = PdfWriter()
                for i in range(s - 1, min(e, total)):
                    w.add_page(reader.pages[i])
                with open(os.path.join(output_dir, f"{stem}_{s}-{e}.pdf"), "wb") as f:
                    w.write(f)
                count += 1

        elif mode == "every_n":
            for start in range(0, total, every_n):
                w = PdfWriter()
                end = min(start + every_n, total)
                for i in range(start, end):
                    w.add_page(reader.pages[i])
                with open(os.path.join(output_dir, f"{stem}_{start+1}-{end}.pdf"), "wb") as f:
                    w.write(f)
                count += 1

        return _result(output_dir, count, t)

    @staticmethod
    def rotate_pdf(input_path: str, output_path: str, *,
                   angle: int = 90, page_range: str = "all",
                   progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        reader = PdfReader(input_path)
        writer = PdfWriter()
        total = len(reader.pages)
        indices = _parse_page_range(page_range, total)
        for i, page in enumerate(reader.pages):
            if i in indices:
                page.rotate(angle)
            writer.add_page(page)
            if progress:
                progress((i + 1) / total)
        with open(output_path, "wb") as f:
            writer.write(f)
        return _result(output_path, total, t)

    @staticmethod
    def organise_pdf(input_path: str, output_path: str, *,
                     page_order: list[int],
                     delete_pages: list[int] | None = None,
                     progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        reader = PdfReader(input_path)
        writer = PdfWriter()
        deleted = set(delete_pages) if delete_pages else set()
        order = [i for i in page_order if i not in deleted]
        for idx, i in enumerate(order):
            writer.add_page(reader.pages[i])
            if progress:
                progress((idx + 1) / len(order))
        with open(output_path, "wb") as f:
            writer.write(f)
        return _result(output_path, len(order), t)

    @staticmethod
    def page_numbers(input_path: str, output_path: str, *,
                     position: str = "bottom-center", start_number: int = 1,
                     font_size: int = 10, font_name: str = "Helvetica",
                     margin: int = 36, skip_first: bool = False,
                     format_str: str = "{n}",
                     progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        reader = PdfReader(input_path)
        writer = PdfWriter()
        total = len(reader.pages)
        for i, page in enumerate(reader.pages):
            if skip_first and i == 0:
                writer.add_page(page)
                continue
            pw, ph = float(page.mediabox.width), float(page.mediabox.height)
            packet = io.BytesIO()
            c = canvas.Canvas(packet, pagesize=(pw, ph))
            c.setFont(font_name, font_size)
            num_text = format_str.replace("{n}", str(start_number + i)).replace("{total}", str(total))
            coords = {
                "bottom-center": (pw / 2, margin / 2),
                "bottom-left": (margin, margin / 2),
                "bottom-right": (pw - margin, margin / 2),
                "top-center": (pw / 2, ph - margin / 2),
                "top-left": (margin, ph - margin / 2),
                "top-right": (pw - margin, ph - margin / 2),
            }
            x, y = coords.get(position, coords["bottom-center"])
            if "center" in position:
                c.drawCentredString(x, y, num_text)
            elif "right" in position:
                c.drawRightString(x, y, num_text)
            else:
                c.drawString(x, y, num_text)
            c.save()
            packet.seek(0)
            page.merge_page(PdfReader(packet).pages[0])
            writer.add_page(page)
            if progress:
                progress((i + 1) / total)
        with open(output_path, "wb") as f:
            writer.write(f)
        return _result(output_path, total, t)

    # ══════════════════════════════════════════════════════════════════════
    # CONVERT
    # ══════════════════════════════════════════════════════════════════════

    @staticmethod
    def pdf_to_word(input_path: str, output_path: str, *,
                    pages: str = "all",
                    progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        from pdf2docx import Converter
        cv = Converter(input_path)
        total = len(cv.pages) if hasattr(cv, 'pages') else 0
        if pages == "all":
            cv.convert(output_path)
        else:
            page_indices = list(_parse_page_range(pages, cv.page_count if hasattr(cv, 'page_count') else 100))
            cv.convert(output_path, pages=page_indices)
        cv.close()
        return _result(output_path, total or 1, t)

    @staticmethod
    def word_to_pdf(input_path: str, output_path: str, *,
                    page_size: str = "A4", margin_pt: float = 72.0,
                    progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        from docx import Document
        doc = Document(input_path)
        ps = {"A4": A4, "Letter": letter}.get(page_size, A4)
        styles = getSampleStyleSheet()
        body_style = ParagraphStyle(
            "Body", parent=styles["Normal"], fontSize=11, leading=14,
            spaceBefore=4, spaceAfter=4,
        )
        story = []
        warnings = []
        for para in doc.paragraphs:
            text = para.text.strip()
            if text:
                story.append(Paragraph(text.replace("&", "&amp;").replace("<", "&lt;"), body_style))
            else:
                story.append(Spacer(1, 6))

        for table in doc.tables:
            data = []
            for row in table.rows:
                data.append([cell.text for cell in row.cells])
            if data:
                t_style = TableStyle([
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ])
                story.append(Spacer(1, 12))
                story.append(Table(data, style=t_style))

        if not story:
            story.append(Paragraph("(Empty document)", body_style))
            warnings.append("Document had no text content")

        pdf_doc = SimpleDocTemplate(
            output_path, pagesize=ps,
            leftMargin=margin_pt, rightMargin=margin_pt,
            topMargin=margin_pt, bottomMargin=margin_pt,
        )
        pdf_doc.build(story)
        return _result(output_path, 1, t, warnings)

    @staticmethod
    def pdf_to_pptx(input_path: str, output_path: str, *,
                    dpi: int = 200, pages: str = "all",
                    progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        from pptx import Presentation
        from pptx.util import Inches, Emu

        doc = fitz.open(input_path)
        total = doc.page_count
        indices = _parse_page_range(pages, total)
        mat = fitz.Matrix(dpi / 72, dpi / 72)

        prs = Presentation()
        prs.slide_width = Inches(13.333)
        prs.slide_height = Inches(7.5)
        blank_layout = prs.slide_layouts[6]  # blank layout

        for i in range(total):
            if i not in indices:
                continue
            page = doc[i]
            pix = page.get_pixmap(matrix=mat)
            img_bytes = pix.tobytes("png")
            img_stream = io.BytesIO(img_bytes)

            slide = prs.slides.add_slide(blank_layout)
            slide.shapes.add_picture(
                img_stream, Emu(0), Emu(0),
                prs.slide_width, prs.slide_height,
            )
            if progress:
                progress((i + 1) / total)

        doc.close()
        prs.save(output_path)
        return _result(output_path, len(indices), t)

    @staticmethod
    def pptx_to_pdf(input_path: str, output_path: str, *,
                    page_size: str = "widescreen",
                    progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        from pptx import Presentation
        from pptx.util import Inches

        prs = Presentation(input_path)
        sizes = {
            "widescreen": (Inches(13.333), Inches(7.5)),
            "standard": (Inches(10), Inches(7.5)),
            "A4": A4,
        }
        pw, ph = sizes.get(page_size, sizes["widescreen"])
        if isinstance(pw, float) and pw > 1000:
            pw, ph = pw / 914400 * 72, ph / 914400 * 72
        else:
            pw, ph = float(pw), float(ph)

        c_pdf = canvas.Canvas(output_path, pagesize=(pw, ph))
        total = len(prs.slides)

        for idx, slide in enumerate(prs.slides):
            y_pos = ph - 40
            for shape in slide.shapes:
                if shape.has_text_frame:
                    for para in shape.text_frame.paragraphs:
                        text = para.text.strip()
                        if text:
                            c_pdf.setFont("Helvetica", 12)
                            c_pdf.drawString(40, y_pos, text[:120])
                            y_pos -= 18
                            if y_pos < 40:
                                break
                elif hasattr(shape, "image"):
                    try:
                        img_bytes = shape.image.blob
                        img = Image.open(io.BytesIO(img_bytes))
                        if img.mode == "RGBA":
                            bg = Image.new("RGB", img.size, (255, 255, 255))
                            bg.paste(img, mask=img.split()[3])
                            img = bg
                        elif img.mode != "RGB":
                            img = img.convert("RGB")
                        buf = io.BytesIO()
                        img.save(buf, format="PNG")
                        buf.seek(0)
                        iw, ih = img.size
                        scale = min((pw - 80) / max(iw, 1), (y_pos - 40) / max(ih, 1), 1)
                        c_pdf.drawImage(ImageReader(buf), 40, y_pos - ih * scale, iw * scale, ih * scale)
                        y_pos -= ih * scale + 10
                    except Exception:
                        pass
            c_pdf.showPage()
            if progress:
                progress((idx + 1) / total)

        c_pdf.save()
        return _result(output_path, total, t)

    @staticmethod
    def pdf_to_excel(input_path: str, output_path: str, *,
                     pages: str = "all", use_ocr: bool = False,
                     ocr_engine: str = "auto", ocr_lang: str = "eng",
                     progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        import pdfplumber
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.title = "Extracted Tables"
        current_row = 1
        warnings = []

        with pdfplumber.open(input_path) as pdf:
            total = len(pdf.pages)
            indices = _parse_page_range(pages, total)

            for i, page in enumerate(pdf.pages):
                if i not in indices:
                    continue
                tables = page.extract_tables()
                if not tables and use_ocr:
                    warnings.append(f"Page {i+1}: no tables found, OCR fallback not yet available for table extraction")
                for table in tables:
                    ws.cell(row=current_row, column=1, value=f"--- Page {i+1} ---")
                    current_row += 1
                    for row_data in table:
                        for col, val in enumerate(row_data):
                            ws.cell(row=current_row, column=col + 1, value=val or "")
                        current_row += 1
                    current_row += 1
                if progress:
                    progress((i + 1) / total)

        wb.save(output_path)
        return _result(output_path, current_row - 1, t, warnings)

    @staticmethod
    def excel_to_pdf(input_path: str, output_path: str, *,
                     sheet_names: list[str] | None = None,
                     page_size: str = "A4", landscape_mode: bool = True,
                     progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        from openpyxl import load_workbook

        wb = load_workbook(input_path, data_only=True)
        sheets = sheet_names if sheet_names else wb.sheetnames
        ps = {"A4": A4, "Letter": letter}.get(page_size, A4)
        if landscape_mode:
            ps = rl_landscape(ps)

        story = []
        styles = getSampleStyleSheet()
        total = len(sheets)

        for si, sheet_name in enumerate(sheets):
            if sheet_name not in wb.sheetnames:
                continue
            ws = wb[sheet_name]
            story.append(Paragraph(f"<b>{sheet_name}</b>", styles["Heading2"]))
            story.append(Spacer(1, 12))

            data = []
            for row in ws.iter_rows(values_only=True):
                data.append([str(cell) if cell is not None else "" for cell in row])

            if data:
                t_style = TableStyle([
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2E8F0")),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ])
                col_count = max(len(r) for r in data) if data else 1
                avail = ps[0] - 100
                col_width = min(avail / max(col_count, 1), 200)
                story.append(Table(data, colWidths=[col_width] * col_count, style=t_style))

            if si < total - 1:
                story.append(PageBreak())
            if progress:
                progress((si + 1) / total)

        doc = SimpleDocTemplate(output_path, pagesize=ps, leftMargin=36, rightMargin=36)
        doc.build(story)
        return _result(output_path, total, t)

    @staticmethod
    def pdf_to_jpg(input_path: str, output_dir: str, *,
                   dpi: int = 200, quality: int = 90,
                   pages: str = "all", fmt: str = "jpg",
                   progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        doc = fitz.open(input_path)
        stem = Path(input_path).stem
        total = doc.page_count
        indices = _parse_page_range(pages, total)
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        count = 0

        for i in range(total):
            if i not in indices:
                continue
            pix = doc[i].get_pixmap(matrix=mat)
            out_file = os.path.join(output_dir, f"{stem}_page_{i+1}.{fmt}")
            if fmt in ("jpg", "jpeg"):
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                img.save(out_file, "JPEG", quality=quality)
            else:
                pix.save(out_file)
            count += 1
            if progress:
                progress((i + 1) / total)

        doc.close()
        return _result(output_dir, count, t)

    @staticmethod
    def jpg_to_pdf(input_paths: list[str], output_path: str, *,
                   page_size: str = "auto", auto_orient: bool = True,
                   progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        total = len(input_paths)

        if page_size == "auto":
            doc = fitz.open()
            for i, img_path in enumerate(input_paths):
                img = fitz.open(img_path)
                rect = img[0].rect
                pdf_bytes = img.convert_to_pdf()
                img.close()
                img_pdf = fitz.open("pdf", pdf_bytes)
                page = doc.new_page(width=rect.width, height=rect.height)
                page.show_pdf_page(page.rect, img_pdf, 0)
                img_pdf.close()
                if progress:
                    progress((i + 1) / total)
            doc.save(output_path)
            doc.close()
        else:
            pw, ph = {"A4": A4, "Letter": letter}.get(page_size, A4)
            c_pdf = canvas.Canvas(output_path, pagesize=(pw, ph))
            margin = 36
            for i, img_path in enumerate(input_paths):
                img = Image.open(img_path)
                if img.mode == "RGBA":
                    bg = Image.new("RGB", img.size, (255, 255, 255))
                    bg.paste(img, mask=img.split()[3])
                    img = bg
                elif img.mode != "RGB":
                    img = img.convert("RGB")
                iw, ih = img.size
                if auto_orient and iw > ih and ph > pw:
                    img = img.transpose(Image.ROTATE_90)
                    iw, ih = ih, iw
                scale = min((pw - 2 * margin) / max(iw, 1), (ph - 2 * margin) / max(ih, 1), 1)
                dw, dh = iw * scale, ih * scale
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                buf.seek(0)
                c_pdf.drawImage(ImageReader(buf), (pw - dw) / 2, (ph - dh) / 2, dw, dh)
                c_pdf.showPage()
                if progress:
                    progress((i + 1) / total)
            c_pdf.save()

        return _result(output_path, total, t)

    @staticmethod
    def html_to_pdf(input_path: str, output_path: str, *,
                    page_size: str = "A4", encoding: str = "utf-8",
                    progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        from xhtml2pdf import pisa

        with open(input_path, "r", encoding=encoding) as f:
            html = f.read()
        with open(output_path, "wb") as out:
            result = pisa.CreatePDF(html, dest=out)

        warnings = []
        if result.err:
            warnings.append(f"xhtml2pdf reported {result.err} error(s)")
        return _result(output_path, 1, t, warnings)

    @staticmethod
    def pdf_to_pdfa(input_path: str, output_path: str, *,
                    progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        doc = fitz.open(input_path)
        total = doc.page_count
        # PyMuPDF supports basic PDF/A-1b output
        doc.save(output_path, garbage=4, deflate=True, clean=True)
        doc.close()
        warnings = ["Basic PDF/A compliance applied. For full archival compliance, use a dedicated tool."]
        return _result(output_path, total, t, warnings)

    # ══════════════════════════════════════════════════════════════════════
    # EDIT
    # ══════════════════════════════════════════════════════════════════════

    @staticmethod
    def edit_pdf(input_path: str, output_path: str, *,
                 operations: list[dict],
                 progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        doc = fitz.open(input_path)
        total = len(operations)
        warnings = []

        for idx, op in enumerate(operations):
            page_num = op.get("page", 0)
            if page_num >= doc.page_count:
                warnings.append(f"Page {page_num + 1} does not exist, skipping")
                continue
            page = doc[page_num]
            op_type = op.get("type", "")

            if op_type == "add_text":
                point = fitz.Point(op.get("x", 72), op.get("y", 72))
                page.insert_text(
                    point, op.get("text", ""),
                    fontsize=op.get("font_size", 12),
                    color=op.get("color", (0, 0, 0)),
                )
            elif op_type == "add_image":
                rect = fitz.Rect(op.get("x", 72), op.get("y", 72),
                                 op.get("x", 72) + op.get("width", 100),
                                 op.get("y", 72) + op.get("height", 100))
                page.insert_image(rect, filename=op.get("image_path", ""))

            if progress:
                progress((idx + 1) / total)

        doc.save(output_path)
        doc.close()
        return _result(output_path, doc.page_count if not doc.is_closed else 0, t, warnings)

    @staticmethod
    def compress_pdf(input_path: str, output_path: str, *,
                     quality: str = "balanced", image_dpi: int = 150,
                     progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        original_size = os.path.getsize(input_path)
        doc = fitz.open(input_path)
        total = doc.page_count
        jpg_q = {"maximum": 85, "balanced": 60, "minimum": 30}.get(quality, 60)

        for i, page in enumerate(doc):
            for img_info in page.get_images(full=True):
                xref = img_info[0]
                try:
                    base = doc.extract_image(xref)
                    if not base or len(base["image"]) < 5000:
                        continue
                    pil_img = Image.open(io.BytesIO(base["image"]))
                    if pil_img.mode != "RGB":
                        pil_img = pil_img.convert("RGB")
                    if quality == "minimum":
                        w, h = pil_img.size
                        pil_img = pil_img.resize((max(1, w // 2), max(1, h // 2)), Image.LANCZOS)
                    buf = io.BytesIO()
                    pil_img.save(buf, format="JPEG", quality=jpg_q, optimize=True)
                    page.replace_image(xref, stream=buf.getvalue())
                except Exception:
                    continue
            if progress:
                progress((i + 1) / total)

        doc.save(output_path, garbage=4, deflate=True, clean=True)
        doc.close()
        new_size = os.path.getsize(output_path)
        reduction = ((original_size - new_size) / max(original_size, 1)) * 100
        result = _result(output_path, total, t)
        result["original_size"] = original_size
        result["compressed_size"] = new_size
        result["reduction_percent"] = round(reduction, 1)
        return result

    @staticmethod
    def watermark_pdf(input_path: str, output_path: str, *,
                      text: str | None = None, image_path: str | None = None,
                      opacity: float = 0.3, angle: float = 45.0,
                      position: str = "center", pages: str = "all",
                      font_size: int = 48, color: str = "#888888",
                      progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        reader = PdfReader(input_path)
        writer = PdfWriter()
        total = len(reader.pages)
        indices = _parse_page_range(pages, total)

        for i, page in enumerate(reader.pages):
            if i in indices and text:
                pw, ph = float(page.mediabox.width), float(page.mediabox.height)
                packet = io.BytesIO()
                c = canvas.Canvas(packet, pagesize=(pw, ph))
                c.saveState()
                c.translate(pw / 2, ph / 2)
                c.rotate(angle)
                c.setFont("Helvetica-Bold", font_size)
                hex_color = HexColor(color)
                c.setFillColor(hex_color)
                try:
                    c.setFillAlpha(opacity)
                except AttributeError:
                    pass
                if position == "tile":
                    for tx in range(-int(pw), int(pw), int(font_size * 8)):
                        for ty in range(-int(ph), int(ph), int(font_size * 3)):
                            c.drawCentredString(tx, ty, text)
                else:
                    c.drawCentredString(0, 0, text)
                c.restoreState()
                c.save()
                packet.seek(0)
                page.merge_page(PdfReader(packet).pages[0])
            writer.add_page(page)
            if progress:
                progress((i + 1) / total)

        with open(output_path, "wb") as f:
            writer.write(f)
        return _result(output_path, total, t)

    @staticmethod
    def crop_pdf(input_path: str, output_path: str, *,
                 margins: dict, pages: str = "all",
                 progress: Callable[[float], None] | None = None) -> dict:
        """Crop PDF margins. margins dict: {top, bottom, left, right} in points."""
        t = time.perf_counter()
        doc = fitz.open(input_path)
        total = doc.page_count
        indices = _parse_page_range(pages, total)
        top = margins.get("top", 0)
        bottom = margins.get("bottom", 0)
        left = margins.get("left", 0)
        right = margins.get("right", 0)

        for i in range(total):
            if i in indices:
                page = doc[i]
                rect = page.rect
                new_rect = fitz.Rect(
                    rect.x0 + left, rect.y0 + top,
                    rect.x1 - right, rect.y1 - bottom,
                )
                page.set_cropbox(new_rect)
            if progress:
                progress((i + 1) / total)

        doc.save(output_path)
        doc.close()
        return _result(output_path, total, t)

    @staticmethod
    def sign_pdf(input_path: str, output_path: str, *,
                 signature_image: str | None = None,
                 signature_drawing: bytes | None = None,
                 page: int = -1, x: float = 72, y: float = 72,
                 width: float = 200, height: float = 100,
                 progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        doc = fitz.open(input_path)
        total = doc.page_count
        target_page = page if page >= 0 else total - 1

        if target_page >= total:
            raise ValueError(f"Page {target_page + 1} does not exist (document has {total} pages)")

        p = doc[target_page]
        rect = fitz.Rect(x, y, x + width, y + height)

        if signature_image:
            p.insert_image(rect, filename=signature_image)
        elif signature_drawing:
            p.insert_image(rect, stream=signature_drawing)

        doc.save(output_path)
        doc.close()
        return _result(output_path, total, t)

    @staticmethod
    def redact_pdf(input_path: str, output_path: str, *,
                   redactions: list[dict],
                   fill_color: tuple = (0, 0, 0),
                   progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        doc = fitz.open(input_path)
        total = len(redactions)
        redacted_count = 0

        for idx, r in enumerate(redactions):
            page_num = r.get("page", 0)
            if page_num >= doc.page_count:
                continue
            page = doc[page_num]

            if "rect" in r:
                x0, y0, x1, y1 = r["rect"]
                page.add_redact_annot(fitz.Rect(x0, y0, x1, y1), fill=fill_color)
                redacted_count += 1
            elif "search_text" in r:
                hits = page.search_for(r["search_text"])
                for rect_hit in hits:
                    page.add_redact_annot(rect_hit, fill=fill_color)
                    redacted_count += 1

            page.apply_redactions()
            if progress:
                progress((idx + 1) / total)

        doc.save(output_path)
        doc.close()
        result = _result(output_path, doc.page_count if not doc.is_closed else 0, t)
        result["redactions_applied"] = redacted_count
        return result

    # ══════════════════════════════════════════════════════════════════════
    # SECURITY
    # ══════════════════════════════════════════════════════════════════════

    @staticmethod
    def protect_pdf(input_path: str, output_path: str, *,
                    user_password: str = "", owner_password: str = "",
                    permissions: dict | None = None,
                    encryption: str = "AES-256",
                    progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        reader = PdfReader(input_path)
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)

        from pypdf._encryption import Encryption
        algo = {
            "AES-256": 4,  # AES-256 in pypdf
            "AES-128": 3,
            "RC4-128": 2,
            "RC4-40": 1,
        }.get(encryption, 4)

        writer.encrypt(
            user_password=user_password or "",
            owner_password=owner_password or user_password or "",
            use_128bit=algo >= 2,
        )

        with open(output_path, "wb") as f:
            writer.write(f)
        return _result(output_path, len(reader.pages), t)

    @staticmethod
    def unlock_pdf(input_path: str, output_path: str, *,
                   password: str,
                   progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        reader = PdfReader(input_path)
        if reader.is_encrypted:
            if not reader.decrypt(password):
                raise ValueError("Incorrect password")
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        with open(output_path, "wb") as f:
            writer.write(f)
        return _result(output_path, len(reader.pages), t)

    # ══════════════════════════════════════════════════════════════════════
    # OCR & SCAN
    # ══════════════════════════════════════════════════════════════════════

    @staticmethod
    def ocr_pdf(input_path: str, output_path: str, *,
                engine: str = "auto", lang: str = "eng",
                dpi: int = 300, deskew: bool = True,
                enhance_contrast: bool = False,
                progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        from ocr_backend import OCRBackend, get_install_instructions

        if not OCRBackend.has_any_engine():
            raise RuntimeError(get_install_instructions())

        doc = fitz.open(input_path)
        total = doc.page_count
        new_doc = fitz.open()
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        warnings = []

        for i in range(total):
            page = doc[i]
            pix = page.get_pixmap(matrix=mat)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

            if deskew:
                try:
                    img = img.filter(ImageFilter.MedianFilter(3))
                except Exception:
                    pass
            if enhance_contrast:
                img = ImageEnhance.Contrast(img).enhance(1.5)

            result = OCRBackend.extract_text(img, engine=engine, lang=lang)
            if result.confidence < 0.3:
                warnings.append(f"Page {i+1}: low OCR confidence ({result.confidence:.0%})")

            # Create page with original image
            new_page = new_doc.new_page(width=page.rect.width, height=page.rect.height)
            new_page.insert_image(new_page.rect, pixmap=pix)

            # Overlay invisible text for searchability
            if result.text:
                text_point = fitz.Point(0, 12)
                new_page.insert_text(text_point, result.text, fontsize=1, color=(1, 1, 1), overlay=False)

            if progress:
                progress((i + 1) / total)
            gc.collect()

        new_doc.save(output_path,  garbage=4, deflate=True)
        new_doc.close()
        doc.close()
        return _result(output_path, total, t, warnings)

    @staticmethod
    def scan_to_pdf(input_paths: list[str], output_path: str, *,
                    engine: str = "auto", lang: str = "eng",
                    dpi: int = 300, deskew: bool = True,
                    enhance_contrast: bool = True, auto_crop: bool = True,
                    progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        from ocr_backend import OCRBackend, get_install_instructions

        if not OCRBackend.has_any_engine():
            raise RuntimeError(get_install_instructions())

        doc = fitz.open()
        total = len(input_paths)
        warnings = []

        for i, img_path in enumerate(input_paths):
            img = Image.open(img_path)
            if img.mode != "RGB":
                img = img.convert("RGB")

            if auto_crop:
                try:
                    gray = img.convert("L")
                    bbox = gray.getbbox()
                    if bbox:
                        img = img.crop(bbox)
                except Exception:
                    pass

            if enhance_contrast:
                img = ImageEnhance.Contrast(img).enhance(1.5)
                img = ImageEnhance.Sharpness(img).enhance(1.3)

            result = OCRBackend.extract_text(img, engine=engine, lang=lang)

            buf = io.BytesIO()
            img.save(buf, format="PNG")
            buf.seek(0)

            iw, ih = img.size
            page = doc.new_page(width=iw * 72 / dpi, height=ih * 72 / dpi)
            page.insert_image(page.rect, stream=buf.getvalue())

            if result.text:
                page.insert_text(fitz.Point(0, 12), result.text, fontsize=1, color=(1, 1, 1), overlay=False)

            if result.confidence < 0.3:
                warnings.append(f"Image {i+1}: low OCR confidence ({result.confidence:.0%})")

            if progress:
                progress((i + 1) / total)
            gc.collect()

        doc.save(output_path, garbage=4, deflate=True)
        doc.close()
        return _result(output_path, total, t, warnings)

    # ══════════════════════════════════════════════════════════════════════
    # ADVANCED
    # ══════════════════════════════════════════════════════════════════════

    @staticmethod
    def compare_pdf(input_path_a: str, input_path_b: str, output_path: str, *,
                    mode: str = "text",
                    progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        doc_a = fitz.open(input_path_a)
        doc_b = fitz.open(input_path_b)
        max_pages = max(doc_a.page_count, doc_b.page_count)

        diff_lines = []
        for i in range(max_pages):
            text_a = doc_a[i].get_text() if i < doc_a.page_count else ""
            text_b = doc_b[i].get_text() if i < doc_b.page_count else ""
            diff = difflib.unified_diff(
                text_a.splitlines(), text_b.splitlines(),
                fromfile=f"Document A - Page {i+1}",
                tofile=f"Document B - Page {i+1}",
                lineterm="",
            )
            page_diff = list(diff)
            if page_diff:
                diff_lines.extend(page_diff)
                diff_lines.append("")
            if progress:
                progress((i + 1) / max_pages)

        doc_a.close()
        doc_b.close()

        diff_text = "\n".join(diff_lines) if diff_lines else "No differences found."
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(diff_text)

        result = _result(output_path, max_pages, t)
        result["has_differences"] = bool(diff_lines)
        return result

    @staticmethod
    def repair_pdf(input_path: str, output_path: str, *,
                   progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        warnings = []
        try:
            doc = fitz.open(input_path)
        except Exception as e:
            warnings.append(f"Document has errors: {e}")
            doc = fitz.open()
            try:
                doc = fitz.open(input_path)
            except Exception:
                raise RuntimeError(f"File is too damaged to repair: {e}")

        original_pages = doc.page_count
        doc.save(output_path, garbage=4, deflate=True, clean=True)
        repaired_size = os.path.getsize(output_path)
        doc.close()

        warnings.append(f"Repaired: {original_pages} pages, cleaned and recompressed")
        result = _result(output_path, original_pages, t, warnings)
        result["original_size"] = os.path.getsize(input_path)
        result["repaired_size"] = repaired_size
        return result

    @staticmethod
    def translate_pdf(input_path: str, output_path: str, *,
                      source_lang: str = "auto", target_lang: str = "en",
                      preserve_layout: bool = True,
                      progress: Callable[[float], None] | None = None) -> dict:
        t = time.perf_counter()
        from deep_translator import GoogleTranslator

        doc = fitz.open(input_path)
        total = doc.page_count
        warnings = []
        translator = GoogleTranslator(source=source_lang, target=target_lang)

        for i in range(total):
            page = doc[i]
            blocks = page.get_text("dict")["blocks"]

            for block in blocks:
                if block.get("type") != 0:  # text blocks only
                    continue
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        original = span.get("text", "").strip()
                        if not original or len(original) < 2:
                            continue
                        try:
                            translated = translator.translate(original)
                            if translated and translated != original:
                                rect = fitz.Rect(span["bbox"])
                                page.add_redact_annot(rect, fill=(1, 1, 1))
                                page.apply_redactions()
                                font_size = span.get("size", 11)
                                # Shrink font if translated text is longer
                                ratio = len(original) / max(len(translated), 1)
                                adj_size = max(font_size * min(ratio, 1.0), 6)
                                page.insert_text(
                                    fitz.Point(rect.x0, rect.y1 - 2),
                                    translated,
                                    fontsize=adj_size,
                                    color=(0, 0, 0),
                                )
                        except Exception as e:
                            if "connection" in str(e).lower() or "network" in str(e).lower():
                                raise RuntimeError("Translation requires an internet connection.")
                            warnings.append(f"Page {i+1}: failed to translate '{original[:30]}...'")

            if progress:
                progress((i + 1) / total)

        doc.save(output_path)
        doc.close()
        return _result(output_path, total, t, warnings)

    # ══════════════════════════════════════════════════════════════════════
    # METADATA / INFO (kept from v1)
    # ══════════════════════════════════════════════════════════════════════

    @staticmethod
    def get_info(input_path: str) -> dict:
        reader = PdfReader(input_path)
        meta = reader.metadata
        return {
            "pages": len(reader.pages),
            "encrypted": reader.is_encrypted,
            "size": os.path.getsize(input_path),
            "title": getattr(meta, "title", None) if meta else None,
            "author": getattr(meta, "author", None) if meta else None,
        }

    @staticmethod
    def extract_text(input_path: str, output_path: str) -> str:
        doc = fitz.open(input_path)
        text = "\n\n".join(page.get_text() for page in doc)
        doc.close()
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(text)
        return output_path
