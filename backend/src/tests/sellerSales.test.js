// backend/src/tests/sellerSales.test.js — Sales & Payouts analytics:
// seller-scoped, backend-authoritative math, truthful payout ledger.
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
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));

const SHOP = 'shop-1';
const NOW = new Date('2026-09-15T12:00:00+08:00');
// o1 paid+completed 55000 (Aug, Rings); o2 paid+pending 12000 (Sep, Necklaces);
// o3 failed 9000 (Sep); o4 no payment 5000 (excluded everywhere).
function seedMocks() {
  poolQuery.mockImplementation(async (sql) => {
    if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: SHOP }] };
    if (/SELECT id, name, category FROM products WHERE shop_id/.test(sql)) {
      return { rows: [
        { id: 'p1', name: 'Ring', category: 'Rings' },
        { id: 'p2', name: 'Necklace', category: 'Necklaces' },
      ] };
    }
    if (/FROM auctions WHERE product_id IN/.test(sql)) {
      return { rows: [{ id: 'a1', product_id: 'p1' }, { id: 'a2', product_id: 'p2' }] };
    }
    if (/FROM orders WHERE auction_id IN/.test(sql)) {
      return { rows: [
        { id: 'o1', auction_id: 'a1', buyer_id: 'u1', amount: 55000, status: 'completed', created_at: '2026-08-10T10:00:00+08:00', transaction_code: 'TXN-0001' },
        { id: 'o2', auction_id: 'a2', buyer_id: 'u2', amount: 12000, status: 'pending', created_at: '2026-09-12T10:00:00+08:00', transaction_code: 'TXN-0002' },
        { id: 'o3', auction_id: 'a2', buyer_id: 'u3', amount: 9000, status: 'pending', created_at: '2026-09-13T10:00:00+08:00', transaction_code: 'TXN-0003' },
        { id: 'o4', auction_id: 'a1', buyer_id: 'u4', amount: 5000, status: 'pending', created_at: '2026-09-07T10:00:00+08:00', transaction_code: 'TXN-0004' },
      ] };
    }
    if (/FROM payments WHERE order_id IN/.test(sql)) {
      return { rows: [
        { order_id: 'o1', status: 'paid', payment_method: 'gcash', paid_at: '2026-08-11T10:00:00+08:00', created_at: '2026-08-10T11:00:00+08:00' },
        { order_id: 'o2', status: 'paid', payment_method: 'card', paid_at: null, created_at: '2026-09-12T11:00:00+08:00' },
        { order_id: 'o3', status: 'failed', payment_method: 'gcash', paid_at: null, created_at: '2026-09-13T11:00:00+08:00' },
      ] };
    }
    if (/user_id FROM shops WHERE id/.test(sql)) return { rows: [{ user_id: 'seller-1' }] };
    if (/FROM seller_payment_methods/.test(sql)) return { rows: [{ type: 'gcash', last4: '4421' }] };
    return { rows: [] };
  });
}
function mockRes() { const r = {}; r.status = vi.fn().mockReturnValue(r); r.json = vi.fn().mockReturnValue(r); return r; }

beforeEach(() => poolQuery.mockReset());

describe('commission helper (single source of truth)', () => {
  it('10% commission / 90% payout, integer pesos', async () => {
    const { calculatePlatformCommission, calculateSellerPayout, COMMISSION_RATE } = await import('../services/commission.js');
    expect(COMMISSION_RATE).toBe(0.10);
    expect(calculatePlatformCommission(55000)).toBe(5500);
    expect(calculateSellerPayout(55000)).toBe(49500);
  });
});

const FIXED_NOW = new Date('2026-09-15T12:00:00+08:00');
async function dashboard(range = 'month') {
  const { getSellerSalesDashboard } = await import('../services/sellerSales.js');
  return getSellerSalesDashboard('seller-1', FIXED_NOW, range);
}

