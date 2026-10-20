// backend/src/tests/auctionCreateIncrement.test.js
// Create auction with per-auction minimum bid increment.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();
const poolConnect = vi.fn();

vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: (...a) => poolConnect(...a), on: () => {} },
  isDirectPg: () => true,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) } })) }));
vi.mock('../services/emailService.js', () => ({ sendNotificationEmail: vi.fn(async () => {}) }));

const SELLER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SHOP = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PRODUCT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AUCTION = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function mockRes() { const r = {}; r.status = vi.fn().mockReturnValue(r); r.json = vi.fn().mockReturnValue(r); return r; }

let auctionController;

beforeEach(async () => {
  vi.resetModules();
  poolQuery.mockReset();
  poolConnect.mockReset();
  poolConnect.mockImplementation(async () => ({
    query: vi.fn(async (sql, params) => {
      if (/BEGIN/.test(sql) || /COMMIT/.test(sql) || /ROLLBACK/.test(sql)) return { rows: [] };
      if (/INSERT INTO products/.test(sql)) return { rows: [{ id: PRODUCT, shop_id: SHOP, name: 'Ring', category: 'Rings', image_url: null }] };
      if (/INSERT INTO auctions/.test(sql)) {
        // params: [product_id, start_price, current_bid(=start_price), minimum_bid_increment, status, start_time, end_time]
        const inc = params[2];
        return { rows: [{ id: AUCTION, product_id: PRODUCT, start_price: params[1], current_bid: params[1], status: 'scheduled', start_time: params[4], end_time: params[5], minimum_bid_increment: inc }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
    __restFallback: false,
  }));
  auctionController = await import('../controllers/shop-owner/auction.controller.js');
});

function setupCreate({ increment = 2000, ownShop = SHOP } = {}) {
  poolQuery.mockImplementation(async (sql) => {
    if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: ownShop }] };
    return { rows: [] };
  });
}

describe('createAuction — minimum_bid_increment', () => {
  it('accepts and stores increment 2000', async () => {
    setupCreate({ increment: 2000 });
    const req = { user: { id: SELLER }, body: { name: 'Gold Ring', category: 'Rings', start_price: 70000, start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 8 * 86400000).toISOString(), minimum_bid_increment: 2000 } };
    const res = mockRes();
    await auctionController.createAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.minimumBidIncrement).toBe(2000);
    expect(body.minimum_bid_increment).toBe(2000);
  });

  it('defaults increment to 1000 when not provided', async () => {
    setupCreate({ increment: 1000 });
    const req = { user: { id: SELLER }, body: { name: 'Gold Ring', category: 'Rings', start_price: 70000, start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 8 * 86400000).toISOString() } };
    const res = mockRes();
    await auctionController.createAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.minimumBidIncrement).toBe(1000);
  });

  it('rejects zero increment', async () => {
    setupCreate();
    const req = { user: { id: SELLER }, body: { name: 'Gold Ring', category: 'Rings', start_price: 70000, start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 8 * 86400000).toISOString(), minimum_bid_increment: 0 } };
    const res = mockRes();
    await auctionController.createAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('INVALID_BID_INCREMENT');
  });

  it('rejects negative increment', async () => {
    setupCreate();
    const req = { user: { id: SELLER }, body: { name: 'Gold Ring', category: 'Rings', start_price: 70000, start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 8 * 86400000).toISOString(), minimum_bid_increment: -100 } };
    const res = mockRes();
    await auctionController.createAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects malformed increment', async () => {
    setupCreate();
    const req = { user: { id: SELLER }, body: { name: 'Gold Ring', category: 'Rings', start_price: 70000, start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 8 * 86400000).toISOString(), minimum_bid_increment: 'abc' } };
    const res = mockRes();
    await auctionController.createAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects when shop not found', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const req = { user: { id: SELLER }, body: { name: 'Gold Ring', category: 'Rings', start_price: 70000, minimum_bid_increment: 1000 } };
    const res = mockRes();
    await auctionController.createAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
