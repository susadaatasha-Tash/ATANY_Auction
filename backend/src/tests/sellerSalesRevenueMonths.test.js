// backend/src/tests/sellerSalesRevenueMonths.test.js
// Seller Sales & Payouts — revenue recognition + calendar-month grouping.
//
// Contract under test:
//  • Recognized revenue requires payments.status = 'paid' (canonical rule).
//  • The financial date is the PAYMENT date (payments.paid_at), not the
//    order creation date.
//  • The calendar month is derived in the LOCAL (Asia/Manila) timezone for
//    BOTH the bucket key and the displayed label — a September sale can never
//    appear under an OCT 2026 label.
//  • Commission stays 10% / seller earnings 90%.
//  • The history table is EARNINGS, never a payout: no destination column and
//    the status is "Earned" (there is no recorded seller disbursement).
//  • The scope stays seller-scoped (the caller's own shop only).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: vi.fn(), on: vi.fn() },
  isDirectPg: () => true,
}));

const { getSalesSummary } = await import('../controllers/shop-owner/sales.controller.js');
const { localMonthKey, localMonthLabel } = await import('../lib/monthKey.js');

const SELLER = '00000000-0000-0000-0000-000000000002';
const SHOP = '8dfd50c4-30f2-467a-ab4c-7cf9bff08de5';
const PRODUCT = 'p-1';
const AUCTION = 'a-1';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

/** Pool mock: one order, one payment (the seller-scoped summary query). */
function setupPool({ order = {}, payment = null, orderRows = null, buyers = null } = {}) {
  poolQuery.mockImplementation(async (sql) => {
    if (/FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: SHOP, user_id: SELLER }] };
    if (/FROM products WHERE shop_id/.test(sql)) {
      return { rows: [{ id: PRODUCT, name: 'Rose Gold Bangle', category: 'Bracelets' }] };
    }
    if (/FROM auctions WHERE product_id/.test(sql)) return { rows: [{ id: AUCTION, product_id: PRODUCT }] };
    if (/FROM orders WHERE auction_id/.test(sql)) {
      const rows = orderRows || [{
        id: 'o-1',
        auction_id: AUCTION,
        buyer_id: 'b-1',
        amount: 55000,
        status: 'completed',
        created_at: '2026-09-15T10:31:25.384Z',
        transaction_code: 'TXN-9002',
        ...order,
      }];
      return { rows };
    }
    if (/FROM payments WHERE order_id/.test(sql)) {
      return { rows: payment ? [payment] : [] };
    }
    // Batched buyer lookup (one query for ALL rows — no N+1).
    if (/FROM users WHERE id IN/.test(sql)) {
      return { rows: buyers || [{ id: 'b-1', name: 'Britz Susada' }] };
    }
    if (/FROM seller_payment_methods/.test(sql)) return { rows: [] };
    return { rows: [] };
  });
}

