// backend/src/tests/subscriptionPaymentMethodRoutes.test.js
// Route-level security + contract for the seller subscription payment PREFERENCE.
//
//   GET  /billing/subscription/payment-methods  — catalog + saved preference
//   POST /billing/subscription/payment-method  — save the preference
//
// Rules: unauthenticated → 401, non-shop-owner → 403, suspended seller →
// 403 ACCOUNT_SUSPENDED, and the seller identity always comes from the
// authenticated session (never from the request body).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const state = vi.hoisted(() => ({
  user: null,
  role: 'shop_owner',
  status: 'active',
  reason: null,
}));

vi.mock('../db/pool.js', () => ({
  pool: {
    query: vi.fn(async (sql, params) => {
      if (/select role from public\.users/i.test(sql)) return { rows: [{ role: state.role }] };
      if (/select status, suspension_reason from public\.users/i.test(sql)) {
        return { rows: [{ status: state.status, suspension_reason: state.reason }] };
      }
      if (/^update billing_records/i.test(sql.trim())) return { rows: [] };
      if (/from billing_records/i.test(sql)) {
        return {
          rows: [
            {
              id: 'bill-1',
              seller_id: params?.[0],
              status: 'pending',
              amount: 12000,
              billing_period: 'November 2026',
              billing_interval: 'monthly',
              plan_code: 'gold',
              due_date: '2026-11-16',
              current_period_end: '2026-11-16',
              payment_method_type: 'gcash',
              paymongo_checkout_session_id: null,
              created_at: new Date().toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    }),
    on: vi.fn(),
  },
}));

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: async (req, res, next) => {
    if (!state.user) return res.status(401).json({ message: 'Missing token' });
    req.user = state.user;
    next();
  },
}));

vi.mock('../services/paymongoService.js', () => ({
  getCheckoutSession: vi.fn(),
  checkoutStatus: vi.fn(() => 'pending'),
  verifyWebhookSignature: vi.fn(() => true),
  isPayMongoConfigured: vi.fn(() => true),
}));

const SELLER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function buildApp() {
  const app = express();
  app.use(express.json());
  const { default: billingRoutes } = await import('../routes/billing.routes.js');
  app.use('/billing', billingRoutes);
  app.use((req, res) => res.status(404).json({ message: 'Not found' }));
  return app;
}

beforeEach(() => {
  state.user = { id: SELLER, email: 'seller@atany.ph', user_metadata: {} };
  state.role = 'shop_owner';
  state.status = 'active';
  state.reason = null;
});

describe('subscription payment-method routes — authorization', () => {
  it('rejects an unauthenticated caller (401)', async () => {
    state.user = null;
    const app = await buildApp();
    const res = await request(app).get('/billing/subscription/payment-methods');
    expect(res.status).toBe(401);
  });

  it('rejects a customer (403)', async () => {
    state.role = 'customer';
    const app = await buildApp();
    const res = await request(app).get('/billing/subscription/payment-methods');
    expect(res.status).toBe(403);
  });

  it('rejects an admin (403) — the flow is seller-only', async () => {
    state.role = 'admin';
    const app = await buildApp();
    const res = await request(app).get('/billing/subscription/payment-methods');
    expect(res.status).toBe(403);
  });

  it('blocks a suspended seller with ACCOUNT_SUSPENDED (403)', async () => {
    state.status = 'suspended';
    state.reason = 'Payment issues';
    const app = await buildApp();
    const res = await request(app).get('/billing/subscription/payment-methods');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('allows a shop owner', async () => {
    const app = await buildApp();
    const res = await request(app).get('/billing/subscription/payment-methods');
    expect(res.status).toBe(200);
  });
});

describe('subscription payment-method routes — the catalog', () => {
  it('exposes ONLY Card, GCash, Maya and QR Ph', async () => {
    const app = await buildApp();
    const res = await request(app).get('/billing/subscription/payment-methods');
    expect(res.status).toBe(200);
    const values = res.body.methods.map((m) => m.value);
    expect([...values].sort()).toEqual(['card', 'gcash', 'maya', 'qrph']);
    for (const removed of ['grabpay', 'shopeepay', 'unionbank', 'billease', 'bnpl', 'paymaya']) {
      expect(values).not.toContain(removed);
    }
  });

  it('returns the saved preference and no secret material', async () => {
    const app = await buildApp();
    const res = await request(app).get('/billing/subscription/payment-methods');
    expect(res.status).toBe(200);
    expect(res.body.preference).toEqual({ method: 'gcash' });
    expect(JSON.stringify(res.body)).not.toMatch(/sk_test|sk_live|PAYMONGO_SECRET_KEY/i);
  });
});

describe('subscription payment-method routes — saving the preference', () => {
  it('accepts each supported method', async () => {
    const app = await buildApp();
    for (const method of ['card', 'gcash', 'maya', 'qrph']) {
      const res = await request(app)
        .post('/billing/subscription/payment-method')
        .send({ method });
      expect(res.status, `${method} must be accepted`).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payment_method.method).toBe(method);
    }
  });

  it('rejects a removed method with 400 UNSUPPORTED_PAYMENT_METHOD', async () => {
    const app = await buildApp();
    for (const method of ['grabpay', 'shopeepay', 'unionbank', 'billease', 'bnpl', 'paymaya']) {
      const res = await request(app)
        .post('/billing/subscription/payment-method')
        .send({ method });
      expect(res.status, `${method} must be rejected`).toBe(400);
      expect(res.body.code).toBe('UNSUPPORTED_PAYMENT_METHOD');
      expect(res.body.error?.code).toBe('UNSUPPORTED_PAYMENT_METHOD');
    }
  });

  it('rejects raw card data with 400', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/billing/subscription/payment-method')
      .send({ method: 'card', card_number: '4242424242424242', cvc: '123' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SENSITIVE_CARD_DATA_REJECTED');
  });

  it('ignores a seller_id supplied in the body (ownership comes from the session)', async () => {
    const app = await buildApp();
    const { pool } = await import('../db/pool.js');
    await request(app)
      .post('/billing/subscription/payment-method')
      .send({ method: 'gcash', seller_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' });
    const update = pool.query.mock.calls.find(([sql]) => /^UPDATE billing_records/i.test(sql.trim()));
    expect(update).toBeTruthy();
    // The seller id is the AUTHENTICATED user, not the body's.
    expect(update[1]).toContain(SELLER);
    expect(update[1]).not.toContain('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  it('does NOT create a PayMongo session (preference only)', async () => {
    const app = await buildApp();
    const { pool } = await import('../db/pool.js');
    const res = await request(app)
      .post('/billing/subscription/payment-method')
      .send({ method: 'qrph' });
    expect(res.status).toBe(200);
    // No provider checkout was created.
    const checkout = pool.query.mock.calls.find(([sql]) => /paymongo_checkout_session_id = \$1/i.test(sql));
    expect(checkout).toBeUndefined();
  });
});

describe('subscription payment-method routes — no provider session endpoint', () => {
  it('the old session endpoint is gone (no duplicate API)', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/billing/subscription/payment-method/session')
      .send({ method: 'card' });
    expect(res.status).toBe(404);
  });
});
