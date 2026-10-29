// backend/src/tests/manualPayment.test.js
// PAYMENT LIFECYCLE INTEGRITY — counter/manual payment + admin mark-paid.
//
// Regression suite for the two holes that let a real payment exist with no
// financial evidence:
//   1. POST /customer/orders/:id/pay  (counter) set orders.status and nothing else
//   2. PATCH /admin/transactions/:id/pay wrote ready_pickup with no payment and
//      no transition validation
//
// Invariants locked here: payment and fulfillment are separate state machines,
// an unpaid order can never be "paid" by status alone, a paid order always has
// authoritative evidence, retries are idempotent, amounts come from the server,
// and money received is never handed to two different buyers.
import { describe, test, expect, vi, beforeEach } from 'vitest';

// The money path now runs inside a real transaction that holds the ORDER row
// lock (services/manualPayment.js + services/paymentRaceGuard.js), so the mock
// pool must be able to hand out a transaction client.
const { poolQuery, txClient } = vi.hoisted(() => {
  const poolQuery = vi.fn();
  const txClient = {
    query: async (sql, params) => {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i.test(String(sql))) return { rows: [], rowCount: 0 };
      return poolQuery(sql, params);
    },
    release: () => {},
  };
  return { poolQuery, txClient };
});
vi.mock('../db/pool.js', () => ({
  pool: { query: poolQuery, connect: async () => txClient },
  isDirectPg: () => true,
}));

import {
  recordManualPayment, applyOrderTransition, advanceOrderTo,
  hasPaidPayment, canAcceptManualPayment, MANUAL_PROVIDER, ALLOWED_TRANSITIONS,
} from '../services/manualPayment.js';
import { payOrder } from '../controllers/customer/order.controller.js';
import { markPaid, updateOrderStatus } from '../controllers/admin/transaction.controller.js';
import { recognizedRevenue, isRecognizedRevenueOrder } from '../services/revenueRule.js';

const BUYER = 'user-buyer';
const OTHER_USER = 'user-other';
const ADMIN = 'user-admin';

function orderRow(over = {}) {
  return {
    id: 'order-1', auction_id: 'a1', buyer_id: BUYER, amount: 45000,
    branch_id: 'b1', status: 'pending', created_at: new Date().toISOString(),
    winner_confirmed_at: new Date().toISOString(),
    payment_deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    winner_rank: 1, ...over,
  };
}

/** In-memory payments table that honours the one-paid-per-order invariant. */
function seed({ order = orderRow(), payments = [], paidPayments = null } = {}) {
  const table = [...payments];
  poolQuery.mockImplementation(async (sql, params = []) => {
    const s = String(sql);
    if (/FROM orders WHERE id=\$1/.test(s)) {
      const row = String(s).includes('SELECT status FROM orders')
        ? { status: order.status }
        : order;
      return { rows: [row] };
    }
    if (/FROM payments WHERE order_id=\$1 ORDER BY created_at/.test(s)) return { rows: table };
    if (/FROM payments WHERE order_id=\$1 AND status='paid'/.test(s)) {
      return { rows: table.filter((p) => p.status === 'paid').slice(0, 1) };
    }
    if (/UPDATE payments/.test(s) && /status='paid'/.test(s)) {
      const row = table.find((p) => p.id === params[3]);
      if (!row || !['pending', 'processing', 'failed', 'expired', 'cancelled'].includes(row.status)) return { rows: [] };
      row.status = 'paid';
      row.amount = params[0];
      row.payment_method = params[1];
      row.paid_at = new Date().toISOString();
      return { rows: [row] };
    }
    if (/INSERT INTO payments/.test(s)) {
      if (paidPayments) return paidPayments(table, params);
      const row = {
        id: `pay-${table.length + 1}`,
        order_id: params[0], customer_id: params[1], provider: params[2],
        provider_reference_id: null, checkout_session_id: null,
        amount: params[3], currency: 'PHP', payment_method: params[4],
        status: 'paid', paid_at: new Date().toISOString(), metadata: JSON.parse(params[5]),
      };
      table.push(row);
      return { rows: [row] };
    }
    if (/UPDATE orders SET status=\$1 WHERE id=\$2/.test(s)) {
      order.status = params[0];
      return { rows: [{ ...order }] };
    }
    if (/FROM notifications/.test(s)) return { rows: [] };
    if (/FROM users/.test(s)) return { rows: [{ id: BUYER }] };
    return { rows: [] };
  });
  return { table, order };
}