const paidPayment = (overrides = {}) => ({
  order_id: 'o-1',
  status: 'paid',
  payment_method: 'gcash',
  amount: 55000,
  paid_at: '2026-09-15T10:34:48.890Z',
  created_at: '2026-09-15T10:34:08.514Z',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('localMonthKey — timezone-safe calendar month', () => {
  it('keeps a September payment in September (Asia/Manila)', () => {
    // 2026-09-30 18:00 PHT = 2026-09-30T10:00Z → still September.
    expect(localMonthKey('2026-09-30T10:00:00.000Z')).toBe('2026-09');
  });

  it('a local October 1st stays October (no UTC shift to September)', () => {
    // The exact case that used to shift: new Date(2026, 9, 1) in Asia/Manila
    // is 2026-09-30T16:00Z → the old toISOString() key was "2026-09".
    const d = new Date(2026, 9, 1);
    expect(localMonthKey(d)).toBe('2026-10');
    expect(d.toISOString().slice(0, 7)).toBe('2026-09'); // the old buggy key
  });

  it('derives the label from the SAME local calendar month', () => {
    const d = new Date(2026, 9, 1);
    expect(localMonthLabel(d)).toBe('OCT 2026');
    expect(localMonthKey(d)).toBe('2026-10');
  });

  it('handles the month boundary on both sides', () => {
    expect(localMonthKey(new Date(2026, 8, 30, 23, 59))).toBe('2026-09');
    expect(localMonthKey(new Date(2026, 9, 1, 0, 1))).toBe('2026-10');
  });
});

describe('seller sales summary — recognized revenue month', () => {
  it('places a September payment under SEP 2026 and leaves OCT 2026 at zero', async () => {
    setupPool({ payment: paidPayment() });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const body = res.json.mock.calls[0][0];
    const trend = body.revenue_trend;
    const sep = trend.find((p) => p.month === 'SEP 2026');
    const oct = trend.find((p) => p.month === 'OCT 2026');
    expect(sep.gross).toBe(55000);
    expect(sep.net).toBe(49500);
    expect(oct.gross).toBe(0);
    expect(oct.net).toBe(0);
  });

  it('uses the payment date, NOT the order creation date', async () => {
    // Order created Sep 30, payment confirmed Oct 1 → October.
    setupPool({
      order: { created_at: '2026-09-30T14:00:00.000Z' },
      payment: paidPayment({ paid_at: '2026-10-01T02:00:00.000Z', created_at: '2026-10-01T01:00:00.000Z' }),
    });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const body = res.json.mock.calls[0][0];
    const oct = body.revenue_trend.find((p) => p.month === 'OCT 2026');
    const sep = body.revenue_trend.find((p) => p.month === 'SEP 2026');
    expect(oct.gross).toBe(55000);
    expect(sep.gross).toBe(0);
  });

  it('falls back to the payment created_at when a legacy paid row has no paid_at', async () => {
    setupPool({
      payment: paidPayment({ paid_at: null, created_at: '2026-09-20T09:00:00.000Z' }),
    });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.revenue_trend.find((p) => p.month === 'SEP 2026').gross).toBe(55000);
  });

  it('excludes unpaid orders from recognized revenue', async () => {
    setupPool({ payment: paidPayment({ status: 'pending', paid_at: null }) });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.summary.gross_sales_ytd).toBe(0);
    expect(body.summary.net_earnings_ytd).toBe(0);
    expect(body.revenue_trend.every((p) => p.gross === 0)).toBe(true);
    expect(body.earnings_history).toHaveLength(0);
  });

  it('keeps the 10% commission / 90% seller payout split', async () => {
    setupPool({ payment: paidPayment() });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.summary.gross_sales_ytd).toBe(55000);
    expect(body.summary.net_earnings_ytd).toBe(49500);
    expect(body.summary.commission_rate).toBe(0.10);
  });

  it('uses the recognized payment date for the earnings history row', async () => {
    setupPool({
      order: { created_at: '2026-09-30T14:00:00.000Z' },
      payment: paidPayment({ paid_at: '2026-10-01T02:00:00.000Z' }),
    });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.earnings_history[0].date).toBe('2026-10-01T02:00:00.000Z');
    expect(body.earnings_history[0].gross).toBe(55000);
    expect(body.earnings_history[0].commission).toBe(5500);
    expect(body.earnings_history[0].net).toBe(49500);
    expect(body.earnings_history[0].status).toBe('Earned');
  });

  it('counts This Month from the recognized payment date', async () => {
    // Recognized in the current month → counted; a month earlier → not.
    const now = new Date();
    const thisMonthIso = new Date(now.getFullYear(), now.getMonth(), 5, 3).toISOString();
    setupPool({ payment: paidPayment({ paid_at: thisMonthIso }) });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.summary.sales_this_month).toBe(55000);
    expect(body.summary.lots_sold_this_month).toBe(1);
  });

  it('selects paid_at in the payment query', async () => {
    setupPool({ payment: paidPayment() });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const query = poolQuery.mock.calls
      .map(([sql]) => sql)
      .find((sql) => /FROM payments WHERE order_id/i.test(sql));
    expect(query).toBeTruthy();
    expect(query).toMatch(/paid_at/i);
  });

  it('stays scoped to the caller\'s own shop', async () => {
    setupPool({ payment: paidPayment() });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const shopQuery = poolQuery.mock.calls
      .map(([sql, params]) => [sql, params])
      .find(([sql]) => /FROM shops WHERE user_id/i.test(sql));
    expect(shopQuery[1]).toEqual([SELLER]);
  });
});

