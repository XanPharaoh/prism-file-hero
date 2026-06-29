import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Web Crypto API for testing environment
const mockEncrypt = vi.fn().mockResolvedValue(new ArrayBuffer(32));
const mockDecrypt = vi.fn().mockResolvedValue(new TextEncoder().encode('decrypted_key'));
const mockImportKey = vi.fn().mockResolvedValue({});
const mockDeriveKey = vi.fn().mockResolvedValue({});

Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      importKey: mockImportKey,
      encrypt: mockEncrypt,
      decrypt: mockDecrypt,
      deriveKey: mockDeriveKey,
    },
    getRandomValues: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      return arr;
    },
  },
  writable: true,
});

describe('encryption helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should encrypt and return base64 string with IV prepended', async () => {
    const { encryptByokKey } = await import('../worker/src/encryption');

    const result = await encryptByokKey(
      'test_api_key',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    );

    expect(mockImportKey).toHaveBeenCalled();
    expect(mockEncrypt).toHaveBeenCalled();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should decrypt base64 string and return plaintext', async () => {
    const { decryptByokKey } = await import('../worker/src/encryption');

    const result = await decryptByokKey(
      'dGVzdA==',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    );

    expect(mockImportKey).toHaveBeenCalled();
    expect(mockDecrypt).toHaveBeenCalled();
    expect(result).toBe('decrypted_key');
  });

  it('should encryptPdfBytes with PBKDF2 + AES-256-GCM', async () => {
    const { encryptPdfBytes } = await import('../worker/src/encryption');

    mockDeriveKey.mockResolvedValue({});
    mockEncrypt.mockResolvedValue(new ArrayBuffer(64));

    const result = await encryptPdfBytes(
      new Uint8Array([1, 2, 3, 4, 5]),
      'test_password'
    );

    expect(mockImportKey).toHaveBeenCalledWith(
      'raw',
      expect.any(Object),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );
    expect(mockDeriveKey).toHaveBeenCalled();
    expect(mockEncrypt).toHaveBeenCalled();
    // Should have salt (16) + iv (12) + ciphertext
    expect(result.length).toBe(16 + 12 + 64);
  });
});

describe('worker utils', () => {
  it('uint8ArrayToBase64 should convert correctly', async () => {
    const { uint8ArrayToBase64 } = await import('../worker/src/utils');
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    expect(uint8ArrayToBase64(bytes)).toBe('SGVsbG8=');
  });

  it('base64ToUint8Array should convert correctly', async () => {
    const { base64ToUint8Array } = await import('../worker/src/utils');
    const bytes = base64ToUint8Array('SGVsbG8=');
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
  });

  it('hexToUint8Array should convert correctly', async () => {
    const { hexToUint8Array } = await import('../worker/src/utils');
    const bytes = hexToUint8Array('0a1b2c');
    expect(Array.from(bytes)).toEqual([10, 27, 44]);
  });

  it('uint8ArrayToHex should convert correctly', async () => {
    const { uint8ArrayToHex } = await import('../worker/src/utils');
    const hex = uint8ArrayToHex(new Uint8Array([10, 27, 44]));
    expect(hex).toBe('0a1b2c');
  });

  it('should round-trip base64 conversions', async () => {
    const { uint8ArrayToBase64, base64ToUint8Array } = await import('../worker/src/utils');
    const original = new Uint8Array([255, 254, 253, 1, 2, 3]);
    const base64 = uint8ArrayToBase64(original);
    const restored = base64ToUint8Array(base64);
    expect(Array.from(original)).toEqual(Array.from(restored));
  });
});