const sqlOf = (frag) => poolQuery.mock.calls.map(([s]) => String(s)).filter((s) => frag.test(s));

function mockRes() {
  const r = {};
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  return r;
}

beforeEach(() => poolQuery.mockReset());

/* ── 1-3. counter payment produces authoritative evidence ─────────────────── */
describe('1-3. counter payment creates an authoritative paid payment', () => {
  test('1. successful counter payment creates a paid payment row with no fabricated gateway ids', async () => {
    seed();
    const res = await recordManualPayment({ orderId: 'order-1', actorId: BUYER, paymentMethod: 'counter' });
    expect(res.ok).toBe(true);
    expect(res.created).toBe(true);
    expect(res.payment.status).toBe('paid');
    expect(res.payment.provider).toBe(MANUAL_PROVIDER);
    expect(res.payment.paid_at).toBeTruthy();
    // the schema explicitly permits NULL here — that is what "no gateway" means
    expect(res.payment.provider_reference_id).toBeNull();
    expect(res.payment.checkout_session_id).toBeNull();
    const insert = sqlOf(/INSERT INTO payments/)[0];
    expect(insert).toMatch(/VALUES \(\$1,\$2,\$3,NULL,NULL/);
  });

  test('2. revenueRule recognizes a counter-paid order exactly like a gateway order', async () => {
    const { table } = seed();
    await recordManualPayment({ orderId: 'order-1', actorId: BUYER });
    const o = orderRow({ status: 'ready_pickup' });
    const payments = table.map((p) => ({ ...p }));
    expect(recognizedRevenue([o], () => payments).total).toBe(45000);
    expect(isRecognizedRevenueOrder({ payment: payments[0] })).toBe(true);
  });

  test('3. an unpaid counter order is NOT recognized', async () => {
    const o = orderRow();
    expect(recognizedRevenue([o], () => []).total).toBe(0);
    expect(recognizedRevenue([o], () => [{ status: 'failed' }]).total).toBe(0);
  });
});

/* ── 4. winner expiration interaction ──────────────────────────────────────── */
describe('4. a paid order is never rotated as unpaid', () => {
  test('winnerExpiration sees the counter payment as paid evidence', async () => {
    const { table } = seed();
    await recordManualPayment({ orderId: 'order-1', actorId: BUYER });
    // exactly the predicate services/winnerExpiration.js uses
    const paid = table.some((p) => p.status === 'paid' && p.order_id === 'order-1');
    expect(paid).toBe(true);
    expect(await hasPaidPayment('order-1')).toBe(true);
  });

  test('an unpaid order remains unpaid evidence and stays rotation-eligible', async () => {
    seed();
    expect(await hasPaidPayment('order-1')).toBe(false);
  });
});

/* ── 5. admin mark-paid integrity ─────────────────────────────────────────── */
describe('5. admin mark-paid requires real payment evidence', () => {
  test('5. admin pay cannot move an unpaid order straight to ready_pickup', async () => {
    seed();
    const res = mockRes();
    await markPaid({ params: { id: 'order-1' }, user: { id: ADMIN }, body: {} }, res);
    // it now records the payment first, then advances ONE legal step
    expect(res.json.mock.calls[0][0].payment_status).toBe('paid');
    expect(res.json.mock.calls[0][0].status).toBe('preparing');
    expect(sqlOf(/UPDATE orders SET status='ready_pickup'/)).toHaveLength(0);
    expect(sqlOf(/INSERT INTO payments/)).toHaveLength(1);
  });

  test('admin pay on an already advanced order records payment without touching fulfillment', async () => {
    seed({ order: orderRow({ status: 'ready_pickup' }) });
    const res = mockRes();
    await markPaid({ params: { id: 'order-1' }, user: { id: ADMIN }, body: {} }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe('ready_pickup');
    expect(body.payment_status).toBe('paid');
    expect(sqlOf(/UPDATE orders SET status=/)).toHaveLength(0);
  });

  test('admin pay rejects an unknown order', async () => {
    seed({ order: null });
    const res = mockRes();
    await markPaid({ params: { id: 'nope' }, user: { id: ADMIN }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('admin pay refuses an expired order (the 7-day rule already decided nobody paid)', async () => {
    seed({ order: orderRow({ status: 'expired' }) });
    const res = mockRes();
    await markPaid({ params: { id: 'order-1' }, user: { id: ADMIN }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(sqlOf(/INSERT INTO payments/)).toHaveLength(0);
  });

  test('expired is the only state that cannot take a payment', () => {
    expect(canAcceptManualPayment({ status: 'expired' }).ok).toBe(false);
    ['pending', 'preparing', 'ready_pickup', 'completed'].forEach((st) => {
      expect(canAcceptManualPayment({ status: st }).ok).toBe(true);
    });
  });
});

/* ── 6. idempotency ───────────────────────────────────────────────────────── */
describe('6. repeated confirmation is idempotent', () => {
  test('6a. counter paid twice creates exactly one paid payment', async () => {
    seed();
    const first = await recordManualPayment({ orderId: 'order-1', actorId: BUYER });
    const second = await recordManualPayment({ orderId: 'order-1', actorId: BUYER });
    expect(first.created).toBe(true);
    expect(second.alreadyPaid).toBe(true);
    expect(second.created).toBe(false);
    expect(sqlOf(/INSERT INTO payments/)).toHaveLength(1);
    expect(second.payment.id).toBe(first.payment.id);
  });

  test('6b. an existing pending attempt is claimed, not duplicated', async () => {
    seed({ payments: [{ id: 'pay-x', order_id: 'order-1', customer_id: BUYER, amount: 45000, status: 'pending', created_at: '2026-01-01' }] });
    const res = await recordManualPayment({ orderId: 'order-1', actorId: BUYER });
    expect(res.created).toBe(false);
    expect(res.payment.id).toBe('pay-x');
    expect(res.payment.status).toBe('paid');
    expect(sqlOf(/INSERT INTO payments/)).toHaveLength(0);
  });

  test('6c. a terminal paid payment is never rewritten', async () => {
    const { table } = seed();
    await recordManualPayment({ orderId: 'order-1', actorId: BUYER });
    const before = JSON.stringify(table);
    await recordManualPayment({ orderId: 'order-1', actorId: BUYER });
    expect(JSON.stringify(table)).toBe(before);
  });

  test('6d. a concurrent paid race returns the winner instead of throwing', async () => {
    seed({
      // the other tab commits between our read and our insert
      paidPayments: (table, params) => {
        table.push({
          id: 'pay-other-tab', order_id: params[0], customer_id: params[1],
          provider: 'paymongo', amount: params[3], status: 'paid',
          paid_at: new Date().toISOString(), created_at: new Date().toISOString(),
        });
        const e = new Error('duplicate key value violates unique constraint');
        e.code = '23505';
        throw e;
      },
    });
    const res = await recordManualPayment({ orderId: 'order-1', actorId: BUYER });
    expect(res.ok).toBe(true);
    expect(res.payment.id).toBe('pay-other-tab');
    expect(res.alreadyPaid).toBe(true);
  });
});

/* ── 7. authoritative amount ──────────────────────────────────────────────── */
describe('7. the amount always comes from the server order', () => {
  test('7a. a client-supplied amount is ignored entirely', async () => {
    seed();
    const res = await recordManualPayment({ orderId: 'order-1', actorId: BUYER, amount: 1 });
    expect(res.payment.amount).toBe(45000);
    expect(sqlOf(/INSERT INTO payments/).length).toBe(1);
  });

  test('7b. the customer endpoint ignores amount in the body', async () => {
    seed();
    const res = mockRes();
    await payOrder({ params: { id: 'order-1' }, user: { id: BUYER }, body: { payment_method: 'counter', amount: 1 } }, res);
    const payment = JSON.parse(sqlOf(/INSERT INTO payments/).length ? '{}' : '{}');
    void payment;
    const rows = poolQuery.mock.calls.find(([s]) => /INSERT INTO payments/.test(String(s)));
    expect(rows[1][3]).toBe(45000); // the order amount parameter
  });
});

/* ── 8. cross-user access ─────────────────────────────────────────────────── */
describe('8. cross-user order access is rejected', () => {
  test('8a. a non-buyer cannot pay another customer order', async () => {
    seed();
    const res = await recordManualPayment({ orderId: 'order-1', actorId: OTHER_USER, expectedBuyerId: OTHER_USER });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('BUYER_MISMATCH');
    expect(sqlOf(/INSERT INTO payments/)).toHaveLength(0);
  });

  test('8b. the customer endpoint refuses another customer order', async () => {
    seed();
    const res = mockRes();
    await payOrder({ params: { id: 'order-1' }, user: { id: OTHER_USER }, body: { payment_method: 'counter' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(sqlOf(/UPDATE orders SET status=/)).toHaveLength(0);
  });
});

/* ── 9. authorization ─────────────────────────────────────────────────────── */
describe('9. admin-only surface stays admin-only', () => {
  test('9. markPaid and updateOrderStatus are mounted under the admin middleware', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    const routesSrc = fs.readFileSync(path.join(__dirname, '../routes/admin.routes.js'), 'utf8');
    expect(indexSrc).toMatch(/app\.use\('\/admin',\s*requireAuth,\s*requireRole\(\['admin'\]\),\s*adminRoutes\)/);
    expect(routesSrc).toMatch(/router\.patch\('\/transactions\/:id\/pay', markPaid\)/);
    expect(routesSrc).toMatch(/router\.patch\('\/orders\/:id\/status', updateOrderStatus\)/);
    // and no customer/seller/public route file exposes these handlers
    const customerRoutes = fs.readFileSync(path.join(__dirname, '../routes/customer.routes.js'), 'utf8');
    const sellerRoutes = fs.readFileSync(path.join(__dirname, '../routes/shop-owner.routes.js'), 'utf8');
    expect(customerRoutes).not.toMatch(/markPaid|transactions\/\:id\/pay/);
    expect(sellerRoutes).not.toMatch(/markPaid|transactions\/\:id\/pay/);
  });
});

/* ── 10. gateway flow untouched ───────────────────────────────────────────── */
describe('10. the PayMongo flow is unchanged', () => {
  test('10. no manual-payment logic leaked into the gateway controller', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, '../controllers/customer/payment.controller.js'), 'utf8');
    expect(src).not.toMatch(/recordManualPayment|manualPayment/);
    // gateway rows are still created pending, then claimed by the webhook
    expect(src).toMatch(/INSERT INTO payments \(order_id, customer_id, amount, currency, payment_method, status\) VALUES \(\$1,\$2,\$3,'PHP',\$4,'pending'\)/);
  });
});

/* ── 11. fulfillment still requires payment ───────────────────────────────── */
describe('11. fulfillment states remain payment-gated', () => {
  test('11a. preparing is refused without a paid payment', async () => {
    seed();
    const res = await applyOrderTransition('order-1', 'preparing');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('PAYMENT_NOT_CONFIRMED');
  });

  test('11b. after payment the same transition succeeds', async () => {
    const { order } = seed();
    await recordManualPayment({ orderId: 'order-1', actorId: BUYER });
    const res = await applyOrderTransition('order-1', 'preparing');
    expect(res.ok).toBe(true);
    expect(order.status).toBe('preparing');
  });

  test('11c. an illegal transition is refused', async () => {
    seed();
    const res = await applyOrderTransition('order-1', 'completed');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('INVALID_TRANSITION');
  });

  test('11d. admin status endpoint still enforces transitions + payment', async () => {
    seed();
    const res = mockRes();
    await updateOrderStatus({ params: { id: 'order-1' }, user: { id: ADMIN }, body: { status: 'completed' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(sqlOf(/UPDATE orders SET status=\$1/)).toHaveLength(0);
  });
});

/* ── 12. revenue surfaces unaffected ──────────────────────────────────────── */
describe('12. no regression to admin revenue totals', () => {
  test('12. a counter sale flows straight into the shared revenue rule', async () => {
    const { table } = seed({ order: orderRow({ amount: 45000 }) });
    const before = recognizedRevenue([orderRow({ amount: 45000 })], () => []).total;
    expect(before).toBe(0);

    await recordManualPayment({ orderId: 'order-1', actorId: BUYER });
    await advanceOrderTo('order-1', 'ready_pickup');

    const after = recognizedRevenue([orderRow({ status: 'ready_pickup' })], () => table).total;
    expect(after).toBe(45000);
  });

  test('12b. revenueRule itself was not weakened by this change', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const rule = fs.readFileSync(path.join(__dirname, '../services/revenueRule.js'), 'utf8');
    expect(rule).toMatch(/PAID_PAYMENT_STATUS = 'paid'/);
    expect(rule).not.toMatch(/counter|manual/i);
  });
});