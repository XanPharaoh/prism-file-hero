/**
 * R3 — billingService client contract. Proves the browser sends ONLY a plan intent (never
 * userId/customer_id/price_id) and that checkout/entitlement/portal map the server responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/authService', () => ({ getAuthToken: vi.fn(async () => 'test-jwt') }));
import { startCheckout, fetchEntitlement, openPortal } from '../services/billingService';

let calls: { url: string; init: RequestInit }[] = [];
function stubFetch(payloadFactory: (url: string) => unknown) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const body = JSON.stringify(payloadFactory(url));
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as any);
}
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('billingService (browser is never entitlement authority)', () => {
  it('startCheckout posts ONLY the plan, with the auth token, and reports pending', async () => {
    stubFetch(() => ({ status: 'pending', plan: 'pro', transactionId: 'txn_1', checkoutUrl: 'https://checkout.paddle.test/x' }));
    const res = await startCheckout('pro');
    const c = calls[0];
    expect(c.url).toMatch(/\/api\/billing\/checkout$/);
    expect(c.init.method).toBe('POST');
    const sent = JSON.parse(String(c.init.body));
    expect(sent).toEqual({ plan: 'pro' });                 // NO userId / customer_id / price_id
    expect((c.init.headers as any).Authorization).toBe('Bearer test-jwt');
    expect(res.status).toBe('pending');
    expect(res.checkoutUrl).toBe('https://checkout.paddle.test/x');
  });

  it('surfaces configured:false (billing disabled) without throwing', async () => {
    stubFetch(() => ({ error: 'no key', configured: false }));
    const res = await startCheckout('business');
    expect(res.configured).toBe(false);
    expect(res.ok).toBe(true); // HTTP 200 in the stub; the flag drives the UI, not a grant
  });

  it('fetchEntitlement reads the SERVER plan (GET, token, mapped)', async () => {
    stubFetch((u) => (u.includes('entitlement') ? { entitled: true, plan: 'pro', subscription_status: 'active', source: 'server' } : {}));
    const e = await fetchEntitlement();
    expect(calls[0].url).toMatch(/\/api\/billing\/entitlement$/);
    expect(calls[0].init.method).toBe('GET');
    expect(e).toEqual({ entitled: true, plan: 'pro', subscription_status: 'active' });
  });

  it('openPortal requests the caller’s own portal session', async () => {
    stubFetch(() => ({ url: 'https://paddle.test/portal/session' }));
    const p = await openPortal();
    expect(calls[0].url).toMatch(/\/api\/billing\/portal$/);
    expect(calls[0].init.method).toBe('POST');
    expect(p.url).toBe('https://paddle.test/portal/session');
  });
});
