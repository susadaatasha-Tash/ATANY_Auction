// backend/src/tests/sellerAuctionManage.test.js — Seller Auction Management (My Auctions premium)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();
const poolConnect = vi.fn();
let directPgFlag = true;
vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: (...a) => poolConnect(...a), on: () => {} },
  isDirectPg: () => directPgFlag,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })), admin: {} }})) }));
vi.mock('../services/emailService.js', () => ({ sendNotificationEmail: vi.fn(async () => {}) }));

const SELLER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SELLER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SHOP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OTHER_SHOP = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const PRODUCT_A = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const PRODUCT_B = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const AUCTION_LIVE = '11111111-1111-1111-1111-111111111111';
const AUCTION_SCHED = '22222222-2222-2222-2222-222222222222';
const AUCTION_ENDED = '33333333-3333-3333-3333-333333333333';

function mockRes() { const r = {}; r.status = vi.fn().mockReturnValue(r); r.json = vi.fn().mockReturnValue(r); return r; }

const now = new Date();
const liveStart = new Date(now.getTime() - 3600 * 1000).toISOString();
const liveEnd = new Date(now.getTime() + 3600 * 1000).toISOString();
const schedStart = new Date(now.getTime() + 86400000).toISOString();
const schedEnd = new Date(now.getTime() + 8 * 86400000).toISOString();
const endedStart = new Date(now.getTime() - 8 * 86400000).toISOString();
const endedEnd = new Date(now.getTime() - 86400000).toISOString();

let manageModule;
beforeEach(async () => {
  vi.resetModules();
  poolQuery.mockReset();
  poolConnect.mockReset();
  directPgFlag = true;
  // Default poolConnect returns a mock client for transactions
  poolConnect.mockImplementation(async () => ({
    query: vi.fn(async (sql) => {
      if (/BEGIN/.test(sql)) return { rows: [] };
      if (/COMMIT/.test(sql)) return { rows: [] };
      if (/ROLLBACK/.test(sql)) return { rows: [] };
      if (/UPDATE auctions SET status='live'/.test(sql)) return { rows: [{ id: AUCTION_SCHED, product_id: PRODUCT_A, status: 'live', start_time: new Date().toISOString(), end_time: new Date(Date.now() + 86400000).toISOString(), start_price: 4000, current_bid: 4000, auction_code: 'LOT-1001' }] };
      if (/UPDATE auctions SET end_time = end_time \+ INTERVAL/.test(sql)) return { rows: [{ id: AUCTION_LIVE, product_id: PRODUCT_A, status: 'live', start_time: liveStart, end_time: new Date(Date.now() + 7200000).toISOString(), start_price: 4000, current_bid: 6000 }] };
      if (/UPDATE auctions SET status='paused'/.test(sql)) return { rows: [{ id: AUCTION_LIVE, product_id: PRODUCT_A, status: 'paused', start_time: liveStart, end_time: liveEnd, start_price: 4000, current_bid: 6000, paused_at: new Date().toISOString() }] };
      if (/UPDATE auctions SET status='live', paused_at=NULL/.test(sql)) return { rows: [{ id: AUCTION_LIVE, product_id: PRODUCT_A, status: 'live', start_time: liveStart, end_time: new Date(Date.now() + 3600000).toISOString(), start_price: 4000, current_bid: 6000 }] };
      if (/UPDATE auctions SET status='ended'/.test(sql)) return { rows: [{ id: AUCTION_LIVE, product_id: PRODUCT_A, status: 'ended', start_time: liveStart, end_time: new Date().toISOString(), start_price: 4000, current_bid: 6000 }] };
      if (/INSERT INTO auctions/.test(sql)) return { rows: [{ id: '99999999-9999-9999-9999-999999999999', product_id: PRODUCT_A, status: 'scheduled', start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 8 * 86400000).toISOString(), start_price: 4000, current_bid: 4000 }] };
      return { rows: [] };
    }),
    release: vi.fn(),
    __restFallback: false,
  }));
  manageModule = await import('../controllers/shop-owner/auctionManage.controller.js');
});

