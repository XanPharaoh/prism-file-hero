import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  resolveOcrAssetPaths,
  missingOcrAssets,
  appOcrAssetBase,
  appOcrWorkerOptions,
  REQUIRED_OCR_ASSETS,
} from '../shared/ocr/assets';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('OCR offline asset manifest', () => {
  it('offline mode resolves to same-origin paths, never a CDN', () => {
    const p = resolveOcrAssetPaths('assets/vendor/tesseract/', true);
    expect(p.workerPath).toBe('assets/vendor/tesseract/tesseract-worker.min.js');
    expect(p.traineddataUrl('eng')).toBe('assets/vendor/tesseract/langdata/eng.traineddata.gz');
    for (const v of [p.workerPath, p.corePath, p.langPath]) {
      expect(v).not.toMatch(/^https?:/i);
      expect(v).not.toMatch(/jsdelivr/i);
    }
  });

  it('online (CDN) fallback is explicit and marked as not-offline', () => {
    const p = resolveOcrAssetPaths('assets/vendor/tesseract/', false);
    expect(p.workerPath).toMatch(/^https:\/\/cdn\./);
  });

  it('trailing slash in the base does not double up', () => {
    expect(resolveOcrAssetPaths('a/b//', true).workerPath).toBe('a/b/tesseract-worker.min.js');
  });

  it('lists the concrete binaries a build step must vendor', () => {
    expect(REQUIRED_OCR_ASSETS).toContain('eng.traineddata.gz');
    expect(REQUIRED_OCR_ASSETS.some(a => /core.*wasm/.test(a))).toBe(true);
    expect(REQUIRED_OCR_ASSETS.some(a => /worker/.test(a))).toBe(true);
  });

  it('missingOcrAssets reports every absent required file', () => {
    const p = resolveOcrAssetPaths('assets/vendor/tesseract/', true);
    const missing = missingOcrAssets(p, () => false);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every(m => !/^https?:/i.test(m))).toBe(true);
    expect(missingOcrAssets(p, () => true)).toEqual([]);
  });
});

describe('app OCR bundle (D1)', () => {
  it('resolves inside the app base: /ocr/ in dev, /app/ocr/ in the release artifact', () => {
    expect(appOcrAssetBase('/')).toBe('/ocr/');
    expect(appOcrAssetBase('/app/')).toBe('/app/ocr/');
    expect(appOcrWorkerOptions({ baseUrl: '/app/' })).toEqual({
      workerPath: '/app/ocr/tesseract-worker.min.js',
      corePath: '/app/ocr/core',
      langPath: '/app/ocr/langdata',
    });
  });

  it('never resolves a CDN in a browser, whatever the base', () => {
    for (const base of ['/', '/app/', '/app']) {
      for (const v of Object.values(appOcrWorkerOptions({ baseUrl: base }))) {
        expect(v).not.toMatch(/^https?:/i);
        expect(v).not.toMatch(/jsdelivr/i);
      }
    }
  });

  // Under Node the worker script is spawned from the package and getCore() requires the core out of
  // node_modules, so only the language model can (and must) be named — as a directory on disk.
  it('hands the Node harness a local language directory and no unusable URLs', () => {
    expect(appOcrWorkerOptions({ isBrowser: false })).toEqual({ langPath: 'public/ocr/langdata' });
  });

  // D1's defect was an option object with no paths in it, so tesseract.js silently used jsdelivr.
  // Every entry point must hand over the resolved trio; this reads the source because the real
  // call sites need a browser (canvas + WASM) and scripts/offline-ocr-check.mjs drives those.
  it('passes the same-origin bundle at every tesseract entry point in ocrService', () => {
    const src = readFileSync(resolve(ROOT, 'services/ocrService.ts'), 'utf8');
    const calls = [...src.matchAll(/Tesseract\.(recognize|createWorker)\(/g)];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) {
      const snippet = src.slice(call.index, call.index + 220);
      expect(snippet, `Tesseract.${call[1]} at ${call.index} passes no asset paths`).toContain('ocrOpts');
    }
  });
});
