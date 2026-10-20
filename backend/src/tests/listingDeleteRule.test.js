// backend/src/tests/listingDeleteRule.test.js
// Listing DELETE rule: primary gate is BID COUNT (not auction status).
// Zero bids → delete allowed. One or more bids → delete forbidden (409).
// Transactional re-check inside BEGIN/COMMIT to prevent race conditions.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────
const poolQuery = vi.fn();
const poolConnect = vi.fn();

vi.mock('../db/pool.js', () => ({
  pool: {
    query: (...a) => poolQuery(...a),
    connect: (...a) => poolConnect(...a),
    on: () => {},
  },
  isDirectPg: () => true,
}));

// Configurable tx client query mock — tests assign txClientQuery.mockImplementation
const txClientQuery = vi.fn();

vi.mock('../db/dbGuard.js', () => ({
  acquireTxClient: vi.fn(async () => ({
    client: {
      query: txClientQuery,
      release: vi.fn(),
      __restFallback: false,
    },
    release: vi.fn(),
  })),
  ServiceUnavailableError: class extends Error {
    constructor(message, code = 'SERVICE_UNAVAILABLE') {
      super(message);
      this.name = 'ServiceUnavailableError';
      this.code = code;
      this.statusCode = 503;
    }
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) } })),
}));

vi.mock('../services/emailService.js', () => ({ sendNotificationEmail: vi.fn(async () => {}) }));

// ── Fixtures ──────────────────────────────────────────────────────
const SELLER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SELLER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SHOP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OTHER_SHOP = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const PRODUCT_NO_AUCTION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const PRODUCT_SCHED_0BID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const PRODUCT_LIVE_0BID = '11111111-1111-1111-1111-111111111111';
const PRODUCT_PAUSED_0BID = '22222222-2222-2222-2222-222222222222';
const PRODUCT_SCHED_1BID = '33333333-3333-3333-3333-333333333333';
const PRODUCT_LIVE_1BID = '44444444-4444-4444-4444-444444444444';
const PRODUCT_PAUSED_1BID = '55555555-5555-5555-5555-555555555555';
const PRODUCT_MULTI_BID = '66666666-6666-6666-6666-666666666666';
const PRODUCT_WITH_ORDER = '77777777-7777-7777-7777-777777777777';

const AUCTION_SCHED = '88888888-8888-8888-8888-888888888888';
const AUCTION_LIVE = '99999999-9999-9999-9999-999999999999';
const AUCTION_PAUSED = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AUCTION_WITH_ORDER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function mockRes() {
  const r = {};
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  return r;
}

let listingModule;

beforeEach(async () => {
  vi.resetModules();
  poolQuery.mockReset();
  poolConnect.mockReset();
  txClientQuery.mockReset();

  listingModule = await import('../controllers/shop-owner/listing.controller.js');
});

// ── Helper: configure txClientQuery for a given scenario ─────────
// The controller inside the transaction calls client.query() for:
//   SELECT id FROM shops WHERE user_id=$1
//   SELECT * FROM products WHERE id=$1 AND shop_id=$2 FOR UPDATE
//   SELECT id FROM auctions WHERE product_id=$1 FOR UPDATE
//   SELECT COUNT(*)::int as cnt FROM bids WHERE auction_id=$1
//   SELECT COUNT(*)::int as cnt FROM orders WHERE auction_id=$1
//   DELETE FROM auctions WHERE id=$1
//   DELETE FROM products WHERE id=$1
function setupTxMocks({
  productId,
  auctionId = null,
  bidCount = 0,
  orderCount = 0,
  ownShop = SHOP,
  productShop = SHOP,
  productExists = true,
  auctionExists = true,
  throwOnProduct = false,
} = {}) {
  txClientQuery.mockImplementation(async (sql, params) => {
    if (/BEGIN/.test(sql)) return { rows: [] };
    if (/COMMIT/.test(sql)) return { rows: [] };
    if (/ROLLBACK/.test(sql)) return { rows: [] };

    // Shop resolution
    if (/SELECT id FROM shops WHERE user_id/.test(sql)) {
      return { rows: [{ id: ownShop }] };
    }

    // Simulate DB error mid-transaction
    if (throwOnProduct) throw new Error('DB connection lost');

    // Product ownership check (FOR UPDATE in tx)
    // params[0] = product id, params[1] = shop id (from req.user)
    if (/SELECT \* FROM products WHERE id=\$1 AND shop_id=\$2 FOR UPDATE/.test(sql)) {
      if (!productExists) return { rows: [] };
      // Only return the product if the shop_id in params matches productShop
      if (String(params[1]) !== productShop) return { rows: [] };
      return { rows: [{ id: productId, shop_id: productShop, name: 'Test Ring' }] };
    }

    // Auction lookup (FOR UPDATE in tx)
    if (/SELECT id FROM auctions WHERE product_id=\$1 FOR UPDATE/.test(sql)) {
      if (!auctionExists || !auctionId) return { rows: [] };
      return { rows: [{ id: auctionId }] };
    }

    // Bid count
    if (/SELECT COUNT\([^)]*\)::int as cnt FROM bids WHERE auction_id=\$1/.test(sql)) {
      return { rows: [{ cnt: bidCount }] };
    }

    // Order count
    if (/SELECT COUNT\([^)]*\)::int as cnt FROM orders WHERE auction_id=\$1/.test(sql)) {
      return { rows: [{ cnt: orderCount }] };
    }

    return { rows: [] };
  });
}

