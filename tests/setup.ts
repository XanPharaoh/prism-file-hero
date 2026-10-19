import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Polyfill Promise.withResolvers for older Node / environments (required by pdfjs-dist)
if (typeof (Promise as any).withResolvers !== 'function') {
  (Promise as any).withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Polyfill File.arrayBuffer for jsdom (not natively supported in older jsdom)
if (!File.prototype.arrayBuffer) {
    File.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(this);
        });
    };
}

// Polyfill Blob.arrayBuffer for jsdom
if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(this);
        });
    };
}

const TINY_JPEG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/Iaf/xAAVEQEBAAAAAAAAAAAAAAAAAAAAEf/aAAgBAwEBPxCP/8QAFREBAQAAAAAAAAAAAAAAAAAAABH/2gAIAQIBAT8Qj//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z';
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLk7wAAAABJRU5ErkJggg==';

class DOMMatrixMock {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  m11 = 1; m12 = 0; m13 = 0; m14 = 0;
  m21 = 0; m22 = 1; m23 = 0; m24 = 0;
  m31 = 0; m32 = 0; m33 = 1; m34 = 0;
  m41 = 0; m42 = 0; m43 = 0; m44 = 1;
  is2D = true;
  isIdentity = true;
  constructor(init?: any) {
    if (Array.isArray(init) && init.length >= 6) {
      this.a = init[0]; this.b = init[1]; this.c = init[2];
      this.d = init[3]; this.e = init[4]; this.f = init[5];
    }
  }
  invertSelf() { return this; }
  multiplySelf() { return this; }
  preMultiplySelf() { return this; }
  translateSelf() { return this; }
  scaleSelf() { return this; }
  rotateSelf() { return this; }
  transformPoint(p?: any) { return p || { x: 0, y: 0, z: 0, w: 1 }; }
}

if (typeof (globalThis as any).DOMMatrix === 'undefined') {
  (globalThis as any).DOMMatrix = DOMMatrixMock;
}

// Real canvas backing via @napi-rs/canvas for pdf rendering and image generation
import { createCanvas as createNapiCanvas } from '@napi-rs/canvas';

HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...args: any[]) {
  if (contextId === '2d') {
    const w = Math.max(1, Math.round(this.width || 300));
    const h = Math.max(1, Math.round(this.height || 150));
    if (!(this as any)._napiCanvas || (this as any)._napiCanvas.width !== w || (this as any)._napiCanvas.height !== h) {
      (this as any)._napiCanvas = createNapiCanvas(w, h);
    }
    const ctx = (this as any)._napiCanvas.getContext('2d');
    (ctx as any).canvas = this;
    return ctx;
  }
  return null as any;
};

HTMLCanvasElement.prototype.toDataURL = function (this: HTMLCanvasElement, type?: string, quality?: any) {
  const w = Math.max(1, Math.round(this.width || 300));
  const h = Math.max(1, Math.round(this.height || 150));
  const canvas = (this as any)._napiCanvas || createNapiCanvas(w, h);
  const mimeType = type && (type.includes('jpeg') || type.includes('jpg')) ? 'image/jpeg' : 'image/png';
  const q = typeof quality === 'number' ? Math.round(quality * 100) : 92;
  const buf = canvas.toBuffer(mimeType as any, q);
  return `data:${mimeType};base64,${buf.toString('base64')}`;
};

// Mock URL.createObjectURL
URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
URL.revokeObjectURL = vi.fn();

/**
 * createImageBitmap backed by the same native decoder the canvas shim uses.
 *
 * Without it, any service that feature-detects `createImageBitmap` takes its "this runtime has no
 * image codec" branch during tests, and a re-encoding path can pass while never actually re-encoding
 * anything. The returned object is a real @napi-rs/canvas image, so `ctx.drawImage` accepts it.
 */
if (typeof (globalThis as any).createImageBitmap === 'undefined') {
  (globalThis as any).createImageBitmap = async (blob: Blob) => {
    const { loadImage } = await import('@napi-rs/canvas');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const img = await loadImage(bytes);
    if (!(img as any).close) (img as any).close = () => {};
    return img;
  };
}

// Silence jsdom navigation noise in tests
HTMLAnchorElement.prototype.click = vi.fn();

// Test assertion helpers
export const testAssertions = {
  assertValidParsedAmount: (result: any) => {
    if (result.value !== null) {
      if (typeof result.value !== 'number' || !Number.isFinite(result.value)) {
        throw new Error(`Invalid parsed amount value: ${result.value}`);
      }
    }
  },
  assertValidParsedDate: (result: any) => {
    if (result.date !== null) {
      if (!(result.date instanceof Date) || !Number.isFinite(result.date.getTime())) {
        throw new Error(`Invalid parsed date: ${result.date}`);
      }
    }
  },
  assertValidBankDetection: (result: any) => {
    if (!result || typeof result !== 'object') {
      throw new Error(`Invalid bank detection result`);
    }
    if (!result.bankCode || typeof result.bankCode !== 'string') {
      throw new Error(`Invalid bankCode: ${result.bankCode}`);
    }
  },
  assertValidTransaction: (transaction: any) => {
    if (!transaction || typeof transaction !== 'object') {
      throw new Error(`Invalid transaction object`);
    }
    if (!transaction.date || typeof transaction.date !== 'string') {
      throw new Error(`Invalid transaction date: ${transaction.date}`);
    }
    if (typeof transaction.amount !== 'number' || !Number.isFinite(transaction.amount)) {
      throw new Error(`Invalid transaction amount: ${transaction.amount}`);
    }
  },
};

// Test data generator
export const testDataGenerator = {
  generateCanonicalTransaction: () => ({
    date: '2024-01-06',
    description: 'Test transaction',
    amount: 100,
    balance: 1000,
    direction: 'DEBIT' as const,
    bankCode: 'FNB_SA',
    confidence: 95,
  }),
};

// Provide a tiny shim for XLSX.utils.aoa_to_sheet in test environment
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const XLSX = require('xlsx');
  if (XLSX && XLSX.utils && !XLSX.utils.aoa_to_sheet) {
    XLSX.utils.aoa_to_sheet = function (aoa: any[][]) {
      const ws: any = {};
      const rows = aoa || [];
      const cols = rows.length > 0 ? (rows[0] || []).length : 0;
      // simple cell writer
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r] || [];
        for (let c = 0; c < row.length; c++) {
          const val = row[c];
          const cellRef = (function (R: number, C: number) {
            // Convert 0-based col to letters
            let col = '';
            let n = C + 1;
            while (n > 0) {
              const rem = (n - 1) % 26;
              col = String.fromCharCode(65 + rem) + col;
              n = Math.floor((n - 1) / 26);
            }
            return col + String(R + 1);
          })(r, c);
          ws[cellRef] = { v: val };
        }
      }
      if (rows.length && cols) {
        ws['!ref'] = `A1:${(function () { // compute end cell
          const lastColIndex = cols - 1;
          let col = '';
          let n = lastColIndex + 1;
          while (n > 0) {
            const rem = (n - 1) % 26;
            col = String.fromCharCode(65 + rem) + col;
            n = Math.floor((n - 1) / 26);
          }
          return col + String(rows.length);
        })()}`;
      }
      return ws;
    };
  }
} catch (e) {
  // ignore if xlsx not installed in test env
}
