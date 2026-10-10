/**
 * Batch 07 — OCR offline asset manifest.
 *
 * tesseract.js ships as three parts. Only the JS glue (tesseract.min.js) is currently
 * vendored; at runtime it fetches the WASM CORE and the LANGUAGE MODEL (eng.traineddata)
 * from jsdelivr. That makes OCR run LOCALLY (document pixels never leave the device) but
 * NOT OFFLINE (first run needs the CDN). To make the "offline" claim true, every file
 * below must be vendored under the site/app assets and the loader must resolve to same-origin
 * paths instead of a CDN.
 *
 * This module is the single, testable contract for those paths + the exact required files, so
 * the staging/build step that downloads them is concrete and CI can assert the resolver.
 */

export type OcrScriptLang = 'eng' | 'afr' | 'nld' | 'deu' | 'fra' | 'spa';

export interface OcrAssetPaths {
  workerPath: string;   // tesseract worker bundle
  corePath: string;      // wasm core (single + threaded/simd variants live under it)
  langPath: string;      // directory containing <lang>.traineddata.gz
  traineddataUrl: (lang: OcrScriptLang) => string;
}

export const CDN_BASE = 'https://cdn.jsdelivr.net/npm';

/** Files that MUST be vendored for true offline OCR. A build step downloads these. */
export const REQUIRED_OCR_ASSETS = [
  'tesseract-worker.min.js',                       // worker (matches tesseract.js version)
  'tesseract-core-simd.wasm.js',                   // core: SIMD variant
  'tesseract-core.wasm.js',                        // core: baseline variant
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'eng.traineddata.gz',                            // language model
  'eng.traineddata.gz.verified.js',                // integrity sidecar (if used)
] as const;

/**
 * Resolve same-origin asset paths from a local base directory (e.g. "assets/vendor/tesseract/").
 * When `offline` is true the loader MUST use these; a fetch of any path returning 404 means the
 * asset was not vendored and the run should fail loudly rather than silently hit the CDN.
 */
export function resolveOcrAssetPaths(localBase: string, offline = true): OcrAssetPaths {
  const base = localBase.replace(/\/+$/, '') + '/';
  if (!offline) {
    return {
      workerPath: `${CDN_BASE}/tesseract.js/dist/worker.min.js`,
      corePath: `${CDN_BASE}/tesseract.js-core`,
      langPath: `${CDN_BASE}/tesseract.js-traineddata/langs`,
      traineddataUrl: (lang) => `${CDN_BASE}/tesseract.js-traineddata/langs/${lang}.traineddata.gz`,
    };
  }
  return {
    workerPath: `${base}tesseract-worker.min.js`,
    corePath: `${base}core`,
    langPath: `${base}langdata`,
    traineddataUrl: (lang: OcrScriptLang) => `${base}langdata/${lang}.traineddata.gz`,
  };
}

/** True only when every required file is present at the resolved base (build/CI assertion). */
export function missingOcrAssets(resolved: OcrAssetPaths, present: (url: string) => boolean): string[] {
  const candidates = [resolved.workerPath, `${resolved.corePath}/tesseract-core-simd.wasm.js`, resolved.traineddataUrl('eng')];
  return candidates.filter((u) => !present(u));
}
