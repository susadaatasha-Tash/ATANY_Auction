// backend/src/tests/sellerListings.test.js — seller listings grid payload:
// stored ended survives time computation, latest-auction priority, branch,
// ownership scoping, no shop_id trust.
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

const SHOP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const now = Date.now();
const liveWin = { start: new Date(now - 3600000).toISOString(), end: new Date(now + 3600000).toISOString() };

function baseMocks({ products, auctions, bids = [], watches = [], branch = 'Gmall Branch' }) {
  poolQuery.mockImplementation(async (sql) => {
    if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: SHOP }] };
    if (/SELECT \* FROM products WHERE shop_id/.test(sql)) return { rows: products };
    if (/FROM auctions WHERE product_id IN/.test(sql)) return { rows: auctions };
    if (/FROM bids WHERE auction_id IN/.test(sql)) return { rows: bids };
    if (/FROM watchlists WHERE product_id IN/.test(sql)) return { rows: watches };
    if (/home_branch_id FROM shops/.test(sql)) return { rows: [{ home_branch_id: 'b1' }] };
    if (/FROM branches WHERE id/.test(sql)) return { rows: [{ name: branch }] };
    return { rows: [] };
  });
}
function mockRes() { const r = {}; r.status = vi.fn().mockReturnValue(r); r.json = vi.fn().mockReturnValue(r); return r; }

beforeEach(() => { poolQuery.mockReset(); poolConnect.mockReset(); });

describe('GET /shop-owner/listings payload', () => {
  it('manually ended auction (future end_time) reports ended, not live', async () => {
    const { listListings } = await import('../controllers/shop-owner/listing.controller.js');
    baseMocks({
      products: [{ id: 'p1', shop_id: SHOP, name: 'Ended Ring', category: 'Rings', karat_weight: '12.5', price: 8000, status: 'approved', description: 'd', image_url: null, created_at: new Date().toISOString() }],
      auctions: [{ id: 'a1', product_id: 'p1', status: 'ended', start_time: liveWin.start, end_time: liveWin.end, start_price: 8000, current_bid: 12500 }],
    });
    const res = mockRes();
    await listListings({ user: { id: 'seller' } }, res);
    const row = res.json.mock.calls[0][0][0];
    expect(row.computed_status).toBe('ended');
    expect(row.auction_status).toBe('ended');
    expect(row.auction_id).toBe('a1');
  });

  it('picks live over ended for relisted products; ended falls back to latest', async () => {
    const { listListings } = await import('../controllers/shop-owner/listing.controller.js');
    baseMocks({
      products: [{ id: 'p1', shop_id: SHOP, name: 'Relisted', category: 'Rings', karat_weight: null, price: 100, status: 'approved', description: null, image_url: null, created_at: new Date().toISOString() }],
      auctions: [
        { id: 'old', product_id: 'p1', status: 'ended', start_time: liveWin.start, end_time: liveWin.end, start_price: 100, current_bid: 0 },
        { id: 'cur', product_id: 'p1', status: 'live', start_time: liveWin.start, end_time: liveWin.end, start_price: 100, current_bid: 150 },
      ],
    });
    const res = mockRes();
    await listListings({ user: { id: 'seller' } }, res);
    const row = res.json.mock.calls[0][0][0];
    expect(row.auction_id).toBe('cur');
    expect(row.computed_status).toBe('live');
  });

  it('no auction → auction null with branch + counts', async () => {
    const { listListings } = await import('../controllers/shop-owner/listing.controller.js');
    baseMocks({
      products: [{ id: 'p2', shop_id: SHOP, name: 'Bare', category: 'Other', karat_weight: null, price: 50, status: 'pending', description: null, image_url: null, created_at: new Date().toISOString() }],
      auctions: [],
    });
    const res = mockRes();
    await listListings({ user: { id: 'seller' } }, res);
    const row = res.json.mock.calls[0][0][0];
    expect(row.auction).toBeNull();
    expect(row.auction_id).toBeNull();
    expect(row.branch_name).toBe('Gmall Branch');
  });

  it('includes batched bid/watcher counts without N+1', async () => {
    const { listListings } = await import('../controllers/shop-owner/listing.controller.js');
    baseMocks({
      products: [{ id: 'p1', shop_id: SHOP, name: 'X', category: 'Rings', karat_weight: null, price: 100, status: 'approved', description: null, image_url: null, created_at: new Date().toISOString() }],
      auctions: [{ id: 'a1', product_id: 'p1', status: 'live', start_time: liveWin.start, end_time: liveWin.end, start_price: 100, current_bid: 200 }],
      bids: [{ auction_id: 'a1', user_id: 'u1' }, { auction_id: 'a1', user_id: 'u2' }],
      watches: [{ user_id: 'u1', product_id: 'p1' }, { user_id: 'u1', product_id: 'p1' }, { user_id: 'u3', product_id: 'p1' }],
    });
    const res = mockRes();
    await listListings({ user: { id: 'seller' } }, res);
    const row = res.json.mock.calls[0][0][0];
    expect(row.auction.bid_count).toBe(2);
    expect(row.auction.watcher_count).toBe(2);
    // One list call total: batched IN queries, no per-row auction fetch
    const auctionFetches = poolQuery.mock.calls.filter(([sql]) => /FROM auctions WHERE product_id IN/.test(sql));
    expect(auctionFetches.length).toBe(1);
  });
});

