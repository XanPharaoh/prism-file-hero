import React, { FormEvent, useState } from 'react';

const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xljrdzgj';

type SubmissionState = 'idle' | 'sending' | 'submitted' | 'error';

/** Internal desktop support channel. It is deliberately not rendered publicly. */
export default function BugReportForm() {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<SubmissionState>('idle');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState('sending');
    try {
      const response = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, message, source: 'Prism File Hero internal desktop' }),
      });
      if (!response.ok) throw new Error('Formspree rejected the report');
      setMessage('');
      setEmail('');
      setState('submitted');
    } catch {
      setState('error');
    }
  };

  return (
    <section className="mt-8 max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="bug-report-title">
      <h2 id="bug-report-title" className="text-sm font-black text-slate-800">Report an internal desktop issue</h2>
      <p className="mt-1 text-xs leading-5 text-slate-500">This sends your message, and the optional email address, to Prism File Hero through Formspree. Do not include document contents, passwords, or other sensitive data.</p>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <label className="block text-xs font-bold text-slate-600">Email (optional)<input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" type="email" value={email} onChange={event => setEmail(event.target.value)} disabled={state === 'sending'} /></label>
        <label className="block text-xs font-bold text-slate-600">What happened?<textarea className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" required value={message} onChange={event => setMessage(event.target.value)} disabled={state === 'sending'} /></label>
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-60" disabled={state === 'sending'} type="submit">{state === 'sending' ? 'Sending…' : 'Send report'}</button>
        {state === 'submitted' && <p className="text-xs font-semibold text-emerald-700" role="status">Report submitted. Thank you.</p>}
        {state === 'error' && <p className="text-xs font-semibold text-red-700" role="alert">The report could not be sent. Please try again.</p>}
      </form>
    </section>
  );
}
