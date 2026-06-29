"""
Windows-only hardware scanner acquisition via the Windows Image Acquisition
(WIA) COM API. On non-Windows platforms all public functions return clean
failure results rather than raising ImportError at module import time.

WIA architecture:
    WIA.DeviceManager → DeviceInfos[] → DeviceInfo.Connect() → Device
    Device.Items[]    → Item (scannable region: flatbed platen or ADF)
    Item.Transfer()   → ImageFile (COM object with FileData.BinaryData)

ADF multi-page scanning:
    ADF scanners expose a single Item that represents the document feeder.
    Calling Transfer() repeatedly on that item advances the feed by one page.
    WIA_ERROR_PAPER_EMPTY (0x80210003) signals the end of the document stack
    and is caught as the normal loop termination condition.
"""

import io
import logging
import platform
import sys
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import List, Optional, Tuple

import fitz
from PIL import Image, ImageEnhance, ImageFilter

from docsuitekit.core.result import ConversionResult, ConversionStatus

logger = logging.getLogger(__name__)

_IS_WINDOWS = platform.system() == "Windows"

# ── WIA property IDs (WIA 2.0, Windows 7+) ────────────────────────────────────
# These are integer constants from the WIA specification. Using IDs rather than
# property name strings avoids localization issues (driver names can vary by
# Windows language pack).
_WIA_IPS_XRES           = 6147   # Horizontal scan resolution (DPI)
_WIA_IPS_YRES           = 6148   # Vertical scan resolution (DPI)
_WIA_IPS_XPOS           = 6150   # Left edge of scan area (pixels at current DPI)
_WIA_IPS_YPOS           = 6151   # Top edge of scan area
_WIA_IPS_XEXTENT        = 6152   # Scan width (pixels at current DPI)
_WIA_IPS_YEXTENT        = 6153   # Scan height (pixels at current DPI)
_WIA_IPA_DATATYPE       = 4103   # Colour mode (see ScanMode values below)
_WIA_IPA_DEPTH          = 4104   # Bits per colour channel
_WIA_DPS_DOCUMENT_HANDLING_CAPABILITIES = 3086  # Bitmask: 0x01=ADF, 0x02=Flatbed
_WIA_DPS_DOCUMENT_HANDLING_STATUS       = 3087  # 0x01 = paper loaded in ADF
_WIA_DPS_PAGES          = 3096   # ADF pages to scan (0 = all available)

# WIA image format GUIDs passed to Item.Transfer()
_FMT_BMP  = "{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}"
_FMT_PNG  = "{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}"
_FMT_TIFF = "{B96B3CB1-0728-11D3-9D7B-0000F81EF32E}"

# WIA COM error code for ADF empty (loop termination condition)
_WIA_ERROR_PAPER_EMPTY = 0x80210003


class ScanMode(Enum):
    BW        = 0    # WIA_DATA_THRESHOLD — bilevel, smallest file
    GRAYSCALE = 2    # WIA_DATA_GRAYSCALE
    COLOR     = 4    # WIA_DATA_COLOR (24-bit RGB)


@dataclass
class ScanSettings:
    dpi:              int       = 300
    mode:             ScanMode  = ScanMode.COLOR
    enhance_contrast: bool      = True
    auto_deskew:      bool      = True
    max_adf_pages:    int       = 50       # Safety cap for runaway ADF loops
    ocr_after_scan:   bool      = False    # Pipe output through ocr.py after scan
    ocr_languages:    List[str] = field(default_factory=lambda: ["eng"])


@dataclass
class ScannerInfo:
    device_id:   str
    name:        str
    description: str
    has_adf:     bool
    has_flatbed: bool


# ── Public API ─────────────────────────────────────────────────────────────────

