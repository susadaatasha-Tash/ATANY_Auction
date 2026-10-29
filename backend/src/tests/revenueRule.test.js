// backend/src/tests/revenueRule.test.js
// REVENUE SEMANTICS REGRESSION SUITE.
//
// Locks in ONE authoritative definition of recognized revenue across every admin
// surface, so a future change to one screen cannot silently diverge from another.
//
// The rule (services/revenueRule.js): an order counts as revenue ONLY when a
// payment reached 'paid'. orders.status is a fulfillment axis and is never used
// to decide recognition. This is what the lifecycle actually supports — see the
// header comment in that module for the traced evidence.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const poolQuery = vi.hoisted(() => vi.fn());
vi.mock('../db/pool.js', () => ({ pool: { query: poolQuery } }));
vi.mock('../services/auctionPresence.js', () => ({ watcherCount: () => 0 }));

import {
  isPaidPayment,
  pickDecidingPayment,
  isRecognizedRevenueOrder,
  recognizedRevenue,
  recognizedRevenueTotals,
  REVENUE_RULE_ID,
  PAID_PAYMENT_STATUS,
} from '../services/revenueRule.js';
import { getAnalytics } from '../controllers/admin/analytics.controller.js';
import { listBranchMonitorOverview, getBranchOverview } from '../controllers/admin/branchMonitor.controller.js';

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

function mockRes() {
  const r = {};
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  return r;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The matrix below IS the specification. Every cell is a real, reachable state.
 * ──────────────────────────────────────────────────────────────────────────── */
const ORDERS = [
  { id: 'o-completed-paid', status: 'completed', amount: 50000, branch_id: 'b1', created_at: new Date().toISOString() },
  { id: 'o-preparing-paid', status: 'preparing', amount: 40000, branch_id: 'b1', created_at: new Date().toISOString() },
  { id: 'o-ready-paid', status: 'ready_pickup', amount: 30000, branch_id: 'b1', created_at: new Date().toISOString() },
  { id: 'o-pending-paid', status: 'pending', amount: 20000, branch_id: 'b1', created_at: new Date().toISOString() },
  // ── the money that is NOT collected ──────────────────────────────────────
  { id: 'o-pending-nopay', status: 'pending', amount: 90000, branch_id: 'b1', created_at: new Date().toISOString() },
  { id: 'o-pending-failed', status: 'pending', amount: 80000, branch_id: 'b1', created_at: new Date().toISOString() },
  { id: 'o-pending-expired-pay', status: 'pending', amount: 70000, branch_id: 'b1', created_at: new Date().toISOString() },
  { id: 'o-pending-cancelled', status: 'pending', amount: 60000, branch_id: 'b1', created_at: new Date().toISOString() },
  { id: 'o-ready-nopay', status: 'ready_pickup', amount: 55000, branch_id: 'b1', created_at: new Date().toISOString() },
  { id: 'o-expired-nopay', status: 'expired', amount: 45000, branch_id: 'b1', created_at: new Date().toISOString() },
];
const PAYMENTS = [
  { order_id: 'o-completed-paid', status: 'paid', paid_at: '2026-10-01', created_at: '2026-10-01' },
  { order_id: 'o-preparing-paid', status: 'paid', paid_at: '2026-10-02', created_at: '2026-10-02' },
  { order_id: 'o-ready-paid', status: 'paid', paid_at: '2026-10-03', created_at: '2026-10-03' },
  { order_id: 'o-pending-paid', status: 'paid', paid_at: '2026-10-04', created_at: '2026-10-04' },
  { order_id: 'o-pending-failed', status: 'failed', created_at: '2026-10-04' },
  { order_id: 'o-pending-expired-pay', status: 'expired', created_at: '2026-10-04' },
  { order_id: 'o-pending-cancelled', status: 'cancelled', created_at: '2026-10-04' },
];
// 140,000 recognized · 355,000 collected-but-not-paid · total 495,000

function seed({ branchRows = [{ id: 'b1', name: 'Gmall Branch', status: 'Open' }] } = {}) {
  poolQuery.mockImplementation(async (sql, params = []) => {
    const s = String(sql);
    if (/FROM payments WHERE order_id IN/.test(s)) {
      return { rows: PAYMENTS.filter((p) => params.includes(p.order_id)) };
    }
    if (/FROM orders WHERE branch_id IS NOT NULL/.test(s)) return { rows: ORDERS };
    if (/FROM orders ORDER BY created_at DESC/.test(s)) return { rows: ORDERS };
    if (/FROM branches ORDER BY name/.test(s)) return { rows: branchRows };
    if (/FROM branches WHERE id=\$1/.test(s)) return { rows: branchRows.filter((b) => b.id === params[0]) };
    if (/FROM shops/.test(s)) return { rows: [] };
    if (/FROM products WHERE shop_id IN/.test(s)) return { rows: [] };
    if (/FROM auctions WHERE product_id IN/.test(s)) return { rows: [] };
    if (/FROM auctions a/.test(s)) return { rows: [] };
    if (/FROM orders WHERE created_at >= \$2/.test(s)) return { rows: [] };
    if (/FROM orders ORDER BY start_time/.test(s)) return { rows: [] };
    if (/FROM users ORDER BY created_at/.test(s)) return { rows: [] };
    if (/FROM bids ORDER BY created_at/.test(s)) return { rows: [] };
    return { rows: [] };
  });
}

beforeEach(() => poolQuery.mockReset());

describe('the rule itself', () => {
  test('only a paid payment is money received', () => {
    ['paid'].forEach((s) => expect(isPaidPayment({ status: s })).toBe(true));
    ['pending', 'processing', 'failed', 'cancelled', 'expired', '', null, undefined].forEach((s) => {
      expect(isPaidPayment({ status: s })).toBe(false);
    });
    expect(PAID_PAYMENT_STATUS).toBe('paid');
    expect(REVENUE_RULE_ID).toBe('paid-payments-v1');
  });

  test('a paid payment always wins over a newer failed one (race safety)', () => {
    const paid = { status: 'paid', paid_at: '2026-10-01', created_at: '2026-10-01' };
    const newerFail = { status: 'failed', created_at: '2026-10-05' };
    expect(pickDecidingPayment([paid, newerFail])).toBe(paid);
    expect(pickDecidingPayment([newerFail, paid])).toBe(paid);
    expect(pickDecidingPayment([])).toBeNull();
  });

  test('order status is never consulted for recognition', () => {
    ['pending', 'preparing', 'ready_pickup', 'completed', 'expired'].forEach((status) => {
      // same payment state → same recognition, whatever the fulfillment state
      expect(isRecognizedRevenueOrder({ status, payment: { status: 'paid' } })).toBe(true);
      expect(isRecognizedRevenueOrder({ status, payment: { status: 'pending' } })).toBe(false);
      expect(isRecognizedRevenueOrder({ status, payment: null })).toBe(false);
    });
  });

  test('the full lifecycle matrix recognizes exactly the paid orders', () => {
    const paymentsByOrder = {};
    PAYMENTS.forEach((p) => { (paymentsByOrder[p.order_id] ||= []).push(p); });
    const { total, count } = recognizedRevenue(ORDERS, (o) => paymentsByOrder[o.id] || []);
    expect(count).toBe(4);
    expect(total).toBe(140000);
    // the three that the OLD rule counted and this one must not
    const excluded = ['o-pending-nopay', 'o-pending-failed', 'o-pending-expired-pay', 'o-pending-cancelled', 'o-ready-nopay', 'o-expired-nopay'];
    excluded.forEach((id) => {
      expect(recognizedRevenue([ORDERS.find((o) => o.id === id)], () => []).total).toBe(0);
    });
    // 'preparing' is revenue even though the OLD rule excluded it
    expect(recognizedRevenue([ORDERS.find((o) => o.id === 'o-preparing-paid')], () => [PAYMENTS[1]]).total).toBe(40000);
  });

  test('an unreachable payments table reports zero rather than inflating revenue', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/FROM payments/.test(String(sql))) throw new Error('relation "payments" does not exist');
      return { rows: [] };
    });
    const { total } = await recognizedRevenueTotals({ query: poolQuery }, ORDERS);
    expect(total).toBe(0);
  });
});