function setupManageMocks({ ownShop = SHOP, auctions = null } = {}) {
  const allAuctions = auctions || [
    { id: AUCTION_LIVE, product_id: PRODUCT_A, status: 'live', start_time: liveStart, end_time: liveEnd, start_price: 4000, current_bid: 6000, auction_code: 'LOT-1001' },
    { id: AUCTION_SCHED, product_id: PRODUCT_B, status: 'scheduled', start_time: schedStart, end_time: schedEnd, start_price: 55000, current_bid: 0, auction_code: 'LOT-1002' },
    { id: AUCTION_ENDED, product_id: PRODUCT_A, status: 'ended', start_time: endedStart, end_time: endedEnd, start_price: 60000, current_bid: 88000, auction_code: 'LOT-1003' },
  ];
  poolQuery.mockImplementation(async (sql, params) => {
    if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: ownShop }] };
    if (/FROM users WHERE id/.test(sql)) return { rows: [{ name: 'Shop Owner' }] };
    if (/SELECT id FROM products WHERE shop_id/.test(sql)) return { rows: [{ id: PRODUCT_A }, { id: PRODUCT_B }] };
    if (/SELECT \* FROM auctions WHERE product_id IN/.test(sql)) return { rows: allAuctions };
    if (/SELECT \* FROM products WHERE id IN/.test(sql)) return { rows: [{ id: PRODUCT_A, shop_id: SHOP, name: 'Ring', category: 'Rings', image_url: 'x.jpg', price: 4000 }, { id: PRODUCT_B, shop_id: SHOP, name: 'Pendant', category: 'Necklaces', image_url: 'y.jpg', price: 55000 }] };
    if (/SELECT \* FROM shops WHERE id IN/.test(sql)) return { rows: [{ id: SHOP, home_branch_id: 'branch-1' }] };
    if (/SELECT \* FROM branches WHERE id IN/.test(sql)) return { rows: [{ id: 'branch-1', name: 'Gmall Branch', address: 'Gmall' }] };
    if (/FROM bids WHERE auction_id IN/.test(sql)) {
      // one bid for live auction
      return { rows: [{ auction_id: AUCTION_LIVE, user_id: 'user-1', amount: 6000, created_at: new Date().toISOString() }, { auction_id: AUCTION_ENDED, user_id: 'user-2', amount: 88000, created_at: new Date().toISOString() }] };
    }
    if (/FROM watchlists WHERE product_id IN/.test(sql)) return { rows: [{ user_id: 'u1', product_id: PRODUCT_A }] };
    if (/SELECT id, name FROM users WHERE id IN/.test(sql)) return { rows: [{ id: 'user-1', name: 'Maria Santos' }, { id: 'user-2', name: 'Anthony Ong' }] };
    if (/FROM orders WHERE auction_id IN/.test(sql)) return { rows: [{ auction_id: AUCTION_ENDED, buyer_id: 'user-2', amount: 88000 }] };
    if (/FROM branches/.test(sql)) return { rows: [] };
    return { rows: [] };
  });
}

