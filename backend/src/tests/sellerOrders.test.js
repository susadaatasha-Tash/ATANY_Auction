// Seller order surface: list payload + status mutation (was untested).
// Covers ownership, batching, transition validation and the
// payment-before-fulfillment rule.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const poolQuery = vi.hoisted(() => vi.fn());
const poolConnect = vi.hoisted(() => vi.fn());
vi.mock('../db/pool.js', () => ({ pool: { query: poolQuery, connect: poolConnect } }));

import { listSales, updateOrderStatus, cancelOrder } from '../controllers/shop-owner/sales.controller.js';

const SHOP = 'shop-1';
const OWN_SHOP = 'shop-2';

function mockRes() {
  const r = {};
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  return r;
}

let activeOperation;
function makeClient() {
  const query = vi.fn(async (sql, params = []) => {
    if (/INSERT INTO payment_operations/.test(sql)) { activeOperation=params[0]; return {rows:[]}; }
    if (/SELECT \* FROM payment_operations/.test(sql)) return {rows:[]};
    if (/SELECT id FROM payment_operations/.test(sql)) return {rows:[{id:activeOperation}]};
    if (/UPDATE payment_operations/.test(sql)) return {rows:[]};
    return poolQuery(sql,params);
  });
  const release = vi.fn();
  return { query, release };
}

/** SQL-routing mock. `ownShop` flips which shop the session resolves to. */
function seed({ ownShop = true, orders = null, payments = [], branches = [] } = {}) {
  const defaultOrders = [
    {
      id: 'o1', auction_id: 'a1', buyer_id: 'b1', amount: 71000, status: 'pending',
      branch_id: 'br1', payment_method: null,
      created_at: '2026-10-11T02:24:00Z', transaction_code: 'TXN-9009',
    },
  ];
  const orderRows = orders || defaultOrders;
  poolQuery.mockImplementation(async (sql, params = []) => {
    const s = String(sql);
    if (/SELECT s.id FROM shops s JOIN products/.test(s)) return {rows:ownShop ? [{id:SHOP}] : []};
    if (/^\s*BEGIN/i.test(s)) return { rows: [], rowCount: 0 };
    if (/^\s*COMMIT/i.test(s)) return { rows: [], rowCount: 0 };
    if (/^\s*ROLLBACK/i.test(s)) return { rows: [], rowCount: 0 };
    if (/FROM shops WHERE user_id/.test(s)) return { rows: [{ id: ownShop ? SHOP : OWN_SHOP }] };
    if (/FROM products WHERE shop_id/.test(s)) return { rows: [{ id: 'p1' }, { id: 'p2' }] };
    if (/FROM auctions WHERE product_id IN/.test(s)) return { rows: [{ id: 'a1', product_id: 'p1' }] };
    if (/FROM orders WHERE auction_id IN/.test(s)) return { rows: orderRows };
    if (/FROM products WHERE id IN/.test(s)) return { rows: [{ id: 'p1', name: 'TEST 1', image_url: null, category: 'Watches' }] };
    if (/FROM users WHERE id IN/.test(s)) return { rows: [{ id: 'b1', name: 'britz Susada' }] };
    if (/FROM payments WHERE order_id IN/.test(s)) return { rows: payments };
    if (/FROM branches WHERE id IN/.test(s)) return { rows: branches };
    if (/SELECT product_id FROM auctions WHERE id=/.test(s)) return { rows: [{ product_id: 'p1' }] };
    if (/SELECT shop_id, name FROM products WHERE id=/.test(s)) {
      return { rows: [{ shop_id: SHOP, name: 'TEST 1' }] };
    }
    if (/SELECT o.id, o.status, o.auction_id FROM orders o WHERE o.id=/.test(s)) {
      const found = orderRows.find((o) => o.id === 'o1');
      return { rows: found ? [{ id: found.id, status: found.status, auction_id: found.auction_id }] : [] };
    }
    // Cancel endpoint: SELECT * FROM orders WHERE id=$1 FOR UPDATE
    if (/SELECT \* FROM orders WHERE id=\$1 FOR UPDATE/.test(s)) {
      const found = orderRows.find((o) => o.id === 'o1');
      return { rows: found ? [{ ...found }] : [] };
    }
    // Cancel endpoint: payment eligibility check (paid or processing blocks cancellation)
    if (/FROM payments WHERE order_id=\$1 ORDER BY created_at/.test(s)) {
      return { rows: payments.filter((p) => p.status === 'paid' || p.status === 'processing') };
    }
    // Cancel endpoint: UPDATE orders SET status='cancelled', cancellation_reason=...
    if (/UPDATE\s+orders\s+SET\s+status='cancelled'/.test(s)) {
      return { rows: ownShop ? [{ id: 'o1', status: 'cancelled', cancellation_reason: 'Item no longer available', cancelled_at: new Date().toISOString(), cancelled_by: 'seller' }] : [] };
    }
    if (/FROM payments WHERE order_id=\$1 AND status='paid'/.test(s)) {
      return { rows: payments.some((x) => x.status === 'paid') ? [{ id: 'pay1' }] : [] };
    }
    if (/UPDATE orders o SET status/.test(s)) {
      return { rows: ownShop ? [{ id: 'o1', status: 'preparing' }] : [] };
    }
    if (/SELECT buyer_id FROM orders WHERE id=/.test(s)) return { rows: [{ buyer_id: 'b1' }] };
    if (/SELECT b.name as branch_name/.test(s)) return { rows: [{ branch_name: 'Gmall' }] };
    if (/INSERT INTO audit_logs/.test(s)) return { rows: [] };
    if (/INSERT INTO notifications/.test(s)) return { rows: [] };
    return { rows: [] };
  });
}