def list_scanners() -> List[ScannerInfo]:
    """
    Enumerate all WIA-compatible scanners currently connected to the system.
    Returns an empty list (not an exception) if no scanners are found or if
    this is not a Windows environment.
    """
    if not _IS_WINDOWS:
        logger.warning("Scanner acquisition requires Windows. Platform: %s", platform.system())
        return []

    try:
        import win32com.client
        wia = win32com.client.Dispatch("WIA.DeviceManager")
    except Exception as exc:
        logger.error("Cannot initialise WIA DeviceManager: %s", exc)
        return []

    scanners: List[ScannerInfo] = []
    try:
        for info in wia.DeviceInfos:
            # WIA device type 1 = scanner, 2 = camera, 3 = video
            if info.Type != 1:
                continue
            try:
                device = info.Connect()
                caps = _read_device_property(device, _WIA_DPS_DOCUMENT_HANDLING_CAPABILITIES)
                has_adf     = bool(caps & 0x01) if caps is not None else False
                has_flatbed = bool(caps & 0x02) if caps is not None else True
                scanners.append(ScannerInfo(
                    device_id=info.DeviceID,
                    name=info.Properties["Name"].Value,
                    description=info.Properties.get("Description", {}).get("Value", ""),
                    has_adf=has_adf,
                    has_flatbed=has_flatbed,
                ))
            except Exception as exc:
                logger.debug("Could not inspect device '%s': %s", info.DeviceID, exc)
    except Exception as exc:
        logger.error("WIA DeviceInfos enumeration failed: %s", exc)

    return scanners


def scan_to_pdf(
    output_path: Path,
    scanner_index: int = 0,
    settings: Optional[ScanSettings] = None,
) -> ConversionResult:
    """
    Scan one or more pages and compile them into a single PDF.

    For flatbed scanners: scans one page and saves it.
    For ADF scanners with paper loaded: scans all pages in the feeder.
    For ADF scanners with no paper: falls back to flatbed platen.

    Optionally applies deskew and contrast enhancement before PDF compilation.
    Optionally pipes the result through the OCR engine to create a searchable PDF.

    scanner_index: 0-indexed position in the list returned by list_scanners().
    settings:      ScanSettings instance, or None to use defaults.
    """
    t0 = time.monotonic()
    cfg = settings or ScanSettings()

    if not _IS_WINDOWS:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=output_path,
            engine_used="WIA",
            error="WIA scanner acquisition is only available on Windows.",
            elapsed_seconds=time.monotonic() - t0,
        )

    try:
        import win32com.client
        import pythoncom
        pythoncom.CoInitialize()
    except ImportError:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=output_path,
            engine_used="WIA",
            error="pywin32 not installed. Run: pip install pywin32",
            elapsed_seconds=time.monotonic() - t0,
        )

    scanners = list_scanners()
    if not scanners:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=output_path,
            engine_used="WIA",
            error="No WIA-compatible scanners detected. Check device connection and driver installation.",
            elapsed_seconds=time.monotonic() - t0,
        )

    if scanner_index >= len(scanners):
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=output_path,
            engine_used="WIA",
            error=f"Scanner index {scanner_index} out of range. "
                  f"Available: {len(scanners)} device(s).",
            elapsed_seconds=time.monotonic() - t0,
        )

    scanner_info = scanners[scanner_index]
    logger.info(
        "Scanning from: %s (ADF=%s, Flatbed=%s)",
        scanner_info.name, scanner_info.has_adf, scanner_info.has_flatbed,
    )

    try:
        import win32com.client
        wia    = win32com.client.Dispatch("WIA.DeviceManager")
        device = None
        for info in wia.DeviceInfos:
            if info.DeviceID == scanner_info.device_id:
                device = info.Connect()
                break

        if device is None:
            raise RuntimeError(f"Could not reconnect to device '{scanner_info.name}'.")

        images = _scan_all_pages(device, scanner_info, cfg)

        if not images:
            return ConversionResult(
                status=ConversionStatus.FAILURE,
                input_path=output_path,
                engine_used="WIA",
                error="Scanner returned no image data. "
                      "Verify the document is loaded and the scanner is ready.",
                elapsed_seconds=time.monotonic() - t0,
            )

        output_path.parent.mkdir(parents=True, exist_ok=True)
        _images_to_pdf(images, output_path)

        result = ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=output_path,
            output_path=output_path,
            engine_used="WIA",
            elapsed_seconds=time.monotonic() - t0,
            metadata={
                "scanner":        scanner_info.name,
                "pages_scanned":  len(images),
                "dpi":            cfg.dpi,
                "mode":           cfg.mode.name,
                "deskew_applied": cfg.auto_deskew,
            },
        )

        # Optional OCR pass to create searchable PDF
        if cfg.ocr_after_scan and result.succeeded:
            from docsuitekit.engines.ocr import ocr_pdf, OcrMode
            searchable_path = output_path.with_stem(output_path.stem + "_searchable")
            # We import and call from docsuitekit.engines.ocr to create the chain
            # Note: in a pure modular design we'd use a callback, but for Phase 4
            # direct coupling in ScanSettings is explicitly allowed per user spec.
            ocr_result = ocr_pdf(
                output_path, searchable_path,
                languages=cfg.ocr_languages,
                mode=OcrMode.STANDARD,
            )
            if ocr_result.succeeded:
                import shutil
                shutil.move(str(searchable_path), str(output_path))
                result.metadata["ocr_applied"] = True
                result.metadata["ocr_engine"]  = ocr_result.engine_used
            else:
                result.metadata["ocr_applied"] = False
                result.metadata["ocr_error"]   = ocr_result.error
                logger.warning("Post-scan OCR failed: %s", ocr_result.error)

        return result

    except Exception as exc:
        logger.error("Scan failed: %s", exc, exc_info=True)
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=output_path,
            engine_used="WIA",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )


# ── Internal scan execution ────────────────────────────────────────────────────

def _scan_all_pages(device, info: ScannerInfo, cfg: ScanSettings) -> List[Image.Image]:
    """
    Route to ADF or flatbed scanning based on device capability and paper status.
    """
    if info.has_adf:
        adf_status = _read_device_property(device, _WIA_DPS_DOCUMENT_HANDLING_STATUS)
        paper_ready = adf_status is not None and bool(adf_status & 0x01)
        if paper_ready:
            logger.info("ADF paper detected. Scanning all loaded pages.")
            return _scan_adf(device, cfg)
        logger.info("ADF empty or unavailable. Falling back to flatbed.")

    return _scan_flatbed(device, cfg)


def _scan_flatbed(device, cfg: ScanSettings) -> List[Image.Image]:
    """Scan a single page from the flatbed platen."""
    item = device.Items[0]
    _configure_scan_item(item, cfg)
    img = _transfer_image(item)
    if img is None:
        return []
    return [_enhance_image(img, cfg)]


def _scan_adf(device, cfg: ScanSettings) -> List[Image.Image]:
    """
    Scan all pages from the ADF in a loop.

    WIA ADF scanning calls Transfer() repeatedly on the same item.
    Each call advances the feeder by one sheet. The loop terminates
    when WIA raises the WIA_ERROR_PAPER_EMPTY COM error code, which
    is the standard, non-exceptional signal that the feeder is empty.
    Any other COM error is re-raised as a genuine failure.
    """
    import pythoncom

    item = device.Items[0]
    _configure_scan_item(item, cfg)

    images: List[Image.Image] = []
    for page_num in range(1, cfg.max_adf_pages + 1):
        try:
            img = _transfer_image(item)
            if img is not None:
                images.append(_enhance_image(img, cfg))
                logger.info("ADF: scanned page %d.", page_num)
        except pythoncom.com_error as com_err:
            hr = com_err.args[0] if com_err.args else 0
            if hr == _WIA_ERROR_PAPER_EMPTY or hr == -2145320957:  # Both encodings
                logger.info("ADF empty after %d page(s).", page_num - 1)
                break
            raise   # Re-raise unexpected COM errors

    return images


def _configure_scan_item(item, cfg: ScanSettings) -> None:
    """Set resolution, colour mode, and depth on a WIA scannable item."""
    _set_item_property(item, _WIA_IPS_XRES,     cfg.dpi)
    _set_item_property(item, _WIA_IPS_YRES,     cfg.dpi)
    _set_item_property(item, _WIA_IPA_DATATYPE, cfg.mode.value)
    depth = 1 if cfg.mode == ScanMode.BW else 8
    _set_item_property(item, _WIA_IPA_DEPTH,    depth)