describe('seller sales summary — truthful earnings history', () => {
  it('returns gross / commission / net earnings and the "Earned" status', async () => {
    setupPool({ payment: paidPayment() });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const body = res.json.mock.calls[0][0];
    const row = body.earnings_history[0];
    expect(row.id).toBe('TXN-9002');
    expect(row.gross).toBe(55000);
    expect(row.commission).toBe(5500);
    expect(row.net).toBe(49500);
    expect(row.status).toBe('Earned');
    // Gross = commission + net earnings always holds.
    expect(row.gross).toBe(row.commission + row.net);
  });

  it('includes the item and the buyer name (from the batched maps)', async () => {
    setupPool({ payment: paidPayment() });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const body = res.json.mock.calls[0][0];
    const row = body.earnings_history[0];
    expect(row.item).toBe('Rose Gold Bangle');
    expect(row.buyer).toBe('Britz Susada');
  });

  it('never returns a payout method — ATANY has no disbursement destination', async () => {
    setupPool({ payment: paidPayment() });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const body = res.json.mock.calls[0][0];
    for (const row of body.earnings_history) {
      expect(row).not.toHaveProperty('method');
      expect(Object.keys(row)).not.toContain('method');
    }
    expect(JSON.stringify(body.earnings_history)).not.toMatch(/Subscription preference/);
  });

  it('never labels a seller earning as "Paid"', async () => {
    setupPool({ payment: paidPayment() });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.earnings_history[0].status).not.toBe('Paid');
    expect(body.earnings_history[0].status).not.toBe('Scheduled');
  });

  it('keeps the fulfillment state separate from the earnings state', async () => {
    setupPool({ payment: paidPayment(), order: { status: 'ready_pickup' } });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const body = res.json.mock.calls[0][0];
    const row = body.earnings_history[0];
    expect(row.status).toBe('Earned');
    expect(row.order_status).toBe('Pending fulfillment');
    // A paid-but-unfulfilled order still counts as pending earnings.
    expect(body.summary.pending_earnings).toBe(49500);
  });

  it('batches the buyer lookup into ONE query (no N+1)', async () => {
    setupPool({
      orderRows: [
        {
          id: 'o-1', auction_id: AUCTION, buyer_id: 'b-1', amount: 55000, status: 'completed',
          created_at: '2026-09-15T10:31:25.384Z', transaction_code: 'TXN-9002',
        },
        {
          id: 'o-2', auction_id: AUCTION, buyer_id: 'b-2', amount: 22000, status: 'completed',
          created_at: '2026-09-16T10:31:25.384Z', transaction_code: 'TXN-9003',
        },
      ],
      payment: null,
    });
    // Two payments for the two orders.
    poolQuery.mockImplementation(async (sql) => {
      if (/FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: SHOP, user_id: SELLER }] };
      if (/FROM products WHERE shop_id/.test(sql)) {
        return { rows: [{ id: PRODUCT, name: 'Rose Gold Bangle', category: 'Bracelets' }] };
      }
      if (/FROM auctions WHERE product_id/.test(sql)) return { rows: [{ id: AUCTION, product_id: PRODUCT }] };
      if (/FROM orders WHERE auction_id/.test(sql)) {
        return { rows: [
          { id: 'o-1', auction_id: AUCTION, buyer_id: 'b-1', amount: 55000, status: 'completed', created_at: '2026-09-15T10:31:25.384Z', transaction_code: 'TXN-9002' },
          { id: 'o-2', auction_id: AUCTION, buyer_id: 'b-2', amount: 22000, status: 'completed', created_at: '2026-09-16T10:31:25.384Z', transaction_code: 'TXN-9003' },
        ] };
      }
      if (/FROM payments WHERE order_id/.test(sql)) {
        return { rows: [
          { order_id: 'o-1', status: 'paid', payment_method: 'gcash', amount: 55000, paid_at: '2026-09-15T10:34:48.890Z', created_at: '2026-09-15T10:34:08.514Z' },
          { order_id: 'o-2', status: 'paid', payment_method: 'card', amount: 22000, paid_at: '2026-09-16T10:34:48.890Z', created_at: '2026-09-16T10:34:08.514Z' },
        ] };
      }
      if (/FROM users WHERE id IN/.test(sql)) {
        return { rows: [{ id: 'b-1', name: 'Britz Susada' }, { id: 'b-2', name: 'Maria Santos' }] };
      }
      return { rows: [] };
    });

    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.earnings_history).toHaveLength(2);
    expect(body.earnings_history.map((r) => r.buyer).sort()).toEqual(['Britz Susada', 'Maria Santos']);

    const buyerQueries = poolQuery.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => /FROM users WHERE id IN/i.test(sql));
    expect(buyerQueries).toHaveLength(1);
  });

  it('excludes unpaid orders from the earnings history entirely', async () => {
    setupPool({ payment: paidPayment({ status: 'failed', paid_at: null }) });
    const res = mockRes();
    await getSalesSummary({ user: { id: SELLER } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.earnings_history).toHaveLength(0);
    expect(body.summary.gross_sales_ytd).toBe(0);
    expect(body.summary.net_earnings_ytd).toBe(0);
    expect(body.summary.pending_earnings).toBe(0);
  });
});
