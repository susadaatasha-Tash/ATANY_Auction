// backend/src/tests/bidIncrement.test.js — seller-defined minimum bid increment:
// per-auction rule, authoritative backend validation, race safety.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const poolQuery = vi.fn();
const poolConnect = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: (...a) => poolConnect(...a), on: vi.fn() },
  isDirectPg: () => true,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));

const AUCTION = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BUYER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NOW = new Date('2026-10-11T08:00:00Z');
const liveRow = (over = {}) => ({
  current_bid: 74000,
  status: 'live',
  start_time: new Date(NOW.getTime() - 3600000).toISOString(),
  end_time: new Date(NOW.getTime() + 3600000).toISOString(),
  minimum_bid_increment: 2000,
  ...over,
});
function txClient(row) {
  return {
    query: vi.fn(async (sql) => {
      if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
      if (/FROM auctions WHERE id/.test(sql)) return { rows: [row] };
      if (/UPDATE auctions SET current_bid/.test(sql)) return { rows: [], rowCount: 1 };
      if (/INSERT INTO bids/.test(sql)) return { rows: [{ id: 'b1' }] };
      if (/FROM bids WHERE auction_id=\$1 AND user_id/.test(sql)) return { rows: [] };
      if (/FROM notifications WHERE/.test(sql)) return { rows: [] };
      if (/INSERT INTO notifications/.test(sql)) return { rows: [] };
      if (/SELECT id FROM notifications/.test(sql)) return { rows: [] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
}
function mockRes() { const r = {}; r.status = vi.fn().mockReturnValue(r); r.json = vi.fn().mockReturnValue(r); return r; }

beforeEach(() => { poolQuery.mockReset(); poolConnect.mockReset(); });

describe('validateBidIncrement / validateBidAmount / minimumNextBid', () => {
  it('accepts 1000/2000/2500/5000', async () => {
    const { validateBidIncrement } = await import('../services/bidLogic.js');
    for (const v of [1000, 2000, 2500, 5000]) {
      expect(validateBidIncrement(v)).toMatchObject({ ok: true, value: v });
    }
  });
  it('rejects 0, negative, blank, NaN, Infinity, decimals, overflow', async () => {
    const { validateBidIncrement } = await import('../services/bidLogic.js');
    expect(validateBidIncrement(0).ok).toBe(false);
    expect(validateBidIncrement(-100).ok).toBe(false);
    expect(validateBidIncrement('').ok).toBe(false);
    expect(validateBidIncrement('abc').ok).toBe(false);
    expect(validateBidIncrement(NaN).ok).toBe(false);
    expect(validateBidIncrement(Infinity).ok).toBe(false);
    expect(validateBidIncrement(1500.5).ok).toBe(false);
    expect(validateBidIncrement(2147483648).ok).toBe(false);
    expect(validateBidIncrement(0).code).toBe('INVALID_BID_INCREMENT');
  });
  it('minimumNextBid is current + increment (74000+2000=76000)', async () => {
    const { minimumNextBid } = await import('../services/bidLogic.js');
    expect(minimumNextBid(74000, 2000)).toBe(76000);
  });
});

describe('placeBid per-auction increment (§55)', () => {
  it('1. legacy row without increment uses default 1000', async () => {
    const { placeBid } = await import('../services/bidLogic.js');
    const row = liveRow({ current_bid: 10000 });
    delete row.minimum_bid_increment;
    poolConnect.mockResolvedValue(txClient(row));
    const r = await placeBid({ auctionId: AUCTION, userId: BUYER, amount: 11000, now: NOW });
    expect(r.bid.id).toBe('b1');
    await expect(placeBid({ auctionId: AUCTION, userId: BUYER, amount: 10999, now: NOW }))
      .rejects.toMatchObject({ code: 'BID_TOO_LOW' });
  });

  it.each([1000, 2000, 2500, 5000])('increments enforced: %i', async (inc) => {
    const { placeBid } = await import('../services/bidLogic.js');
    poolConnect.mockResolvedValue(txClient(liveRow({ current_bid: 50000, minimum_bid_increment: inc })));
    const min = 50000 + inc;
    await expect(placeBid({ auctionId: AUCTION, userId: BUYER, amount: min - 1, now: NOW }))
      .rejects.toMatchObject({ code: 'BID_TOO_LOW', minimum_bid: min, minimum_bid_increment: inc, current_bid: 50000 });
  });

  it('exact minimum accepted; higher accepted; non-multiple accepted', async () => {
    const { placeBid } = await import('../services/bidLogic.js');
    poolConnect.mockResolvedValue(txClient(liveRow({})));
    // min = 76000
    await expect(placeBid({ auctionId: AUCTION, userId: BUYER, amount: 76000, now: NOW })).resolves.toBeTruthy();
    await expect(placeBid({ auctionId: AUCTION, userId: BUYER, amount: 77000, now: NOW })).resolves.toBeTruthy();
    await expect(placeBid({ auctionId: AUCTION, userId: BUYER, amount: 100000, now: NOW })).resolves.toBeTruthy();
  });

  it('10. stale concurrent bid rejected (B committed 80000, A bids 76000)', async () => {
    const { placeBid } = await import('../services/bidLogic.js');
    poolConnect.mockResolvedValue(txClient(liveRow({ current_bid: 80000 })));
    await expect(placeBid({ auctionId: AUCTION, userId: BUYER, amount: 76000, now: NOW }))
      .rejects.toMatchObject({ code: 'BID_TOO_LOW', minimum_bid: 82000 });
  });

  it('11. first-bid rule preserved (start 70000 + 2000 → min 72000)', async () => {
    const { placeBid } = await import('../services/bidLogic.js');
    poolConnect.mockResolvedValue(txClient(liveRow({ current_bid: 70000 })));
    await expect(placeBid({ auctionId: AUCTION, userId: BUYER, amount: 70000, now: NOW }))
      .rejects.toMatchObject({ code: 'BID_TOO_LOW' });
    await expect(placeBid({ auctionId: AUCTION, userId: BUYER, amount: 72000, now: NOW })).resolves.toBeTruthy();
  });

  it('malformed amounts rejected before touching the DB', async () => {
    const { placeBid } = await import('../services/bidLogic.js');
    poolConnect.mockResolvedValue(txClient(liveRow({})));
    await expect(placeBid({ auctionId: AUCTION, userId: BUYER, amount: NaN, now: NOW }))
      .rejects.toMatchObject({ code: 'INVALID_BID' });
    await expect(placeBid({ auctionId: AUCTION, userId: BUYER, amount: -5, now: NOW }))
      .rejects.toMatchObject({ code: 'INVALID_BID' });
  });

  it('16. two auctions use different increments simultaneously', async () => {
    const { placeBid } = await import('../services/bidLogic.js');
    poolConnect.mockResolvedValueOnce(txClient(liveRow({ current_bid: 10000, minimum_bid_increment: 1000 })));
    poolConnect.mockResolvedValueOnce(txClient(liveRow({ current_bid: 10000, minimum_bid_increment: 5000 })));
    await expect(placeBid({ auctionId: 'a-one', userId: BUYER, amount: 11000, now: NOW })).resolves.toBeTruthy();
    await expect(placeBid({ auctionId: 'a-two', userId: BUYER, amount: 11000, now: NOW }))
      .rejects.toMatchObject({ code: 'BID_TOO_LOW', minimum_bid: 15000 });
  });
});

describe('bid controller contract', () => {
  it('15. customer cannot send a fake increment (only auctionId+amount read)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/customer/bid.controller.js'), 'utf8');
    expect(src).toMatch(/const \{ auctionId, amount \} = req\.body/);
    expect(src).not.toMatch(/minimum_bid_increment.*req\.body|req\.body.*minimum/);
  });

  it('BID_TOO_LOW response carries authoritative minimum fields', async () => {
    const { placeBidController } = await import('../controllers/customer/bid.controller.js');
    const t = Date.now();
    poolConnect.mockResolvedValue(txClient(liveRow({
      start_time: new Date(t - 3600000).toISOString(),
      end_time: new Date(t + 3600000).toISOString(),
    })));
    const req = { body: { auctionId: AUCTION, amount: 75000 }, user: { id: BUYER } };
    const res = mockRes();
    await placeBidController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      code: 'BID_TOO_LOW', current_bid: 74000, minimum_bid_increment: 2000, minimum_bid: 76000,
    });
  });
});

