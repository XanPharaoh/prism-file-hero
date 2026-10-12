/**
 * R7 — billingService client contract (PayPal). Proves the browser sends ONLY plan+cycle (never
 * userId/customer_id/paypal plan id) and that subscribe/entitlement/cancel/reconcile map correctly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/authService', () => ({ getAuthToken: vi.fn(async () => 'test-jwt') }));
import { startPayPalSubscribe, fetchEntitlement, cancelSubscription, reconcile } from '../services/billingService';

let calls: { url: string; init: RequestInit }[] = [];
function stubFetch(payloadFactory: (url: string) => unknown) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(payloadFactory(url)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as any);
}
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('billingService PayPal contract (browser is never entitlement authority)', () => {
  it('startPayPalSubscribe sends ONLY {plan, cycle} with the token', async () => {
    stubFetch(() => ({ status: 'pending', plan: 'pro', subscriptionId: 'I-123', approveUrl: 'https://sandbox.paypal.com/sc/xxx' }));
    const res = await startPayPalSubscribe('pro', 'monthly');
    expect(calls[0].url).toMatch(/\/api\/billing\/paypal\/subscribe$/);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ plan: 'pro', cycle: 'monthly' }); // NO userId/plan id
    expect((calls[0].init.headers as any).Authorization).toBe('Bearer test-jwt');
    expect(res.status).toBe('pending');
    expect(res.approveUrl).toContain('paypal.com');
  });

  it('surfaces configured:false (no PayPal creds) without granting anything', async () => {
    stubFetch(() => ({ error: 'no creds', configured: false }));
    const res = await startPayPalSubscribe('business', 'annual');
    expect(res.configured).toBe(false);
    expect(res.subscriptionId).toBeUndefined();
  });

  it('fetchEntitlement reads the SERVER plan (GET)', async () => {
    stubFetch((u) => (u.includes('entitlement') ? { entitled: true, plan: 'pro', subscription_status: 'active', source: 'server' } : {}));
    const e = await fetchEntitlement();
    expect(calls[0].url).toMatch(/\/api\/billing\/entitlement$/);
    expect(calls[0].init.method).toBe('GET');
    expect(e).toMatchObject({ entitled: true, plan: 'pro', subscription_status: 'active' });
  });

  it('cancelSubscription posts the caller’s own subscription id', async () => {
    stubFetch(() => ({ status: 'canceled' }));
    const r = await cancelSubscription('I-abc');
    expect(calls[0].url).toMatch(/\/api\/billing\/paypal\/cancel$/);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ subscriptionId: 'I-abc' });
    expect(r.status).toBe('canceled');
  });

  it('reconcile asks the server to pull authoritative PayPal state', async () => {
    stubFetch(() => ({ reconciled: [{ subscriptionId: 'I-abc', status: 'ACTIVE' }] }));
    const r = await reconcile();
    expect(calls[0].url).toMatch(/\/api\/billing\/paypal\/reconcile$/);
    expect(r.ok).toBe(true);
    expect(r.reconciled).toHaveLength(1);
  });
});
