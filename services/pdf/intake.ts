import { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfjsLib } from '../pdfjsClient';
import { EncryptedDocumentError, isEncryptedLoadFailure } from '../../shared/pdf/loadGuard';

/**
 * Document intake — the one way a PDF enters this product.
 *
 * Every load states an intent. Reading is allowed for any document pdf.js can open, including
 * permission-only files whose owner restrictions pdf.js does not enforce. Rebuilding is only allowed
 * when the content can actually be copied, which an encrypted document cannot be today.
 *
 * Encryption is decided from the document's own `/Encrypt` entry, not from a load failure: pdf.js
 * throws nothing for permission-only files (it pads the empty password and renders content), so a
 * failure-based guard would silently classify the most common bank statement in this corpus as
 * readable-and-rebuildable. The user-password distinction is behavioural — pdf.js is the only
 * authority on whether an empty password opens the file.
 *
 * The engines stay visible: a caller gets the pdf.js document or the pdf-lib document it already
 * knows. The depth here is that it cannot get one without the guards, the teardown and the frame
 * facts.
 */

export type DocumentState = 'readable' | 'user-locked' | 'permission-only';
export type IntakeIntent = 'read' | 'rebuild' | 'repair';

export interface PageFrame {
  pageNumber: number;
  /** Visible page width in points, i.e. after /Rotate — the frame a reader sees. */
  width: number;
  /** Visible page height in points, after /Rotate. */
  height: number;
  /** Raw /Rotate value as pdf.js reports it (0, 90, 180, 270). */
  rotation: number;
}

export interface IntakeOptions {
  operation?: string;
  password?: string;
}

export class PasswordRequiredError extends Error {
  constructor(operation = 'This tool') {
    super(
      `${operation} needs the password for this PDF: it is password-protected and cannot be read ` +
      'without one. Run Unlock PDF with the password if the document should be re-saved.'
    );
    this.name = 'PasswordRequiredError';
  }
}

export class WrongPasswordError extends Error {
  constructor(operation = 'This tool') {
    super(`${operation} could not open this PDF: the supplied password is incorrect.`);
    this.name = 'WrongPasswordError';
  }
}

export class UnreadableDocumentError extends Error {
  constructor(operation = 'This tool', cause?: unknown) {
    const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : '';
    super(`${operation} could not read this PDF — it is not a valid PDF document${detail}`);
    this.name = 'UnreadableDocumentError';
  }
}

/** `/Encrypt` in the file's dictionary. The token is ASCII and appears in the trailer dictionary. */
export function hasEncryptDictionary(bytes: Uint8Array): boolean {
  const needle = '/Encrypt';
  const first = needle.charCodeAt(0);
  let at = bytes.indexOf(first);
  while (at !== -1) {
    if (at + needle.length <= bytes.length) {
      let matches = true;
      for (let i = 1; i < needle.length; i++) {
        if (bytes[at + i] !== needle.charCodeAt(i)) { matches = false; break; }
      }
      if (matches) return true;
    }
    at = bytes.indexOf(first, at + 1);
  }
  return false;
}

/** Which intents a document state allows. Refusal is a policy, not a side effect of a failed load. */
export function assertIntentAllowed(state: DocumentState, intent: IntakeIntent, operation?: string): void {
  if (intent === 'read') {
    if (state === 'user-locked') throw new PasswordRequiredError(operation);
    return;
  }
  // rebuild and repair both produce a new document; pdf-lib cannot decrypt content, so any encrypted
  // document is refused here regardless of what pdf.js can display.
  if (state !== 'readable') throw new EncryptedDocumentError(operation);
}

export interface OpenedForRead {
  state: DocumentState;
  pdf: PDFDocumentProxy;
  pageCount: number;
  /** Visible frame of one page (1-based). Computed on demand and cached. */
  frame(pageNumber: number): Promise<PageFrame>;
  /** Idempotent. The handle owns teardown; callers must not destroy the document themselves. */
  release(): Promise<void>;
}

export interface OpenedForRebuild {
  state: 'readable';
  pdf: PDFDocument;
}

/** Internal seam: tests can supply a fake opener to reach branches the corpus cannot produce. */
export type PdfJsOpener = (bytes: Uint8Array, password?: string) => Promise<PDFDocumentProxy>;