beforeEach(() => { poolQuery.mockReset(); poolConnect.mockReset(); poolConnect.mockResolvedValue(makeClient()); });

describe('GET /shop-owner/sales (list)', () => {
  test('returns the same persisted cancellation record the buyer sees',async()=>{
    seed({orders:[{id:'o1',auction_id:'a1',buyer_id:'b1',amount:71000,status:'cancelled',cancelled_by:'b1',cancelled_at:'2026-11-01T06:00:00Z',cancellation_reason:'Stored customer reason'}]});
    const res=mockRes();await listSales({user:{id:'seller'}},res);
    expect(res.json.mock.calls[0][0][0]).toMatchObject({status:'cancelled',cancelled_by:'b1',cancellation_reason:'Stored customer reason',cancelled_at:'2026-11-01T06:00:00Z'});
  });
  test('returns real records with backend-authoritative commission/payout', async () => {
    seed({
      payments: [{ order_id: 'o1', status: 'paid', payment_method: 'gcash', paid_at: '2026-10-11T03:00:00Z', created_at: '2026-10-11T03:00:00Z' }],
      branches: [{ id: 'br1', name: 'Gmall' }],
    });
    const res = mockRes();
    await listSales({ user: { id: 'seller' } }, res);
    const row = res.json.mock.calls[0][0][0];
    expect(row).toMatchObject({
      transaction_code: 'TXN-9009',
      item: 'TEST 1',
      category: 'Watches',
      buyer: 'britz Susada',
      amount: 71000,
      commission: 7100,
      payout: 63900,
      status: 'pending',
      payment_status: 'paid',
      payment_method: 'gcash',
      branch_name: 'Gmall',
    });
    // Sale Amount = Commission + Payout
    expect(row.amount).toBe(row.commission + row.payout);
  });

  test('batches payments in ONE query (no N+1)', async () => {
    seed({ payments: [{ order_id: 'o1', status: 'paid', payment_method: null, paid_at: null, created_at: '2026-10-11T03:00:00Z' }] });
    const res = mockRes();
    await listSales({ user: { id: 'seller' } }, res);
    const paymentQueries = poolQuery.mock.calls.filter(([sql]) => /FROM payments/.test(String(sql)));
    expect(paymentQueries).toHaveLength(1);
    expect(paymentQueries[0][0]).toContain('IN (');
  });

  test('a paid payment wins over a newer failed retry (matches KPI semantics)', async () => {
    seed({
      payments: [
        { order_id: 'o1', status: 'paid', payment_method: null, paid_at: '2026-10-11T03:00:00Z', created_at: '2026-10-11T03:00:00Z' },
        { order_id: 'o1', status: 'failed', payment_method: null, paid_at: null, created_at: '2026-10-12T09:00:00Z' },
      ],
    });
    const res = mockRes();
    await listSales({ user: { id: 'seller' } }, res);
    expect(res.json.mock.calls[0][0][0].payment_status).toBe('paid');
  });

  test('shop with no products returns an empty list (no crash)', async () => {
    poolQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (/^\s*BEGIN/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*COMMIT/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*ROLLBACK/i.test(s)) return { rows: [], rowCount: 0 };
      if (/FROM shops WHERE user_id/.test(s)) return { rows: [{ id: SHOP }] };
      if (/FROM products WHERE shop_id/.test(s)) return { rows: [] };
      return { rows: [] };
    });
    const res = mockRes();
    await listSales({ user: { id: 'seller' } }, res);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  test('shop resolved from the authenticated user only', async () => {
    seed({});
    const res = mockRes();
    await listSales({ user: { id: 'seller' }, query: { shop_id: OWN_SHOP }, body: { shop_id: OWN_SHOP } }, res);
    const shopQuery = poolQuery.mock.calls.find(([sql]) => /FROM shops WHERE user_id/.test(String(sql)));
    expect(shopQuery[1]).toEqual(['seller']);
  });
});

