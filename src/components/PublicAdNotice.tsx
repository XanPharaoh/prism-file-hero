import React, { useEffect, useState } from 'react';

const DISMISSED_KEY = 'pfh_adblock_notice_dismissed';

/** Public-only placeholder; no advertising network or publisher identifier is loaded. */
export default function PublicAdNotice({ isPremium }: { isPremium: boolean }) {
  const [adBlocked, setAdBlocked] = useState(false);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISSED_KEY) === '1');

  useEffect(() => {
    if (isPremium) return;
    const bait = document.createElement('div');
    bait.className = 'adsbox ad-banner ad-container';
    bait.setAttribute('aria-hidden', 'true');
    bait.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;';
    document.body.appendChild(bait);
    const timer = window.setTimeout(() => {
      const style = window.getComputedStyle(bait);
      setAdBlocked(bait.offsetHeight === 0 || style.display === 'none' || style.visibility === 'hidden');
      bait.remove();
    }, 100);
    return () => { window.clearTimeout(timer); bait.remove(); };
  }, [isPremium]);

  if (isPremium) return null;
  return <div className="mt-8 space-y-3">
    <aside className="rounded-xl border border-dashed border-slate-300 bg-slate-100 px-4 py-3 text-center text-xs text-slate-500" aria-label="Advertisement placeholder">Advertisement</aside>
    {adBlocked && !dismissed && <aside className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800" role="status"><span>An ad blocker appears to be active. This site can continue to be used.</span><button className="font-bold underline" onClick={() => { sessionStorage.setItem(DISMISSED_KEY, '1'); setDismissed(true); }}>Dismiss</button></aside>}
  </div>;
}
