// backend/src/tests/sellerSalesList.test.js
// Won Lots & Orders backend suite.
//
// Contract under test:
//  • The seller order list is authenticated + shop_owner scoped.
//  • The seller's shop is resolved from the session — a client can never
//    pass a shop_id / owner id.
//  • The rows carry the product (name/category/image), the buyer, the payment
//    status, the pickup branch and the money split.
//  • Sale Amount = Commission (10%) + Payout (90%).
//  • The payments are read in ONE batched query (no N+1).
//  • The fulfillment mutation validates ownership, the transition and the
//    payment-before-processing rule server-side.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const poolQuery = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: vi.fn(), on: vi.fn() },
  isDirectPg: () => true,
}));

const { listSales, updateOrderStatus } = await import('../controllers/shop-owner/sales.controller.js');

const SELLER = '00000000-0000-0000-0000-000000000002';
const OTHER_SELLER = '00000000-0000-0000-0000-000000000005';
const SHOP = '8dfd50c4-30f2-467a-ab4c-7cf9bff08de5';
const PRODUCT = 'p-1';
const AUCTION = 'a-1';
const ORDER = 'o-1';
const BRANCH = 'b-1';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
const req = (body = {}, userId = SELLER, params = {}) => ({ body, params, user: { id: userId } });

/** Pool mock for the seller sales list. */
function setupListPool({ shop = true, products = true, auctions = true, orders = true } = {}) {
  poolQuery.mockImplementation(async (sql) => {
    if (/FROM shops WHERE user_id/.test(sql)) {
      return shop ? { rows: [{ id: SHOP }] } : { rows: [] };
    }
    if (/FROM products WHERE shop_id/.test(sql)) {
      return products
        ? { rows: [{ id: PRODUCT, name: 'TEST 1', category: 'Watches', image_url: 'https://img.test/w.jpg' }] }
        : { rows: [] };
    }
    if (/FROM auctions WHERE product_id/.test(sql)) {
      return auctions ? { rows: [{ id: AUCTION, product_id: PRODUCT }] } : { rows: [] };
    }
    if (/FROM orders WHERE auction_id/.test(sql)) {
      return orders
        ? {
            rows: [{
              id: ORDER, auction_id: AUCTION, buyer_id: 'buyer-1', amount: 71000, status: 'pending',
              created_at: '2026-10-11T02:24:00.000Z', transaction_code: 'TXN-9009', branch_id: BRANCH,
              payment_method: null, payment_deadline: '2026-10-18T02:24:00.000Z', winner_confirmed_at: null,
            }],
          }
        : { rows: [] };
    }
    if (/FROM users WHERE id IN/.test(sql)) return { rows: [{ id: 'buyer-1', name: 'britz Susada' }] };
    if (/FROM payments WHERE order_id IN/.test(sql)) {
      return { rows: [{ order_id: ORDER, status: 'paid', payment_method: 'gcash', amount: 71000, paid_at: '2026-10-11T03:00:00.000Z', created_at: '2026-10-11T03:00:00.000Z' }] };
    }
    if (/FROM branches WHERE id IN/.test(sql)) return { rows: [{ id: BRANCH, name: 'Gmall Branch' }] };
    return { rows: [] };
  });
}

beforeEach(() => {
  poolQuery.mockReset();
});

describe('seller Won Lots & Orders — route authorization', () => {
  it('the sales list and the order mutation live on the shop-owner router', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/shop-owner.routes.js'), 'utf8');
    expect(routes).toMatch(/router\.get\('\/sales', listSales\)/);
    expect(routes).toMatch(/router\.patch\('\/orders\/:id\/status', updateOrderStatus\)/);
  });

  it('the shop-owner router is mounted behind requireAuth + requireRole(shop_owner)', () => {
    const index = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    expect(index).toMatch(/app\.use\('\/shop-owner',\s*requireAuth,\s*requireRole\('shop_owner'\)/);
  });
});

