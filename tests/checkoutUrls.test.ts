/**
 * R7/R8 — the buyer's return target and the paid-through window source.
 * checkoutTargets must never fall back to the Worker's own origin (that served a JSON 404 to a
 * returning browser) and coverageWindow must read the date PayPal itself declares, not invent one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkoutTargets } from '../worker/src/billing/urls';
import { coverageWindow } from '../worker/src/billing/paypalApi';

const ENV = { PAYPAL_CLIENT_ID: 'cid', PAYPAL_SECRET: 'sec', PAYPAL_ENV: 'sandbox' };

afterEach(() => vi.unstubAllGlobals());

describe('checkout return targets', () => {
  it('builds both targets under an explicit frontend origin', () => {
    expect(checkoutTargets('https://prism.app')).toEqual({
      returnUrl: 'https://prism.app/app?checkout=success',
      cancelUrl: 'https://prism.app/app?checkout=cancelled',
    });
  });

  it('keeps a base path and a trailing slash without doubling it', () => {
    expect(checkoutTargets('http://127.0.0.1:5173/')!.returnUrl).toBe('http://127.0.0.1:5173/app?checkout=success');
    expect(checkoutTargets('https://cdn.example.com/app/')!.returnUrl).toBe('https://cdn.example.com/app/app?checkout=success');
  });

  it('refuses to construct a target when the frontend is not configured', () => {
    expect(checkoutTargets(undefined)).toBeNull();
    expect(checkoutTargets('')).toBeNull();
    expect(checkoutTargets('   ')).toBeNull();
  });

  it('refuses non-http(s) schemes and garbage (no worker-origin fallback)', () => {
    expect(checkoutTargets('ftp://prism.app')).toBeNull();
    expect(checkoutTargets('not a url')).toBeNull();
  });
});

describe('paid-through window from PayPal', () => {
  function stubSubscription(billingInfo: unknown) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tk' }), { status: 200 });
      return new Response(JSON.stringify({ id: 'I-SUB1', start_time: '2026-10-01T00:00:00Z', billing_info: billingInfo }), { status: 200 });
    }) as any);
  }

  it('uses next_billing_time as the paid-through date and the last payment as the start', async () => {
    stubSubscription({ next_billing_time: '2026-11-12T10:00:00Z', last_payment: { time: '2026-10-12T13:23:06Z' } });
    expect(await coverageWindow(ENV, 'I-SUB1')).toEqual({ start: '2026-10-12T13:23:06Z', end: '2026-11-12T10:00:00Z' });
  });

  it('falls back to the subscription start when no payment is reported', async () => {
    stubSubscription({ next_billing_time: '2026-11-12T10:00:00Z' });
    expect(await coverageWindow(ENV, 'I-SUB1')).toEqual({ start: '2026-10-01T00:00:00Z', end: '2026-11-12T10:00:00Z' });
  });

  it('returns no end date instead of inventing one when PayPal reports none', async () => {
    stubSubscription({});
    expect(await coverageWindow(ENV, 'I-SUB1')).toEqual({ start: '2026-10-01T00:00:00Z', end: null });
  });

  it('returns nulls when the subscription read fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tk' }), { status: 200 });
      return new Response(JSON.stringify({ name: 'RESOURCE_NOT_FOUND' }), { status: 404 });
    }) as any);
    expect(await coverageWindow(ENV, 'I-SUB1')).toEqual({ start: null, end: null });
  });
});
