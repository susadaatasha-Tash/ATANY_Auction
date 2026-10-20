// backend/src/tests/billingSubscription.test.js
// Backend subscription/billing domain tests — mocked pool + PayMongo.
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn(), on: () => {} },
  isDirectPg: () => true,
}));

vi.mock('../services/paymongoService.js', () => ({
  createPayMongoCheckout: vi.fn(async () => ({ checkoutId: 'cs_x', checkoutUrl: 'https://pay.test/cs' })),
  getCheckoutSession: vi.fn(async () => ({ data: { attributes: { checkout_url: 'https://pay.test/reuse', status: 'pending' } } })),
  checkoutStatus: vi.fn(() => 'pending'),
  verifyWebhookSignature: vi.fn(() => true),
}));

import { pool } from '../db/pool.js';
import { getCheckoutSession, checkoutStatus } from '../services/paymongoService.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
import {
  addOneCalendarMonth,
  computeMonthlyPeriod,
  computeSubscriptionMetricsFromRecords,
  createBillingCheckoutSession,
  createPendingBillingForPlan,
  deriveSubscriptionStatus,
  evaluatePlanCheckoutRequest,
  ensureNextPeriod,
  isPaidPeriodActive,
  markBillingPaid,
  pickCurrentBillingRecord,
  buildSubscriptionSummary,
} from '../services/subscriptionService.js';
import {
  getPlanByCode,
  getPlanCatalog,
  resolvePlanForRecord,
} from '../config/subscriptionPlans.js';
import {
  listMyBilling,
  getMySubscription,
  getMyBillingOne,
  createMaintenanceCheckout,
  checkoutSubscriptionPlan,
  listAllBilling,
  adminRetryBilling,
  listSubscriptionPlans,
} from '../controllers/billing.controller.js';
import { paymongoWebhook } from '../controllers/webhook.controller.js';

const SELLER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const ADMIN = '99999999-9999-9999-9999-999999999999';
const BILLING_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function futureISO(days = 20) {
  return new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
}

function pastISO(days = 5) {
  return new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
}

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function reqUser(id, role) {
  return { user: { id, trustedRole: role } };
}

let billingStore;

