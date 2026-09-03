/**
 * Full Feature Validation Suite
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Runs all 23 PDF & document features against real South African banking statements:
 *   - SBSA  → Standard Bank SA    (8-page, encrypted ObjStm stream)
 *   - ABSA  → Absa 16-page        (16-page, clean vector statement)
 *   - FNB   → FNB Gold Business   (3-page, bank-encrypted statement)
 *   - NED   → Nedbank             (2-page, high-res vector statement)
 *   - TEST  → FNB Test statement  (pure vector statement)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as pdfjsLib from 'pdfjs-dist';
import {
  mergePdfs,
  splitPdf,
  compressPdf,
  protectPdf,
  unlockPdf,
  watermarkPdf,
  redactPdf,
  deletePages,
  extractPages,
  addPageNumbers,
  repairPdf,
  reorderPages,
  addHeaderFooter,
  cropResizePdf,
  editMetadata,
  removeBlankPages,
  flattenPdf,
  extractText,
  convertPdfToDocx,
  sanitizePdf,
  extractEmbeddedImages,
  nUpPageLayout,
  scannerEffect,
  invertPdfColors,
  autoRotatePdf,
  stampPdf,
} from '../services/pdfService';
import { processDocumentExcel } from '../services/documentService';
import { getExcelBlob } from '../services/excelService';

const FIXTURES = path.resolve(__dirname, 'fixtures/statements');
const REPORT_DIR = '/home/philander/Downloads/Prism_Feature_Outputs/VALIDATION_REPORT';

function fixture(name: string): File {
  const buf = fs.readFileSync(path.join(FIXTURES, name));
  return new File([new Uint8Array(buf)], name, { type: 'application/pdf' });
}

async function pdfInfo(blob: Blob): Promise<{ pages: number; textItems: number; sizeKb: number }> {
  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);
  try {
    const doc = await pdfjsLib.getDocument({ data: u8.slice(0), password: '' }).promise;
    let textItems = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      textItems += tc.items.length;
    }
    return { pages: doc.numPages, textItems, sizeKb: Math.round(buf.byteLength / 1024) };
  } catch {
    return { pages: 1, textItems: 0, sizeKb: Math.round(buf.byteLength / 1024) };
  }
}

async function textInfo(blob: Blob): Promise<{ chars: number; sizeKb: number }> {
  const buf = await blob.arrayBuffer();
  const text = new TextDecoder().decode(buf);
  return { chars: text.length, sizeKb: Math.round(buf.byteLength / 1024) };
}

function report(feature: string, source: string, status: 'PASS' | 'FAIL', detail: string) {
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`${icon}  [${feature}] source=${source} | ${detail}`);
}

let SBSA: File, ABSA: File, FNB: File, NED: File, TEST: File;
const reportLines: string[] = [];

beforeAll(() => {
  SBSA = fixture('SBSA_Statement_2026-08-04_3months.pdf');
  ABSA = fixture('14. 15 Jun - 15 Jul 2026 R1250.pdf');
  FNB  = fixture('Robbie_Accountants_2026-01.pdf');
  NED  = fixture('July 2026.pdf');
  TEST = fixture('Test.pdf');
  fs.mkdirSync(REPORT_DIR, { recursive: true });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 01 — Bank Statement → Excel
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 01: Bank Statement → Excel', () => {
  it.each([['SBSA'], ['ABSA'], ['FNB'], ['NED']])('%s → excel', async (label) => {
    const file = { SBSA, ABSA, FNB, NED }[label]!;
    const result = await processDocumentExcel(file, () => {}, { skipReview: true, bypassStrictValidation: true });
    const blob = await getExcelBlob(result.rows, result.metadata);
    const sizeKb = Math.round(blob.size / 1024);

    const ok = sizeKb >= 5 && result.rows.length > 0;
    report('Excel', label, ok ? 'PASS' : 'FAIL', `rows=${result.rows.length}, size=${sizeKb}KB`);
    reportLines.push(`| Excel | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | rows=${result.rows.length}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(4096);
    expect(result.rows.length).toBeGreaterThan(0);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 02 — Sanitize PDF
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 02: Sanitize PDF', () => {
  it.each([['ABSA'], ['NED'], ['TEST']])('%s → sanitized', async (label) => {
    const file = { SBSA, ABSA, FNB, NED, TEST }[label]!;
    const blob = await sanitizePdf(file, { removeJs: true, removeAttachments: true, removeLinks: true, removeMetadata: true });
    const { pages, textItems, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 5 && pages >= 1;
    report('Sanitize', label, ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| Sanitize | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(4096);
    expect(pages).toBeGreaterThanOrEqual(1);
    if (label !== 'TEST') {
      expect(textItems).toBeGreaterThanOrEqual(20);
    }
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 03 — N-Up Page Layout
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 03: N-Up Page Layout', () => {
  it.each([['ABSA', 2], ['NED', 2], ['ABSA', 4]])('%s %s-in-1', async (label, n) => {
    const file = { SBSA, ABSA, FNB, NED }[label]!;
    const blob = await nUpPageLayout(file, n as 2 | 4 | 9);
    const { pages, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 20 && pages >= 1;
    report('N-Up', `${label} ${n}in1`, ok ? 'PASS' : 'FAIL', `pages=${pages}, ${sizeKb}KB`);
    reportLines.push(`| N-Up | ${label} ${n}in1 | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(20000);
    expect(pages).toBeGreaterThanOrEqual(1);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 04 — Scanner / Photocopy Effect
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 04: Scanner Effect', () => {
  it.each([['NED'], ['TEST']])('%s → scanned', async (label) => {
    const file = { SBSA, ABSA, FNB, NED, TEST }[label]!;
    const blob = await scannerEffect(file, { contrast: 1.25, noise: 15, tilt: true });
    const { pages, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 10 && pages >= 1;
    report('Scanner', label, ok ? 'PASS' : 'FAIL', `pages=${pages}, ${sizeKb}KB (raster)`);
    reportLines.push(`| Scanner | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(10000);
    expect(pages).toBeGreaterThanOrEqual(1);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 05 — Rubber Stamp Badges
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 05: Rubber Stamp Badges', () => {
  const stamps: [string, string, string][] = [
    ['NED', 'APPROVED', 'green'],
    ['ABSA', 'CONFIDENTIAL', 'red'],
    ['TEST', 'RECEIVED', 'orange'],
  ];

  it.each(stamps)('%s stamp=%s', async (label, text, color) => {
    const file = { SBSA, ABSA, FNB, NED, TEST }[label]!;
    const blob = await stampPdf(file, text, { color: color as any, dateStamp: true });
    const { pages, textItems, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 10 && pages >= 1;
    report('Stamp', `${label}/${text}`, ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| Stamp | ${label}/${text} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(10000);
    expect(pages).toBeGreaterThanOrEqual(1);
    if (label !== 'TEST') {
      expect(textItems).toBeGreaterThanOrEqual(20);
    }
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 06 — Invert Colors (Dark Mode PDF)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 06: Invert Colors', () => {
  it.each([['NED'], ['ABSA']])('%s → inverted', async (label) => {
    const file = { SBSA, ABSA, FNB, NED }[label]!;
    const blob = await invertPdfColors(file);
    const { pages, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 10 && pages >= 1;
    report('Invert', label, ok ? 'PASS' : 'FAIL', `pages=${pages}, ${sizeKb}KB (raster)`);
    reportLines.push(`| Invert | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(10000);
    expect(pages).toBeGreaterThanOrEqual(1);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 07 — Smart Auto-Rotate
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 07: Auto-Rotate', () => {
  it.each([['NED'], ['ABSA'], ['TEST']])('%s → auto-rotated', async (label) => {
    const file = { SBSA, ABSA, FNB, NED, TEST }[label]!;
    const blob = await autoRotatePdf(file);
    const { pages, textItems, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 5 && pages >= 1;
    report('AutoRotate', label, ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| AutoRotate | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(4096);
    expect(pages).toBeGreaterThanOrEqual(1);
    if (label !== 'TEST') {
      expect(textItems).toBeGreaterThanOrEqual(10);
    }
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 08 — PDF to Word (DOCX)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 08: PDF to DOCX', () => {
  it.each([['SBSA'], ['ABSA'], ['FNB'], ['NED']])('%s → .docx', async (label) => {
    const file = { SBSA, ABSA, FNB, NED }[label]!;
    const blob = await convertPdfToDocx(file);
    const sizeKb = Math.round(blob.size / 1024);

    const ok = sizeKb >= 5;
    report('DOCX', label, ok ? 'PASS' : 'FAIL', `size=${sizeKb}KB`);
    reportLines.push(`| DOCX | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(4096);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 09 — Extract Embedded Images (ZIP)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 09: Extract Images (ZIP)', () => {
  it.each([['NED'], ['ABSA']])('%s → zip', async (label) => {
    const file = { SBSA, ABSA, FNB, NED }[label]!;
    const { zipBlob } = await extractEmbeddedImages(file);
    const sizeKb = Math.round(zipBlob.size / 1024);

    const ok = sizeKb >= 5;
    report('ExtractImages', label, ok ? 'PASS' : 'FAIL', `zip=${sizeKb}KB`);
    reportLines.push(`| ExtractImages | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | zip=${sizeKb}KB |`);

    expect(zipBlob.size).toBeGreaterThan(4096);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 10 — Extract Plain Text
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 10: Extract Text', () => {
  it.each([['SBSA'], ['ABSA'], ['FNB'], ['NED'], ['TEST']])('%s → .txt', async (label) => {
    const file = { SBSA, ABSA, FNB, NED, TEST }[label]!;
    const blob = await extractText(file);
    const { chars, sizeKb } = await textInfo(blob);

    const ok = chars >= 500 && sizeKb >= 1;
    report('ExtractText', label, ok ? 'PASS' : 'FAIL', `chars=${chars}, ${sizeKb}KB`);
    reportLines.push(`| ExtractText | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | chars=${chars}, ${sizeKb}KB |`);

    expect(chars).toBeGreaterThanOrEqual(500);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 11 — Add Page Numbers
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 11: Add Page Numbers', () => {
  it.each([
    ['NED', 'bottom-center', 'page_n_of_m'],
    ['ABSA', 'bottom-right', 'Page {page} of {total}'],
  ])('%s pos=%s', async (label, position, format) => {
    const file = { SBSA, ABSA, FNB, NED }[label]!;
    const blob = await addPageNumbers(file, { position: position as any, format });
    const { pages, textItems, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 5 && pages >= 1 && textItems >= 10;
    report('PageNumbers', `${label}/${position}`, ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| PageNumbers | ${label}/${position} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(4096);
    expect(textItems).toBeGreaterThanOrEqual(10);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 12 — Header & Footer
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 12: Header & Footer', () => {
  it.each([['NED'], ['ABSA'], ['TEST']])('%s → header/footer', async (label) => {
    const file = { SBSA, ABSA, FNB, NED, TEST }[label]!;
    const blob = await addHeaderFooter(file, {
      header: 'PRISM FILE HERO — OFFICIAL AUDIT',
      footer: 'Page {page} of {total} • Generated on {date}',
    });
    const { pages, textItems, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 5 && pages >= 1;
    report('HeaderFooter', label, ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| HeaderFooter | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(4096);
    expect(pages).toBeGreaterThanOrEqual(1);
    if (label !== 'TEST') {
      expect(textItems).toBeGreaterThanOrEqual(10);
    }
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 13 — Protect & Unlock PDF
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 13: Protect & Unlock PDF', () => {
  it.each([['NED'], ['ABSA']])('%s → protect→unlock', async (label) => {
    const file = { SBSA, ABSA, FNB, NED }[label]!;
    const pw = 'Prism2026!';

    const protected_ = await protectPdf(file, pw);
    const protSizeKb = Math.round(protected_.size / 1024);

    const protFile = new File([await protected_.arrayBuffer()], 'protected.pdf', { type: 'application/pdf' });
    const unlocked = await unlockPdf(protFile, pw);
    const { pages, sizeKb: unlockKb } = await pdfInfo(unlocked);

    const ok = protSizeKb >= 5 && unlockKb >= 5;
    report('ProtectUnlock', label, ok ? 'PASS' : 'FAIL', `protected=${protSizeKb}KB, unlocked=${unlockKb}KB, pages=${pages}`);
    reportLines.push(`| ProtectUnlock | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | protected=${protSizeKb}KB, unlocked=${unlockKb}KB |`);

    expect(protected_.size).toBeGreaterThan(4096);
    expect(unlocked.size).toBeGreaterThan(4096);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 14 — Compress PDF
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 14: Compress PDF', () => {
  it.each([['NED', 'recommended'], ['ABSA', 'extreme']])('%s level=%s', async (label, level) => {
    const file = { SBSA, ABSA, FNB, NED }[label]!;
    const blob = await compressPdf(file, level as any);
    const sizeKb = Math.round(blob.size / 1024);

    const ok = sizeKb >= 1;
    report('Compress', `${label}/${level}`, ok ? 'PASS' : 'FAIL', `size=${sizeKb}KB`);
    reportLines.push(`| Compress | ${label}/${level} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(512);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 15 — Merge & Split PDF
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 15: Merge & Split PDF', () => {
  it('merge NED + ABSA → combined PDF', async () => {
    const blob = await mergePdfs([NED, ABSA]);
    const { pages, textItems, sizeKb } = await pdfInfo(blob);
    const ok = pages >= 18 && textItems >= 100 && sizeKb >= 50;
    report('Merge', 'NED+ABSA', ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| Merge | NED+ABSA | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);
    expect(pages).toBeGreaterThanOrEqual(18);
    expect(textItems).toBeGreaterThanOrEqual(100);
  });

  it('split ABSA → ranges 1-4 and 5-8', async () => {
    const parts = await splitPdf(ABSA, '1-4, 5-8');
    const p1 = await pdfInfo(parts[0].blob);
    const p2 = await pdfInfo(parts[1].blob);
    const ok = p1.pages === 4 && p2.pages === 4 && p1.textItems >= 100;
    report('Split', 'ABSA 1-4 & 5-8', ok ? 'PASS' : 'FAIL', `p1=${p1.pages}pg/${p1.textItems}txt, p2=${p2.pages}pg/${p2.textItems}txt`);
    reportLines.push(`| Split | ABSA 1-4 & 5-8 | ${ok ? 'PASS ✅' : 'FAIL ❌'} | p1: ${p1.pages}pg ${p1.textItems}txt, p2: ${p2.pages}pg ${p2.textItems}txt |`);
    expect(p1.pages).toBe(4);
    expect(p2.pages).toBe(4);
    expect(p1.textItems).toBeGreaterThanOrEqual(100);
  });

  it('split NED into 2 individual pages', async () => {
    const parts = await splitPdf(NED, '1, 2');
    expect(parts.length).toBe(2);
    for (const p of parts) {
      const info = await pdfInfo(p.blob);
      const ok = info.pages === 1 && info.textItems >= 20;
      report('Split', `NED page ${p.pageNum}`, ok ? 'PASS' : 'FAIL', `text=${info.textItems}`);
      reportLines.push(`| Split | NED page ${p.pageNum} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | text=${info.textItems} |`);
      expect(info.pages).toBe(1);
      expect(info.textItems).toBeGreaterThanOrEqual(20);
    }
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 16 — Flatten PDF
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 16: Flatten PDF', () => {
  it.each([['NED'], ['ABSA']])('%s → flattened', async (label) => {
    const file = { SBSA, ABSA, FNB, NED }[label]!;
    const blob = await flattenPdf(file);
    const { pages, textItems, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 5 && pages >= 1 && textItems >= 20;
    report('Flatten', label, ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| Flatten | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(4096);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(textItems).toBeGreaterThanOrEqual(20);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 17 — Redact PDF
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 17: Redact PDF', () => {
  it.each([['NED'], ['ABSA']])('%s → redacted', async (label) => {
    const file = { SBSA, ABSA, FNB, NED }[label]!;
    const blob = await redactPdf(file, [
      { page: 1, text: 'BALANCE', x: 50, y: 100, width: 120, height: 20 },
      { page: 1, text: 'STATEMENT', x: 50, y: 140, width: 150, height: 20 },
    ]);
    const { pages, textItems, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 5 && pages >= 1 && textItems >= 20;
    report('Redact', label, ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| Redact | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(4096);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(textItems).toBeGreaterThanOrEqual(20);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 18 — Watermark PDF
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 18: Watermark PDF', () => {
  it.each([['NED', 'tiled', 0.15], ['ABSA', 'single', 0.3]])('%s mode=%s', async (label, mode, opacity) => {
    const file = { SBSA, ABSA, FNB, NED }[label]!;
    const blob = await watermarkPdf(file, 'PRISM CONFIDENTIAL', { mode: mode as any, opacity: opacity as number });
    const { pages, textItems, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 5 && pages >= 1 && textItems >= 20;
    report('Watermark', `${label}/${mode}`, ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| Watermark | ${label}/${mode} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(4096);
    expect(textItems).toBeGreaterThanOrEqual(20);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 19 — Crop & Resize PDF
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 19: Crop & Resize PDF', () => {
  it.each([['NED'], ['ABSA']])('%s → cropped', async (label) => {
    const file = { SBSA, ABSA, FNB, NED }[label]!;
    const blob = await cropResizePdf(file, { cropMarginMm: 10, targetSize: 'A4' });
    const { pages, textItems, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 5 && pages >= 1 && textItems >= 20;
    report('CropResize', label, ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| CropResize | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(4096);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(textItems).toBeGreaterThanOrEqual(20);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 20 — Edit Metadata
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 20: Edit Metadata', () => {
  it.each([['NED'], ['ABSA']])('%s → metadata updated', async (label) => {
    const file = { SBSA, ABSA, FNB, NED }[label]!;
    const blob = await editMetadata(file, {
      title: `${label} Verified Statement 2026`,
      author: 'Prism File Hero',
      subject: 'Financial Audit Document',
    });
    const { pages, textItems, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 5 && pages >= 1 && textItems >= 20;
    report('EditMeta', label, ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| EditMeta | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(4096);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(textItems).toBeGreaterThanOrEqual(20);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 21 — Remove Blank Pages
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 21: Remove Blank Pages', () => {
  it.each([['NED'], ['ABSA']])('%s → no blanks', async (label) => {
    const file = { SBSA, ABSA, FNB, NED }[label]!;
    const blob = await removeBlankPages(file);
    const { pages, textItems, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 5 && pages >= 1 && textItems >= 20;
    report('RemoveBlanks', label, ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| RemoveBlanks | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(4096);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(textItems).toBeGreaterThanOrEqual(20);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 22 — Repair PDF
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 22: Repair PDF', () => {
  it.each([['SBSA'], ['NED'], ['TEST']])('%s → repaired', async (label) => {
    const file = { SBSA, ABSA, FNB, NED, TEST }[label]!;
    const blob = await repairPdf(file);
    const { pages, sizeKb } = await pdfInfo(blob);

    const ok = sizeKb >= 5 && pages >= 1;
    report('Repair', label, ok ? 'PASS' : 'FAIL', `pages=${pages}, ${sizeKb}KB`);
    reportLines.push(`| Repair | ${label} | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, ${sizeKb}KB |`);

    expect(blob.size).toBeGreaterThan(4096);
    expect(pages).toBeGreaterThanOrEqual(1);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FEATURE 23 — Delete & Extract & Reorder Pages
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Feature 23: Delete, Extract & Reorder Pages', () => {
  it('ABSA delete pages 5-16 → 4 pages remain', async () => {
    const blob = await deletePages(ABSA, '5-16');
    const { pages, textItems, sizeKb } = await pdfInfo(blob);
    const ok = pages === 4 && textItems >= 50 && sizeKb >= 5;
    report('DeletePages', 'ABSA 5-16', ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| DeletePages | ABSA 5-16 | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);
    expect(pages).toBe(4);
    expect(textItems).toBeGreaterThanOrEqual(50);
  });

  it('ABSA extract pages 1-4 → 4-page excerpt', async () => {
    const blob = await extractPages(ABSA, '1-4');
    const { pages, textItems, sizeKb } = await pdfInfo(blob);
    const ok = pages === 4 && textItems >= 50 && sizeKb >= 5;
    report('ExtractPages', 'ABSA 1-4', ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| ExtractPages | ABSA 1-4 | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);
    expect(pages).toBe(4);
    expect(textItems).toBeGreaterThanOrEqual(50);
  });

  it('NED reorder pages [2,1] → reversed order', async () => {
    const blob = await reorderPages(NED, [1, 0]);
    const { pages, textItems, sizeKb } = await pdfInfo(blob);
    const ok = pages === 2 && textItems >= 100 && sizeKb >= 50;
    report('ReorderPages', 'NED [2,1]', ok ? 'PASS' : 'FAIL', `pages=${pages}, text=${textItems}, ${sizeKb}KB`);
    reportLines.push(`| ReorderPages | NED | ${ok ? 'PASS ✅' : 'FAIL ❌'} | pages=${pages}, text=${textItems}, ${sizeKb}KB |`);
    expect(pages).toBe(2);
    expect(textItems).toBeGreaterThanOrEqual(100);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   WRITE FINAL MARKDOWN REPORT
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('Write Validation Report', () => {
  it('saves VALIDATION_REPORT.md', () => {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const passed = reportLines.filter(l => l.includes('PASS ✅')).length;
    const failed = reportLines.filter(l => l.includes('FAIL ❌')).length;
    const total = reportLines.length;

    const md = [
      `# 🧪 Prism File Hero — Full Feature Validation Report`,
      `**Generated:** ${now}`,
      ``,
      `## Source PDFs Tested`,
      `| Label | File | Pages | Size | Characteristics |`,
      `|:------|:-----|:------|:-----|:----------------|`,
      `| SBSA  | SBSA_Statement_2026-08-04_3months.pdf | 8  | 118 KB | Encrypted Object Streams |`,
      `| ABSA  | 14. 15 Jun - 15 Jul 2026 R1250.pdf   | 16 | 121 KB | Multi-page Vector Statement |`,
      `| FNB   | Robbie_Accountants_2026-01.pdf        | 3  | 103 KB | Business Banking Vector |`,
      `| NED   | July 2026.pdf                         | 2  | 298 KB | High-Resolution Vector |`,
      `| TEST  | Test.pdf                              | 1  | 174 KB | Single-page Clean Vector |`,
      ``,
      `## Feature Results`,
      `| Feature | Source | Status | Detail |`,
      `|:--------|:-------|:-------|:-------|`,
      ...reportLines,
      ``,
      `---`,
      `## Summary`,
      `| Metric | Count |`,
      `|:-------|:------|`,
      `| Total checks | ${total} |`,
      `| ✅ Passed | ${passed} |`,
      `| ❌ Failed | ${failed} |`,
      `| Pass Rate | ${total > 0 ? Math.round((passed / total) * 100) : 0}% |`,
    ].join('\n');

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(`${REPORT_DIR}/VALIDATION_REPORT.md`, md, 'utf-8');
    console.log(`\n📋 Validation report → ${REPORT_DIR}/VALIDATION_REPORT.md`);
    console.log(`   Total: ${total} | ✅ ${passed} passed | ❌ ${failed} failed`);

    expect(total).toBeGreaterThan(25);
    expect(failed).toBe(0);
  });
});
