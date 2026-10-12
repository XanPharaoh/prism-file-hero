/**
 * Where PayPal sends the buyer back to. Built ONLY from the explicitly configured FRONTEND_URL —
 * never from the Worker's own origin, which serves /api/* and would answer the return navigation with
 * a JSON 404 (that is exactly what `/app?checkout=success` on the Worker did). The app reads
 * ?checkout= to pick which confirmation message to show; the parameter itself grants nothing, because
 * entitlement always comes from /api/billing/entitlement.
 */
export function checkoutTargets(frontendUrl: string | undefined): { returnUrl: string; cancelUrl: string } | null {
  const raw = (frontendUrl ?? '').trim();
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  return { returnUrl: `${base}/app?checkout=success`, cancelUrl: `${base}/app?checkout=cancelled` };
}
