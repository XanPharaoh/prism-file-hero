"""Tool metadata, categories, and UI constants for Prism Document Suite."""

from collections import OrderedDict

APP_NAME = "Prism Document Suite"
APP_VERSION = "1.0.0"
CONFIG_DIR_NAME = ".prism_suite"

# ── Tool Definitions ─────────────────────────────────────────────────
TOOLS = OrderedDict([
    # ── ORGANIZE ──
    ("merge_pdf", {
        "name": "Merge PDF",
        "category": "organize",
        "description": "Combine multiple PDFs into one file",
        "accepts": [".pdf"],
        "multi_file": True,
        "keywords": ["combine", "join", "merge", "concatenate"],
    }),
    ("split_pdf", {
        "name": "Split PDF",
        "category": "organize",
        "description": "Split a PDF into individual pages or ranges",
        "accepts": [".pdf"],
        "keywords": ["separate", "extract", "divide", "split"],
    }),
    ("rotate_pdf", {
        "name": "Rotate PDF",
        "category": "organize",
        "description": "Rotate pages by 90°, 180°, or 270°",
        "accepts": [".pdf"],
        "keywords": ["rotate", "turn", "flip", "orientation"],
    }),
    ("organise_pdf", {
        "name": "Organise PDF",
        "category": "organize",
        "description": "Reorder, delete, or rearrange pages",
        "accepts": [".pdf"],
        "keywords": ["reorder", "arrange", "move", "delete", "pages"],
    }),
    ("page_numbers", {
        "name": "Page Numbers",
        "category": "organize",
        "description": "Add page numbers to your PDF",
        "accepts": [".pdf"],
        "keywords": ["number", "paginate", "footer", "header"],
    }),

    # ── CONVERT ──
    ("pdf_to_word", {
        "name": "PDF → Word",
        "category": "convert",
        "description": "Convert PDF to editable DOCX",
        "accepts": [".pdf"],
        "keywords": ["docx", "word", "document", "convert"],
    }),
    ("word_to_pdf", {
        "name": "Word → PDF",
        "category": "convert",
        "description": "Convert DOCX to PDF",
        "accepts": [".docx", ".doc"],
        "keywords": ["docx", "word", "convert", "document"],
    }),
    ("pdf_to_pptx", {
        "name": "PDF → PowerPoint",
        "category": "convert",
        "description": "Convert PDF pages to PowerPoint slides",
        "accepts": [".pdf"],
        "keywords": ["pptx", "powerpoint", "slides", "presentation"],
    }),
    ("pptx_to_pdf", {
        "name": "PowerPoint → PDF",
        "category": "convert",
        "description": "Convert PowerPoint to PDF",
        "accepts": [".pptx", ".ppt"],
        "keywords": ["pptx", "powerpoint", "slides", "convert"],
    }),
    ("pdf_to_excel", {
        "name": "PDF → Excel",
        "category": "convert",
        "description": "Extract tables from PDF to Excel spreadsheet",
        "accepts": [".pdf"],
        "keywords": ["xlsx", "excel", "table", "spreadsheet", "extract"],
    }),
    ("excel_to_pdf", {
        "name": "Excel → PDF",
        "category": "convert",
        "description": "Convert Excel spreadsheet to PDF",
        "accepts": [".xlsx", ".xls"],
        "keywords": ["xlsx", "excel", "spreadsheet", "convert"],
    }),
    ("pdf_to_jpg", {
        "name": "PDF → JPG",
        "category": "convert",
        "description": "Convert PDF pages to images",
        "accepts": [".pdf"],
        "keywords": ["image", "jpg", "jpeg", "png", "picture"],
    }),
    ("jpg_to_pdf", {
        "name": "JPG → PDF",
        "category": "convert",
        "description": "Convert images to a PDF document",
        "accepts": [".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".gif", ".webp"],
        "multi_file": True,
        "keywords": ["image", "photo", "picture", "convert"],
    }),
    ("html_to_pdf", {
        "name": "HTML → PDF",
        "category": "convert",
        "description": "Convert HTML file to PDF",
        "accepts": [".html", ".htm"],
        "keywords": ["html", "web", "webpage", "convert"],
    }),
    ("pdf_to_pdfa", {
        "name": "PDF → PDF/A",
        "category": "convert",
        "description": "Convert to archival PDF/A format",
        "accepts": [".pdf"],
        "keywords": ["archive", "pdfa", "standard", "compliance"],
    }),

    # ── EDIT ──
    ("edit_pdf", {
        "name": "Edit PDF",
        "category": "edit",
        "description": "Add text, images, or annotations to PDF",
        "accepts": [".pdf"],
        "keywords": ["edit", "annotate", "text", "modify", "add"],
    }),
    ("compress_pdf", {
        "name": "Compress PDF",
        "category": "edit",
        "description": "Reduce PDF file size",
        "accepts": [".pdf"],
        "keywords": ["compress", "reduce", "shrink", "optimize", "size"],
    }),
    ("watermark_pdf", {
        "name": "Watermark",
        "category": "edit",
        "description": "Add text or image watermark to PDF",
        "accepts": [".pdf"],
        "keywords": ["watermark", "stamp", "overlay", "brand"],
    }),
    ("crop_pdf", {
        "name": "Crop PDF",
        "category": "edit",
        "description": "Crop page margins",
        "accepts": [".pdf"],
        "keywords": ["crop", "trim", "margin", "cut"],
    }),
    ("sign_pdf", {
        "name": "Sign PDF",
        "category": "edit",
        "description": "Add signature image to PDF",
        "accepts": [".pdf"],
        "keywords": ["sign", "signature", "autograph"],
    }),
    ("redact_pdf", {
        "name": "Redact PDF",
        "category": "edit",
        "description": "Permanently remove sensitive content",
        "accepts": [".pdf"],
        "keywords": ["redact", "censor", "black out", "remove", "sensitive"],
    }),

    # ── SECURITY ──
    ("protect_pdf", {
        "name": "Protect PDF",
        "category": "security",
        "description": "Encrypt PDF with password",
        "accepts": [".pdf"],
        "keywords": ["protect", "encrypt", "password", "lock", "secure"],
    }),
    ("unlock_pdf", {
        "name": "Unlock PDF",
        "category": "security",
        "description": "Remove password protection",
        "accepts": [".pdf"],
        "keywords": ["unlock", "decrypt", "password", "remove"],
    }),

    # ── OCR & SCAN ──
    ("ocr_pdf", {
        "name": "OCR PDF",
        "category": "ocr",
        "description": "Make scanned PDFs searchable with OCR",
        "accepts": [".pdf"],
        "keywords": ["ocr", "recognize", "text", "scan", "searchable"],
    }),
    ("scan_to_pdf", {
        "name": "Scan to PDF",
        "category": "ocr",
        "description": "Convert scanned images to searchable PDF",
        "accepts": [".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".gif"],
        "multi_file": True,
        "keywords": ["scan", "photo", "ocr", "document", "camera"],
    }),

    # ── ADVANCED ──
    ("compare_pdf", {
        "name": "Compare PDF",
        "category": "advanced",
        "description": "Compare two PDFs and highlight differences",
        "accepts": [".pdf"],
        "multi_file": True,
        "keywords": ["compare", "diff", "difference", "change"],
    }),
    ("repair_pdf", {
        "name": "Repair PDF",
        "category": "advanced",
        "description": "Attempt to fix corrupted PDF files",
        "accepts": [".pdf"],
        "keywords": ["repair", "fix", "recover", "corrupt", "broken"],
    }),
    ("translate_pdf", {
        "name": "Translate PDF",
        "category": "advanced",
        "description": "Translate PDF text to another language",
        "accepts": [".pdf"],
        "keywords": ["translate", "language", "convert", "multilingual"],
    }),
])

# ── Categories ───────────────────────────────────────────────────────
CATEGORIES = OrderedDict([
    ("organize", {
        "label": "Organize",
        "emoji": "📁",
        "tools": ["merge_pdf", "split_pdf", "rotate_pdf", "organise_pdf", "page_numbers"],
    }),
    ("convert", {
        "label": "Convert",
        "emoji": "🔄",
        "tools": [
            "pdf_to_word", "word_to_pdf", "pdf_to_pptx", "pptx_to_pdf",
            "pdf_to_excel", "excel_to_pdf", "pdf_to_jpg", "jpg_to_pdf",
            "html_to_pdf", "pdf_to_pdfa",
        ],
    }),
    ("edit", {
        "label": "Edit",
        "emoji": "✏️",
        "tools": ["edit_pdf", "compress_pdf", "watermark_pdf", "crop_pdf", "sign_pdf", "redact_pdf"],
    }),
    ("security", {
        "label": "Security",
        "emoji": "🔒",
        "tools": ["protect_pdf", "unlock_pdf"],
    }),
    ("ocr", {
        "label": "OCR & Scan",
        "emoji": "🔍",
        "tools": ["ocr_pdf", "scan_to_pdf"],
    }),
    ("advanced", {
        "label": "Advanced",
        "emoji": "⚙️",
        "tools": ["compare_pdf", "repair_pdf", "translate_pdf"],
    }),
])

# ── Appearance ───────────────────────────────────────────────────────
THEMES = {
    "light": {"accent": "#2563EB", "bg": "#F8FAFC", "surface": "#FFFFFF", "text": "#1E293B"},
    "dark": {"accent": "#38BDF8", "bg": "#0F172A", "surface": "#1E293B", "text": "#F1F5F9"},
    "high_contrast": {"accent": "#FACC15", "bg": "#000000", "surface": "#1A1A1A", "text": "#FFFFFF"},
}

DEFAULT_WINDOW = {"width": 1200, "height": 800, "x": 100, "y": 100}

# ── Translate languages ──────────────────────────────────────────────
TRANSLATE_LANGUAGES = {
    "auto": "Auto-detect",
    "en": "English", "es": "Spanish", "fr": "French", "de": "German",
    "it": "Italian", "pt": "Portuguese", "ru": "Russian", "zh-CN": "Chinese (Simplified)",
    "zh-TW": "Chinese (Traditional)", "ja": "Japanese", "ko": "Korean",
    "ar": "Arabic", "hi": "Hindi", "tr": "Turkish", "nl": "Dutch",
    "pl": "Polish", "sv": "Swedish", "da": "Danish", "no": "Norwegian",
    "fi": "Finnish", "el": "Greek", "cs": "Czech", "ro": "Romanian",
    "hu": "Hungarian", "uk": "Ukrainian", "th": "Thai", "vi": "Vietnamese",
    "id": "Indonesian", "ms": "Malay", "af": "Afrikaans", "zu": "Zulu",
}
