import { describe, expect, it, vi } from 'vitest';
import { isInternalDesktopDistribution } from '../src/config/distribution';
import { processWithAI } from '../services/geminiService';
import { getAuthToken } from '../services/authService';
import { getInternalAiHeaders } from '../services/internalDeviceAuth';

vi.mock('../services/authService', () => ({ getAuthToken: vi.fn() }));

describe('internal AI authorization', () => {
  const internalOnly = isInternalDesktopDistribution ? it : it.skip;

  internalOnly('uses a device token instead of a Clerk token for an internal worker AI request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"rows": []}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    localStorage.setItem('prism.internal-device-auth', JSON.stringify({ token: 'pfd_test-token', deviceLabel: 'QA laptop', expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    await processWithAI('pdf-to-excel', [{ base64: 'image-data', pageNumber: 1 }]);

    expect(getAuthToken).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer pfd_test-token');
    localStorage.removeItem('prism.internal-device-auth');
    vi.unstubAllGlobals();
  });

  internalOnly('returns a device bearer header from desktop activation storage', async () => {
    localStorage.setItem('prism.internal-device-auth', JSON.stringify({ token: 'pfd_stored-token', deviceLabel: 'Accounts', expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    await expect(getInternalAiHeaders()).resolves.toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer pfd_stored-token' });
    localStorage.removeItem('prism.internal-device-auth');
  });
});
