import { PDFDocument } from 'pdf-lib';

/**
 * pdf-lib can read the STRUCTURE of an encrypted document but cannot decrypt its page content.
 * Loading with `ignoreEncryption: true` and then copying pages or re-saving therefore produces a
 * file that opens correctly, keeps its page count, and contains nothing. Measured on this product's
 * own bank-statement corpus: Standard Bank in 14,476 characters, protected output out 8, 8 pages
 * either way. Permission-encrypted statements are the normal case for South African banks, not an
 * edge case, so this is a loud refusal rather than a shipped-looking file.
 */
export class EncryptedDocumentError extends Error {
  constructor(operation = 'This tool') {
    super(
      `${operation} cannot rebuild a password-protected PDF: its pages can be displayed, OCR'd and ` +
      'redacted, but their content cannot be copied or re-saved without the password. If you have ' +
      'the password, run Unlock PDF with it first.'
    );
    this.name = 'EncryptedDocumentError';
  }
}

/**
 * pdf-lib raises a plain `Error` whose message names encryption (its EncryptedPDFError subclass does
 * not set `name`), so the message is the reliable signal.
 */
export function isEncryptedLoadFailure(err: unknown): boolean {
  const e = err as { name?: string; message?: string; constructor?: { name?: string } };
  if (e?.name === 'EncryptedPDFError' || e?.name === 'EncryptedDocumentError') return true;
  if (e?.constructor?.name === 'EncryptedPDFError') return true;
  return /is encrypted/i.test(String(e?.message ?? ''));
}

/**
 * Load a document that the caller is about to copy pages from, embed, or re-save. Callers that only
 * READ structure (page counts, dimensions) may keep `ignoreEncryption`, because those values live in
 * plaintext dictionaries; callers that produce a new document may not.
 */
export async function loadPdfForRebuild(
  bytes: Uint8Array | ArrayBuffer,
  operation?: string
): Promise<PDFDocument> {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return await PDFDocument.load(u8, { ignoreEncryption: false });
  } catch (err) {
    if (isEncryptedLoadFailure(err)) throw new EncryptedDocumentError(operation);
    throw err;
  }
}