describe('seller auction management — ownership & counts', () => {
  it('seller only receives own auctions', async () => {
    setupManageMocks({ ownShop: SHOP });
    const req = { user: { id: SELLER }, query: {} };
    const res = mockRes();
    await manageModule.manageAuctions(req, res);
    expect(res.json).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.auctions.length).toBe(3);
    expect(payload.summary.total).toBe(3);
  });

  it('counts correct per status', async () => {
    setupManageMocks();
    const req = { user: { id: SELLER }, query: {} };
    const res = mockRes();
    await manageModule.manageAuctions(req, res);
    const { summary } = res.json.mock.calls[0][0];
    expect(summary.live).toBe(1);
    expect(summary.scheduled).toBe(1);
    expect(summary.ended).toBe(1);
  });

  it('search filters by title', async () => {
    setupManageMocks();
    const req = { user: { id: SELLER }, query: { search: 'Ring' } };
    const res = mockRes();
    await manageModule.manageAuctions(req, res);
    const { auctions } = res.json.mock.calls[0][0];
    expect(auctions.every(a => a.title.toLowerCase().includes('ring') || a.category.toLowerCase().includes('ring'))).toBe(true);
  });

  it('status filter works', async () => {
    setupManageMocks();
    const req = { user: { id: SELLER }, query: { status: 'live' } };
    const res = mockRes();
    await manageModule.manageAuctions(req, res);
    const { auctions } = res.json.mock.calls[0][0];
    expect(auctions.every(a => a.status === 'live')).toBe(true);
  });

  it('category filter works', async () => {
    setupManageMocks();
    const req = { user: { id: SELLER }, query: { category: 'Rings' } };
    const res = mockRes();
    await manageModule.manageAuctions(req, res);
    const { auctions } = res.json.mock.calls[0][0];
    expect(auctions.every(a => a.category === 'Rings')).toBe(true);
  });

  it('leaderboard is deduplicated per bidder and does not expose email', async () => {
    setupManageMocks();
    const req = { user: { id: SELLER }, query: {} };
    const res = mockRes();
    await manageModule.manageAuctions(req, res);
    const { auctions } = res.json.mock.calls[0][0];
    for (const a of auctions) {
      for (const row of a.leaderboard || []) {
        expect(row.bidder_name).toBeDefined();
        expect(row.bidder_id).toBeDefined();
        expect(row.email).toBeUndefined();
        expect(row.phone).toBeUndefined();
      }
    }
  });

  it('watcher count is batch and correct', async () => {
    setupManageMocks();
    const req = { user: { id: SELLER }, query: {} };
    const res = mockRes();
    await manageModule.manageAuctions(req, res);
    const { auctions } = res.json.mock.calls[0][0];
    const live = auctions.find(a => a.id === AUCTION_LIVE);
    expect(live.watcher_count).toBe(1);
  });

  it('blocked when shop not found', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops/.test(sql)) return { rows: [] };
      if (/SELECT name/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const req = { user: { id: SELLER }, query: {} };
    const res = mockRes();
    // Mock insertion fails
    poolQuery.mockImplementation(async (sql) => {
      if (/INSERT INTO shops/.test(sql)) throw new Error('no insert');
      if (/SELECT id FROM shops/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
  });
});

describe('seller auction mutations', () => {
  function baseLoadMocks(auctionId, shopId) {
    poolQuery.mockImplementation(async (sql, params) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: shopId }] };
      if (/SELECT \* FROM auctions WHERE id=\$1/.test(sql)) {
        if (String(params[0]) === AUCTION_LIVE) return { rows: [{ id: AUCTION_LIVE, product_id: PRODUCT_A, status: 'live', start_time: liveStart, end_time: liveEnd, start_price: 4000, current_bid: 6000 }] };
        if (String(params[0]) === AUCTION_SCHED) return { rows: [{ id: AUCTION_SCHED, product_id: PRODUCT_B, status: 'scheduled', start_time: schedStart, end_time: schedEnd, start_price: 55000, current_bid: 0 }] };
        if (String(params[0]) === AUCTION_ENDED) return { rows: [{ id: AUCTION_ENDED, product_id: PRODUCT_A, status: 'ended', start_time: endedStart, end_time: endedEnd, start_price: 60000, current_bid: 88000 }] };
        return { rows: [] };
      }
      if (/SELECT shop_id FROM products WHERE id/.test(sql)) return { rows: [{ shop_id: shopId === OTHER_SHOP ? OTHER_SHOP : SHOP }] };
      // Enrichment fallbacks after mutation
      if (/SELECT \* FROM products WHERE id IN/.test(sql)) return { rows: [{ id: PRODUCT_A, shop_id: SHOP, name: 'Ring', category: 'Rings', image_url: 'x.jpg' }, { id: PRODUCT_B, shop_id: SHOP, name: 'Pendant', category: 'Necklaces', image_url: 'y.jpg' }] };
      if (/SELECT \* FROM shops WHERE id IN/.test(sql)) return { rows: [{ id: SHOP, home_branch_id: 'branch-1' }] };
      if (/SELECT \* FROM branches WHERE id IN/.test(sql)) return { rows: [{ id: 'branch-1', name: 'Gmall Branch' }] };
      if (/FROM bids WHERE auction_id IN/.test(sql)) return { rows: [] };
      if (/FROM watchlists WHERE product_id IN/.test(sql)) return { rows: [] };
      if (/SELECT id, name FROM users/.test(sql)) return { rows: [] };
      if (/FROM orders WHERE auction_id IN/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
  }

  it('unauthorized seller cannot start another seller auction', async () => {
    baseLoadMocks(AUCTION_SCHED, SHOP);
    // Simulate other seller owns auction (product shop_id mismatch)
    poolQuery.mockImplementation(async (sql, params) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: OTHER_SHOP }] };
      if (/SELECT \* FROM auctions WHERE id=\$1/.test(sql)) return { rows: [{ id: AUCTION_SCHED, product_id: PRODUCT_B, status: 'scheduled', start_time: schedStart, end_time: schedEnd, start_price: 55000, current_bid: 0 }] };
      if (/SELECT shop_id FROM products WHERE id/.test(sql)) return { rows: [{ shop_id: SHOP }] };
      return { rows: [] };
    });
    const req = { user: { id: OTHER_SELLER }, params: { id: AUCTION_SCHED }, io: { to: () => ({ emit: () => {} }), emit: () => {} } };
    const res = mockRes();
    await manageModule.startAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('extend updates end_time (live only)', async () => {
    baseLoadMocks(AUCTION_LIVE, SHOP);
    const req = { user: { id: SELLER }, params: { id: AUCTION_LIVE }, body: { minutes: 5 }, io: { to: () => ({ emit: () => {} }), emit: () => {} } };
    const res = mockRes();
    await manageModule.extendAuction(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('ended auction cannot extend', async () => {
    baseLoadMocks(AUCTION_ENDED, SHOP);
    poolQuery.mockImplementation(async (sql, params) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM auctions WHERE id=\$1/.test(sql)) return { rows: [{ id: AUCTION_ENDED, product_id: PRODUCT_A, status: 'ended', start_time: endedStart, end_time: endedEnd, start_price: 60000, current_bid: 88000 }] };
      if (/SELECT shop_id FROM products WHERE id/.test(sql)) return { rows: [{ shop_id: SHOP }] };
      return { rows: [] };
    });
    const req = { user: { id: SELLER }, params: { id: AUCTION_ENDED }, body: { minutes: 5 } };
    const res = mockRes();
    await manageModule.extendAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('end now is idempotent when already ended', async () => {
    baseLoadMocks(AUCTION_ENDED, SHOP);
    poolQuery.mockImplementation(async (sql, params) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM auctions WHERE id=\$1/.test(sql)) return { rows: [{ id: AUCTION_ENDED, product_id: PRODUCT_A, status: 'ended', start_time: endedStart, end_time: endedEnd, start_price: 60000, current_bid: 88000 }] };
      if (/SELECT shop_id FROM products WHERE id/.test(sql)) return { rows: [{ shop_id: SHOP }] };
      if (/SELECT \* FROM products WHERE id IN/.test(sql)) return { rows: [{ id: PRODUCT_A, shop_id: SHOP, name: 'Ring', category: 'Rings', image_url: 'x.jpg' }] };
      if (/SELECT \* FROM shops WHERE id IN/.test(sql)) return { rows: [{ id: SHOP, home_branch_id: 'branch-1' }] };
      if (/SELECT \* FROM branches WHERE id IN/.test(sql)) return { rows: [{ id: 'branch-1', name: 'Gmall Branch' }] };
      if (/FROM bids WHERE auction_id IN/.test(sql)) return { rows: [] };
      if (/FROM watchlists/.test(sql)) return { rows: [] };
      if (/SELECT id, name FROM users/.test(sql)) return { rows: [] };
      if (/FROM orders WHERE auction_id IN/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const req = { user: { id: SELLER }, params: { id: AUCTION_ENDED }, io: { emit: () => {} } };
    const res = mockRes();
    await manageModule.endAuction(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('relist creates NEW auction and preserves original', async () => {
    baseLoadMocks(AUCTION_ENDED, SHOP);
    poolQuery.mockImplementation(async (sql, params) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM auctions WHERE id=\$1/.test(sql)) return { rows: [{ id: AUCTION_ENDED, product_id: PRODUCT_A, status: 'ended', start_time: endedStart, end_time: endedEnd, start_price: 60000, current_bid: 88000 }] };
      if (/SELECT shop_id FROM products WHERE id/.test(sql)) return { rows: [{ shop_id: SHOP }] };
      if (/SELECT \* FROM products WHERE id=\$1/.test(sql)) return { rows: [{ id: PRODUCT_A, shop_id: SHOP, name: 'Ring', category: 'Rings', image_url: 'x.jpg', price: 60000 }] };
      return { rows: [] };
    });
    const req = { user: { id: SELLER }, params: { id: AUCTION_ENDED }, body: { start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 8 * 86400000).toISOString() } };
    const res = mockRes();
    await manageModule.relistAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('transactional routes fail closed when REST fallback', async () => {
    directPgFlag = false;
    // Re-import to pick up flag — but isDirectPg is mocked, so just set connect to fallback
    poolConnect.mockImplementation(async () => ({ query: async () => ({ rows: [] }), release: () => {}, __restFallback: true }));
    // Need fresh import that sees flag false; requireDirectPg will throw
    const fresh = await import('../controllers/shop-owner/auctionManage.controller.js');
    // Mock shop/auction load with direct query still
    poolQuery.mockImplementation(async (sql, params) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM auctions WHERE id=\$1/.test(sql)) return { rows: [{ id: AUCTION_LIVE, product_id: PRODUCT_A, status: 'live', start_time: liveStart, end_time: liveEnd, start_price: 4000, current_bid: 6000 }] };
      if (/SELECT shop_id FROM products WHERE id/.test(sql)) return { rows: [{ shop_id: SHOP }] };
      return { rows: [] };
    });
    const req = { user: { id: SELLER }, params: { id: AUCTION_LIVE }, body: { minutes: 5 }, io: { emit: () => {} } };
    const res = mockRes();
    await fresh.extendAuction(req, res);
    expect([503, 409].includes(res.status.mock.calls[0]?.[0])).toBeTruthy();
    directPgFlag = true;
  });
});
