import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { activationCodeMatches, deviceRegistryKey, deviceTokenKey, hasMinimumActivationCodeStrength, issueDeviceToken, revokeDeviceToken, verifyDeviceToken } from '../worker/src/deviceTokens';

class MemoryKv {
  values = new Map<string, string>();
  async put(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async get(key: string, type?: string): Promise<unknown> { const value = this.values.get(key) ?? null; return type === 'json' && value ? JSON.parse(value) : value; }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

describe('internal device tokens', () => {
  beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });

  it('issues an opaque token that validates against its KV record', async () => {
    const KV = new MemoryKv();
    const issued = await issueDeviceToken({ KV: KV as unknown as KVNamespace }, 'Finance laptop', 1, 2);
    expect(issued.token).toMatch(/^pfd_[A-Za-z0-9_-]{24}_[A-Za-z0-9_-]{43}$/);
    await expect(verifyDeviceToken({ KV: KV as unknown as KVNamespace }, issued.token)).resolves.toMatchObject({ deviceId: issued.record.deviceId, label: 'Finance laptop' });
  });

  it('rejects a modified, revoked, or missing token record', async () => {
    const KV = new MemoryKv();
    const issued = await issueDeviceToken({ KV: KV as unknown as KVNamespace }, 'Finance laptop', 1, 2);
    await expect(verifyDeviceToken({ KV: KV as unknown as KVNamespace }, `${issued.token}x`)).resolves.toBeNull();
    const revoked = { ...issued.record, revokedAt: new Date().toISOString() };
    KV.values.set(deviceTokenKey(issued.record.deviceId), JSON.stringify(revoked));
    await expect(verifyDeviceToken({ KV: KV as unknown as KVNamespace }, issued.token)).resolves.toBeNull();
    KV.values.delete(deviceTokenKey(issued.record.deviceId));
    await expect(verifyDeviceToken({ KV: KV as unknown as KVNamespace }, issued.token)).resolves.toBeNull();
  });

  it('enforces the active-device inventory cap and retains revocation audit state', async () => {
    const KV = new MemoryKv();
    const first = await issueDeviceToken({ KV: KV as unknown as KVNamespace }, 'One', 1, 1);
    expect(first).not.toBeNull();
    await expect(issueDeviceToken({ KV: KV as unknown as KVNamespace }, 'Two', 1, 1)).resolves.toBeNull();
    await expect(revokeDeviceToken({ KV: KV as unknown as KVNamespace }, first!.record.deviceId)).resolves.toBe(true);
    expect(JSON.parse(KV.values.get(deviceTokenKey(first!.record.deviceId))!)).toMatchObject({ revokedAt: expect.any(String), revokeReason: 'operator' });
    expect(JSON.parse(KV.values.get(deviceRegistryKey())!).entries[0]).toMatchObject({ deviceId: first!.record.deviceId, revokedAt: expect.any(String) });
  });

  it('requires a high-entropy activation secret before comparing it', async () => {
    const strong = 'aB3!cD4@eF5#gH6$iJ7%kL8^mN9&oP0*qR1!';
    expect(hasMinimumActivationCodeStrength(strong)).toBe(true);
    expect(hasMinimumActivationCodeStrength('short-code')).toBe(false);
    await expect(activationCodeMatches('short-code', 'short-code')).resolves.toBe(false);
    await expect(activationCodeMatches(strong, strong)).resolves.toBe(true);
    const copied = " \n" + strong + "\t ";
    await expect(activationCodeMatches(copied.trim(), strong)).resolves.toBe(true);
  });
});
