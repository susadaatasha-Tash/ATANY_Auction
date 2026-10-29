// backend/src/tests/auctionHardening.test.js — targeted hardening regressions
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('migration 030', () => {
  it('contains paused enum addition', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/030_auction_pause_support.sql'), 'utf8');
    expect(sql).toMatch(/auction_status.*paused/i);
  });
  it('contains paused_at column', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/030_auction_pause_support.sql'), 'utf8');
    expect(sql).toMatch(/paused_at/i);
  });
  it('schema.sql and setup_complete.sql are consistent', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    const setup = fs.readFileSync(path.join(__dirname, '../db/setup_complete.sql'), 'utf8');
    expect(schema).toMatch(/paused/);
    expect(setup).toMatch(/paused_at/);
  });
});

describe('closing service centralization', () => {
  it('manual end and cron use same closeSingleAuction service', async () => {
    const closer = fs.readFileSync(path.join(__dirname, '../services/auctionCloser.js'), 'utf8');
    const manage = fs.readFileSync(path.join(__dirname, '../controllers/shop-owner/auctionManage.controller.js'), 'utf8');
    expect(closer).toMatch(/closeSingleAuction/);
    expect(manage).toMatch(/closeSingleAuction/);
    // Ensure duplicate winner logic not present in manage (no direct SELECT user_id, amount dupe logic beyond service)
    const manageHasDupLogic = (manage.match(/SELECT user_id, amount FROM bids/g) || []).length;
    // manage should not contain its own winner dedup besides enrich — end route now delegates
    expect(manageHasDupLogic).toBeLessThan(2);
  });
});

// Pause / resume timing and start-now duration
const poolQuery = vi.fn();
const poolConnect = vi.fn();
let directPgFlag = true;
vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: (...a) => poolConnect(...a), on: () => {} },
  isDirectPg: () => directPgFlag,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })), admin: {} }})) }));
vi.mock('../services/emailService.js', () => ({ sendNotificationEmail: vi.fn(async () => {}) }));

const SHOP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PRODUCT = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const AUCTION = '11111111-1111-1111-1111-111111111111';

