// backend/src/tests/salesSummary.test.js
// Sales & Payouts revenue rule edge-case tests.
// Verifies canonical recognized-revenue rule: payments.status = 'paid'.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: { query: (...args) => poolQuery(...args) },
  isDirectPg: () => true,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'not used' } })) },
  })),
}));

const SELLER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SHOP = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  poolQuery.mockReset();
});

function mockShop() {
  return { rows: [{ id: SHOP, user_id: SELLER }] };
}

function mockProducts() {
  return { rows: [{ id: 'p1', name: 'Ring', category: 'Rings' }] };
}

function mockAuctions() {
  return { rows: [{ id: 'a1', product_id: 'p1' }] };
}

describe('Sales & Payouts revenue rule audit', () => {
  it('A: paid payment + order not completed → recognized as gross revenue', async () => {
    // Order status = 'ready_pickup' but payment is paid → revenue recognized
    poolQuery.mockImplementation((sql) => {
      if (sql.includes('FROM shops')) return mockShop();
      if (sql.includes('FROM products')) return mockProducts();
      if (sql.includes('FROM auctions')) return mockAuctions();
      if (sql.includes('FROM orders')) {
        return {
          rows: [
            {
              id: 'o1',
              auction_id: 'a1',
              buyer_id: 'buyer1',
              amount: 100000,
              status: 'ready_pickup',
              created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
              transaction_code: 'TXN-001',
            },
          ],
        };
      }
      if (sql.includes('FROM payments')) {
        return {
          rows: [
            {
              order_id: 'o1',
              status: 'paid',
              payment_method: 'gcash',
              created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
            },
          ],
        };
      }
      if (sql.includes('FROM seller_payment_methods')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { getSalesSummary } = await import('../controllers/shop-owner/sales.controller.js');
    const req = { user: { id: SELLER } };
    const res = mockRes();
    await getSalesSummary(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({
          gross_sales_ytd: 100000,
          net_earnings_ytd: 90000,
          pending_earnings: 90000, // paid but not completed → pending
        }),
      }),
    );
  });

  it('B: completed order + unpaid payment → NOT recognized as revenue', async () => {
    // Order completed but payment not paid → no revenue recognized
    poolQuery.mockImplementation((sql) => {
      if (sql.includes('FROM shops')) return mockShop();
      if (sql.includes('FROM products')) return mockProducts();
      if (sql.includes('FROM auctions')) return mockAuctions();
      if (sql.includes('FROM orders')) {
        return {
          rows: [
            {
              id: 'o1',
              auction_id: 'a1',
              buyer_id: 'buyer1',
              amount: 100000,
              status: 'completed',
              created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
              transaction_code: 'TXN-001',
            },
          ],
        };
      }
      if (sql.includes('FROM payments')) {
        return {
          rows: [
            {
              order_id: 'o1',
              status: 'pending', // unpaid
              payment_method: 'gcash',
              created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
            },
          ],
        };
      }
      if (sql.includes('FROM seller_payment_methods')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { getSalesSummary } = await import('../controllers/shop-owner/sales.controller.js');
    const req = { user: { id: SELLER } };
    const res = mockRes();
    await getSalesSummary(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({
          gross_sales_ytd: 0,
          net_earnings_ytd: 0,
          pending_earnings: 0,
        }),
      }),
    );
  });

  it('C: paid completed order → full revenue recognized', async () => {
    poolQuery.mockImplementation((sql) => {
      if (sql.includes('FROM shops')) return mockShop();
      if (sql.includes('FROM products')) return mockProducts();
      if (sql.includes('FROM auctions')) return mockAuctions();
      if (sql.includes('FROM orders')) {
        return {
          rows: [
            {
              id: 'o1',
              auction_id: 'a1',
              buyer_id: 'buyer1',
              amount: 100000,
              status: 'completed',
              created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
              transaction_code: 'TXN-001',
            },
          ],
        };
      }
      if (sql.includes('FROM payments')) {
        return {
          rows: [
            {
              order_id: 'o1',
              status: 'paid',
              payment_method: 'gcash',
              created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
            },
          ],
        };
      }
      if (sql.includes('FROM seller_payment_methods')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { getSalesSummary } = await import('../controllers/shop-owner/sales.controller.js');
    const req = { user: { id: SELLER } };
    const res = mockRes();
    await getSalesSummary(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({
          gross_sales_ytd: 100000,
          net_earnings_ytd: 90000,
          pending_earnings: 0,
        }),
      }),
    );
  });

  it('D: failed payment → no revenue recognized', async () => {
    poolQuery.mockImplementation((sql) => {
      if (sql.includes('FROM shops')) return mockShop();
      if (sql.includes('FROM products')) return mockProducts();
      if (sql.includes('FROM auctions')) return mockAuctions();
      if (sql.includes('FROM orders')) {
        return {
          rows: [
            {
              id: 'o1',
              auction_id: 'a1',
              buyer_id: 'buyer1',
              amount: 100000,
              status: 'completed',
              created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
              transaction_code: 'TXN-001',
            },
          ],
        };
      }
      if (sql.includes('FROM payments')) {
        return {
          rows: [
            {
              order_id: 'o1',
              status: 'failed',
              payment_method: 'gcash',
              created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
            },
          ],
        };
      }
      if (sql.includes('FROM seller_payment_methods')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { getSalesSummary } = await import('../controllers/shop-owner/sales.controller.js');
    const req = { user: { id: SELLER } };
    const res = mockRes();
    await getSalesSummary(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({
          gross_sales_ytd: 0,
          net_earnings_ytd: 0,
          pending_earnings: 0,
        }),
      }),
    );
  });

  it('E: multiple categories grouped correctly', async () => {
    poolQuery.mockImplementation((sql) => {
      if (sql.includes('FROM shops')) return mockShop();
      if (sql.includes('FROM products')) {
        return {
          rows: [
            { id: 'p1', name: 'Ring', category: 'Rings' },
            { id: 'p2', name: 'Necklace', category: 'Necklaces' },
            { id: 'p3', name: 'Bracelet', category: 'Bracelets' },
          ],
        };
      }
      if (sql.includes('FROM auctions')) {
        return {
          rows: [
            { id: 'a1', product_id: 'p1' },
            { id: 'a2', product_id: 'p2' },
            { id: 'a3', product_id: 'p3' },
          ],
        };
      }
      if (sql.includes('FROM orders')) {
        return {
          rows: [
            { id: 'o1', auction_id: 'a1', buyer_id: 'b1', amount: 60000, status: 'completed', created_at: new Date(Date.now() - 10 * 86400000).toISOString(), transaction_code: 'TXN-001' },
            { id: 'o2', auction_id: 'a2', buyer_id: 'b1', amount: 30000, status: 'completed', created_at: new Date(Date.now() - 10 * 86400000).toISOString(), transaction_code: 'TXN-002' },
            { id: 'o3', auction_id: 'a3', buyer_id: 'b1', amount: 10000, status: 'completed', created_at: new Date(Date.now() - 10 * 86400000).toISOString(), transaction_code: 'TXN-003' },
          ],
        };
      }
      if (sql.includes('FROM payments')) {
        return {
          rows: [
            { order_id: 'o1', status: 'paid', payment_method: 'gcash', created_at: new Date(Date.now() - 5 * 86400000).toISOString() },
            { order_id: 'o2', status: 'paid', payment_method: 'gcash', created_at: new Date(Date.now() - 5 * 86400000).toISOString() },
            { order_id: 'o3', status: 'paid', payment_method: 'gcash', created_at: new Date(Date.now() - 5 * 86400000).toISOString() },
          ],
        };
      }
      if (sql.includes('FROM seller_payment_methods')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { getSalesSummary } = await import('../controllers/shop-owner/sales.controller.js');
    const req = { user: { id: SELLER } };
    const res = mockRes();
    await getSalesSummary(req, res);

    const callArg = res.json.mock.calls[0][0];
    expect(callArg.top_categories).toHaveLength(3);
    expect(callArg.top_categories[0]).toMatchObject({ category: 'Rings', revenue: 60000, percentage: 60 });
    expect(callArg.top_categories[1]).toMatchObject({ category: 'Necklaces', revenue: 30000, percentage: 30 });
    expect(callArg.top_categories[2]).toMatchObject({ category: 'Bracelets', revenue: 10000, percentage: 10 });
  });

  it('F: month with no revenue → zero entries preserved', async () => {
    poolQuery.mockImplementation((sql) => {
      if (sql.includes('FROM shops')) return mockShop();
      if (sql.includes('FROM products')) return mockProducts();
      if (sql.includes('FROM auctions')) return mockAuctions();
      if (sql.includes('FROM orders')) {
        return { rows: [] }; // no orders at all
      }
      if (sql.includes('FROM payments')) {
        return { rows: [] };
      }
      if (sql.includes('FROM seller_payment_methods')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { getSalesSummary } = await import('../controllers/shop-owner/sales.controller.js');
    const req = { user: { id: SELLER } };
    const res = mockRes();
    await getSalesSummary(req, res);

    const callArg = res.json.mock.calls[0][0];
    expect(callArg.revenue_trend).toHaveLength(12); // all 12 months preserved with zeros
    expect(callArg.summary.gross_sales_ytd).toBe(0);
    expect(callArg.summary.net_earnings_ytd).toBe(0);
    expect(callArg.top_categories).toHaveLength(0);
    expect(callArg.earnings_history).toHaveLength(0);
  });
});