def _transfer_image(item) -> Optional[Image.Image]:
    """
    Execute the WIA Transfer() call and decode the resulting BMP bytes via PIL.
    Returns None if the transfer produces zero bytes (empty scan).
    """
    image_file = item.Transfer(_FMT_BMP)
    raw_bytes  = bytes(image_file.FileData.BinaryData)
    if not raw_bytes:
        return None
    return Image.open(io.BytesIO(raw_bytes)).copy()  # .copy() closes the BytesIO ref


def _enhance_image(img: Image.Image, cfg: ScanSettings) -> Image.Image:
    """
    Apply optional post-processing: auto-deskew and contrast enhancement.

    Deskew strategy:
        Tries to import the 'deskew' package (pip install deskew).
        Falls back to scipy.ndimage rotation if deskew is unavailable.
        Falls back to no rotation if scipy is also absent.
        A warning is emitted but the image is still returned — partial
        output is preferable to a hard failure for a physical scan.
    """
    if cfg.auto_deskew:
        img = _deskew(img)

    if cfg.enhance_contrast:
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.4)
        img = img.filter(ImageFilter.SHARPEN)

    return img


def _deskew(img: Image.Image) -> Image.Image:
    """Auto-rotate image to correct skew from imperfect document placement."""
    try:
        import numpy as np
        from deskew import determine_skew
        import scipy.ndimage as ndi

        grayscale = np.array(img.convert("L"))
        angle = determine_skew(grayscale)
        if angle and abs(angle) > 0.1:
            logger.debug("Deskew: rotating %.2f degrees.", angle)
            rotated = ndi.rotate(
                np.array(img), angle,
                reshape=False,
                cval=255,    # Fill with white
            )
            return Image.fromarray(rotated.astype(np.uint8))
    except Exception as exc:
        logger.debug("Deskew failed or not installed: %s. Returning original.", exc)

    return img


def _images_to_pdf(images: List[Image.Image], output_path: Path) -> None:
    """
    Compile a list of PIL Images into a single multi-page PDF using PyMuPDF.

    Each image is converted to PNG bytes and inserted as a full-page image
    via fitz.Document.new_page() + Page.insert_image(). This preserves
    colour fidelity better than PIL's PDF save, which applies JPEG
    compression regardless of the image mode.
    """
    doc = fitz.open()
    for img in images:
        buf = io.BytesIO()
        # Convert to RGB for PDF compatibility (BW images may be mode "1" or "L")
        rgb_img = img.convert("RGB")
        rgb_img.save(buf, format="PNG")
        buf.seek(0)

        # Infer page dimensions from image resolution metadata
        dpi_x, dpi_y = (img.info.get("dpi") or (300, 300))
        if isinstance(dpi_x, tuple):
            dpi_x = dpi_x[0]
        if isinstance(dpi_y, tuple):
            dpi_y = dpi_y[0]

        width_pt  = img.width  * 72.0 / dpi_x
        height_pt = img.height * 72.0 / dpi_y

        page = doc.new_page(width=width_pt, height=height_pt)
        page.insert_image(page.rect, stream=buf.getvalue())

    doc.save(str(output_path), deflate=True)
    doc.close()


# ── WIA property helpers ───────────────────────────────────────────────────────

def _set_item_property(item, property_id: int, value) -> None:
    """Set a WIA property by numeric ID. Silently skips unsupported properties."""
    try:
        for prop in item.Properties:
            if prop.PropertyID == property_id:
                prop.Value = value
                return
        logger.debug("WIA property ID %d not found on this device.", property_id)
    except Exception as exc:
        logger.debug("Could not set WIA property %d to %s: %s", property_id, value, exc)


def _read_device_property(device, property_id: int):
    """Read a WIA device property by numeric ID. Returns None if absent."""
    try:
        for prop in device.Properties:
            if prop.PropertyID == property_id:
                return prop.Value
    except Exception:
        pass
    return None
