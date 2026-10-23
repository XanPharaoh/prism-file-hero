import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, degrees, StandardFonts } from 'pdf-lib';
import {
  hasEncryptDictionary,
  assertIntentAllowed,
  openForRead,
  openForRebuild,
  withReadDocument,
  PasswordRequiredError,
  WrongPasswordError,
  UnreadableDocumentError,
} from '../services/pdf/intake';
import { EncryptedDocumentError } from '../shared/pdf/loadGuard';

const FIX = path.resolve(__dirname, 'fixtures/statements');
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIX, name)));

const PLAIN = 'July 2026.pdf';
const PLAIN_2 = '14. 15 Jun - 15 Jul 2026 R1250.pdf';
const PERMISSION_ONLY = 'SBSA_Statement_2026-08-04_3months.pdf';
const PERMISSION_ONLY_2 = 'Robbie_Accountants_2026-01.pdf';
const USER_LOCKED = 'UserLocked_Sample.pdf';
const USER_LOCKED_PASSWORD = 'userpw';

async function syntheticPdf(size: [number, number], rotation = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(size);
  page.drawText('INTAKE', { x: 12, y: 12, size: 10, font });
  if (rotation) page.setRotation(degrees(rotation));
  return new Uint8Array(await doc.save());
}

describe('hasEncryptDictionary', () => {
  it('sees the dictionary entry in every encrypted fixture', () => {
    expect(hasEncryptDictionary(fixture(PERMISSION_ONLY))).toBe(true);
    expect(hasEncryptDictionary(fixture(PERMISSION_ONLY_2))).toBe(true);
    expect(hasEncryptDictionary(fixture(USER_LOCKED))).toBe(true);
  });

  it('is false for plaintext documents and for arbitrary bytes', () => {
    expect(hasEncryptDictionary(fixture(PLAIN))).toBe(false);
    expect(hasEncryptDictionary(fixture(PLAIN_2))).toBe(false);
    expect(hasEncryptDictionary(new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });
});

describe('assertIntentAllowed', () => {
  it('allows reading both permission-only and readable documents', () => {
    expect(() => assertIntentAllowed('readable', 'read')).not.toThrow();
    expect(() => assertIntentAllowed('permission-only', 'read')).not.toThrow();
  });

  it('refuses reading a user-locked document without a password', () => {
    expect(() => assertIntentAllowed('user-locked', 'read', 'Merge PDF')).toThrow(PasswordRequiredError);
  });

  it('refuses rebuilding or repairing any encrypted state, naming the operation', () => {
    expect(() => assertIntentAllowed('readable', 'rebuild')).not.toThrow();
    for (const state of ['permission-only', 'user-locked'] as const) {
      for (const intent of ['rebuild', 'repair'] as const) {
        let caught: unknown;
        try { assertIntentAllowed(state, intent, 'Compress PDF'); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(EncryptedDocumentError);
        expect(String((caught as Error).message)).toContain('Compress PDF');
        expect(String((caught as Error).message)).toContain('password-protected');
      }
    }
  });
});

describe('openForRead', () => {
  it('opens a plaintext document as readable and reports its page count', async () => {
    const opened = await openForRead(fixture(PLAIN));
    expect(opened.state).toBe('readable');
    expect(opened.pageCount).toBe(2);
    await opened.release();
  });

  it('classifies an owner-restricted statement as permission-only, not user-locked', async () => {
    // pdf.js opens these with an empty password; the corpus has no user-password file among the banks.
    const opened = await openForRead(fixture(PERMISSION_ONLY));
    expect(opened.state).toBe('permission-only');
    expect(opened.pageCount).toBe(8);
    await opened.release();
  });

  it('requires a password for a user-locked document', async () => {
    await expect(openForRead(fixture(USER_LOCKED), { operation: 'Merge PDF' }))
      .rejects.toBeInstanceOf(PasswordRequiredError);
  });

  it('distinguishes a wrong password from a missing one', async () => {
    await expect(openForRead(fixture(USER_LOCKED), { password: 'nope' }))
      .rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('opens a user-locked document with its password, still reporting the document state', async () => {
    const opened = await openForRead(fixture(USER_LOCKED), { password: USER_LOCKED_PASSWORD });
    expect(opened.state).toBe('user-locked');
    expect(opened.pageCount).toBe(1);
    const page = await opened.pdf.getPage(1);
    const text = await page.getTextContent();
    expect(text.items.map((i: any) => i.str).join('')).toContain('USER-LOCKED FIXTURE');
    await opened.release();
  });

  it('reports unreadable bytes as such instead of a page count of zero', async () => {
    await expect(openForRead(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff])))
      .rejects.toBeInstanceOf(UnreadableDocumentError);
  });

  it('exposes the visible frame: a /Rotate 90 page reports swapped width and height', async () => {
    const opened = await openForRead(await syntheticPdf([300, 400], 90));
    const frame = await opened.frame(1);
    expect(frame).toEqual({ pageNumber: 1, width: 400, height: 300, rotation: 90 });
    await opened.release();
  });

  it('rejects page numbers outside the document', async () => {
    const opened = await openForRead(await syntheticPdf([300, 400]));
    await expect(opened.frame(0)).rejects.toBeInstanceOf(RangeError);
    await expect(opened.frame(2)).rejects.toBeInstanceOf(RangeError);
    await opened.release();
  });

  it('releases idempotently and through the scope form', async () => {
    const opened = await openForRead(fixture(PLAIN));
    await opened.release();
    await expect(opened.release()).resolves.toBeUndefined();

    const pages = await withReadDocument(fixture(PLAIN), {}, (h) => h.pageCount);
    expect(pages).toBe(2);
    await expect(withReadDocument(fixture(PLAIN), {}, async () => { throw new Error('body'); }))
      .rejects.toThrow('body'); // the scope still releases; a leak here would surface as an unhandled worker
  });
});

describe('openForRebuild', () => {
  it('opens plaintext for rebuilding and for the explicit repair intent', async () => {
    expect((await openForRebuild(fixture(PLAIN))).pdf.getPageCount()).toBe(2);
    expect((await openForRebuild(fixture(PLAIN), { intent: 'repair' })).state).toBe('readable');
  });

  it('refuses a permission-only document for rebuilding, naming the operation', async () => {
    await expect(openForRebuild(fixture(PERMISSION_ONLY), { operation: 'Flatten PDF' }))
      .rejects.toThrow(/Flatten PDF.*password-protected/);
  });

  it('still refuses a user-locked document even with a password, until C3 lands', async () => {
    await expect(openForRebuild(fixture(USER_LOCKED), { password: USER_LOCKED_PASSWORD }))
      .rejects.toBeInstanceOf(EncryptedDocumentError);
  });

  it('reports unreadable bytes as unreadable', async () => {
    await expect(openForRebuild(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(UnreadableDocumentError);
  });
});
