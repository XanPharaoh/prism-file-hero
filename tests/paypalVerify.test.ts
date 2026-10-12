/**
 * R7 (Req 5) — PayPal webhook verification is its documented cert/transmission mechanism via
 * /v1/notifications/verify-webhook-signature — NOT Paddle's HMAC. Covers the credential gate, the
 * SSRF cert-host allowlist, the SUCCESS / non-SUCCESS outcomes, and the exact verifier request
 * shape the sandbox accepts for v2-signed deliveries (webhook_event object, no auth_version).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import FIXTURE from './fixtures/paypal-subscription-created.v2.json';
import { verifyWebhook, accessToken, resolveSubscriptionId, BillingNotConfigured } from '../worker/src/billing/paypalApi';

const ENV = { PAYPAL_CLIENT_ID: 'cid', PAYPAL_SECRET: 'sec', PAYPAL_ENV: 'sandbox', PAYPAL_WEBHOOK_ID: 'WH-1' };
const head = (certUrl: string) => new Headers({
  'paypal-transmission-id': 'tid', 'paypal-transmission-time': '2026', 'paypal-auth-algo': 'SHA256withRSA',
  'paypal-auth-version': 'v2', 'paypal-transmission-sig': 'sig', 'paypal-cert-url': certUrl,
});

afterEach(() => vi.unstubAllGlobals());

describe('PayPal webhook verification', () => {
  it('rejects without credentials (no network)', async () => {
    expect(await verifyWebhook({}, head('https://api.sandbox.paypal.com/x'), '{}')).toBe(false);
  });

  it('rejects a missing transmission_sig BEFORE any network call', async () => {
    const spy = vi.fn(); vi.stubGlobal('fetch', spy);
    const h = head('https://api.sandbox.paypal.com/x'); h.delete('paypal-transmission-sig');
    expect(await verifyWebhook(ENV, h, '{}')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a non-PayPal cert_url BEFORE any network call (SSRF guard)', async () => {
    const spy = vi.fn(); vi.stubGlobal('fetch', spy);
    expect(await verifyWebhook(ENV, head('https://evil.example.com/cert'), '{}')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('posts the sandbox verifier shape: webhook_event object, transmission_sig, no auth_version/event_body', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (url.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tk' }), { status: 200 });
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ verification_status: 'SUCCESS' }), { status: 200 });
    }) as any);
    const raw = JSON.stringify(FIXTURE.body);
    expect(await verifyWebhook(ENV, new Headers(FIXTURE.headers as any), raw)).toBe(true);
    const sent = calls[0].body;
    expect(calls[0].url.endsWith('/v1/notifications/verify-webhook-signature')).toBe(true);
    expect(sent.webhook_event).toEqual(FIXTURE.body);
    expect(typeof sent.webhook_event).toBe('object');
    expect(sent.transmission_sig).toBe(FIXTURE.headers['paypal-transmission-sig']);
    expect(sent.cert_url).toBe(FIXTURE.headers['paypal-cert-url']);
    expect(sent.webhook_id).toBe('WH-1');
    expect('event_body' in sent).toBe(false);
    expect('auth_version' in sent).toBe(false);
    expect(Object.keys(sent).sort()).toEqual(
      ['auth_algo', 'cert_url', 'transmission_id', 'transmission_sig', 'transmission_time', 'webhook_event', 'webhook_id']);
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

  it('rejects a body that is not JSON', async () => {
    const spy = vi.fn(); vi.stubGlobal('fetch', spy);
    expect(await verifyWebhook(ENV, head('https://api.sandbox.paypal.com/x'), 'not json')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('accessToken throws BillingNotConfigured without creds', async () => {
    await expect(accessToken({})).rejects.toBeInstanceOf(BillingNotConfigured);
  });
});

describe('subscription identifier resolution', () => {
  it('takes a payment event\'s subscription from billing_agreement_id', () => {
    const r = resolveSubscriptionId('PAYMENT.SALE.COMPLETED', { id: 'SALE-1', billing_agreement_id: 'I-SUB1', custom_id: 'user-1' });
    expect(r.subscription_id).toBe('I-SUB1');
  });

  it('keeps an explicit subscription_id over billing_agreement_id', () => {
    const r = resolveSubscriptionId('PAYMENT.SALE.COMPLETED', { id: 'SALE-1', subscription_id: 'I-SUB1', billing_agreement_id: 'I-SUB2' });
    expect(r.subscription_id).toBe('I-SUB1');
  });

  it('does not invent a subscription for a payment event that names none', () => {
    const r = resolveSubscriptionId('PAYMENT.SALE.COMPLETED', { id: 'SALE-1', custom_id: 'user-1' });
    expect('subscription_id' in r).toBe(false);
  });

  it('leaves lifecycle events to their own resource.id', () => {
    const r = resolveSubscriptionId('BILLING.SUBSCRIPTION.CANCELLED', { id: 'I-SUB1', status: 'CANCELLED', custom_id: 'user-1' });
    expect(r).toEqual({ id: 'I-SUB1', status: 'CANCELLED', custom_id: 'user-1' });
  });
});