describe('DELETE /shop-owner/listings/:id (bid-count rule)', () => {
  const SELLER = 'seller-1';
  const OTHER_SHOP = 'other-shop';
  function delMocks({ product, auctions = [] }) {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id FROM shops WHERE user_id/.test(sql)) return { rows: [{ id: SHOP }] };
      if (/SELECT \* FROM products WHERE id=\$1/.test(sql)) return { rows: product ? [product] : [] };
      if (/FROM auctions WHERE product_id=\$1/.test(sql)) return { rows: auctions };
      if (/DELETE FROM products/.test(sql)) return { rows: [] };
      if (/INSERT INTO audit_logs/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
  }
  // Pooled tx client mock; locked/counts/orders drive in-tx behavior.
  function txMock({ locked = [], counts = {}, orders = [] } = {}) {
    const calls = [];
    const client = {
      query: vi.fn(async (sql, params) => {
        calls.push(String(sql).trim().slice(0, 60));
        const s = String(sql).trim();
        if (/^BEGIN|^COMMIT|^ROLLBACK/.test(s)) return { rows: [] };
        if (/FOR UPDATE/.test(s)) return { rows: locked };
        if (/COUNT\(\*\).*FROM bids/.test(s)) return { rows: [{ cnt: counts[params?.[0]] ?? 0 }] };
        if (/FROM orders WHERE auction_id IN/.test(s)) return { rows: orders };
        if (/^DELETE FROM auctions/.test(s)) return { rows: locked };
        if (/^DELETE FROM products/.test(s)) return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    poolConnect.mockResolvedValue(client);
    return { calls, client };
  }

  it('1. no auction → delete allowed', async () => {
    const { deleteListing } = await import('../controllers/shop-owner/listing.controller.js');
    delMocks({ product: { id: 'p9', shop_id: SHOP, name: 'Bare' }, auctions: [] });
    const res = mockRes();
    await deleteListing({ user: { id: SELLER }, params: { id: 'p9' } }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, id: 'p9' });
    expect(poolConnect).not.toHaveBeenCalled();
    expect(poolQuery.mock.calls.filter(([sql]) => /^DELETE FROM auctions/.test(sql)).length).toBe(0);
  });

  it.each(['scheduled', 'live', 'paused', 'ended'])(
    '%s auction + 0 bids → delete allowed (atomic auction + listing)',
    async (status) => {
      const { deleteListing } = await import('../controllers/shop-owner/listing.controller.js');
      delMocks({ product: { id: 'p1', shop_id: SHOP, name: 'X' }, auctions: [{ id: 'a1', status }] });
      const { calls } = txMock({ locked: [{ id: 'a1' }], counts: { a1: 0 }, orders: [] });
      const res = mockRes();
      await deleteListing({ user: { id: SELLER }, params: { id: 'p1' } }, res);
      expect(res.json).toHaveBeenCalledWith({ success: true, id: 'p1' });
      expect(calls.join('|')).toMatch(/DELETE FROM auctions.*DELETE FROM products/s);
      expect(calls.join('|')).toMatch(/COMMIT/);
    }
  );

  it.each(['scheduled', 'live', 'paused'])(
    '%s auction + 1 bid → 409 LISTING_HAS_BIDS, nothing deleted',
    async (status) => {
      const { deleteListing } = await import('../controllers/shop-owner/listing.controller.js');
      delMocks({ product: { id: 'p1', shop_id: SHOP, name: 'X' }, auctions: [{ id: 'a1', status }] });
      const { calls } = txMock({ locked: [{ id: 'a1' }], counts: { a1: 1 }, orders: [] });
      const res = mockRes();
      await deleteListing({ user: { id: SELLER }, params: { id: 'p1' } }, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'LISTING_HAS_BIDS' });
      expect(calls.join('|')).toMatch(/ROLLBACK/);
      expect(calls.join('|')).not.toMatch(/DELETE FROM/);
    }
  );

  it('8. multiple bids → delete blocked', async () => {
    const { deleteListing } = await import('../controllers/shop-owner/listing.controller.js');
    delMocks({ product: { id: 'p1', shop_id: SHOP, name: 'X' }, auctions: [{ id: 'a1', status: 'live' }] });
    const { calls } = txMock({ locked: [{ id: 'a1' }], counts: { a1: 7 }, orders: [] });
    const res = mockRes();
    await deleteListing({ user: { id: SELLER }, params: { id: 'p1' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('LISTING_HAS_BIDS');
    expect(calls.join('|')).not.toMatch(/DELETE FROM/);
  });

  it('9. bid recount happens inside tx after row lock', async () => {
    const { deleteListing } = await import('../controllers/shop-owner/listing.controller.js');
    delMocks({ product: { id: 'p1', shop_id: SHOP, name: 'X' }, auctions: [{ id: 'a1', status: 'live' }] });
    const { calls } = txMock({ locked: [{ id: 'a1' }], counts: { a1: 0 }, orders: [] });
    const res = mockRes();
    await deleteListing({ user: { id: SELLER }, params: { id: 'p1' } }, res);
    const lockIdx = calls.findIndex((c) => c.includes('FOR UPDATE'));
    const countIdx = calls.findIndex((c) => c.includes('FROM bids'));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(countIdx).toBeGreaterThan(lockIdx);
    expect(res.json).toHaveBeenCalledWith({ success: true, id: 'p1' });
  });

  it('10. race: bid appears before commit → rollback, 409, no partial delete', async () => {
    const { deleteListing } = await import('../controllers/shop-owner/listing.controller.js');
    delMocks({ product: { id: 'p1', shop_id: SHOP, name: 'X' }, auctions: [{ id: 'a1', status: 'scheduled' }] });
    // In-tx recount sees the just-landed bid even though pre-check saw zero.
    const { calls } = txMock({ locked: [{ id: 'a1' }], counts: { a1: 1 }, orders: [] });
    const res = mockRes();
    await deleteListing({ user: { id: SELLER }, params: { id: 'p1' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('LISTING_HAS_BIDS');
    expect(calls.join('|')).toMatch(/ROLLBACK/);
    expect(calls.join('|')).not.toMatch(/DELETE FROM/);
    expect(calls.join('|')).not.toMatch(/COMMIT/);
  });

  it('11. foreign listing → 404 (no existence leak), no tx, no deletes', async () => {
    const { deleteListing } = await import('../controllers/shop-owner/listing.controller.js');
    delMocks({ product: { id: 'px', shop_id: OTHER_SHOP, name: 'Theirs' }, auctions: [] });
    const res = mockRes();
    await deleteListing({ user: { id: SELLER }, params: { id: 'px' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(poolConnect).not.toHaveBeenCalled();
    expect(poolQuery.mock.calls.filter(([sql]) => /^DELETE FROM/.test(sql)).length).toBe(0);
  });

  it('linked order blocks with LISTING_HAS_ORDER (financial records kept)', async () => {
    const { deleteListing } = await import('../controllers/shop-owner/listing.controller.js');
    delMocks({ product: { id: 'p1', shop_id: SHOP, name: 'X' }, auctions: [{ id: 'a1', status: 'ended' }] });
    const { calls } = txMock({ locked: [{ id: 'a1' }], counts: { a1: 0 }, orders: [{ id: 'o1' }] });
    const res = mockRes();
    await deleteListing({ user: { id: SELLER }, params: { id: 'p1' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('LISTING_HAS_ORDER');
    expect(calls.join('|')).not.toMatch(/DELETE FROM/);
  });

  it('can_delete counts bids across ALL auctions of a relisted product', async () => {
    // Regression: can_delete used to read only the auction shown on the card,
    // so a relisted product whose OLD auction has bids advertised a deletable
    // listing that DELETE /shop-owner/listings/:id then rejects (409
    // LISTING_HAS_BIDS). The grid must agree with the delete handler.
    const { listListings } = await import('../controllers/shop-owner/listing.controller.js');
    const prod = (id) => ({ id, shop_id: SHOP, name: 'S', category: 'Rings', karat_weight: null, price: 1, status: 'approved', description: null, image_url: null, created_at: new Date().toISOString() });
    const auc = (id, pid, status, ended = false) => ({
      id, product_id: pid, status,
      start_time: new Date(now - 1000).toISOString(),
      end_time: ended ? new Date(now - 5000).toISOString() : new Date(now + 200000).toISOString(),
      start_price: 1, current_bid: 0,
    });
    baseMocks({
      products: [prod('p1'), prod('p2')],
      auctions: [
        // p1: current live auction (0 bids) + older ended auction (1 bid)
        auc('a1', 'p1', 'live'),
        auc('a0', 'p1', 'ended', true),
        // p2: no bids anywhere
        auc('a2', 'p2', 'scheduled'),
      ],
      bids: [{ auction_id: 'a0', user_id: 'u1' }],
    });
    const res = mockRes();
    await listListings({ user: { id: 'seller' } }, res);
    const byId = Object.fromEntries(res.json.mock.calls[0][0].map((r) => [r.id, r]));
    expect(byId.p1.can_delete).toBe(false); // bid lives on the OLD auction
    expect(byId.p2.can_delete).toBe(true);
  });

  it('can_delete follows bid count, not status', async () => {
    const { listListings } = await import('../controllers/shop-owner/listing.controller.js');
    const prod = (id) => ({ id, shop_id: SHOP, name: 'S', category: 'Rings', karat_weight: null, price: 1, status: 'approved', description: null, image_url: null, created_at: new Date().toISOString() });
    const auc = (id, pid, status) => ({ id, product_id: pid, status, start_time: new Date(now - 1000).toISOString(), end_time: new Date(now + 200000).toISOString(), start_price: 1, current_bid: 0 });
    baseMocks({
      products: [prod('p1'), prod('p2'), prod('p3')],
      auctions: [auc('a1', 'p1', 'live'), auc('a2', 'p2', 'live'), auc('a3', 'p3', 'scheduled')],
      bids: [{ auction_id: 'a2', user_id: 'u1' }],
    });
    const res = mockRes();
    await listListings({ user: { id: 'seller' } }, res);
    const byId = Object.fromEntries(res.json.mock.calls[0][0].map((r) => [r.id, r]));
    expect(byId.p1.can_delete).toBe(true);
    expect(byId.p2.can_delete).toBe(false);
    expect(byId.p3.can_delete).toBe(true);
  });
});

describe('listing security contract', () => {
  const ctrlSrc = fs.readFileSync(path.join(__dirname, '../controllers/shop-owner/listing.controller.js'), 'utf8');
  const routesSrc = fs.readFileSync(path.join(__dirname, '../routes/shop-owner.routes.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

  it('listing UPDATE is tenant-scoped by shop_id, not id alone', () => {
    // Ownership must live in the write statement itself, not only in the
    // pre-check SELECT, so a foreign id can never be updated.
    expect(ctrlSrc).toMatch(
      /UPDATE products SET \$\{fields\.join\(', '\)\} WHERE id=\$\$\{idx\} AND shop_id=\$\$\{idx \+ 1\} RETURNING \*/
    );
  });

  it('never trusts shop_id from body/query', () => {
    expect(ctrlSrc).not.toMatch(/req\.body\.shop_id|req\.query\.shop_id/);
  });

  it('shop resolved from authenticated user only', () => {
    expect(ctrlSrc).toMatch(/WHERE user_id=\$1.*req\.user\.id|req\.user\.id.*user_id/s);
  });

  it('routes stay behind auth (no public flag)', () => {
    expect(routesSrc).not.toContain('public: true');
    expect(indexSrc).toMatch(/app\.use\('\/shop-owner',\s*requireAuth,\s*requireRole\('shop_owner'\)/);
  });

  it('delete reuses the owned scheduled/no-bid auction route', () => {
    expect(routesSrc).toMatch(/router\.delete\('\/auctions\/:id', deleteAuction\)/);
  });
});
