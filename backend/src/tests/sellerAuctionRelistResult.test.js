// backend/src/tests/sellerAuctionRelistResult.test.js
// Seller Relist wizard backend + Auction Result payload.
//   • relist creates a NEW auction and never mutates the ended source
//   • relist accepts the wizard's schedule + bidding rules and validates them
//   • the result endpoint returns the authoritative winner / final bid /
//     bid count / watcher count / ranked leaderboard for a seller-owned auction
//   • cross-seller access is rejected (404, same convention as sibling routes)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();
const poolConnect = vi.fn();

vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: (...a) => poolConnect(...a), on: () => {} },
  isDirectPg: () => true,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) } })) }));

const SELLER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SELLER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SHOP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OTHER_SHOP = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const PRODUCT = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const AUCTION = '11111111-1111-1111-1111-111111111111';
const NEW_AUCTION = '99999999-9999-9999-9999-999999999999';
const BUYER = 'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1';

const now = Date.now();
const endedStart = new Date(now - 8 * 86400000).toISOString();
const endedEnd = new Date(now - 86400000).toISOString();

let manage;
let inserted;

function mockRes() { const r = {}; r.status = vi.fn().mockReturnValue(r); r.json = vi.fn().mockReturnValue(r); return r; }

/** Shared read mocks. `over` lets a test change one dataset. */
function setupReads({ ownShop = SHOP, productShop = SHOP, status = 'ended', bids = [], watchers = [], orders = [], users = [] } = {}) {
  // A stored 'live' auction needs a live window, otherwise effectiveStatus()
  // correctly resolves it to 'ended' by wall-clock time.
  const live = status === 'live';
  const auction = {
    id: AUCTION, product_id: PRODUCT, status,
    start_time: live ? new Date(now - 3600000).toISOString() : endedStart,
    end_time: live ? new Date(now + 3600000).toISOString() : endedEnd,
    start_price: 60000, current_bid: 88000, minimum_bid_increment: 2500,
    auction_code: 'A-812',
  };
  poolQuery.mockImplementation(async (sql) => {
    if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: ownShop }] };
    if (/SELECT \* FROM auctions WHERE id=\$1/.test(sql)) return { rows: [auction] };
    if (/SELECT shop_id FROM products WHERE id=\$1/.test(sql)) return { rows: [{ shop_id: productShop }] };
    if (/SELECT \* FROM products WHERE id IN/.test(sql)) return { rows: [{ id: PRODUCT, shop_id: productShop, name: 'Diamond Stud Earrings 1.0ct', category: 'Earrings', karat_weight: '18K', description: 'Real description', image_url: 'img.jpg', price: 60000 }] };
    if (/SELECT \* FROM products WHERE id=\$1/.test(sql)) return { rows: [{ id: PRODUCT, shop_id: productShop, name: 'Diamond Stud Earrings 1.0ct', category: 'Earrings', karat_weight: '18K', description: 'Real description', image_url: 'img.jpg', price: 60000 }] };
    if (/SELECT \* FROM shops WHERE id IN/.test(sql)) return { rows: [{ id: productShop, home_branch_id: 'branch-1' }] };
    if (/SELECT \* FROM branches WHERE id IN/.test(sql)) return { rows: [{ id: 'branch-1', name: 'Gmall Branch' }] };
    if (/FROM bids WHERE auction_id IN/.test(sql)) return { rows: bids };
    if (/FROM watchlists WHERE product_id IN/.test(sql)) return { rows: watchers };
    if (/FROM orders WHERE auction_id IN/.test(sql)) return { rows: orders };
    if (/SELECT id, name FROM users WHERE id IN/.test(sql)) return { rows: users };
    return { rows: [] };
  });
  return auction;
}

