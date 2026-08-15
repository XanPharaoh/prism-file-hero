export interface DeviceTokenRecord {
  deviceId: string;
  label: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt?: string;
  revokeReason?: 'operator';
  createdAt: string;
}

export interface DeviceRegistryEntry {
  deviceId: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

interface DeviceRegistry { entries: DeviceRegistryEntry[]; updatedAt: string; }

export interface InternalDeviceEnv { KV: KVNamespace; }

const TOKEN_PREFIX = 'pfd';
const REGISTRY_KEY = 'internal-device-registry:v1';
const encoder = new TextEncoder();
const AUDIT_RETENTION_MS = 180 * 86_400_000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function randomBase64Url(bytes: number): string {
  const random = new Uint8Array(bytes);
  crypto.getRandomValues(random);
  return bytesToBase64Url(random);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

export function deviceTokenKey(deviceId: string): string { return `internal-device:${deviceId}`; }
export function deviceRegistryKey(): string { return REGISTRY_KEY; }

function validRegistry(value: unknown): value is DeviceRegistry {
  return Boolean(value) && typeof value === 'object' && Array.isArray((value as DeviceRegistry).entries);
}

async function readRegistry(env: InternalDeviceEnv): Promise<DeviceRegistry> {
  const value = await env.KV.get(REGISTRY_KEY, 'json');
  return validRegistry(value) ? value : { entries: [], updatedAt: new Date(0).toISOString() };
}

function isActive(entry: DeviceRegistryEntry, now = Date.now()): boolean {
  const expiry = Date.parse(entry.expiresAt);
  return !entry.revokedAt && Number.isFinite(expiry) && expiry > now;
}

function pruneAudit(entries: DeviceRegistryEntry[], now = Date.now()): DeviceRegistryEntry[] {
  return entries.filter(entry => {
    const expiry = Date.parse(entry.expiresAt);
    return !Number.isFinite(expiry) || expiry >= now - AUDIT_RETENTION_MS;
  });
}

async function writeRegistry(env: InternalDeviceEnv, entries: DeviceRegistryEntry[]): Promise<void> {
  await env.KV.put(REGISTRY_KEY, JSON.stringify({ entries: pruneAudit(entries), updatedAt: new Date().toISOString() }));
}

export function hasMinimumActivationCodeStrength(value: string): boolean {
  if (value.length < 32 || value.length > 256) return false;
  const unique = new Set(value).size;
  const classes = [/[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value)].filter(Boolean).length;
  return unique >= 16 && classes >= 3;
}

export async function issueDeviceToken(env: InternalDeviceEnv, label: string, ttlDays: number, maxActiveDevices: number): Promise<{ token: string; record: DeviceTokenRecord } | null> {
  const registry = await readRegistry(env);
  if (registry.entries.filter(entry => isActive(entry)).length >= maxActiveDevices) return null;
  const deviceId = randomBase64Url(18);
  const secret = randomBase64Url(32);
  const token = `${TOKEN_PREFIX}_${deviceId}_${secret}`;
  const now = new Date();
  const record: DeviceTokenRecord = {
    deviceId, label, tokenHash: await sha256Base64Url(token), createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlDays * 86_400_000).toISOString(),
  };
  // Keep records after expiry for a bounded audit period; verification always enforces expiry.
  await env.KV.put(deviceTokenKey(deviceId), JSON.stringify(record), {
    expirationTtl: Math.ceil(ttlDays * 86_400 + AUDIT_RETENTION_MS / 1_000),
  });
  try {
    await writeRegistry(env, [...registry.entries, { deviceId, label, createdAt: record.createdAt, expiresAt: record.expiresAt }]);
  } catch (error) {
    await env.KV.delete(deviceTokenKey(deviceId));
    throw error;
  }
  return { token, record };
}

export async function revokeDeviceToken(env: InternalDeviceEnv, deviceId: string): Promise<boolean> {
  const raw = await env.KV.get(deviceTokenKey(deviceId));
  if (!raw) return false;
  try {
    const record = JSON.parse(raw) as DeviceTokenRecord;
    if (record.deviceId !== deviceId) return false;
    const revokedAt = record.revokedAt ?? new Date().toISOString();
    await env.KV.put(deviceTokenKey(deviceId), JSON.stringify({ ...record, revokedAt, revokeReason: 'operator' }));
    const registry = await readRegistry(env);
    await writeRegistry(env, registry.entries.map(entry => entry.deviceId === deviceId ? { ...entry, revokedAt } : entry));
    return true;
  } catch { return false; }
}

export async function verifyDeviceToken(env: InternalDeviceEnv, token: string): Promise<DeviceTokenRecord | null> {
  const match = /^pfd_([A-Za-z0-9_-]{24})_([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  const raw = await env.KV.get(deviceTokenKey(match[1]!));
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as DeviceTokenRecord;
    const expiry = Date.parse(record.expiresAt);
    if (record.deviceId !== match[1] || record.revokedAt || !Number.isFinite(expiry) || expiry <= Date.now()) return null;
    return constantTimeEqual(record.tokenHash, await sha256Base64Url(token)) ? record : null;
  } catch { return null; }
}

export async function activationCodeMatches(provided: string, expected: string): Promise<boolean> {
  if (!hasMinimumActivationCodeStrength(provided) || !hasMinimumActivationCodeStrength(expected)) return false;
  const [providedHash, expectedHash] = await Promise.all([sha256Base64Url(provided), sha256Base64Url(expected)]);
  return constantTimeEqual(providedHash, expectedHash);
}
