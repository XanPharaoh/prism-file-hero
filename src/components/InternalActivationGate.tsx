import { useEffect, useState, type ReactNode } from 'react';
import {
  activateInternalDevice,
  clearInternalDeviceActivation,
  getInternalDeviceActivation,
  type InternalDeviceActivation,
} from '../../services/internalDeviceAuth';

export default function InternalActivationGate({ children }: { children: ReactNode }) {
  const [activation, setActivation] = useState<InternalDeviceActivation | null | undefined>(undefined);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { void getInternalDeviceActivation().then(setActivation).catch(() => setActivation(null)); }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      setActivation(await activateInternalDevice(activationCode, deviceLabel.trim()));
      setActivationCode('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  }

  if (activation === undefined) return <div className="min-h-screen grid place-items-center text-slate-600">Checking device activation…</div>;
  if (activation) {
    return <>
      <div className="fixed bottom-3 left-3 z-[300] rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 shadow-sm" title={`Expires ${new Date(activation.expiresAt).toLocaleString()}`}>
        Activated: {activation.deviceLabel}
        <button className="ml-3 text-emerald-700 underline" onClick={() => void clearInternalDeviceActivation().then(() => setActivation(null))}>Deactivate</button>
      </div>
      {children}
    </>;
  }
  return <main className="min-h-screen grid place-items-center bg-slate-50 p-6">
    <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
      <h1 className="text-xl font-bold text-slate-900">Activate this desktop device</h1>
      <p className="mt-2 text-sm text-slate-600">Enter the internal activation code to enable AI processing. No account sign-in is required.</p>
      <label className="mt-6 block text-sm font-semibold text-slate-700">Device label
        <input required maxLength={80} value={deviceLabel} onChange={e => setDeviceLabel(e.target.value)} placeholder="e.g. Finance laptop" className="mt-1 w-full rounded-lg border border-slate-300 p-3" />
      </label>
      <label className="mt-4 block text-sm font-semibold text-slate-700">Activation code
        <input required maxLength={512} type="password" autoComplete="off" value={activationCode} onChange={e => setActivationCode(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3" />
      </label>
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <button disabled={submitting} className="mt-6 w-full rounded-lg bg-brand-600 p-3 font-semibold text-white disabled:opacity-60">{submitting ? 'Activating…' : 'Activate device'}</button>
    </form>
  </main>;
}
