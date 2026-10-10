import { describe, it, expect } from 'vitest';
import {
  resolveOcrAssetPaths,
  missingOcrAssets,
  REQUIRED_OCR_ASSETS,
} from '../shared/ocr/assets';

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
