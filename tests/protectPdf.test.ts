import { describe, it, expect, vi, beforeEach } from 'vitest';
import { protectPdf } from '../services/pdfService';

global.fetch = vi.fn();

describe('protectPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should delegate encryption to worker and return encrypted blob', async () => {
    const mockFile = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });
    const mockEncryptedBase64 = btoa('encrypted_mock_data');

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ encryptedBytesBase64: mockEncryptedBase64 }),
    });

    const result = await protectPdf(mockFile, 'securepassword123');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/encrypt'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe('application/pdf');
  });

  it('should throw error if worker encryption fails', async () => {
    const mockFile = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });

    (global.fetch as any).mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: 'Encryption module failed' }),
    });

    await expect(protectPdf(mockFile, 'password')).rejects.toThrow('Encryption failed: Encryption module failed');
  });
});