describe('every admin revenue surface uses the SAME rule', () => {
  test('Admin Dashboard / Reports KPI and CSV', async () => {
    seed();
    const res = mockRes();
    await getAnalytics({ query: { bucket: 'month', range: '6' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.kpis.totalRevenue).toBe(140000);
    expect(body.revenueRule.id).toBe(REVENUE_RULE_ID);
    // trend, branch split and top items are all recognized-only too
    expect(body.revenueTrend.reduce((s, b) => s + b.value, 0)).toBe(140000);
    expect(body.branchRevenue.reduce((s, b) => s + b.value, 0)).toBe(140000);
  });

  test('Admin Branches — Monthly Revenue KPI and per-branch Revenue', async () => {
    seed();
    const res = mockRes();
    await listBranchMonitorOverview({ user: { id: 'admin' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.kpis.monthly_revenue).toBe(140000);
    expect(body.branches[0].revenue).toBe(140000);
    expect(body.kpis.revenue_rule).toBe(REVENUE_RULE_ID);
  });

  test('Branch Details — Branch Revenue', async () => {
    seed();
    const res = mockRes();
    await getBranchOverview({ params: { id: 'b1' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.kpis.revenue).toBe(140000);
    expect(body.branch.revenue).toBe(140000);
  });

  test('no admin revenue query filters on orders.status any more', () => {
    const analytics = read('../controllers/admin/analytics.controller.js');
    const branchMon = read('../controllers/admin/branchMonitor.controller.js');
    [analytics, branchMon].forEach((src) => {
      // no status allow-list, and no status-based revenue predicate
      expect(src).not.toMatch(/status\s*=\s*ANY\(/);
      expect(src).not.toMatch(/REVENUE_STATUSES\s*=/);
      expect(src).not.toMatch(/orders\.status\s*(=|IN)/i);
    });
  });

  test('the removed REVENUE_STATUSES list is gone from the codebase', () => {
    const analytics = read('../controllers/admin/analytics.controller.js');
    expect(analytics).toMatch(/services\/revenueRule\.js/);
    expect(analytics).not.toMatch(/export const REVENUE_STATUSES/);
  });

  test('seller dashboard and admin platform revenue agree by construction', () => {
    // sellerSales.js was already payment-based; it must keep importing the same
    // authority rather than re-implementing a status filter.
    const sellerSales = read('../services/sellerSales.js');
    expect(sellerSales).toMatch(/payment\?\.status === 'paid'/);
    expect(sellerSales).not.toMatch(/statusList|REVENUE_STATUSES/);
  });

  test('no admin surface silently reports zero revenue (the old GROUP BY trap)', () => {
    const branchMon = read('../controllers/admin/branchMonitor.controller.js');
    // SUM(...) GROUP BY is untranslatable under the pool's REST fallback and
    // returned { rows: [] } with HTTP 200, i.e. every branch showed ₱0.
    expect(branchMon).not.toMatch(/SUM\s*\(/i);
  });
});