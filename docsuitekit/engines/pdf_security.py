import logging
import time
from pathlib import Path
from typing import Optional

import fitz

from docsuitekit.core.result import ConversionResult, ConversionStatus

logger = logging.getLogger(__name__)


def encrypt_pdf(
    input_path: Path,
    output_path: Path,
    user_password: str,
    owner_password: Optional[str] = None,
    allow_printing: bool = True,
    allow_copying: bool = False,
) -> ConversionResult:
    """
    Encrypt with AES-256 exclusively. RC4 is not offered — it is cryptographically
    broken and disabled by default in PDF 2.0 (ISO 32000-2).
    """
    t0 = time.monotonic()
    try:
        doc = fitz.open(str(input_path))

        perms = fitz.PDF_PERM_ACCESSIBILITY   # Always grant screen-reader access
        if allow_printing:
            perms |= fitz.PDF_PERM_PRINT | fitz.PDF_PERM_PRINT_HQ
        if allow_copying:
            perms |= fitz.PDF_PERM_COPY

        doc.save(
            str(output_path),
            encryption=fitz.PDF_ENCRYPT_AES_256,
            user_pw=user_password,
            owner_pw=owner_password or user_password,
            permissions=perms,
            garbage=4,
            deflate=True,
        )
        doc.close()
        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="PyMuPDF/AES-256",
            elapsed_seconds=time.monotonic() - t0,
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="PyMuPDF",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )


def decrypt_pdf(
    input_path: Path, output_path: Path, password: str
) -> ConversionResult:
    t0 = time.monotonic()
    try:
        doc = fitz.open(str(input_path))
        if doc.is_encrypted and not doc.authenticate(password):
            doc.close()
            return ConversionResult(
                status=ConversionStatus.FAILURE,
                input_path=input_path,
                engine_used="PyMuPDF",
                error="Authentication failed: incorrect password.",
                elapsed_seconds=time.monotonic() - t0,
            )
        doc.save(str(output_path), encryption=fitz.PDF_ENCRYPT_NONE, garbage=4)
        doc.close()
        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="PyMuPDF",
            elapsed_seconds=time.monotonic() - t0,
        )
    except Exception as exc:
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="PyMuPDF",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )


def sign_pdf(
    input_path: Path,
    output_path: Path,
    pfx_path: Path,
    pfx_password: str,
    signature_meta: Optional[dict] = None,
    page_index: int = 0,
    visible_rect: Optional[tuple] = None,
) -> ConversionResult:
    """
    Apply a cryptographic digital signature using pyHanko (ECDSA or RSA).
    visible_rect: (x0, y0, x1, y1) in PDF points. None = invisible signature.
    signature_meta keys: name, location, reason, contact_info.
    """
    t0 = time.monotonic()
    meta = signature_meta or {}
    try:
        from pyhanko.sign import signers, fields
        from pyhanko.sign.fields import SigFieldSpec
        from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
        from pyhanko.sign.signers.pdf_signer import PdfSignatureMetadata

        signer = signers.SimpleSigner.load_pkcs12(
            pfx_file=str(pfx_path),
            passphrase=pfx_password.encode() if pfx_password else None,
        )

        with open(str(input_path), "rb") as in_f:
            writer = IncrementalPdfFileWriter(in_f)

            if visible_rect:
                fields.append_signature_field(
                    writer,
                    SigFieldSpec(
                        sig_field_name="Sig1",
                        on_page=page_index,
                        box=visible_rect,
                    ),
                )

            sig_meta = PdfSignatureMetadata(
                field_name="Sig1",
                name=meta.get("name", ""),
                location=meta.get("location", ""),
                reason=meta.get("reason", ""),
                contact_info=meta.get("contact_info", ""),
            )

            with open(str(output_path), "wb") as out_f:
                signers.PdfSigner(sig_meta, signer=signer).sign_pdf(
                    writer, output=out_f
                )

        return ConversionResult(
            status=ConversionStatus.SUCCESS,
            input_path=input_path,
            output_path=output_path,
            engine_used="pyHanko",
            elapsed_seconds=time.monotonic() - t0,
        )
    except Exception as exc:
        logger.error("PDF signing failed: %s", exc, exc_info=True)
        return ConversionResult(
            status=ConversionStatus.FAILURE,
            input_path=input_path,
            engine_used="pyHanko",
            error=str(exc),
            elapsed_seconds=time.monotonic() - t0,
        )