describe('GET /shop-owner/sales/summary', () => {
  it('controller wires the dashboard service, defaults to month', async () => {
    seedMocks();
    const { getSalesSummary } = await import('../controllers/shop-owner/sales.controller.js');
    const res = mockRes();
    await getSalesSummary({ user: { id: 'seller-1' }, query: {} }, res);
    const d = res.json.mock.calls[0][0];
    expect(d.summary.commission_rate).toBe(0.10);
    expect(d.range).toBe('month');
    expect(Array.isArray(d.payout_history)).toBe(true);
  });

  it('invalid range rejected with 400 (no arbitrary SQL)', async () => {
    seedMocks();
    const { getSalesSummary } = await import('../controllers/shop-owner/sales.controller.js');
    const res = mockRes();
    await getSalesSummary({ user: { id: 'seller-1' }, query: { range: 'banana' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_RANGE');
  });

  it('month range reconciles (Sep: gross 12000, net 10800, lots 1)', async () => {
    seedMocks();
    const d = await dashboard('month');
    expect(d.range).toBe('month');
    expect(d.summary).toMatchObject({ gross_sales: 12000, net_payout: 10800, lots_sold: 1 });
    expect(d.summary.pending_payout).toBe(10800);
    expect(d.revenue_trend.length).toBeGreaterThanOrEqual(15);
    expect(d.top_categories).toEqual([{ name: 'Necklaces', revenue: 12000, percent: 100 }]);
  });

  it('7d range: 7 daily buckets, correct boundaries', async () => {
    seedMocks();
    const d = await dashboard('7d');
    expect(d.revenue_trend.length).toBe(7);
    const total = d.revenue_trend.reduce((s, t) => s + t.gross_sales, 0);
    expect(total).toBe(12000);
    expect(d.summary.gross_sales).toBe(12000);
    expect(d.summary.lots_sold).toBe(1);
  });

  it('year range aggregates monthly (Aug 55000 + Sep 12000)', async () => {
    seedMocks();
    const d = await dashboard('year');
    expect(d.summary.gross_sales).toBe(67000);
    expect(d.summary.net_payout).toBe(60300);
    const aug = d.revenue_trend.find((m) => m.label === 'Aug');
    expect(aug).toMatchObject({ gross_sales: 55000, net_payout: 49500 });
    expect(d.revenue_trend.length).toBe(9);
    expect(d.top_categories[0]).toMatchObject({ name: 'Rings', revenue: 55000 });
    expect(d.top_categories[0].percent).toBeCloseTo(82.1, 1);
  });

  it('payout history uses payout date within range, newest first', async () => {
    seedMocks();
    const d = await dashboard('7d');
    // Sep 12 + Sep 13 payouts in window; Aug 11 outside
    expect(d.payout_history.map((r) => r.id)).toEqual(['TXN-0003', 'TXN-0002']);
    expect(d.payout_history.map((r) => r.status)).toEqual(['failed', 'scheduled']);
    const y = await dashboard('year');
    expect(y.payout_history.map((r) => r.id)).toEqual(['TXN-0003', 'TXN-0002', 'TXN-0001']);
  });

  it('payout method masked, statuses real', async () => {
    seedMocks();
    const h = (await dashboard('year')).payout_history;
    expect(h[0].method).toBe('GCash •••• 4421');
    expect(JSON.stringify(h)).not.toMatch(/44210|09\d{9}/);
    expect(h.find((r) => r.id === 'TXN-0001')).toMatchObject({ amount: 49500, gross_amount: 55000 });
  });

  it('no shop → empty dashboard (no crash, no foreign data)', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const { getSalesSummary } = await import('../controllers/shop-owner/sales.controller.js');
    const res = mockRes();
    await getSalesSummary({ user: { id: 'ghost' }, query: {} }, res);
    const d = res.json.mock.calls[0][0];
    expect(d.summary.gross_sales).toBe(0);
    expect(d.payout_history).toEqual([]);
  });

  it('money stays integer (no float drift)', async () => {
    seedMocks();
    const d = await dashboard('year');
    const nums = [d.summary.gross_sales, d.summary.net_payout, d.summary.pending_payout, ...d.revenue_trend.flatMap((t) => [t.gross_sales, t.net_payout]), ...d.payout_history.map((r) => r.amount)];
    for (const n of nums) expect(Number.isInteger(n)).toBe(true);
  });
});

describe('sales route security', () => {
  it('summary route registered behind auth (no public flag)', () => {
    const routesSrc = fs.readFileSync(path.join(__dirname, '../routes/shop-owner.routes.js'), 'utf8');
    expect(routesSrc).toContain('/sales/summary');
    expect(routesSrc).not.toContain('public: true');
    const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    expect(indexSrc).toMatch(/app\.use\('\/shop-owner',\s*requireAuth,\s*requireRole\('shop_owner'\)/);
  });

  it('shop resolved from authenticated user only', () => {
    const svcSrc = fs.readFileSync(path.join(__dirname, '../services/sellerSales.js'), 'utf8');
    expect(svcSrc).toMatch(/WHERE user_id=\$1/);
    expect(svcSrc).not.toMatch(/req\.query\.shop_id|req\.body\.shop_id/);
  });
});