describe('listing delete rule — bid count is the gate (not auction status)', () => {
  it('TEST 1: no auction → delete allowed', async () => {
    setupTxMocks({ productId: PRODUCT_NO_AUCTION, auctionId: null, bidCount: 0 });
    const req = { user: { id: SELLER }, params: { id: PRODUCT_NO_AUCTION } };
    const res = mockRes();
    await listingModule.deleteListing(req, res);
    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
  });

  it('TEST 2: scheduled auction + 0 bids → delete allowed', async () => {
    setupTxMocks({ productId: PRODUCT_SCHED_0BID, auctionId: AUCTION_SCHED, bidCount: 0 });
    const req = { user: { id: SELLER }, params: { id: PRODUCT_SCHED_0BID } };
    const res = mockRes();
    await listingModule.deleteListing(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('TEST 3: live auction + 0 bids → delete allowed', async () => {
    setupTxMocks({ productId: PRODUCT_LIVE_0BID, auctionId: AUCTION_LIVE, bidCount: 0 });
    const req = { user: { id: SELLER }, params: { id: PRODUCT_LIVE_0BID } };
    const res = mockRes();
    await listingModule.deleteListing(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('TEST 4: paused auction + 0 bids → delete allowed', async () => {
    setupTxMocks({ productId: PRODUCT_PAUSED_0BID, auctionId: AUCTION_PAUSED, bidCount: 0 });
    const req = { user: { id: SELLER }, params: { id: PRODUCT_PAUSED_0BID } };
    const res = mockRes();
    await listingModule.deleteListing(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('TEST 5: scheduled auction + 1 bid → delete blocked (409 LISTING_HAS_BIDS)', async () => {
    setupTxMocks({ productId: PRODUCT_SCHED_1BID, auctionId: AUCTION_SCHED, bidCount: 1 });
    const req = { user: { id: SELLER }, params: { id: PRODUCT_SCHED_1BID } };
    const res = mockRes();
    await listingModule.deleteListing(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('LISTING_HAS_BIDS');
    expect(body.message).toBe('This listing cannot be deleted because it already has bids.');
  });

  it('TEST 6: live auction + 1 bid → delete blocked (409 LISTING_HAS_BIDS)', async () => {
    setupTxMocks({ productId: PRODUCT_LIVE_1BID, auctionId: AUCTION_LIVE, bidCount: 1 });
    const req = { user: { id: SELLER }, params: { id: PRODUCT_LIVE_1BID } };
    const res = mockRes();
    await listingModule.deleteListing(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('LISTING_HAS_BIDS');
  });

  it('TEST 7: paused auction + 1 bid → delete blocked (409 LISTING_HAS_BIDS)', async () => {
    setupTxMocks({ productId: PRODUCT_PAUSED_1BID, auctionId: AUCTION_PAUSED, bidCount: 1 });
    const req = { user: { id: SELLER }, params: { id: PRODUCT_PAUSED_1BID } };
    const res = mockRes();
    await listingModule.deleteListing(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('LISTING_HAS_BIDS');
  });

  it('TEST 8: multiple bids → delete blocked (409 LISTING_HAS_BIDS)', async () => {
    setupTxMocks({ productId: PRODUCT_MULTI_BID, auctionId: AUCTION_LIVE, bidCount: 7 });
    const req = { user: { id: SELLER }, params: { id: PRODUCT_MULTI_BID } };
    const res = mockRes();
    await listingModule.deleteListing(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('LISTING_HAS_BIDS');
  });

  it('TEST 9: backend uses transaction (BEGIN/COMMIT) and issues DELETE inside tx', async () => {
    setupTxMocks({ productId: PRODUCT_SCHED_0BID, auctionId: AUCTION_SCHED, bidCount: 0 });
    const req = { user: { id: SELLER }, params: { id: PRODUCT_SCHED_0BID } };
    const res = mockRes();
    await listingModule.deleteListing(req, res);

    // Verify tx client was acquired and BEGIN/COMMIT used
    const txCalls = txClientQuery.mock.calls.map(([sql]) => sql);
    expect(txCalls.some((s) => s.includes('BEGIN'))).toBe(true);
    expect(txCalls.some((s) => s.includes('COMMIT'))).toBe(true);
    // Verify DELETE for auction and product inside tx
    expect(txCalls.some((s) => s.includes('DELETE FROM auctions WHERE id=$1'))).toBe(true);
    expect(txCalls.some((s) => s.includes('DELETE FROM products WHERE id=$1'))).toBe(true);
  });

  it('TEST 10: race condition — bid appears inside tx before commit → deletion fails safely, no DELETE issued', async () => {
    txClientQuery.mockImplementation(async (sql) => {
      if (/BEGIN/.test(sql)) return { rows: [] };
      if (/COMMIT/.test(sql)) return { rows: [] };
      if (/ROLLBACK/.test(sql)) return { rows: [] };
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM products WHERE id=\$1 AND shop_id=\$2 FOR UPDATE/.test(sql)) {
        return { rows: [{ id: PRODUCT_SCHED_0BID, shop_id: SHOP, name: 'Test Ring' }] };
      }
      if (/SELECT id FROM auctions WHERE product_id=\$1 FOR UPDATE/.test(sql)) {
        return { rows: [{ id: AUCTION_SCHED }] };
      }
      if (/SELECT COUNT\([^)]*\)::int as cnt FROM bids WHERE auction_id=\$1/.test(sql)) {
        // Race: bid count is 1 inside the transaction even though frontend saw 0
        return { rows: [{ cnt: 1 }] };
      }
      return { rows: [] };
    });

    const req = { user: { id: SELLER }, params: { id: PRODUCT_SCHED_0BID } };
    const res = mockRes();
    await listingModule.deleteListing(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('LISTING_HAS_BIDS');

    // No DELETE should have been issued (ROLLBACK instead)
    const txCalls = txClientQuery.mock.calls.map(([sql]) => sql);
    expect(txCalls.some((s) => s.includes('DELETE FROM'))).toBe(false);
    expect(txCalls.some((s) => s.includes('ROLLBACK'))).toBe(true);
  });

  it('TEST 11: seller cannot delete another seller\'s listing (404)', async () => {
    // Product belongs to OTHER_SHOP, request from SELLER (owns SHOP)
    setupTxMocks({
      productId: PRODUCT_SCHED_0BID,
      auctionId: AUCTION_SCHED,
      bidCount: 0,
      productShop: OTHER_SHOP,
    });
    const req = { user: { id: SELLER }, params: { id: PRODUCT_SCHED_0BID } };
    const res = mockRes();
    await listingModule.deleteListing(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('TEST: order exists → 409 LISTING_HAS_ORDER (separate code)', async () => {
    setupTxMocks({
      productId: PRODUCT_WITH_ORDER,
      auctionId: AUCTION_WITH_ORDER,
      bidCount: 0,
      orderCount: 1,
    });
    const req = { user: { id: SELLER }, params: { id: PRODUCT_WITH_ORDER } };
    const res = mockRes();
    await listingModule.deleteListing(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('LISTING_HAS_ORDER');
    expect(body.message).toBe('This listing cannot be deleted because it is linked to an order.');
  });
});

describe('listing delete — transaction rollback on error', () => {
  it('ROLLBACK is issued when product lookup throws mid-transaction', async () => {
    setupTxMocks({
      productId: PRODUCT_SCHED_0BID,
      auctionId: AUCTION_SCHED,
      bidCount: 0,
      throwOnProduct: true,
    });
    const req = { user: { id: SELLER }, params: { id: PRODUCT_SCHED_0BID } };
    const res = mockRes();
    await listingModule.deleteListing(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    const txCalls = txClientQuery.mock.calls.map(([sql]) => sql);
    expect(txCalls.some((s) => s.includes('ROLLBACK'))).toBe(true);
  });
});
