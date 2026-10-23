// backend/src/tests/subscriptionPaymentMethods.test.js
// The seller subscription payment-method contract.
//
// Preference values (stored on billing_records.payment_method_type):
//   card | gcash | maya | qrph
// PayMongo provider identifiers: card | gcash | paymaya | qrph
//
// GrabPay, ShopeePay, UnionBank, BillEase and Buy Now Pay Later are rejected.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: { query: (...args) => poolQuery(...args) },
  isDirectPg: () => true,
}));

vi.mock('../services/paymongoService.js', () => ({
  getCheckoutSession: vi.fn(),
  checkoutStatus: vi.fn(() => 'pending'),
  verifyWebhookSignature: vi.fn(() => true),
}));

const {
  assertNoSensitiveCardFields,
  assertSupportedSubscriptionMethod,
  sanitizeMethodRow,
  getSubscriptionPaymentPreference,
  saveSubscriptionPaymentPreference,
  SUPPORTED_SUBSCRIPTION_METHODS,
  SUBSCRIPTION_PAYMENT_METHOD,
  PAYMONGO_METHOD_MAP,
  toPayMongoMethodType,
} = await import('../services/paymentMethodService.js');

const SELLER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BILLING = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const REMOVED = ['grabpay', 'grab_pay', 'shopeepay', 'shopee_pay', 'unionbank', 'union_bank', 'billease', 'bnpl', 'buy_now_pay_later', 'paymaya'];

function billingRow(overrides = {}) {
  return {
    id: BILLING,
    seller_id: SELLER,
    status: 'pending',
    amount: 12000,
    payment_method_type: null,
    paymongo_checkout_session_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  poolQuery.mockImplementation(async (sql) => {
    if (/^UPDATE billing_records/i.test(sql.trim())) return { rows: [] };
    if (/FROM billing_records/i.test(sql)) return { rows: [billingRow()] };
    return { rows: [] };
  });
});