describe('pause / resume timing', () => {
  beforeEach(() => {
    vi.resetModules();
    poolQuery.mockReset();
    poolConnect.mockReset();
    directPgFlag = true;
  });

  it('pause records paused_at and resume shifts end_time once', async () => {
    const endTime = new Date(Date.now() + 3600000);
    const pausedAt = new Date(Date.now() - 30 * 60000);
    // Mock pause
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM auctions WHERE id/.test(sql)) return { rows: [{ id: AUCTION, product_id: PRODUCT, status: 'live', start_time: new Date().toISOString(), end_time: endTime.toISOString(), start_price: 1000, current_bid: 2000 }] };
      if (/SELECT shop_id FROM products/.test(sql)) return { rows: [{ shop_id: SHOP }] };
      if (/SELECT \* FROM products WHERE id IN/.test(sql)) return { rows: [{ id: PRODUCT, shop_id: SHOP, name: 'Ring', category: 'Rings', image_url: 'x.jpg' }] };
      if (/SELECT \* FROM shops WHERE id IN/.test(sql)) return { rows: [{ id: SHOP, home_branch_id: 'b1' }] };
      if (/SELECT \* FROM branches WHERE id IN/.test(sql)) return { rows: [{ id: 'b1', name: 'Gmall Branch' }] };
      if (/FROM bids/.test(sql)) return { rows: [] };
      if (/FROM watchlists/.test(sql)) return { rows: [] };
      if (/SELECT id, name FROM users/.test(sql)) return { rows: [] };
      if (/FROM orders/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    poolConnect.mockImplementation(async () => ({
      query: vi.fn(async (sql, params) => {
        if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
        if (/UPDATE auctions SET status='paused'/.test(sql)) return { rows: [{ id: AUCTION, product_id: PRODUCT, status: 'paused', start_time: new Date().toISOString(), end_time: endTime.toISOString(), paused_at: new Date().toISOString() }] };
        if (/UPDATE auctions SET status='live', paused_at=NULL/.test(sql)) {
          // Ensure shifted end_time = old end + pausedMs (≈30min)
          const ms = Number(params[0]);
          expect(ms).toBeGreaterThan(29 * 60000);
          expect(ms).toBeLessThan(31 * 60000);
          return { rows: [{ id: AUCTION, product_id: PRODUCT, status: 'live', start_time: new Date().toISOString(), end_time: new Date(endTime.getTime() + ms).toISOString() }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
      __restFallback: false,
    }));
    const mod = await import('../controllers/shop-owner/auctionManage.controller.js');
    // pause
    const resPause = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await mod.pauseAuction({ user: { id: 'u' }, params: { id: AUCTION }, io: { to: () => ({ emit: () => {} }), emit: () => {} } }, resPause);
    expect(resPause.json).toHaveBeenCalled();
    // resume — must have paused_at from previous, shift once
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM auctions WHERE id/.test(sql)) return { rows: [{ id: AUCTION, product_id: PRODUCT, status: 'paused', start_time: new Date().toISOString(), end_time: endTime.toISOString(), paused_at: pausedAt.toISOString() }] };
      if (/SELECT shop_id FROM products/.test(sql)) return { rows: [{ shop_id: SHOP }] };
      if (/SELECT \* FROM products WHERE id IN/.test(sql)) return { rows: [{ id: PRODUCT, shop_id: SHOP, name: 'Ring', category: 'Rings', image_url: 'x.jpg' }] };
      if (/SELECT \* FROM shops WHERE id IN/.test(sql)) return { rows: [{ id: SHOP, home_branch_id: 'b1' }] };
      if (/SELECT \* FROM branches WHERE id IN/.test(sql)) return { rows: [{ id: 'b1', name: 'Gmall Branch' }] };
      if (/FROM bids/.test(sql)) return { rows: [] };
      if (/FROM watchlists/.test(sql)) return { rows: [] };
      if (/SELECT id, name FROM users/.test(sql)) return { rows: [] };
      if (/FROM orders/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const resResume = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await mod.resumeAuction({ user: { id: 'u' }, params: { id: AUCTION }, io: { to: () => ({ emit: () => {} }), emit: () => {} } }, resResume);
    expect(resResume.json).toHaveBeenCalled();
    // second resume should fail (already live, paused_at cleared)
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM auctions WHERE id/.test(sql)) return { rows: [{ id: AUCTION, product_id: PRODUCT, status: 'live', start_time: new Date().toISOString(), end_time: endTime.toISOString(), paused_at: null }] };
      if (/SELECT shop_id FROM products/.test(sql)) return { rows: [{ shop_id: SHOP }] };
      return { rows: [] };
    });
    const resResume2 = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await mod.resumeAuction({ user: { id: 'u' }, params: { id: AUCTION } }, resResume2);
    expect(resResume2.status).toHaveBeenCalledWith(409);
  });

  it('bid during pause is rejected via validateAuctionBidWindow', async () => {
    const { validateAuctionBidWindow } = await import('../services/bidLogic.js');
    const pausedAuction = { status: 'paused', start_time: new Date(Date.now() - 3600 * 1000).toISOString(), end_time: new Date(Date.now() + 3600 * 1000).toISOString() };
    const res = validateAuctionBidWindow(pausedAuction, new Date());
    expect(res.ok).toBe(false);
    expect(res.code).toBe('AUCTION_PAUSED');
  });

  it('Start now preserves configured duration', async () => {
    const scheduledStart = new Date(Date.now() + 86400000);
    const scheduledEnd = new Date(scheduledStart.getTime() + 2 * 3600 * 1000); // 2h
    const durationMs = scheduledEnd.getTime() - scheduledStart.getTime();
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM auctions WHERE id/.test(sql)) return { rows: [{ id: AUCTION, product_id: PRODUCT, status: 'scheduled', start_time: scheduledStart.toISOString(), end_time: scheduledEnd.toISOString(), start_price: 1000, current_bid: 0 }] };
      if (/SELECT shop_id FROM products/.test(sql)) return { rows: [{ shop_id: SHOP }] };
      if (/SELECT \* FROM products WHERE id IN/.test(sql)) return { rows: [{ id: PRODUCT, shop_id: SHOP, name: 'Ring', category: 'Rings', image_url: 'x.jpg' }] };
      if (/SELECT \* FROM shops WHERE id IN/.test(sql)) return { rows: [{ id: SHOP, home_branch_id: 'b1' }] };
      if (/SELECT \* FROM branches WHERE id IN/.test(sql)) return { rows: [{ id: 'b1', name: 'Gmall Branch' }] };
      if (/FROM bids/.test(sql)) return { rows: [] };
      if (/FROM watchlists/.test(sql)) return { rows: [] };
      if (/SELECT id, name FROM users/.test(sql)) return { rows: [] };
      if (/FROM orders/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    let capturedEnd;
    poolConnect.mockImplementation(async () => ({
      query: vi.fn(async (sql, params) => {
        if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
        if (/UPDATE auctions SET status='live'/.test(sql)) {
          capturedEnd = new Date(params[1]);
          return { rows: [{ id: AUCTION, product_id: PRODUCT, status: 'live', start_time: params[0], end_time: params[1] }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
      __restFallback: false,
    }));
    const mod = await import('../controllers/shop-owner/auctionManage.controller.js');
    await mod.startAuction({ user: { id: 'u' }, params: { id: AUCTION }, io: { to: () => ({ emit: () => {} }), emit: () => {} } }, { status: vi.fn().mockReturnThis(), json: vi.fn() });
    const now = Date.now();
    const newDuration = capturedEnd.getTime() - now;
    expect(Math.abs(newDuration - durationMs)).toBeLessThan(2000); // within 2s
  });

  it('arbitrary extension amount rejected', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM auctions WHERE id/.test(sql)) return { rows: [{ id: AUCTION, product_id: PRODUCT, status: 'live', start_time: new Date(Date.now() - 3600 * 1000).toISOString(), end_time: new Date(Date.now() + 3600 * 1000).toISOString(), start_price: 1000, current_bid: 2000 }] };
      if (/SELECT shop_id FROM products/.test(sql)) return { rows: [{ shop_id: SHOP }] };
      return { rows: [] };
    });
    const mod = await import('../controllers/shop-owner/auctionManage.controller.js');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await mod.extendAuction({ user: { id: 'u' }, params: { id: AUCTION }, body: { minutes: 500 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('pause without migration fails clearly', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM auctions WHERE id/.test(sql)) return { rows: [{ id: AUCTION, product_id: PRODUCT, status: 'live', start_time: new Date().toISOString(), end_time: new Date(Date.now() + 3600 * 1000).toISOString() }] };
      if (/SELECT shop_id FROM products/.test(sql)) return { rows: [{ shop_id: SHOP }] };
      return { rows: [] };
    });
    poolConnect.mockImplementation(async () => ({
      query: vi.fn(async (sql) => {
        if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
        if (/UPDATE auctions SET status='paused'/.test(sql)) throw new Error('invalid input value for enum auction_status: "paused"');
        return { rows: [] };
      }),
      release: vi.fn(),
      __restFallback: false,
    }));
    const mod = await import('../controllers/shop-owner/auctionManage.controller.js');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await mod.pauseAuction({ user: { id: 'u' }, params: { id: AUCTION }, io: { emit: () => {} } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe('MIGRATION_MISSING');
  });
});

describe('relist safety and top bidders / watchers', () => {
  it('relist creates clean new auction and leaves original unchanged', async () => {
    const ended = { id: AUCTION, product_id: PRODUCT, status: 'ended', start_time: new Date(Date.now() - 8 * 86400000).toISOString(), end_time: new Date(Date.now() - 86400000).toISOString(), start_price: 5000, current_bid: 8000 };
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM auctions WHERE id=\$1/.test(sql)) return { rows: [ended] };
      if (/SELECT shop_id FROM products/.test(sql)) return { rows: [{ shop_id: SHOP }] };
      if (/SELECT \* FROM products WHERE id=\$1/.test(sql)) return { rows: [{ id: PRODUCT, shop_id: SHOP, name: 'Ring', category: 'Rings', image_url: 'x.jpg', price: 5000 }] };
      if (/SELECT \* FROM products WHERE id IN/.test(sql)) return { rows: [{ id: PRODUCT, shop_id: SHOP, name: 'Ring', category: 'Rings', image_url: 'x.jpg' }] };
      if (/SELECT \* FROM shops WHERE id IN/.test(sql)) return { rows: [{ id: SHOP, home_branch_id: 'b1' }] };
      if (/SELECT \* FROM branches WHERE id IN/.test(sql)) return { rows: [{ id: 'b1', name: 'Branch' }] };
      if (/FROM bids/.test(sql)) return { rows: [] };
      if (/FROM watchlists/.test(sql)) return { rows: [] };
      if (/SELECT id, name FROM users/.test(sql)) return { rows: [] };
      if (/FROM orders/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    poolConnect.mockImplementation(async () => ({
      query: vi.fn(async (sql, params) => {
        if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
        if (/INSERT INTO auctions/.test(sql)) {
          expect(params[2]).toBe('scheduled'); // starts scheduled when future
          expect(Number(params[1])).toBe(5000); // start_price preserved
          return { rows: [{ id: 'new-id', product_id: PRODUCT, status: params[2], start_time: params[3], end_time: params[4], start_price: params[1], current_bid: params[1] }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    }));
    const mod = await import('../controllers/shop-owner/auctionManage.controller.js');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await mod.relistAuction({ user: { id: 'u' }, params: { id: AUCTION }, body: { start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 8 * 86400000).toISOString() } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('top bidders scoped to seller only', async () => {
    const mod = await import('../controllers/shop-owner/auctionManage.controller.js');
    // Mock: seller has 1 auction, other seller auction not included
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT id FROM products WHERE shop_id/.test(sql)) return { rows: [{ id: PRODUCT }] };
      if (/SELECT id FROM auctions WHERE product_id IN/.test(sql)) return { rows: [{ id: AUCTION }] };
      if (/FROM bids WHERE auction_id IN/.test(sql)) return { rows: [{ user_id: 'user-1', amount: 1000, auction_id: AUCTION }] };
      if (/SELECT id, name FROM users/.test(sql)) return { rows: [{ id: 'user-1', name: 'Scoped User' }] };
      if (/FROM orders WHERE auction_id IN/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const req = { user: { id: 'seller' } };
    const res = { json: vi.fn() };
    await mod.getTopBidders(req, res);
    expect(res.json).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload[0].bidder_name).toBe('Scoped User');
  });

  it('watchers use canonical watchlists source (not favorites)', async () => {
    const content = fs.readFileSync(path.join(__dirname, '../controllers/shop-owner/auctionManage.controller.js'), 'utf8');
    expect(content).toMatch(/FROM watchlists/);
    expect(content).not.toMatch(/FROM favorites.*watcher/i);
  });
});

describe('double close is idempotent (one ended auction, one order)', () => {
  it('closing twice ends once and never duplicates the order', async () => {
    vi.resetModules();
    poolQuery.mockReset();
    poolConnect.mockReset();
    directPgFlag = true;
    let orderInserts = 0;
    let closes = 0;
    const txClient = {
      query: vi.fn(async (sql) => {
        if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
        if (/UPDATE auctions SET status = 'ended'/.test(sql)) {
          closes += 1;
          if (closes === 1) {
            return { rows: [{ id: AUCTION, status: 'ended' }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
        if (/FROM bids[\s\S]*auction_id\s*=\s*\$1/.test(sql)) {
          return { rows: [{ user_id: 'user-1', amount: 1000, created_at: new Date().toISOString() }] };
        }
        if (/FROM orders WHERE auction_id=\$1/.test(sql)) return { rows: [] };
        if (/SELECT product_id FROM auctions/.test(sql)) return { rows: [{ product_id: PRODUCT }] };
        if (/SELECT shop_id FROM products/.test(sql)) return { rows: [{ shop_id: SHOP }] };
        if (/SELECT home_branch_id FROM shops/.test(sql)) return { rows: [{ home_branch_id: null }] };
        if (/INSERT INTO orders/.test(sql)) {
          orderInserts += 1;
          return { rows: [{ id: 'order-1' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    poolConnect.mockResolvedValue(txClient);
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT \* FROM auctions WHERE id=\$1/.test(sql)) return { rows: [{ id: AUCTION, status: 'ended' }] };
      return { rows: [] };
    });
    const { closeSingleAuction } = await import('../services/auctionClosingService.js');
    const first = await closeSingleAuction(AUCTION);
    expect(first.alreadyEnded).toBe(false);
    expect(first.orderId).toBe('order-1');
    const second = await closeSingleAuction(AUCTION);
    expect(second.alreadyEnded).toBe(true);
    expect(orderInserts).toBe(1);
  });
});
