import { hexToUint8Array, uint8ArrayToBase64, base64ToUint8Array } from './utils';

function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

/**
 * Encrypt a plaintext API key using AES-256-GCM.
 * Returns base64-encoded IV + ciphertext.
 */
export async function encryptByokKey(plaintext: string, secretHex: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    toBufferSource(hexToUint8Array(secretHex)),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBufferSource(iv) },
    key,
    new TextEncoder().encode(plaintext)
  );
  // Prepend IV to ciphertext for storage: [iv (12)] + [ciphertext]
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return uint8ArrayToBase64(combined);
}

/**
 * Decrypt a base64-encoded IV + ciphertext using AES-256-GCM.
 * Returns the original plaintext string.
 */
export async function decryptByokKey(encryptedBase64: string, secretHex: string): Promise<string> {
  const data = base64ToUint8Array(encryptedBase64);
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);

  const key = await crypto.subtle.importKey(
    'raw',
    toBufferSource(hexToUint8Array(secretHex)),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBufferSource(iv) },
    key,
    toBufferSource(ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Fallback PDF Encryption using Web Crypto API (AES-256-GCM).
 * Encrypts the entire PDF file content with a password-derived key.
 * 
 * Format: [salt (16)] + [iv (12)] + [ciphertext]
 * 
 * NOTE: This produces a custom encrypted file, NOT a standard PDF password-protected file.
 * Standard PDF readers cannot open this without a custom decryption step.
 * For standard PDF compatibility, a WASM library like qpdf-wasm is required.
 */
export async function encryptPdfBytes(pdfBytes: Uint8Array, password: string): Promise<Uint8Array> {
  const enc = new TextEncoder();

  // Derive a key from the password using PBKDF2
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toBufferSource(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBufferSource(iv) },
    derivedKey,
    toBufferSource(pdfBytes)
  );

  // Format: [salt (16)] + [iv (12)] + [ciphertext]
  const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  result.set(salt, 0);
  result.set(iv, salt.length);
  result.set(new Uint8Array(encrypted), salt.length + iv.length);

  return result;
}