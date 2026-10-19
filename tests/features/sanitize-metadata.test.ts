/**
 * A8 — "Strip ... sensitive metadata" has to mean the dates too.
 *
 * `sanitizePdf` set CreationDate and ModDate to `new Date(0)`. That is not removal: the trailer
 * still carries `/CreationDate (D:19700101...)`, so `pdfinfo` still prints a creation date, and a
 * document that was "completely sanitised" still tells a reader that its producer wrote it at the
 * epoch — which is a fact about the file, and one the user asked to delete.
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sanitizePdf } from '../../services/pdfService';

const DIR = mkdtempSync(path.join(tmpdir(), 'prism-sanitize-'));

async function datedDoc(): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 200]);
  page.drawText('SANITIZE-METADATA-PROBE', { x: 20, y: 100, size: 12, font });
  doc.setTitle('Q3 Board Pack');
  doc.setAuthor('J. Okonkwo');
  doc.setSubject('Confidential strategy');
  doc.setKeywords(['board', 'strategy']);
  doc.setProducer('Acme Reports 4.1');
  doc.setCreator('Acme Builder');
  doc.setCreationDate(new Date('2026-03-04T05:06:07Z'));
  doc.setModificationDate(new Date('2026-03-09T10:11:12Z'));
  return new File([await doc.save()], 'dated.pdf', { type: 'application/pdf' });
}

function pdfInfo(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of execFileSync('pdfinfo', [file], { encoding: 'utf8' }).split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

describe('sanitize — metadata removal', () => {
  it('removes the dates instead of resetting them to the epoch', async () => {
    const src = path.join(DIR, 'source.pdf');
    const file = await datedDoc();
    writeFileSync(src, Buffer.from(await file.arrayBuffer()));

    // Prove the fixture really carries them first, or the pass below would mean nothing.
    const before = pdfInfo(src);
    expect(before.CreationDate, 'fixture has a creation date').toBeTruthy();
    expect(before.ModDate ?? before['CreationDate']).toBeTruthy();

    const out = path.join(DIR, 'sanitized.pdf');
    writeFileSync(out, Buffer.from(await (await sanitizePdf(file, { removeMetadata: true })).arrayBuffer()));

    const info = pdfInfo(out);
    // Asserted through pdfinfo rather than a byte scan: pdf-lib packs the info dictionary into an
    // object stream, so a latin1 grep can miss a date that every reader still sees.
    expect(info.CreationDate, `creation date survived as "${info.CreationDate}"`).toBeUndefined();
    expect(info.ModDate, `modification date survived as "${info.ModDate}"`).toBeUndefined();
    expect((info.CreationDate ?? '').toLowerCase()).not.toContain('1970');

    // The rest of the identity has to go with it, and the page content has to survive.
    expect(info.Author ?? '').toBe('');
    expect(info.Title ?? '');
    expect(execFileSync('pdftotext', [out, '-'], { encoding: 'utf8' })).toContain('SANITIZE-METADATA-PROBE');
  }, 300_000);

  it('leaves the dates alone when removeMetadata is declined', async () => {
    const file = await datedDoc();
    const out = path.join(DIR, 'kept.pdf');
    writeFileSync(out, Buffer.from(await (await sanitizePdf(file, { removeMetadata: false })).arrayBuffer()));
    const info = pdfInfo(out);
    expect(info.CreationDate, 'asking for JS/attachment stripping must not silently delete the dates').toBeTruthy();
    expect(info.Title).toBe('Q3 Board Pack');
  }, 300_000);
});
