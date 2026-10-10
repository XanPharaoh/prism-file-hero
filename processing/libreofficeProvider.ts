/**
 * Batch 09 — LibreOffice headless conversion provider (office-to-pdf): the actual engine
 * adapter behind the conversion seam. Runs a real `soffice --headless --convert-to pdf` in a
 * throwaway profile/user dir, bounded by size limits + a hard timeout, verifies the output is
 * a real PDF, and ALWAYS cleans up the temp workspace. It lives in the Node jobs service
 * (`processing/`), NOT the Worker runtime (workerd cannot spawn processes).
 *
 * The sandbox where this was authored has NO soffice binary, so live conversion is UNVERIFIED
 * here (see docs/audit/baseline.md); the adapter logic is unit-tested without the binary.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConversionJob, ConversionProvider, ConversionRequest, ConversionResult } from './workerTypes';

const EXT_BY_MIME: Record<string, string> = {
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};
const SUPPORTED_EXT = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'];
const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 120 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

export function buildSofficeArgs(inputPath: string, outDir: string, profileDir: string): string[] {
  return [
    '-env:UserInstallation=file://' + profileDir, // isolated profile => parallel-safe
    '--headless', '--norestore', '--invisible', '--nodefault',
    '--convert-to', 'pdf', '--outdir', outDir, inputPath,
  ];
}
export function looksLikePdf(buf: Uint8Array): boolean {
  return buf.length >= 1024 && new TextDecoder().decode(buf.slice(0, 5)) === '%PDF-';
}
async function runSoffice(args: string[]): Promise<void> {
  await new Promise<void>((resolveP, rejectP) => {
    const child = spawn('soffice', args, { stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill('SIGKILL'); rejectP(new Error('conversion timed out')); }, TIMEOUT_MS);
    child.on('error', (e: Error) => { clearTimeout(timer); rejectP(e); });
    child.on('close', (code: number | null) => { clearTimeout(timer); code === 0 ? resolveP() : rejectP(new Error(`soffice exited ${code}`)); });
  });
}
export async function sofficeAvailable(): Promise<boolean> {
  try {
    await new Promise<void>((res, rej) => {
      const c = spawn('soffice', ['--version'], { stdio: 'ignore' });
      c.on('error', (e: Error) => rej(e));
      c.on('close', (code: number | null) => (code === 0 ? res() : rej(new Error('no'))));
    });
    return true;
  } catch { return false; }
}

export const libreOfficeProvider: ConversionProvider = {
  name: 'libreoffice-headless',
  supports: (job: ConversionJob) => job === 'office-to-pdf',
  async convert(req: ConversionRequest): Promise<ConversionResult> {
    const ext = EXT_BY_MIME[req.inputMime];
    if (!ext || !SUPPORTED_EXT.includes(ext)) throw new Error(`unsupported input type ${req.inputMime}`);
    if (req.inputBytes.byteLength > MAX_INPUT_BYTES) throw new Error('input exceeds size limit');
    const dir = await mkdtemp(join(tmpdir(), 'prism-conv-'));
    try {
      const inputPath = join(dir, `in.${ext}`);
      await writeFile(inputPath, new Uint8Array(req.inputBytes));
      await runSoffice(buildSofficeArgs(inputPath, dir, join(dir, 'profile')));
      const out = new Uint8Array(await readFile(join(dir, 'out.pdf')));
      if (!looksLikePdf(out)) throw new Error('conversion produced a non-PDF');
      if (out.byteLength > MAX_OUTPUT_BYTES) throw new Error('output exceeds size limit');
      return { bytes: out, mime: 'application/pdf', engine: 'libreoffice-headless', engineVersion: 'unknown' };
    } finally {
      await rm(dir, { recursive: true, force: true }); // ALWAYS cleanup
    }
  },
};
