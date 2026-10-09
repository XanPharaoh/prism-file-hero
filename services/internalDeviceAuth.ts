import { isInternalDesktopDistribution } from '../src/config/distribution';
import { WORKER_BASE_URL } from './apiConfig';

const STORAGE_KEY = 'prism.internal-device-auth';

export interface InternalDeviceActivation {
  token: string;
  deviceLabel: string;
  expiresAt: string;
}

function loadActivation(): InternalDeviceActivation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InternalDeviceActivation;
    if (!parsed.token || !parsed.deviceLabel || Date.parse(parsed.expiresAt) <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getInternalDeviceActivation(): Promise<InternalDeviceActivation | null> {
  if (!isInternalDesktopDistribution) return null;
  return loadActivation();
}

export async function activateInternalDevice(activationCode: string, deviceLabel: string): Promise<InternalDeviceActivation> {
  if (!isInternalDesktopDistribution) throw new Error('Internal activation is unavailable in the public distribution.');
  const response = await fetch(`${WORKER_BASE_URL}/api/internal/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activationCode: activationCode.trim(), deviceLabel }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error('[activate] HTTP', response.status, body);
    throw new Error(`Activation failed (HTTP ${response.status}). Check the code and try again later.`);
  }
  const activation = await response.json() as InternalDeviceActivation;
  if (!activation.token || !activation.deviceLabel || !activation.expiresAt) throw new Error('Activation failed: invalid server response.');
  // Persist via localStorage — works in both Tauri and browser, no fs-scope issues.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(activation));
  return activation;
}

export async function clearInternalDeviceActivation(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY);
}

export async function getInternalAiHeaders(): Promise<Record<string, string>> {
  const activation = await getInternalDeviceActivation();
  if (!activation) throw new Error('This desktop app is not activated.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${activation.token}` };
}
