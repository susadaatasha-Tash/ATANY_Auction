import { afterEach, describe, expect, test, vi } from 'vitest';
import crypto from 'node:crypto';
import { verifyWebhookSignature, inspectCheckout, expireCheckoutSession } from '../services/paymongoService.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('PayMongo documented safety contracts', () => {
  test.each([false, true])('accepts documented mode-specific timestamp signature (live=%s)', (live) => {
    vi.stubEnv('PAYMONGO_WEBHOOK_SECRET', 'fixture-secret');
    const raw = '{ "data": { "attributes": { "livemode": ' + live + ' } } }';
    const t = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac('sha256', 'fixture-secret').update(`${t}.${raw}`).digest('hex');
    expect(verifyWebhookSignature(raw, `t=${t},te=${live ? '' : sig},li=${live ? sig : ''}`)).toBe(true);
    expect(verifyWebhookSignature(raw + ' ', `t=${t},te=${sig},li=${sig}`)).toBe(false);
    expect(verifyWebhookSignature(raw, `t=${t},te=${live ? sig : ''},li=${live ? '' : sig}`)).toBe(false);
  });
  test('rejects body-only signatures and old timestamps', () => {
    vi.stubEnv('PAYMONGO_WEBHOOK_SECRET', 'fixture-secret');
    const raw = '{"data":{"attributes":{"livemode":false}}}';
    const old = '1';
    const sig = crypto.createHmac('sha256', 'fixture-secret').update(`${old}.${raw}`).digest('hex');
    expect(verifyWebhookSignature(raw, `t=${old},te=${sig},li=`)).toBe(false);
    expect(verifyWebhookSignature(raw, crypto.createHmac('sha256', 'fixture-secret').update(raw).digest('hex'))).toBe(false);
  });
  test('keeps an active session collectible after a failed payment attempt', () => {
    expect(inspectCheckout({ data: { id: 'cs_1', attributes: { status: 'active', payments: [{ id: 'pay_failed', attributes: { status: 'failed' } }] } } })).toMatchObject({ state: 'active', paid: false, processing: false });
  });
  test('recognizes processing intents and treats malformed responses as unknown', () => {
    expect(inspectCheckout({ data: { id: 'cs_1', attributes: { status: 'active', payment_intent: { attributes: { status: 'processing' } } } } })).toMatchObject({ processing: true });
    expect(inspectCheckout({})).toMatchObject({ state: 'unknown' });
  });
  test('expires using the documented endpoint without inventing refunds', async () => {
    vi.stubEnv('PAYMONGO_SECRET_KEY', 'sk_test_fixture');
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: 'cs_1', attributes: { status: 'expired' } } }) });
    vi.stubGlobal('fetch', fetch);
    await expireCheckoutSession('cs_1');
    expect(fetch).toHaveBeenCalledWith('https://api.paymongo.com/v1/checkout_sessions/cs_1/expire', expect.objectContaining({ method: 'POST' }));
  });
});
