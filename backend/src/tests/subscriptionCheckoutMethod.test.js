// backend/src/tests/subscriptionCheckoutMethod.test.js
// The outgoing PayMongo checkout payload must contain ONLY the seller's
// selected payment method.
//
//   card  → ['card']
//   gcash → ['gcash']
//   maya  → ['paymaya']   (PayMongo's identifier)
//   qrph  → ['qrph']
//
// GrabPay / BillEase are never sent.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

vi.mock('../db/pool.js', () => ({
  pool: {
    query: vi.fn(async (sql) => {
      if (/^UPDATE billing_records/i.test(sql.trim())) return { rows: [] };
      if (/FROM billing_records/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }),
    connect: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock('../services/paymongoService.js', () => ({
  getCheckoutSession: vi.fn(async () => ({ data: { attributes: { checkout_url: 'https://pay.test/cs', status: 'pending' } } })),
  checkoutStatus: vi.fn(() => 'pending'),
  verifyWebhookSignature: vi.fn(() => true),
}));

const { createBillingCheckoutSession } = await import('../services/subscriptionService.js');

const SELLER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function billing(overrides = {}) {
  return {
    id: 'bill-1',
    seller_id: SELLER,
    amount: 12000,
    billing_period: 'November 2026',
    status: 'pending',
    plan_code: 'gold',
    billing_interval: 'monthly',
    paymongo_checkout_session_id: null,
    ...overrides,
  };
}

/** The payment_method_types actually sent to PayMongo. */
function sentMethodTypes() {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes('checkout_sessions'));
  expect(call, 'a PayMongo checkout session must be requested').toBeTruthy();
  const body = JSON.parse(call[1].body);
  return body.data.attributes.payment_method_types;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || 'sk_test_unit';
  fetchMock.mockImplementation(async (url) => {
    if (String(url).includes('checkout_sessions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: 'cs_test',
            attributes: {
              checkout_url: 'https://pay.test/checkout/cs_test',
              reference_number: 'bill-1',
              status: 'pending',
            },
          },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ data: { id: 'cs_test', attributes: {} } }) };
  });
});

describe('Pay Now sends ONLY the selected method', () => {
  it('card → ["card"]', async () => {
    await createBillingCheckoutSession(billing({ payment_method_type: 'card' }));
    expect(sentMethodTypes()).toEqual(['card']);
  });

  it('gcash → ["gcash"]', async () => {
    await createBillingCheckoutSession(billing({ payment_method_type: 'gcash' }));
    expect(sentMethodTypes()).toEqual(['gcash']);
  });

  it('maya → ["paymaya"] (the PayMongo identifier)', async () => {
    await createBillingCheckoutSession(billing({ payment_method_type: 'maya' }));
    expect(sentMethodTypes()).toEqual(['paymaya']);
  });

  it('qrph → ["qrph"]', async () => {
    await createBillingCheckoutSession(billing({ payment_method_type: 'qrph' }));
    expect(sentMethodTypes()).toEqual(['qrph']);
  });

  it('NEVER sends grab_pay or billease', async () => {
    for (const method of ['card', 'gcash', 'maya', 'qrph']) {
      vi.clearAllMocks();
      fetchMock.mockImplementation(async (url) => {
        if (String(url).includes('checkout_sessions')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 'cs', attributes: { checkout_url: 'https://pay.test/cs', status: 'pending' } } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: { id: 'cs', attributes: {} } }) };
      });
      await createBillingCheckoutSession(billing({ payment_method_type: method }));
      const types = sentMethodTypes();
      expect(types).not.toContain('grab_pay');
      expect(types).not.toContain('billease');
      expect(types).toHaveLength(1);
    }
  });

  it('sends the server-side amount (never a client amount)', async () => {
    await createBillingCheckoutSession(billing({ payment_method_type: 'gcash', amount: 12000 }));
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('checkout_sessions'));
    const body = JSON.parse(call[1].body);
    expect(body.data.attributes.line_items[0].amount).toBe(1200000);
  });

  it('preserves success_url / cancel_url / reference_number', async () => {
    await createBillingCheckoutSession(billing({ payment_method_type: 'qrph' }));
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('checkout_sessions'));
    const attrs = JSON.parse(call[1].body).data.attributes;
    expect(attrs.success_url).toContain('/shop/billing/success');
    expect(attrs.cancel_url).toContain('/shop/billing');
    expect(attrs.reference_number).toBe('bill-1');
  });
});

describe('Pay Now without a chosen method', () => {
  it('refuses to create a checkout (the seller must choose first)', async () => {
    let caught = null;
    try {
      await createBillingCheckoutSession(billing({ payment_method_type: null }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(caught.statusCode).toBe(409);
    expect(caught.code).toBe('PAYMENT_METHOD_REQUIRED');
    // No provider request was made.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('checkout_sessions'))).toBe(false);
  });

  it('a fresh plan checkout may still offer the supported set', async () => {
    await createBillingCheckoutSession(billing({ payment_method_type: null }), { allowUnselected: true });
    const types = sentMethodTypes();
    expect(types.sort()).toEqual(['card', 'gcash', 'paymaya', 'qrph']);
    expect(types).not.toContain('grab_pay');
    expect(types).not.toContain('billease');
  });

  it('rejects an unsupported stored method', async () => {
    let caught = null;
    try {
      await createBillingCheckoutSession(billing({ payment_method_type: 'grabpay' }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(caught.statusCode).toBe(400);
    expect(caught.code).toBe('UNSUPPORTED_PAYMENT_METHOD');
  });
});