const openWithPdfJs: PdfJsOpener = async (bytes, password) => {
  const task = pdfjsLib.getDocument(password ? { data: bytes.slice(0), password } : { data: bytes.slice(0) });
  return task.promise;
};

function isPasswordException(err: unknown): err is { name: string; code?: number } {
  const e = err as { name?: string; code?: number };
  return e?.name === 'PasswordException';
}

function toUint8(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function makeReadHandle(pdf: PDFDocumentProxy, state: DocumentState): OpenedForRead {
  const frameCache = new Map<number, PageFrame>();
  let released: Promise<void> | null = null;
  return {
    state,
    pdf,
    pageCount: pdf.numPages,
    async frame(pageNumber: number): Promise<PageFrame> {
      const cached = frameCache.get(pageNumber);
      if (cached) return cached;
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
        throw new RangeError(`Page ${pageNumber} is outside 1..${pdf.numPages}.`);
      }
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const frame: PageFrame = {
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        rotation: page.rotate ?? 0,
      };
      frameCache.set(pageNumber, frame);
      return frame;
    },
    release(): Promise<void> {
      if (!released) released = pdf.destroy().then(() => undefined);
      return released;
    },
  };
}

export interface OpenForReadOptions extends IntakeOptions {
  /** Internal seam for tests; production always uses pdf.js. */
  opener?: PdfJsOpener;
}

export async function openForRead(
  bytes: Uint8Array | ArrayBuffer,
  options: OpenForReadOptions = {}
): Promise<OpenedForRead> {
  const operation = options.operation;
  const u8 = toUint8(bytes);
  const opener = options.opener ?? openWithPdfJs;
  const encrypted = hasEncryptDictionary(u8);

  if (!encrypted) {
    try {
      return makeReadHandle(await opener(u8, options.password), 'readable');
    } catch (err) {
      throw new UnreadableDocumentError(operation, err);
    }
  }

  // Encrypted: an empty password opening the file means only owner restrictions apply.
  try {
    return makeReadHandle(await opener(u8), 'permission-only');
  } catch (err) {
    if (!isPasswordException(err) || err.code !== 1) throw new UnreadableDocumentError(operation, err);
  }

  if (!options.password) throw new PasswordRequiredError(operation);
  try {
    return makeReadHandle(await opener(u8, options.password), 'user-locked');
  } catch (err) {
    if (isPasswordException(err) && err.code === 2) throw new WrongPasswordError(operation);
    throw new UnreadableDocumentError(operation, err);
  }
}

export async function withReadDocument<T>(
  bytes: Uint8Array | ArrayBuffer,
  options: OpenForReadOptions,
  body: (opened: OpenedForRead) => Promise<T> | T
): Promise<T> {
  const opened = await openForRead(bytes, options);
  try {
    return await body(opened);
  } finally {
    await opened.release();
  }
}

export interface OpenForRebuildOptions extends IntakeOptions {
  intent?: 'rebuild' | 'repair';
}

/**
 * Load a document the caller will copy pages from, embed, or re-save. `intent` is required to be
 * explicit: a repair is something a caller asks for, never a fallback this module performs on its
 * own. The repair algorithm itself stays with the caller.
 */
export async function openForRebuild(
  bytes: Uint8Array | ArrayBuffer,
  options: OpenForRebuildOptions = {}
): Promise<OpenedForRebuild> {
  const u8 = toUint8(bytes);
  const state: DocumentState = hasEncryptDictionary(u8) ? 'permission-only' : 'readable';
  assertIntentAllowed(state, options.intent ?? 'rebuild', options.operation);
  try {
    return { state: 'readable', pdf: await PDFDocument.load(u8, { ignoreEncryption: false }) };
  } catch (err) {
    if (isEncryptedLoadFailure(err)) throw new EncryptedDocumentError(options.operation);
    throw new UnreadableDocumentError(options.operation, err);
  }
}

export async function withRebuildDocument<T>(
  bytes: Uint8Array | ArrayBuffer,
  options: OpenForRebuildOptions,
  body: (opened: OpenedForRebuild) => Promise<T> | T
): Promise<T> {
  return body(await openForRebuild(bytes, options));
}
