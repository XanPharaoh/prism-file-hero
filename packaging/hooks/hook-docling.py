"""
PyInstaller collection hook for Docling.
"""

from PyInstaller.utils.hooks import collect_all, collect_data_files

datas, binaries, hiddenimports = collect_all("docling")
datas += collect_data_files("docling", includes=["**/*.yaml", "**/*.json"])

hiddenimports += [
    "docling.document_converter",
    "docling.datamodel.base_models",
    "docling.datamodel.pipeline_options",
    "docling.datamodel.document",
    "docling.pipeline.standard_pdf_pipeline",
    "docling.backend.pypdfium2_backend",
    "docling.models.layout_model",
    "docling.models.table_structure_model",
    "huggingface_hub",
    "huggingface_hub.file_download",
    "onnxruntime",
    "onnxruntime.backend",
]
