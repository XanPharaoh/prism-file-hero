/**
 * R7 (Req 5) — PayPal webhook verification is its documented cert/transmission mechanism via
 * /v1/notifications/verify-webhook-signature — NOT Paddle's HMAC. Covers the credential gate, the
 * SSRF cert-host allowlist, and the SUCCESS / non-SUCCESS verification outcomes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifyWebhook, accessToken, BillingNotConfigured } from '../worker/src/billing/paypalApi';

const ENV = { PAYPAL_CLIENT_ID: 'cid', PAYPAL_SECRET: 'sec', PAYPAL_ENV: 'sandbox', PAYPAL_WEBHOOK_ID: 'WH-1' };
const head = (certUrl: string) => new Headers({
  'paypal-transmission-id': 'tid', 'paypal-transmission-time': '2026', 'paypal-auth-algo': 'SHA256withRSA',
  'paypal-auth-version': 'v1', 'paypal-cert-url': certUrl,
});

afterEach(() => vi.unstubAllGlobals());

describe('PayPal webhook verification', () => {
  it('rejects without credentials (no network)', async () => {
    expect(await verifyWebhook({}, head('https://api.sandbox.paypal.com/x'), '{}')).toBe(false);
  });

  it('rejects a non-PayPal cert_url BEFORE any network call (SSRF guard)', async () => {
    const spy = vi.fn(); vi.stubGlobal('fetch', spy);
    expect(await verifyWebhook(ENV, head('https://evil.example.com/cert'), '{}')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('grants only when PayPal answers verification_status=SUCCESS', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tk' }), { status: 200 });
      if (url.endsWith('/v1/notifications/verify-webhook-signature')) return new Response(JSON.stringify({ verification_status: 'SUCCESS' }), { status: 200 });
      return new Response('{}', { status: 500 });
    }) as any);
    expect(await verifyWebhook(ENV, head('https://api.sandbox.paypal.com/v1/notifications/webhooks/WH-1'), '{"id":"e1"}')).toBe(true);
  });

  it('rejects when verification is not SUCCESS', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tk' }), { status: 200 });
      return new Response(JSON.stringify({ verification_status: 'FAILURE' }), { status: 200 });
    }) as any);
    expect(await verifyWebhook(ENV, head('https://api.sandbox.paypal.com/x'), '{"id":"e1"}')).toBe(false);
  });

  it('accessToken throws BillingNotConfigured without creds', async () => {
    await expect(accessToken({})).rejects.toBeInstanceOf(BillingNotConfigured);
  });
});
