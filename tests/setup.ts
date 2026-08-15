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

// Mock canvas for pdf rendering tests
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({
        data: new Uint8ClampedArray(4),
    }),
    putImageData: vi.fn(),
    canvas: { toDataURL: vi.fn().mockReturnValue('data:image/png;base64,mock') },
});

HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,/9j/mock');

// Mock URL.createObjectURL
URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
URL.revokeObjectURL = vi.fn();

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