describe('create + relist persistence', () => {
  function createMocks(insertCapture) {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: 'shop-1' }] };
      if (/home_branch_id FROM shops/.test(sql)) return { rows: [{}] };
      if (/INSERT INTO audit_logs/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    poolConnect.mockResolvedValue({
      query: vi.fn(async (sql, params) => {
        if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
        if (/INSERT INTO products/.test(sql)) return { rows: [{ id: 'prod-1' }] };
        if (/INSERT INTO auctions/.test(sql)) { insertCapture.push(params); return { rows: [{ id: 'auc-1', start_price: params[1], status: 'scheduled', minimum_bid_increment: params[5] }] }; }
        return { rows: [] };
      }),
      release: vi.fn(),
    });
  }

  it('create persists 2000/2500; missing → 1000 fallback', async () => {
    const { createAuction } = await import('../controllers/shop-owner/auction.controller.js');
    const start = new Date(Date.now() + 3600000).toISOString();
    const end = new Date(Date.now() + 7200000).toISOString();
    for (const inc of [2000, 2500]) {
      const captured = [];
      createMocks(captured);
      const res = mockRes();
      await createAuction({ user: { id: 'seller' }, body: { name: 'X', category: 'Rings', start_price: 70000, start_time: start, end_time: end, minimum_bid_increment: inc } }, res);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(captured[0][5]).toBe(inc);
      expect(res.json.mock.calls[0][0].minimum_bid_increment).toBe(inc);
    }
    const captured = [];
    createMocks(captured);
    const res = mockRes();
    await createAuction({ user: { id: 'seller' }, body: { name: 'X', category: 'Rings', start_price: 70000, start_time: start, end_time: end } }, res);
    expect(captured[0][5]).toBe(1000);
  });

  it('increment 500 creates successfully (non-default value persists)', async () => {
    const { createAuction } = await import('../controllers/shop-owner/auction.controller.js');
    const start = new Date(Date.now() + 3600000).toISOString();
    const end = new Date(Date.now() + 3720000).toISOString();
    const captured = [];
    createMocks(captured);
    const res = mockRes();
    await createAuction({ user: { id: 'seller' }, body: { name: 'X', category: 'Rings', start_price: 70000, start_time: start, end_time: end, minimum_bid_increment: 500 } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(captured[0][5]).toBe(500);
    expect(res.json.mock.calls[0][0].minimum_bid_increment).toBe(500);
  });

  it('3-minute duration is valid (no minimum-duration rule)', async () => {
    const { createAuction } = await import('../controllers/shop-owner/auction.controller.js');
    const start = new Date(Date.now() + 60000).toISOString();
    const end = new Date(Date.now() + 240000).toISOString();
    const captured = [];
    createMocks(captured);
    const res = mockRes();
    await createAuction({ user: { id: 'seller' }, body: { name: 'X', category: 'Rings', start_price: 70000, start_time: start, end_time: end, minimum_bid_increment: 500 } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('end <= start gives the specific schedule message (not generic failure)', async () => {
    const { createAuction } = await import('../controllers/shop-owner/auction.controller.js');
    createMocks([]);
    const start = new Date(Date.now() + 3600000).toISOString();
    const res = mockRes();
    await createAuction({ user: { id: 'seller' }, body: { name: 'X', category: 'Rings', start_price: 70000, start_time: start, end_time: start, minimum_bid_increment: 500 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Auction end must be after start');
  });

  it('auction INSERT failure rolls back (no orphan product/auction)', async () => {
    const { createAuction } = await import('../controllers/shop-owner/auction.controller.js');
    createMocks([]);
    poolConnect.mockResolvedValue({
      query: vi.fn(async (sql) => {
        if (/BEGIN|ROLLBACK/.test(sql)) return { rows: [] };
        if (/COMMIT/.test(sql)) throw new Error('COMMIT should not run');
        if (/INSERT INTO products/.test(sql)) return { rows: [{ id: 'prod-1' }] };
        if (/INSERT INTO auctions/.test(sql)) throw new Error('simulated insert failure');
        return { rows: [] };
      }),
      release: vi.fn(),
    });
    const start = new Date(Date.now() + 3600000).toISOString();
    const end = new Date(Date.now() + 7200000).toISOString();
    const res = mockRes();
    await createAuction({ user: { id: 'seller' }, body: { name: 'X', category: 'Rings', start_price: 70000, start_time: start, end_time: end, minimum_bid_increment: 500 } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    const txq = poolConnect.mock.results[0].value.query;
    const calls = txq.mock.calls.map(([s]) => s);
    expect(calls.join('|')).toMatch(/ROLLBACK/);
    expect(calls.join('|')).not.toMatch(/COMMIT/);
  });

  it('create rejects 0/negative/malformed with INVALID_BID_INCREMENT', async () => {
    const { createAuction } = await import('../controllers/shop-owner/auction.controller.js');
    createMocks([]);
    const start = new Date(Date.now() + 3600000).toISOString();
    const end = new Date(Date.now() + 7200000).toISOString();
    for (const bad of [0, -100, 'abc', 1.5]) {
      const res = mockRes();
      await createAuction({ user: { id: 'seller' }, body: { name: 'X', start_price: 70000, start_time: start, end_time: end, minimum_bid_increment: bad } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_BID_INCREMENT');
    }
  });

  it('relist rejects explicit past start with INVALID_SCHEDULE', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: 'shop-1' }] };
      if (/SELECT \* FROM auctions WHERE id/.test(sql)) {
        return { rows: [{ id: 'old', product_id: 'prod-1', status: 'ended', start_price: 54000, minimum_bid_increment: 500, start_time: new Date().toISOString(), end_time: new Date().toISOString() }] };
      }
      if (/FROM products WHERE id/.test(sql)) return { rows: [{ id: 'prod-1', shop_id: 'shop-1' }] };
      return { rows: [] };
    });
    const { relistAuction } = await import('../controllers/shop-owner/auctionManage.controller.js');
    const res = mockRes();
    await relistAuction({
      user: { id: 'seller' }, params: { id: 'old' },
      body: { start_time: new Date(Date.now() - 3600000).toISOString(), end_time: new Date(Date.now() + 3600000).toISOString() },
      io: null,
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_SCHEDULE');
  });

  it('relist copies source increment (never reverts to 1000)', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: 'shop-1' }] };
      if (/SELECT \* FROM auctions WHERE id/.test(sql)) {
        return { rows: [{ id: 'old', product_id: 'prod-1', status: 'ended', start_price: 70000, minimum_bid_increment: 2500, start_time: new Date().toISOString(), end_time: new Date().toISOString() }] };
      }
      if (/FROM products WHERE id/.test(sql)) return { rows: [{ id: 'prod-1', shop_id: 'shop-1' }] };
      if (/FROM auctions WHERE product_id IN/.test(sql)) return { rows: [] };
      if (/FROM products WHERE id IN/.test(sql)) return { rows: [] };
      if (/FROM shops WHERE id IN/.test(sql)) return { rows: [] };
      if (/FROM branches WHERE id IN/.test(sql)) return { rows: [] };
      if (/FROM bids WHERE auction_id IN/.test(sql)) return { rows: [] };
      if (/FROM watchlists/.test(sql)) return { rows: [] };
      if (/users WHERE id IN/.test(sql)) return { rows: [] };
      if (/FROM orders WHERE auction_id IN/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    let captured = null;
    poolConnect.mockResolvedValue({
      query: vi.fn(async (sql, params) => {
        if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
        if (/INSERT INTO auctions/.test(sql)) {
          captured = params;
          return { rows: [{ id: 'new-1', product_id: 'prod-1', status: 'scheduled', start_price: 70000, minimum_bid_increment: params[5], start_time: params[3], end_time: params[4] }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    });
    const { relistAuction } = await import('../controllers/shop-owner/auctionManage.controller.js');
    const res = mockRes();
    const start = new Date(Date.now() + 86400000).toISOString();
    const end = new Date(Date.now() + 8 * 86400000).toISOString();
    await relistAuction({ user: { id: 'seller' }, params: { id: 'old' }, body: { start_time: start, end_time: end }, io: null }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(captured[5]).toBe(2500);
    expect(res.json.mock.calls[0][0].minimum_bid_increment).toBe(2500);
  });
});

describe('migration 031 + payloads', () => {
  it('migration file exists with integer column + backfill + guard', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/031_auction_minimum_bid_increment.sql'), 'utf8');
    expect(sql).toMatch(/minimum_bid_increment INTEGER NOT NULL DEFAULT 1000/);
    expect(sql).toMatch(/UPDATE auctions SET minimum_bid_increment = 1000/);
    expect(sql).not.toMatch(/\bREAL\b|\bFLOAT\b|\bDOUBLE\b/i);
  });

  it('schema snapshots synchronized', () => {
    for (const f of ['../db/schema.sql', '../db/setup_complete.sql']) {
      expect(fs.readFileSync(path.join(__dirname, f), 'utf8')).toMatch(/minimum_bid_increment/);
    }
  });

  it('seller manage + customer payloads expose the increment', () => {
    for (const f of ['../controllers/shop-owner/auctionManage.controller.js', '../services/auctionService.js', '../controllers/customer/auction.controller.js']) {
      expect(fs.readFileSync(path.join(__dirname, f), 'utf8')).toMatch(/minimum_bid_increment/);
    }
  });
});
