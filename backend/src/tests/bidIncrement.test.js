// backend/src/tests/bidIncrement.test.js
// Per-auction minimum bid increment tests.
// Validates bidLogic uses auction.minimum_bid_increment from DB, not hardcoded constant.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();
const poolConnect = vi.fn();

vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: (...a) => poolConnect(...a), on: () => {} },
  isDirectPg: () => true,
}));
vi.mock('../services/fraudCheck.js', () => ({ checkFraud: vi.fn(async () => ({ flagged: false })) }));
vi.mock('../services/notificationPreference.js', () => ({ shouldDeliverNotification: vi.fn(async () => false) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) } })) }));

const AUCTION = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function mockRes() { const r = {}; r.status = vi.fn().mockReturnValue(r); r.json = vi.fn().mockReturnValue(r); return r; }

let bidLogicModule;

beforeEach(async () => {
  vi.resetModules();
  poolQuery.mockReset();
  poolConnect.mockReset();
  bidLogicModule = await import('../services/bidLogic.js');
});

function setupAuction({ increment = 1000, currentBid = 0, status = 'live' } = {}) {
  const now = new Date();
  const start = new Date(now.getTime() - 3600 * 1000).toISOString();
  const end = new Date(now.getTime() + 3600 * 1000).toISOString();
  poolConnect.mockImplementation(async () => ({
    query: vi.fn(async (sql, params) => {
      if (/BEGIN/.test(sql) || /COMMIT/.test(sql) || /ROLLBACK/.test(sql)) return { rows: [] };
      if (/SELECT current_bid.*FROM auctions WHERE id = \$1 FOR UPDATE/.test(sql)) {
        return { rows: [{ id: AUCTION, current_bid: currentBid, status, start_time: start, end_time: end, minimum_bid_increment: increment }] };
      }
      if (/INSERT INTO bids/.test(sql)) return { rows: [{ id: 'bid-1', auction_id: params[0], user_id: params[1], amount: Number(params[2]), created_at: new Date().toISOString() }] };
      return { rows: [] };
    }),
    release: vi.fn(),
    __restFallback: false,
  }));
}

describe('bidLogic — per-auction minimum bid increment', () => {
  it('rejects bid below minimum with BID_TOO_LOW code and structured extra', async () => {
    setupAuction({ increment: 2000, currentBid: 74000 });
    try {
      await bidLogicModule.placeBid({ auctionId: AUCTION, userId: USER, amount: 75999 });
      expect(false).toBe(true); // should not reach
    } catch (e) {
      expect(e.code).toBe('BID_TOO_LOW');
      expect(e.extra.current_bid).toBe(74000);
      expect(e.extra.minimum_bid_increment).toBe(2000);
      expect(e.extra.minimum_bid).toBe(76000);
    }
  });

  it('accepts bid at exactly minimumNextBid with increment 2000', async () => {
    setupAuction({ increment: 2000, currentBid: 74000 });
    const res = await bidLogicModule.placeBid({ auctionId: AUCTION, userId: USER, amount: 76000 });
    expect(res.bid.amount).toBe(76000);
  });

  it('accepts bid higher than minimum (not exact multiple) with increment 2000', async () => {
    setupAuction({ increment: 2000, currentBid: 74000 });
    const res = await bidLogicModule.placeBid({ auctionId: AUCTION, userId: USER, amount: 77000 });
    expect(res.bid.amount).toBe(77000);
  });

  it('accepts bid much higher than minimum with increment 2000', async () => {
    setupAuction({ increment: 2000, currentBid: 74000 });
    const res = await bidLogicModule.placeBid({ auctionId: AUCTION, userId: USER, amount: 100000 });
    expect(res.bid.amount).toBe(100000);
  });

  it('rejects bid equal to current bid (below minimum)', async () => {
    setupAuction({ increment: 1000, currentBid: 50000 });
    try {
      await bidLogicModule.placeBid({ auctionId: AUCTION, userId: USER, amount: 50000 });
      expect(false).toBe(true);
    } catch (e) {
      expect(e.code).toBe('BID_TOO_LOW');
      expect(e.extra.minimum_bid).toBe(51000);
    }
  });

  it('uses increment 5000 correctly', async () => {
    setupAuction({ increment: 5000, currentBid: 10000 });
    try {
      await bidLogicModule.placeBid({ auctionId: AUCTION, userId: USER, amount: 14000 });
      expect(false).toBe(true);
    } catch (e) {
      expect(e.code).toBe('BID_TOO_LOW');
      expect(e.extra.minimum_bid).toBe(15000);
    }
    const res = await bidLogicModule.placeBid({ auctionId: AUCTION, userId: USER, amount: 15000 });
    expect(res.bid.amount).toBe(15000);
  });

  it('two auctions can have different increments simultaneously', async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 3600 * 1000).toISOString();
    const end = new Date(now.getTime() + 3600 * 1000).toISOString();
    const configs = {
      [AUCTION]: { increment: 1000, currentBid: 50000 },
      'dddddddd-dddd-dddd-dddd-dddddddddddd': { increment: 2000, currentBid: 50000 },
    };
    poolConnect.mockImplementation(async () => ({
      query: vi.fn(async (sql, params) => {
        if (/BEGIN/.test(sql) || /COMMIT/.test(sql) || /ROLLBACK/.test(sql)) return { rows: [] };
        if (/SELECT current_bid.*FROM auctions WHERE id = \$1 FOR UPDATE/.test(sql)) {
          const id = params[0];
          const cfg = configs[id];
          if (!cfg) return { rows: [] };
          return { rows: [{ id, current_bid: cfg.currentBid, status: 'live', start_time: start, end_time: end, minimum_bid_increment: cfg.increment }] };
        }
        if (/INSERT INTO bids/.test(sql)) return { rows: [{ id: 'bid-1', auction_id: params[0], user_id: params[1], amount: Number(params[2]), created_at: new Date().toISOString() }] };
        return { rows: [] };
      }),
      release: vi.fn(),
      __restFallback: false,
    }));

    // 51000 valid for auction A (increment 1000)
    const resA = await bidLogicModule.placeBid({ auctionId: AUCTION, userId: USER, amount: 51000 });
    expect(resA.bid.amount).toBe(51000);

    // 51000 invalid for auction B (increment 2000, min 52000)
    const auctionB = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    try {
      await bidLogicModule.placeBid({ auctionId: auctionB, userId: USER, amount: 51000 });
      expect(false).toBe(true);
    } catch (e) {
      expect(e.code).toBe('BID_TOO_LOW');
      expect(e.extra.minimum_bid).toBe(52000);
    }
  });
});