function seedBilling(rows) {
  billingStore = rows.map((r) => ({ ...r }));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || 'sk_test_dummy';
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5178';
  // Restore PayMongo mock behaviors after clearAllMocks
  getCheckoutSession.mockImplementation(async () => ({
    data: { attributes: { checkout_url: 'https://pay.test/reuse', status: 'pending' } },
  }));
  checkoutStatus.mockImplementation(() => 'pending');
  // createBillingCheckoutSession uses global fetch for PayMongo Checkout API
  fetchMock.mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/v1/checkout_sessions/') ) {
      return { ok: false, status: 404, json: async () => ({ errors: [{ detail: 'not found' }] }) };
    }
    if (u.includes('/v1/checkout_sessions')) {
      return {
        ok: true,
        json: async () => ({
          data: { id: 'cs_new', attributes: { checkout_url: 'https://pay.test/new' } },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  billingStore = [];
  pool.query.mockImplementation(async (sql, params = []) => {
    const s = sql.trim();
    if (/FROM billing_records WHERE seller_id\s*=\s*\$1 ORDER BY created_at DESC/i.test(s)) {
      return { rows: billingStore.filter((b) => b.seller_id === params[0]) };
    }
    if (/FROM billing_records WHERE id\s*=\s*\$1 AND seller_id\s*=\s*\$2/i.test(s)) {
      return { rows: billingStore.filter((b) => b.id === params[0] && b.seller_id === params[1]) };
    }
    if (/FROM billing_records WHERE id\s*=\s*\$1/i.test(s)) {
      return { rows: billingStore.filter((b) => b.id === params[0]) };
    }
    if (/FROM billing_records WHERE paymongo_checkout_session_id\s*=\s*\$1 OR id::text\s*=\s*\$1/i.test(s)) {
      return {
        rows: billingStore.filter(
          (b) => b.paymongo_checkout_session_id === params[0] || b.id === params[0]
        ),
      };
    }
    if (/FROM billing_records\s*(WHERE[\s\S]*)?ORDER BY created_at DESC/i.test(s)) {
      let rows = [...billingStore];
      if (/status\s*=\s*\$1/i.test(s) && params[0]) rows = rows.filter((b) => b.status === params[0]);
      if (/seller_id\s*=\s*\$2/i.test(s) && params[1]) rows = rows.filter((b) => b.seller_id === params[1]);
      return { rows };
    }
    if (/FROM shops WHERE user_id\s*=\s*\$1/i.test(s)) {
      const shop =
        params[0] === SELLER
          ? { id: 'shop-1', user_id: SELLER, shop_name: 'Test Shop', home_branch_id: 'br-1' }
          : null;
      return { rows: shop ? [shop] : [] };
    }
    if (/UPDATE billing_records[\s\S]*SET status\s*=\s*'paid'/i.test(s)) {
      const idx = billingStore.findIndex((b) => b.id === params[1]);
      if (idx < 0 || billingStore[idx].status === 'paid') return { rows: [] };
      billingStore[idx] = {
        ...billingStore[idx],
        status: 'paid',
        payment_reference: params[0] || billingStore[idx].payment_reference,
        paid_at: new Date().toISOString(),
      };
      return { rows: [billingStore[idx]] };
    }
    if (/UPDATE billing_records[\s\S]*SET paymongo_checkout_session_id\s*=\s*\$1/i.test(s)) {
      const idx = billingStore.findIndex((b) => b.id === params[1]);
      if (idx >= 0) billingStore[idx].paymongo_checkout_session_id = params[0];
      return { rows: [] };
    }
    if (/UPDATE billing_records[\s\S]*SET status\s*=\s*\$1,\s*updated_at\s*=\s*now\(\)/i.test(s)) {
      const idx = billingStore.findIndex((b) => b.id === params[1]);
      if (idx < 0 || billingStore[idx].status === 'paid') return { rows: [] };
      billingStore[idx] = { ...billingStore[idx], status: params[0] };
      return { rows: [billingStore[idx]] };
    }
    if (/INSERT INTO billing_records/i.test(s)) {
      const row = {
        id: `new-${billingStore.length + 1}`,
        seller_id: params[0],
        amount: params[1],
        billing_period: params[2],
        status: 'pending',
        due_date: params[3],
        current_period_start: params[4],
        current_period_end: params[5],
        plan_code: params[6] || null,
        paymongo_checkout_session_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      billingStore.push(row);
      return { rows: [row] };
    }
    if (/INSERT INTO audit_logs/i.test(s) || /INSERT INTO notifications/i.test(s)) {
      return { rows: [] };
    }
    if (/SELECT id FROM users WHERE role\s*=\s*'admin'/i.test(s)) {
      return { rows: [{ id: ADMIN }] };
    }
    if (/SELECT id FROM notifications/i.test(s)) {
      return { rows: [] };
    }
    if (/FROM users WHERE id IN/i.test(s) || /FROM shops WHERE user_id IN/i.test(s) || /FROM branches WHERE id IN/i.test(s)) {
      return { rows: [] };
    }
    return { rows: [] };
  });
});

describe('plan source of truth', () => {
  test('catalog has bronze/gold/platinum with server prices', () => {
    const catalog = getPlanCatalog();
    expect(catalog.map((p) => p.code)).toEqual(['bronze', 'gold', 'platinum']);
    expect(getPlanByCode('gold').monthly_price).toBe(1500);
    expect(getPlanByCode('nope')).toBeNull();
  });

  test('plan_code wins over amount; amount is legacy fallback', () => {
    expect(resolvePlanForRecord({ plan_code: 'gold', amount: 1000 }).code).toBe('gold');
    expect(resolvePlanForRecord({ amount: 12000 }).code).toBe('platinum');
    expect(resolvePlanForRecord(null).code).toBe('bronze');
  });
});

describe('billing period logic', () => {
  test('calendar month helper is month-end safe', () => {
    const end = addOneCalendarMonth(new Date('2026-01-31T12:00:00Z'));
    expect(end.getMonth()).toBe(1); // February
    expect(end.getDate()).toBe(28); // 2026 not leap? 2026 is not leap → 28
  });

  test('computeMonthlyPeriod stores start/end/due', () => {
    const p = computeMonthlyPeriod(new Date(2026, 8, 14, 10, 0, 0)); // Sep 14 local
    expect(p.start).toBe('2026-09-14');
    expect(p.end).toBe('2026-10-14');
    expect(p.due_date).toBe('2026-10-14');
    expect(p.label).toContain('September 2026');
  });
});

describe('subscription vs billing status', () => {
  test('paid active period → active; pending unpaid → pending; overdue → past_due', () => {
    expect(deriveSubscriptionStatus({ status: 'paid', current_period_end: futureISO(10) }).status).toBe('active');
    expect(deriveSubscriptionStatus({ status: 'pending', due_date: futureISO(5) }).status).toBe('pending');
    expect(deriveSubscriptionStatus({ status: 'overdue', due_date: pastISO(3) }).status).toBe('past_due');
    expect(deriveSubscriptionStatus({ status: 'cancelled' }).status).toBe('canceled');
  });

  test('pickCurrentBillingRecord prefers active paid period over older history', () => {
    const records = [
      { id: '1', seller_id: SELLER, status: 'paid', amount: 1000, created_at: '2026-08-01', current_period_end: pastISO(10) },
      { id: '2', seller_id: SELLER, status: 'paid', amount: 1000, created_at: '2026-09-01', current_period_end: futureISO(10) },
    ];
    expect(pickCurrentBillingRecord(records).id).toBe('2');
    expect(isPaidPeriodActive(records[0])).toBe(false);
    expect(isPaidPeriodActive(records[1])).toBe(true);
  });
});

describe('seller routes authorization + ownership', () => {
  test('seller can view own billing history only', async () => {
    seedBilling([
      { id: BILLING_ID, seller_id: SELLER, status: 'paid', amount: 1500, plan_code: 'gold', billing_period: 'Oct', current_period_end: futureISO(5), created_at: new Date().toISOString() },
      { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', seller_id: OTHER, status: 'paid', amount: 1000, plan_code: 'bronze', created_at: new Date().toISOString() },
    ]);
    const req = reqUser(SELLER, 'shop_owner');
    const res = mockRes();
    await listMyBilling(req, res);
    const rows = res.json.mock.calls[0][0];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.every((r) => r.seller_id === SELLER)).toBe(true);
    expect(rows[0].plan_code).toBe('gold');
  });

  test('seller subscription summary uses same records + catalog', async () => {
    seedBilling([
      { id: BILLING_ID, seller_id: SELLER, status: 'paid', amount: 1500, plan_code: 'gold', billing_period: 'Oct 2026 – Nov 2026', current_period_start: pastISO(2), current_period_end: futureISO(28), created_at: new Date().toISOString() },
    ]);
    const res = mockRes();
    await getMySubscription(reqUser(SELLER, 'shop_owner'), res);
    const body = res.json.mock.calls[0][0];
    expect(body.subscription_status).toBe('active');
    expect(body.plan.code).toBe('gold');
    expect(body.next_payment.mode).toBe('next_billing_date');
    expect(body.next_payment.note).toMatch(/manually/i);
  });

  test('seller cannot read another seller billing row', async () => {
    seedBilling([{ id: BILLING_ID, seller_id: OTHER, status: 'pending', amount: 1000 }]);
    const res = mockRes();
    await getMyBillingOne(
      Object.assign(reqUser(SELLER, 'shop_owner'), { params: { id: BILLING_ID } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('customer identity cannot read foreign billing row via ownership scoping', async () => {
    seedBilling([{ id: BILLING_ID, seller_id: OTHER, status: 'pending', amount: 1000 }]);
    const res = mockRes();
    await getMyBillingOne(
      Object.assign(reqUser('customer-user', 'customer'), { params: { id: BILLING_ID } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('checkout by plan_code', () => {
  test('valid plan creates pending billing from catalog price (ignores client amount)', async () => {
    seedBilling([]);
    getCheckoutSession.mockRejectedValueOnce(new Error('no session yet'));
    const res = mockRes();
    await checkoutSubscriptionPlan(
      {
        user: { id: SELLER, trustedRole: 'shop_owner' },
        body: { plan_code: 'gold', amount: 1, seller_id: OTHER },
      },
      res
    );
    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.plan.code).toBe('gold');
    expect(body.billing.amount).toBe(1500); // server catalog, not client amount
    expect(body.billing.seller_id).toBe(SELLER); // from auth, not body
    expect(body.billing.plan_code).toBe('gold');
    expect(body.checkout_url).toBeTruthy();
  });

  test('invalid plan rejected 400', async () => {
    const res = mockRes();
    await checkoutSubscriptionPlan(
      { user: { id: SELLER }, body: { plan_code: 'enterprise' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('missing plan_code rejected 400', async () => {
    const res = mockRes();
    await checkoutSubscriptionPlan({ user: { id: SELLER }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('open invoice for different plan → 409', async () => {
    seedBilling([
      { id: BILLING_ID, seller_id: SELLER, status: 'pending', amount: 1000, plan_code: 'bronze', created_at: new Date().toISOString() },
    ]);
    const res = mockRes();
    await checkoutSubscriptionPlan(
      { user: { id: SELLER }, body: { plan_code: 'gold' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('active subscription plan-change → 409 (rules not implemented)', async () => {
    seedBilling([
      { id: BILLING_ID, seller_id: SELLER, status: 'paid', amount: 1000, plan_code: 'bronze', current_period_end: futureISO(10), created_at: new Date().toISOString() },
    ]);
    const decision = evaluatePlanCheckoutRequest({
      records: billingStore,
      planCode: 'gold',
      shop: { id: 's' },
    });
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(409);
  });

  test('duplicate open checkout for same plan does not create a second pending billing', async () => {
    seedBilling([
      { id: BILLING_ID, seller_id: SELLER, status: 'pending', amount: 1500, plan_code: 'gold', paymongo_checkout_session_id: 'cs_old', updated_at: new Date().toISOString(), created_at: new Date().toISOString() },
    ]);
    getCheckoutSession.mockImplementation(async (id) => ({
      data: {
        attributes: {
          checkout_url: id === 'cs_old' ? 'https://pay.test/reused' : 'https://pay.test/new',
          status: 'pending',
        },
      },
    }));
    checkoutStatus.mockImplementation(() => 'pending');
    const res = mockRes();
    await checkoutSubscriptionPlan(
      { user: { id: SELLER }, body: { plan_code: 'gold' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].checkout_url).toBeTruthy();
    // Critical rule: at most one open pending gold invoice for this seller
    expect(billingStore.filter((b) => b.plan_code === 'gold' && b.status === 'pending')).toHaveLength(1);
    expect(billingStore.filter((b) => b.plan_code === 'gold' && b.status === 'pending')[0].id).toBe(BILLING_ID);
  });
});

describe('seller checkout ownership', () => {
  test('seller can retry own eligible record', async () => {
    seedBilling([
      { id: BILLING_ID, seller_id: SELLER, status: 'overdue', amount: 1000, plan_code: 'bronze', paymongo_checkout_session_id: null, updated_at: pastISO(2), created_at: new Date().toISOString() },
    ]);
    // Force new checkout creation path (no reusable session)
    getCheckoutSession.mockRejectedValue(new Error('none'));
    const req = Object.assign(reqUser(SELLER, 'shop_owner'), { params: { id: BILLING_ID } });
    const res = mockRes();
    await createMaintenanceCheckout(req, res);
    expect(res.json.mock.calls[0][0].checkout_url).toBeTruthy();
    expect(billingStore[0].paymongo_checkout_session_id).toBeTruthy();
  });

  test('seller cannot retry another seller record', async () => {
    seedBilling([
      { id: BILLING_ID, seller_id: OTHER, status: 'overdue', amount: 1000 },
    ]);
    const req = Object.assign(reqUser(SELLER, 'shop_owner'), { params: { id: BILLING_ID } });
    const res = mockRes();
    await createMaintenanceCheckout(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('paid record cannot retry', async () => {
    seedBilling([
      { id: BILLING_ID, seller_id: SELLER, status: 'paid', amount: 1000 },
    ]);
    const req = Object.assign(reqUser(SELLER, 'shop_owner'), { params: { id: BILLING_ID } });
    const res = mockRes();
    await createMaintenanceCheckout(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('cancelled/refunded cannot retry', async () => {
    seedBilling([{ id: BILLING_ID, seller_id: SELLER, status: 'cancelled', amount: 1000 }]);
    const req = Object.assign(reqUser(SELLER, 'shop_owner'), { params: { id: BILLING_ID } });
    const res = mockRes();
    await createMaintenanceCheckout(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('payment confirmation + idempotency', () => {
  test('webhook paid activates billing once; duplicate webhook does not double-apply', async () => {
    seedBilling([
      { id: BILLING_ID, seller_id: SELLER, status: 'pending', amount: 1500, plan_code: 'gold', billing_period: 'Oct', paymongo_checkout_session_id: 'cs_1', created_at: new Date().toISOString() },
    ]);

    const mkReq = () => ({
      rawBody: '{}',
      headers: { 'paymongo-signature': 'sig' },
      body: {
        data: {
          attributes: {
            type: 'checkout_session.paid',
            data: {
              id: 'cs_1',
              attributes: {
                reference_number: BILLING_ID,
                payments: [{ id: 'pay_1', attributes: { status: 'paid' } }],
              },
            },
          },
        },
      },
    });

    const res1 = mockRes();
    await paymongoWebhook(mkReq(), res1);
    expect(res1.json).toHaveBeenCalledWith({ received: true });
    expect(billingStore[0].status).toBe('paid');
    expect(billingStore[0].payment_reference).toBe('pay_1');

    const res2 = mockRes();
    await paymongoWebhook(mkReq(), res2);
    expect(res2.json).toHaveBeenCalledWith({ received: true, already_paid: true });
  });

  test('failed payment does not activate subscription', async () => {
    seedBilling([
      { id: BILLING_ID, seller_id: SELLER, status: 'pending', amount: 1000, plan_code: 'bronze', paymongo_checkout_session_id: 'cs_f', created_at: new Date().toISOString() },
    ]);
    const res = mockRes();
    await paymongoWebhook(
      {
        rawBody: '{}',
        headers: {},
        body: {
          data: {
            attributes: {
              type: 'checkout_session.failed',
              data: { id: 'cs_f', attributes: { reference_number: BILLING_ID, status: 'failed' } },
            },
          },
        },
      },
      res
    );
    expect(billingStore[0].status).toBe('failed');
    expect(billingStore[0].paid_at).toBeUndefined();
  });

  test('markBillingPaid is idempotent', async () => {
    seedBilling([
      { id: BILLING_ID, seller_id: SELLER, status: 'pending', amount: 1000, plan_code: 'bronze' },
    ]);
    const first = await markBillingPaid({ billingId: BILLING_ID, paymentReference: 'pay_9', source: 'test' });
    expect(first).toBeTruthy();
    const second = await markBillingPaid({ billingId: BILLING_ID, paymentReference: 'pay_9', source: 'test' });
    expect(second).toBeNull();
  });
});

describe('billing history preservation', () => {
  test('historical paid cycles remain after new pending cycle', async () => {
    seedBilling([
      { id: 'sep', seller_id: SELLER, status: 'paid', amount: 1000, plan_code: 'bronze', billing_period: 'Sep 2026 – Oct 2026', current_period_end: pastISO(1), created_at: '2026-09-01' },
    ]);
    const created = await ensureNextPeriod(SELLER);
    expect(created).toBeTruthy();
    expect(created.plan_code).toBe('bronze');
    expect(billingStore.find((b) => b.id === 'sep').status).toBe('paid');
    expect(billingStore.filter((b) => b.status === 'pending')).toHaveLength(1);
  });
});

describe('admin routes + metrics', () => {
  test('admin list returns enriched rows with plan_code from same source', async () => {
    seedBilling([
      { id: BILLING_ID, seller_id: SELLER, status: 'paid', amount: 1500, plan_code: 'gold', created_at: new Date().toISOString() },
    ]);
    const res = mockRes();
    await listAllBilling({ query: {} }, res);
    const rows = res.json.mock.calls[0][0];
    expect(rows[0].plan_code).toBe('gold');
    expect(rows[0].plan_name).toBe('Gold Circle');
  });

  test('admin retry eligible record works; paid cannot retry', async () => {
    seedBilling([
      { id: BILLING_ID, seller_id: SELLER, status: 'overdue', amount: 1500, plan_code: 'gold', paymongo_checkout_session_id: null, updated_at: pastISO(2), created_at: new Date().toISOString() },
    ]);
    getCheckoutSession.mockRejectedValue(new Error('none'));
    const ok = mockRes();
    await adminRetryBilling(Object.assign(reqUser(ADMIN, 'admin'), { params: { id: BILLING_ID } }), ok);
    expect(ok.json.mock.calls[0][0].checkout_url).toBeTruthy();

    billingStore[0].status = 'paid';
    const bad = mockRes();
    await adminRetryBilling(Object.assign(reqUser(ADMIN, 'admin'), { params: { id: BILLING_ID } }), bad);
    expect(bad.status).toHaveBeenCalledWith(409);
  });

  test('MRR uses current active subscriptions only (not all historical paid rows)', () => {
    const records = [
      { id: '1', seller_id: SELLER, status: 'paid', amount: 1000, plan_code: 'bronze', current_period_end: pastISO(3), created_at: '2026-08-01' },
      { id: '2', seller_id: SELLER, status: 'paid', amount: 1000, plan_code: 'bronze', current_period_end: futureISO(20), created_at: '2026-09-01' },
      { id: '3', seller_id: OTHER, status: 'paid', amount: 1500, plan_code: 'gold', current_period_end: futureISO(20), created_at: '2026-09-01' },
    ];
    const m = computeSubscriptionMetricsFromRecords(records);
    // Seller has ONE current active bronze (not 2× historical)
    expect(m.mrr).toBe(1000 + 1500);
    expect(m.arr).toBe(m.mrr * 12);
    expect(m.activeCount).toBe(2);
    expect(m.planCounts.bronze.subscribers).toBe(1);
    expect(m.planCounts.gold.subscribers).toBe(1);
    expect(m.planCounts.platinum.subscribers).toBe(0);
  });

  test('pending + past due counts use current cycle', () => {
    const records = [
      { id: '1', seller_id: SELLER, status: 'overdue', amount: 1000, plan_code: 'bronze', due_date: pastISO(2), created_at: new Date().toISOString() },
      { id: '2', seller_id: OTHER, status: 'pending', amount: 1500, plan_code: 'gold', due_date: futureISO(5), created_at: new Date().toISOString() },
    ];
    const m = computeSubscriptionMetricsFromRecords(records);
    expect(m.pastDueCount).toBe(1);
    expect(m.pendingCount).toBe(1);
    expect(m.pastDueMrr).toBe(1000);
  });

  test('plan catalog endpoint returns all three plans', async () => {
    const res = mockRes();
    await listSubscriptionPlans({}, res);
    const body = res.json.mock.calls[0][0];
    expect(body.plans).toHaveLength(3);
    expect(body.plans.map((p) => p.code)).toEqual(['bronze', 'gold', 'platinum']);
  });
});

describe('security surface', () => {
  test('buildSubscriptionSummary preserves history totals', () => {
    const records = [
      { id: 'a', seller_id: SELLER, status: 'paid', amount: 1000, plan_code: 'bronze', current_period_end: pastISO(5), created_at: '2026-08-01' },
      { id: 'b', seller_id: SELLER, status: 'pending', amount: 1000, plan_code: 'bronze', current_period_end: futureISO(20), due_date: futureISO(20), created_at: '2026-09-01' },
    ];
    const s = buildSubscriptionSummary(records);
    expect(s.total_paid).toBe(1000);
    expect(s.total_due).toBe(1000);
    expect(s.next_payment.mode).toBe('open_invoice');
    expect(s.subscription_status).toBe('pending');
  });
});
