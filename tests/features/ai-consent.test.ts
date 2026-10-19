/**
 * D3 — a scan must never be billed to cloud AI without the user asking for it.
 *
 * pdf-to-excel reads a table locally first, and when that finds nothing it escalates to a cloud
 * provider. For a scanned statement the local read *always* finds nothing, so every scan silently
 * took the paid path — one credit per page — on a tool the user chose because it converts tables,
 * with nothing on screen saying a cloud model was about to read their bank statement.
 *
 * `processWithAI` is mocked here, so these assertions are about whether it is reached at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';

vi.mock('../../services/geminiService', () => ({
  processWithAI: vi.fn(async () => ({ data: { rows: [] } })),
}));

// The local reader is made to fail, which is exactly the state a scanned page is in. Mocking it keeps
// this test about the consent gate rather than about a several-minute OCR attempt under jsdom.
vi.mock('../../services/documentService', () => ({
  processDocumentExcel: vi.fn(async () => ({ rows: [], metadata: { confidence: 0 } })),
}));

const { processWithAI } = await import('../../services/geminiService');
const { getToolById } = await import('../../src/registry/toolRegistry');

/**
 * A one-page document with an image and no text layer. Deliberately not the two-page scan fixture:
 * the local strategies must fail for the same reason (nothing readable on the page) but in seconds,
 * not the several minutes a real 2400x3508 scan costs under jsdom's decoder.
 */
async function scanFile(): Promise<File> {
  const c = createCanvas(240, 320);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 240, 320);
  g.fillStyle = '#222222'; g.fillRect(20, 40, 200, 200);
  const doc = await PDFDocument.create();
  const page = doc.addPage([240, 320]);
  const jpg = new Uint8Array(c.toBuffer('image/jpeg', 85));
  page.drawImage(await doc.embedJpg(jpg), { x: 0, y: 0, width: 240, height: 320 });
  return new File([new Uint8Array(await doc.save())], 'scan-like.pdf', { type: 'application/pdf' });
}

async function run(options: Record<string, unknown> = {}) {
  const tool = getToolById('pdf-to-excel')!;
  return tool.handler({
    files: [await scanFile()],
    options,
    onProgress: () => {},
    setIsProcessing: () => {},
  } as never);
}

describe('pdf-to-excel — cloud AI is spent only on an explicit request', () => {
  beforeEach(() => vi.mocked(processWithAI).mockClear());

  it('refuses to reach a provider when the option was never set, and says what it would cost', async () => {
    let error: Error | null = null;
    try { await run(); } catch (e) { error = e as Error; }

    expect(error, 'a text-less document must not quietly become a paid call').not.toBeNull();
    expect(error!.message).toMatch(/no readable text layer/i);
    expect(error!.message).toMatch(/one credit per page/i);
    expect(error!.message).toMatch(/cloud AI/i);
    expect(vi.mocked(processWithAI)).not.toHaveBeenCalled();
  }, 300_000);

  it('still refuses when the option is explicitly off', async () => {
    let error: Error | null = null;
    try { await run({ allowAIFallback: false }); } catch (e) { error = e as Error; }
    expect(error?.message).toMatch(/no readable text layer/i);
    expect(vi.mocked(processWithAI)).not.toHaveBeenCalled();
  }, 300_000);

  it('takes the cloud path once the user asks for it', async () => {
    try { await run({ allowAIFallback: true }); } catch { /* the mocked provider returns no rows */ }
    expect(vi.mocked(processWithAI)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processWithAI).mock.calls[0][0]).toBe('pdf-to-excel');
  }, 300_000);
});
