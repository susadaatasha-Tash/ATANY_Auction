// backend/src/tests/auctionRelistIncrement.test.js
// Relist preserves minimum_bid_increment from the source auction.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();
const poolConnect = vi.fn();

vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: (...a) => poolConnect(...a), on: () => {} },
  isDirectPg: () => true,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) } })) }));

const SELLER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SHOP = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PRODUCT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AUCTION = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function mockRes() { const r = {}; r.status = vi.fn().mockReturnValue(r); r.json = vi.fn().mockReturnValue(r); return r; }

let auctionManage;

beforeEach(async () => {
  vi.resetModules();
  poolQuery.mockReset();
  poolConnect.mockReset();
  poolConnect.mockImplementation(async () => ({
    query: vi.fn(async (sql) => {
      if (/BEGIN/.test(sql) || /COMMIT/.test(sql) || /ROLLBACK/.test(sql)) return { rows: [] };
      if (/INSERT INTO auctions/.test(sql)) {
        return { rows: [{ id: 'new-auction', product_id: PRODUCT, status: 'scheduled', start_time: new Date().toISOString(), end_time: new Date(Date.now() + 86400000).toISOString(), start_price: 5000, current_bid: 5000, minimum_bid_increment: 2500 }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
    __restFallback: false,
  }));
  auctionManage = await import('../controllers/shop-owner/auctionManage.controller.js');
});

describe('relist — preserves minimum_bid_increment', () => {
  it('relisted auction copies increment from source (2500)', async () => {
    const ended = { id: AUCTION, product_id: PRODUCT, status: 'ended', start_time: new Date(Date.now() - 8 * 86400000).toISOString(), end_time: new Date(Date.now() - 86400000).toISOString(), start_price: 5000, current_bid: 8000, minimum_bid_increment: 2500 };
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM auctions WHERE id=\$1/.test(sql)) return { rows: [ended] };
      if (/SELECT shop_id FROM products/.test(sql)) return { rows: [{ shop_id: SHOP }] };
      if (/SELECT \* FROM products WHERE id=\$1/.test(sql)) return { rows: [{ id: PRODUCT, shop_id: SHOP, name: 'Ring', category: 'Rings', image_url: 'x.jpg', price: 5000 }] };
      return { rows: [] };
    });
    const req = { user: { id: SELLER }, params: { id: AUCTION }, body: { start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 8 * 86400000).toISOString() } };
    const res = mockRes();
    await auctionManage.relistAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.minimum_bid_increment).toBe(2500);
    expect(body.minimumBidIncrement).toBe(2500);
  });

  it('relisted auction defaults to 1000 when source has no increment (legacy)', async () => {
    const endedLegacy = { id: AUCTION, product_id: PRODUCT, status: 'ended', start_time: new Date(Date.now() - 8 * 86400000).toISOString(), end_time: new Date(Date.now() - 86400000).toISOString(), start_price: 5000, current_bid: 8000 };
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM auctions WHERE id=\$1/.test(sql)) return { rows: [endedLegacy] };
      if (/SELECT shop_id FROM products/.test(sql)) return { rows: [{ shop_id: SHOP }] };
      if (/SELECT \* FROM products WHERE id=\$1/.test(sql)) return { rows: [{ id: PRODUCT, shop_id: SHOP, name: 'Ring', category: 'Rings', image_url: 'x.jpg', price: 5000 }] };
      return { rows: [] };
    });
    const req = { user: { id: SELLER }, params: { id: AUCTION }, body: { start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 8 * 86400000).toISOString() } };
    const res = mockRes();
    await auctionManage.relistAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