describe('PATCH /shop-owner/orders/:id/status', () => {
  test('blocked when payment is not paid (payment-before-fulfillment rule)', async () => {
    seed({ payments: [] });
    const res = mockRes();
    await updateOrderStatus(
      { user: { id: 'seller' }, params: { id: 'o1' }, body: { status: 'preparing' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/payment is confirmed/i);
    expect(poolQuery.mock.calls.some(([sql]) => /UPDATE orders o SET status/.test(String(sql)))).toBe(false);
  });

  test('invalid transition rejected (pending → completed)', async () => {
    seed({ payments: [{ order_id: 'o1', status: 'paid' }] });
    const res = mockRes();
    await updateOrderStatus(
      { user: { id: 'seller' }, params: { id: 'o1' }, body: { status: 'completed' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Invalid transition/);
  });

  test('unknown status rejected with 400', async () => {
    seed({});
    const res = mockRes();
    await updateOrderStatus(
      { user: { id: 'seller' }, params: { id: 'o1' }, body: { status: 'refunded' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('foreign seller order → 404 and no UPDATE is issued', async () => {
    seed({ ownShop: false });
    const res = mockRes();
    await updateOrderStatus(
      { user: { id: 'seller' }, params: { id: 'o1' }, body: { status: 'preparing' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toBe('Order not found');
    expect(poolQuery.mock.calls.some(([sql]) => /UPDATE orders o SET status/.test(String(sql)))).toBe(false);
  });

  test('valid paid transition succeeds and is tenant-scoped in the write', async () => {
    seed({ payments: [{ order_id: 'o1', status: 'paid' }] });
    const res = mockRes();
    await updateOrderStatus(
      { user: { id: 'seller' }, params: { id: 'o1' }, body: { status: 'preparing' } },
      res
    );
    const update = poolQuery.mock.calls.find(([sql]) => /UPDATE orders o SET status/.test(String(sql)));
    expect(update[0]).toMatch(/shop_id = \$3/); // ownership inside the statement
    expect(update[1]).toEqual(['preparing', 'o1', SHOP]);
    expect(res.json).toHaveBeenCalled();
  });
});

describe('PATCH /shop-owner/orders/:id/cancel', () => {
  test('empty cancellation reason rejected with 400', async () => {
    seed({ payments: [] });
    const res = mockRes();
    await cancelOrder({ user: { id: 'seller' }, params: { id: 'o1' }, body: { reason: '' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('CANCELLATION_REASON_REQUIRED');
  });

  test('whitespace-only cancellation reason rejected with 400', async () => {
    seed({ payments: [] });
    const res = mockRes();
    await cancelOrder({ user: { id: 'seller' }, params: { id: 'o1' }, body: { reason: '   ' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('CANCELLATION_REASON_REQUIRED');
  });

  test('paid order cannot be cancelled', async () => {
    seed({ payments: [{ order_id: 'o1', status: 'paid' }] });
    const res = mockRes();
    await cancelOrder({ user: { id: 'seller' }, params: { id: 'o1' }, body: { reason: 'Changed my mind' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('PAYMENT_NOT_CANCELLABLE');
    // No cancellation UPDATE issued
    expect(poolQuery.mock.calls.some(([sql]) => /cancellation_reason/.test(String(sql)))).toBe(false);
  });

  test('processing payment means order cannot be cancelled', async () => {
    seed({ payments: [{ order_id: 'o1', status: 'processing' }] });
    const res = mockRes();
    await cancelOrder({ user: { id: 'seller' }, params: { id: 'o1' }, body: { reason: 'Changed my mind' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('PAYMENT_NOT_CANCELLABLE');
  });

  test('already cancelled order rejected with 409', async () => {
    seed({
      orders: [{ id: 'o1', auction_id: 'a1', buyer_id: 'b1', amount: 71000, status: 'cancelled', branch_id: 'br1', payment_method: null, created_at: '2026-10-11T02:24:00Z', transaction_code: 'TXN-9009' }],
    });
    const res = mockRes();
    await cancelOrder({ user: { id: 'seller' }, params: { id: 'o1' }, body: { reason: 'Duplicate' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('ALREADY_CANCELLED');
  });

  test('non-pending order (e.g. completed) cannot be cancelled', async () => {
    seed({
      orders: [{ id: 'o1', auction_id: 'a1', buyer_id: 'b1', amount: 71000, status: 'completed', branch_id: 'br1', payment_method: null, created_at: '2026-10-11T02:24:00Z', transaction_code: 'TXN-9009' }],
      payments: [],
    });
    const res = mockRes();
    await cancelOrder({ user: { id: 'seller' }, params: { id: 'o1' }, body: { reason: 'Changed my mind' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('ORDER_NOT_CANCELLABLE');
  });

  test('foreign seller order → 404 and no cancellation UPDATE', async () => {
    seed({ ownShop: false, payments: [] });
    const res = mockRes();
    await cancelOrder({ user: { id: 'seller' }, params: { id: 'o1' }, body: { reason: 'Changed my mind' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toBe('Order not found');
    expect(poolQuery.mock.calls.some(([sql]) => /cancellation_reason/.test(String(sql)))).toBe(false);
  });

  test('eligible unpaid order can be cancelled with reason persisted', async () => {
    seed({ payments: [] });
    const res = mockRes();
    await cancelOrder(
      { user: { id: 'seller' }, params: { id: 'o1' }, body: { reason: 'Item no longer available' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const update = poolQuery.mock.calls.find(([sql]) => /cancellation_reason/.test(String(sql)));
    expect(update).toBeTruthy();
    expect(update[0]).toMatch(/s.user_id=\$3/); // ownership inside the statement
    expect(update[1]).toEqual(['o1', 'Item no longer available', 'seller']);
    expect(res.json.mock.calls[0][0].status).toBe('cancelled');
    expect(res.json.mock.calls[0][0].cancellation_reason).toBe('Item no longer available');
    expect(res.json.mock.calls[0][0].cancelled_by).toBe('seller');
  });
});

describe('seller orders security contract', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../controllers/shop-owner/sales.controller.js'),
    'utf8'
  );
  const routesSrc = fs.readFileSync(path.join(__dirname, '../routes/shop-owner.routes.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

  test('routes stay behind auth + shop_owner role', () => {
    expect(routesSrc).toMatch(/router\.get\('\/sales', listSales\)/);
    expect(routesSrc).toMatch(/router\.patch\('\/orders\/:id\/status', updateOrderStatus\)/);
    expect(routesSrc).toMatch(/router\.patch\('\/orders\/:id\/cancel', cancelOrder\)/);
    expect(indexSrc).toMatch(/app\.use\('\/shop-owner', requireAuth, requireRole\('shop_owner'\)/);
  });

  test('never trusts seller_id / shop_id / owner_id from the request', () => {
    expect(src).not.toMatch(/req\.body\.shop_id|req\.query\.shop_id|req\.body\.seller_id/);
  });

  test('commission stays a single backend source of truth (no duplicate rate here)', () => {
    // The controller must delegate to services/commission.js, not inline 0.10/0.9.
    expect(src).toMatch(/calculatePlatformCommission|calculateSellerPayout/);
    expect(src).not.toMatch(/\*\s*0\.1\b/);
  });
});