describe('the supported payment methods', () => {
  it('supports exactly Card, GCash, Maya and QR Ph', () => {
    expect([...SUPPORTED_SUBSCRIPTION_METHODS].sort()).toEqual(['card', 'gcash', 'maya', 'qrph']);
    expect(SUBSCRIPTION_PAYMENT_METHOD.CARD).toBe('card');
    expect(SUBSCRIPTION_PAYMENT_METHOD.GCASH).toBe('gcash');
    expect(SUBSCRIPTION_PAYMENT_METHOD.MAYA).toBe('maya');
    expect(SUBSCRIPTION_PAYMENT_METHOD.QRPH).toBe('qrph');
  });

  it('accepts every supported method (case-insensitive)', () => {
    expect(assertSupportedSubscriptionMethod('qrph')).toBe('qrph');
    expect(assertSupportedSubscriptionMethod('CARD')).toBe('card');
    expect(assertSupportedSubscriptionMethod('GCash')).toBe('gcash');
    expect(assertSupportedSubscriptionMethod('Maya')).toBe('maya');
  });

  it('rejects every removed method with 400 UNSUPPORTED_PAYMENT_METHOD', () => {
    for (const method of REMOVED) {
      let caught = null;
      try {
        assertSupportedSubscriptionMethod(method);
      } catch (e) {
        caught = e;
      }
      expect(caught, `${method} must be rejected`).toBeTruthy();
      expect(caught.statusCode).toBe(400);
      expect(caught.code).toBe('UNSUPPORTED_PAYMENT_METHOD');
    }
  });

  it('rejects a missing method', () => {
    let caught = null;
    try {
      assertSupportedSubscriptionMethod('');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(caught.code).toBe('INVALID_PAYMENT_METHOD');
  });
});

describe('the PayMongo method map', () => {
  it('maps every preference to exactly one provider method', () => {
    expect(toPayMongoMethodType('card')).toBe('card');
    expect(toPayMongoMethodType('gcash')).toBe('gcash');
    expect(toPayMongoMethodType('qrph')).toBe('qrph');
  });

  it('maps maya to the PayMongo identifier "paymaya"', () => {
    expect(toPayMongoMethodType('maya')).toBe('paymaya');
    expect(PAYMONGO_METHOD_MAP.maya).toBe('paymaya');
  });

  it('rejects an unsupported preference', () => {
    let caught = null;
    try {
      toPayMongoMethodType('grabpay');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(caught.code).toBe('UNSUPPORTED_PAYMENT_METHOD');
  });
});

describe('raw card data is never accepted', () => {
  it('rejects a payload carrying card credentials', () => {
    for (const key of ['card_number', 'cardNumber', 'cvc', 'cvv', 'pan', 'security_code']) {
      let caught = null;
      try {
        assertNoSensitiveCardFields({ [key]: '4242424242424242' });
      } catch (e) {
        caught = e;
      }
      expect(caught, `${key} must be rejected`).toBeTruthy();
      expect(caught.statusCode).toBe(400);
      expect(caught.code).toBe('SENSITIVE_CARD_DATA_REJECTED');
    }
  });

  it('only exposes safe metadata on a stored method', () => {
    const safe = sanitizeMethodRow({
      id: 'pm-1',
      brand: 'visa',
      last4: '4242',
      card_number: '4242424242424242',
      cvc: '123',
    });
    expect(safe.card_number).toBeUndefined();
    expect(safe.cvc).toBeUndefined();
    expect(safe.last4).toBe('4242');
  });
});

describe('the payment preference is stored on the billing record', () => {
  it('updates payment_method_type on the seller\'s own billing record', async () => {
    const result = await saveSubscriptionPaymentPreference({ sellerId: SELLER, method: 'gcash' });
    expect(result.method).toBe('gcash');
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE billing_records/i.test(sql.trim()));
    expect(update).toBeTruthy();
    expect(update[1]).toContain('gcash');
    expect(update[1]).toContain(SELLER);
  });

  it('never trusts a seller id from the request body', async () => {
    await saveSubscriptionPaymentPreference({ sellerId: SELLER, method: 'card' });
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE billing_records/i.test(sql.trim()));
    // The authenticated seller is always used.
    expect(update[1]).toContain(SELLER);
  });

  it('rejects a removed method before touching the database', async () => {
    let caught = null;
    try {
      await saveSubscriptionPaymentPreference({ sellerId: SELLER, method: 'grabpay' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(caught.code).toBe('UNSUPPORTED_PAYMENT_METHOD');
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('clears a stale checkout session when the method changes', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/^UPDATE billing_records/i.test(sql.trim())) return { rows: [] };
      if (/FROM billing_records/i.test(sql)) {
        return {
          rows: [billingRow({ payment_method_type: 'gcash', paymongo_checkout_session_id: 'cs_old' })],
        };
      }
      return { rows: [] };
    });
    await saveSubscriptionPaymentPreference({ sellerId: SELLER, method: 'card' });
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE billing_records/i.test(sql.trim()));
    // The changed flag is passed so the old session association is cleared.
    expect(update[1]).toContain(true);
  });

  it('does NOT clear the session when the method is unchanged', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/^UPDATE billing_records/i.test(sql.trim())) return { rows: [] };
      if (/FROM billing_records/i.test(sql)) {
        return { rows: [billingRow({ payment_method_type: 'gcash', paymongo_checkout_session_id: 'cs_old' })] };
      }
      return { rows: [] };
    });
    await saveSubscriptionPaymentPreference({ sellerId: SELLER, method: 'gcash' });
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE billing_records/i.test(sql.trim()));
    expect(update[1]).toContain(false);
  });

  it('stores the preference on a PAID cycle but never touches its payment facts', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/^UPDATE billing_records/i.test(sql.trim())) return { rows: [] };
      if (/FROM billing_records/i.test(sql)) {
        return {
          rows: [
            billingRow({
              status: 'paid',
              payment_method_type: 'gcash',
              paymongo_checkout_session_id: 'cs_paid_history',
            }),
          ],
        };
      }
      return { rows: [] };
    });
    const result = await saveSubscriptionPaymentPreference({ sellerId: SELLER, method: 'card' });
    expect(result.method).toBe('card');
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE billing_records/i.test(sql.trim()));
    expect(update).toBeTruthy();
    // The paid invoice's checkout session (history) is NOT cleared.
    expect(update[1]).toContain(false);
  });

  it('clears the stale session on an UNPAID record when the method changes', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/^UPDATE billing_records/i.test(sql.trim())) return { rows: [] };
      if (/FROM billing_records/i.test(sql)) {
        return {
          rows: [
            billingRow({ status: 'pending', payment_method_type: 'gcash', paymongo_checkout_session_id: 'cs_old' }),
          ],
        };
      }
      return { rows: [] };
    });
    await saveSubscriptionPaymentPreference({ sellerId: SELLER, method: 'card' });
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE billing_records/i.test(sql.trim()));
    expect(update[1]).toContain(true);
  });

  it('reads the preference from the seller\'s own records', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/FROM billing_records/i.test(sql)) {
        return { rows: [billingRow({ payment_method_type: 'maya' })] };
      }
      return { rows: [] };
    });
    const pref = await getSubscriptionPaymentPreference(SELLER);
    expect(pref).toBe('maya');
  });
});

describe('the checkout is restricted to the selected method', () => {
  it('sends ONLY the selected provider method to PayMongo', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(process.cwd(), 'src/services/subscriptionService.js'), 'utf8');
    // The method list is the single selected provider method.
    expect(src).toContain('payment_method_types: methodTypes');
    expect(src).toContain('methodTypes = [providerMethod]');
    // The only full-set fallback is the fresh plan checkout (no method yet).
    expect(src).toContain("allowUnselected = false");
    expect(src).toContain("methodTypes = ['gcash', 'card', 'paymaya', 'qrph']");
    // The removed providers are never sent.
    expect(src).not.toContain("'grab_pay'");
    expect(src).not.toContain("'billease'");
  });

  it('requires a chosen method before paying', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(process.cwd(), 'src/services/subscriptionService.js'), 'utf8');
    expect(src).toContain("PAYMENT_METHOD_REQUIRED");
    expect(src).toContain('billing.payment_method_type');
  });
});