describe('seller Won Lots & Orders — list', () => {
  it('resolves the shop from the session, never from a client-provided id', async () => {
    setupListPool();
    const res = mockRes();
    await listSales(req({ shop_id: OTHER_SELLER }, SELLER), res);
    const shopQuery = poolQuery.mock.calls.find(([sql]) => /FROM shops WHERE user_id/.test(sql));
    expect(shopQuery[1]).toEqual([SELLER]);
  });

  it('returns an empty list when the seller has no shop', async () => {
    setupListPool({ shop: false });
    const res = mockRes();
    await listSales(req(), res);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('enriches the row with the product, buyer, payment and branch', async () => {
    setupListPool();
    const res = mockRes();
    await listSales(req(), res);
    const rows = res.json.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: ORDER,
      transaction_code: 'TXN-9009',
      item: 'TEST 1',
      category: 'Watches',
      item_image: 'https://img.test/w.jpg',
      buyer: 'britz Susada',
      amount: 71000,
      commission: 7100,
      payout: 63900,
      status: 'pending',
      payment_status: 'paid',
      payment_method: 'gcash',
      branch_name: 'Gmall Branch',
    });
  });

  it('keeps the money rule: amount = commission (10%) + payout (90%)', async () => {
    setupListPool();
    const res = mockRes();
    await listSales(req(), res);
    const row = res.json.mock.calls[0][0][0];
    expect(row.commission).toBe(Math.round(row.amount * 0.10));
    expect(row.payout).toBe(row.amount - row.commission);
    expect(row.amount).toBe(row.commission + row.payout);
  });

  it('reads the payments in ONE batched query (no N+1)', async () => {
    setupListPool();
    const res = mockRes();
    await listSales(req(), res);
    const paymentQueries = poolQuery.mock.calls.filter(([sql]) => /FROM payments/.test(sql));
    expect(paymentQueries).toHaveLength(1);
    expect(paymentQueries[0][1]).toEqual([ORDER]);
  });

  it('never returns another seller order', async () => {
    setupListPool();
    const res = mockRes();
    await listSales(req({}, OTHER_SELLER), res);
    const shopQuery = poolQuery.mock.calls.find(([sql]) => /FROM shops WHERE user_id/.test(sql));
    expect(shopQuery[1]).toEqual([OTHER_SELLER]);
    // products are only fetched for the caller's own shop
    const productQuery = poolQuery.mock.calls.find(([sql]) => /FROM products WHERE shop_id/.test(sql));
    expect(productQuery[1]).toEqual([SHOP]);
  });
});

describe('seller Won Lots & Orders — fulfillment mutation', () => {
  function setupMutationPool({ order = { id: ORDER, status: 'pending', auction_id: AUCTION }, productShop = SHOP, paid = true } = {}) {
    poolQuery.mockImplementation(async (sql) => {
      if (/FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/FROM orders o WHERE o.id/.test(sql)) return order ? { rows: [order] } : { rows: [] };
      if (/SELECT product_id FROM auctions/.test(sql)) return { rows: [{ product_id: PRODUCT }] };
      if (/FROM products WHERE id/.test(sql)) return { rows: [{ shop_id: productShop, name: 'TEST 1' }] };
      if (/FROM payments WHERE order_id=\$1 AND status='paid'/.test(sql)) {
        return paid ? { rows: [{ status: 'paid' }] } : { rows: [] };
      }
      if (/UPDATE orders SET status/.test(sql)) return { rows: [{ ...order, status: 'preparing' }] };
      if (/FROM audit_logs|INSERT INTO audit_logs/.test(sql)) return { rows: [] };
      if (/SELECT buyer_id FROM orders/.test(sql)) return { rows: [{ buyer_id: 'buyer-1' }] };
      if (/FROM notifications WHERE user_id/.test(sql)) return { rows: [] };
      if (/INSERT INTO notifications/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
  }

  it('rejects a transition that is not allowed by the order state machine', async () => {
    setupMutationPool({ order: { id: ORDER, status: 'pending', auction_id: AUCTION } });
    const res = mockRes();
    await updateOrderStatus(req({ status: 'completed' }, SELLER, { id: ORDER }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Invalid transition/);
  });

  it('enforces the payment-before-processing rule', async () => {
    setupMutationPool({ order: { id: ORDER, status: 'pending', auction_id: AUCTION }, paid: false });
    const res = mockRes();
    await updateOrderStatus(req({ status: 'preparing' }, SELLER, { id: ORDER }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/cannot be prepared until payment is confirmed/i);
  });

  it('rejects an unknown status value', async () => {
    setupMutationPool();
    const res = mockRes();
    await updateOrderStatus(req({ status: 'deleted' }, SELLER, { id: ORDER }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("refuses an order that belongs to another seller's shop", async () => {
    setupMutationPool({ order: { id: ORDER, status: 'pending', auction_id: AUCTION }, productShop: 'another-shop' });
    const res = mockRes();
    await updateOrderStatus(req({ status: 'preparing' }, SELLER, { id: ORDER }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('refuses an unknown order', async () => {
    setupMutationPool({ order: null });
    const res = mockRes();
    await updateOrderStatus(req({ status: 'preparing' }, SELLER, { id: 'nope' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('applies a valid transition for a paid order', async () => {
    setupMutationPool({ order: { id: ORDER, status: 'pending', auction_id: AUCTION }, paid: true });
    const res = mockRes();
    await updateOrderStatus(req({ status: 'preparing' }, SELLER, { id: ORDER }), res);
    const update = poolQuery.mock.calls.find(([sql]) => /UPDATE orders SET status/.test(sql));
    expect(update[1]).toEqual(['preparing', ORDER]);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
  });
});