beforeEach(async () => {
  vi.resetModules();
  poolQuery.mockReset();
  poolConnect.mockReset();
  inserted = null;
  poolConnect.mockImplementation(async () => ({
    query: vi.fn(async (sql, params) => {
      if (/BEGIN/.test(sql) || /COMMIT/.test(sql) || /ROLLBACK/.test(sql)) return { rows: [] };
      if (/INSERT INTO auctions/.test(sql)) {
        inserted = { sql, params };
        return { rows: [{ id: NEW_AUCTION, product_id: PRODUCT, status: 'scheduled', start_time: params[4], end_time: params[5], start_price: params[1], current_bid: params[1], minimum_bid_increment: params[2], auction_code: 'A-900' }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
    __restFallback: false,
  }));
  manage = await import('../controllers/shop-owner/auctionManage.controller.js');
});

describe('RELIST — creates a new auction, preserves the source', () => {
  it('1/2. an ended seller-owned auction is relisted and a NEW auction id is returned', async () => {
    setupReads();
    const req = { user: { id: SELLER }, params: { id: AUCTION }, body: { start_time: new Date(now + 86400000).toISOString(), end_time: new Date(now + 8 * 86400000).toISOString() } };
    const res = mockRes();
    await manage.relistAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.id).toBe(NEW_AUCTION);
    expect(body.id).not.toBe(AUCTION);
  });

  it('3/4. the original auction row is never updated and its bids are never deleted', async () => {
    setupReads();
    const req = { user: { id: SELLER }, params: { id: AUCTION }, body: { start_time: new Date(now + 86400000).toISOString(), end_time: new Date(now + 8 * 86400000).toISOString() } };
    const res = mockRes();
    await manage.relistAuction(req, res);
    const allSql = [...poolQuery.mock.calls.map(c => c[0]), ...(inserted ? [inserted.sql] : [])].join('\n');
    expect(allSql).not.toMatch(/UPDATE auctions SET/);
    expect(allSql).not.toMatch(/DELETE FROM bids/);
    expect(allSql).not.toMatch(/DELETE FROM orders/);
    expect(allSql).not.toMatch(/DELETE FROM products/);
  });

  it('5. the new schedule is stored on the new auction', async () => {
    setupReads();
    const start = new Date(now + 3 * 86400000).toISOString();
    const end = new Date(now + 10 * 86400000).toISOString();
    const req = { user: { id: SELLER }, params: { id: AUCTION }, body: { start_time: start, end_time: end } };
    const res = mockRes();
    await manage.relistAuction(req, res);
    expect(inserted).toBeTruthy();
    expect(inserted.params[4]).toBe(start);
    expect(inserted.params[5]).toBe(end);
  });

  it('6. a new starting bid supplied by the wizard is stored', async () => {
    setupReads();
    const req = { user: { id: SELLER }, params: { id: AUCTION }, body: { start_time: new Date(now + 86400000).toISOString(), end_time: new Date(now + 8 * 86400000).toISOString(), start_price: 75000 } };
    const res = mockRes();
    await manage.relistAuction(req, res);
    expect(inserted.params[1]).toBe(75000);
    const body = res.json.mock.calls[0][0];
    expect(body.start_price).toBe(75000);
  });

  it('7. the minimum bid increment is stored (wizard value, else inherited)', async () => {
    setupReads();
    const req = { user: { id: SELLER }, params: { id: AUCTION }, body: { start_time: new Date(now + 86400000).toISOString(), end_time: new Date(now + 8 * 86400000).toISOString(), minimum_bid_increment: 1500 } };
    const res = mockRes();
    await manage.relistAuction(req, res);
    expect(inserted.params[2]).toBe(1500);
    const body = res.json.mock.calls[0][0];
    expect(body.minimum_bid_increment).toBe(1500);
  });

  it('7b. the increment is inherited from the source when the wizard omits it', async () => {
    setupReads();
    const req = { user: { id: SELLER }, params: { id: AUCTION }, body: { start_time: new Date(now + 86400000).toISOString(), end_time: new Date(now + 8 * 86400000).toISOString() } };
    const res = mockRes();
    await manage.relistAuction(req, res);
    expect(inserted.params[2]).toBe(2500);
  });

  it('8. another seller cannot relist the auction (404)', async () => {
    setupReads({ ownShop: OTHER_SHOP, productShop: SHOP });
    const req = { user: { id: SELLER }, params: { id: AUCTION }, body: { start_time: new Date(now + 86400000).toISOString(), end_time: new Date(now + 8 * 86400000).toISOString() } };
    const res = mockRes();
    await manage.relistAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(inserted).toBeNull();
  });

  it('9. an invalid schedule (end before start) is rejected', async () => {
    setupReads();
    const req = { user: { id: SELLER }, params: { id: AUCTION }, body: { start_time: new Date(now + 8 * 86400000).toISOString(), end_time: new Date(now + 86400000).toISOString() } };
    const res = mockRes();
    await manage.relistAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(inserted).toBeNull();
  });

  it('10. an invalid minimum bid increment is rejected', async () => {
    setupReads();
    const req = { user: { id: SELLER }, params: { id: AUCTION }, body: { start_time: new Date(now + 86400000).toISOString(), end_time: new Date(now + 8 * 86400000).toISOString(), minimum_bid_increment: 0 } };
    const res = mockRes();
    await manage.relistAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(inserted).toBeNull();
  });

  it('10b. an invalid starting price is rejected', async () => {
    setupReads();
    const req = { user: { id: SELLER }, params: { id: AUCTION }, body: { start_time: new Date(now + 86400000).toISOString(), end_time: new Date(now + 8 * 86400000).toISOString(), start_price: -5 } };
    const res = mockRes();
    await manage.relistAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(inserted).toBeNull();
  });

  it('11. a live auction cannot be relisted (409)', async () => {
    setupReads({ status: 'live' });
    const req = { user: { id: SELLER }, params: { id: AUCTION }, body: { start_time: new Date(now + 86400000).toISOString(), end_time: new Date(now + 8 * 86400000).toISOString() } };
    const res = mockRes();
    await manage.relistAuction(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(inserted).toBeNull();
  });
});

describe('AUCTION RESULT — authoritative payload', () => {
  const bids = [
    { auction_id: AUCTION, user_id: BUYER, amount: 88000, created_at: endedEnd },
    { auction_id: AUCTION, user_id: 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', amount: 85000, created_at: endedEnd },
    { auction_id: AUCTION, user_id: 'b3b3b3b3-b3b3-b3b3-b3b3-b3b3b3b3b3b3', amount: 80000, created_at: endedEnd },
  ];
  const watchers = [{ user_id: 'w1', product_id: PRODUCT }, { user_id: 'w2', product_id: PRODUCT }];
  const orders = [{
    auction_id: AUCTION, buyer_id: BUYER, amount: 88000, status: 'pending',
    payment_deadline: new Date(now + 6 * 86400000).toISOString(), winner_confirmed_at: endedEnd, winner_rank: 1,
  }];
  const users = [
    { id: BUYER, name: 'Anthony Ong' },
    { id: 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', name: 'Maria Santos' },
    { id: 'b3b3b3b3-b3b3-b3b3-b3b3-b3b3b3b3b3b3', name: 'Bianca Lim' },
  ];

  async function fetchResult(overrides = {}) {
    setupReads({ bids, watchers, orders, users, ...overrides });
    const req = { user: { id: SELLER }, params: { id: AUCTION } };
    const res = mockRes();
    await manage.getAuctionResult(req, res);
    return { res, payload: res.json.mock.calls[0]?.[0] };
  }

  it('12/13. the winner and final bid come from the order (authoritative)', async () => {
    const { res, payload } = await fetchResult();
    expect(res.json).toHaveBeenCalled();
    expect(payload.winner).toEqual({ id: BUYER, name: 'Anthony Ong', amount: 88000 });
    expect(payload.result.final_bid).toBe(88000);
    expect(payload.result.winner_confirmed).toBe(true);
    expect(payload.result.state).toBe('payment_pending');
  });

  it('14. the total bid count is the real bid count', async () => {
    const { payload } = await fetchResult();
    expect(payload.result.total_bids).toBe(3);
  });

  it('15. the watcher count comes from the watchlist table', async () => {
    const { payload } = await fetchResult();
    expect(payload.result.watcher_count).toBe(2);
  });

  it('16. the leaderboard is ranked by amount with the winner flagged', async () => {
    const { payload } = await fetchResult();
    expect(payload.leaderboard.map(r => r.bidder_name)).toEqual(['Anthony Ong', 'Maria Santos', 'Bianca Lim']);
    expect(payload.leaderboard.map(r => r.rank)).toEqual([1, 2, 3]);
    expect(payload.leaderboard[0].is_winner).toBe(true);
    expect(payload.leaderboard[1].is_winner).toBe(false);
  });

  it('16b. auction + product + branch identifiers are real values', async () => {
    const { payload } = await fetchResult();
    expect(payload.auction.auction_code).toBe('A-812');
    expect(payload.product.name).toBe('Diamond Stud Earrings 1.0ct');
    expect(payload.product.category).toBe('Earrings');
    expect(payload.branch.name).toBe('Gmall Branch');
    expect(payload.can_relist).toBe(true);
  });

  it('17. an auction with no bids reports the no-bid state (never "Sold")', async () => {
    const { payload } = await fetchResult({ bids: [], watchers: [], orders: [] });
    expect(payload.result.state).toBe('no_bids');
    expect(payload.result.winner_confirmed).toBe(false);
    expect(payload.winner).toBeNull();
    expect(payload.leaderboard).toEqual([]);
    expect(payload.result.label).not.toMatch(/sold/i);
  });

  it('17b. an expired winner is reported as expired, not as a confirmed winner', async () => {
    const { payload } = await fetchResult({
      orders: [{ ...orders[0], status: 'expired' }],
    });
    expect(payload.result.state).toBe('winner_expired');
    expect(payload.result.winner_confirmed).toBe(false);
    expect(payload.winner).toBeNull();
  });

  it('18. another seller cannot inspect the result (404, no private data leaked)', async () => {
    setupReads({ ownShop: OTHER_SHOP, productShop: SHOP, bids, watchers, orders, users });
    const req = { user: { id: OTHER_SELLER }, params: { id: AUCTION } };
    const res = mockRes();
    await manage.getAuctionResult(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    // The 404 body must not expose the winner, the leaderboard or bid amounts.
    const body = JSON.stringify(res.json.mock.calls[0]?.[0] || {});
    expect(body).not.toContain('Anthony Ong');
    expect(body).not.toContain('88000');
    expect(body).not.toContain('leaderboard');
  });

  it('PERF. the result is fetched with a bounded number of queries (no N+1 per bidder)', async () => {
    const manyBids = [];
    const manyUsers = [];
    for (let i = 0; i < 40; i++) {
      const id = `bidder-${i}`;
      manyBids.push({ auction_id: AUCTION, user_id: id, amount: 80000 - i * 100, created_at: endedEnd });
      manyUsers.push({ id, name: `Bidder ${i}` });
    }
    const { payload } = await fetchResult({ bids: manyBids, users: manyUsers });
    expect(payload.leaderboard.length).toBe(40);
    // One query per data set — the bidder count must not change the query count.
    const qCount = poolQuery.mock.calls.length;
    expect(qCount).toBeLessThanOrEqual(12);
  });
});
