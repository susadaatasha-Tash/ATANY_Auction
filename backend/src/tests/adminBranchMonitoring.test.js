// backend/src/tests/adminBranchMonitoring.test.js
// Admin → Branches: branch-centric monitoring backend suite.
//
// Contract under test:
//  • The admin router stays behind requireAuth + requireRole(['admin']) and
//    the new branch read endpoint lives on it (anonymous / non-admin blocked).
//  • The branch overview is scoped SERVER-SIDE through the authoritative
//    relationship listing (products) → shop (shops) → home_branch_id →
//    branches. No cross-branch leakage.
//  • Listings, auctions, bids, leaders and winners come from the real
//    tables — the admin never invents a winner for a live auction.
//  • The seller / customer mutation endpoints are untouched: an admin cannot
//    bid and a customer cannot reach seller management routes.
//  • Live watcher presence counts UNIQUE authenticated CUSTOMERS viewing an
//    auction (multi-tab safe, bids never add watchers, admin/seller excluded,
//    disconnect cleans up).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const poolQuery = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: vi.fn(), on: vi.fn() },
  isDirectPg: () => true,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'no session' } })) },
  })),
}));

const { listBranches, getBranchOverview } = await import('../controllers/admin/branch.controller.js');
const presence = await import('../services/auctionPresence.js');
const { requireRole } = await import('../middleware/requireRole.js');
const { requireAuth } = await import('../middleware/requireAuth.js');

const BRANCH_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const BRANCH_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const SHOP_A = 'shop-a-0000-0000-0000-000000000003';
const SHOP_B = 'shop-b-0000-0000-0000-000000000004';
const PRODUCT_A = 'prod-a-0000-0000-0000-000000000005';
const PRODUCT_B = 'prod-b-0000-0000-0000-000000000006';
const AUCTION_A = 'auct-a-0000-0000-0000-000000000007';
const AUCTION_B = 'auct-b-0000-0000-0000-000000000008';
const CUSTOMER_A = 'cust-a-0000-0000-0000-000000000009';
const CUSTOMER_B = 'cust-b-0000-0000-0000-00000000000a';
const SELLER = 'sell-r-0000-0000-0000-00000000000b';
const ADMIN = 'admn-r-0000-0000-0000-00000000000c';
// Relative timestamps so the fixtures are always "live" when the suite runs.
const START = new Date(Date.now() - 3600000).toISOString();
const END = new Date(Date.now() + 3600000).toISOString();

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res;
}
const req = (params = {}, query = {}) => ({ params, query, body: {}, user: { id: ADMIN } });
const payload = (res) => res.json.mock.calls[0]?.[0];

/** Two branches, each with its own shop, listing and auction. */
function defaultPool() {
  poolQuery.mockImplementation(async (sql) => {
    if (/FROM branches WHERE id=/.test(sql)) {
      return { rows: [{ id: BRANCH_A, name: 'Gmall Branch', address: 'Gmall, Davao', status: 'Open', branch_image_url: 'https://cdn/gmall.png' }] };
    }
    if (/FROM shops WHERE home_branch_id=/.test(sql)) {
      return { rows: [{ id: SHOP_A, shop_name: 'Golden Heritage Co.', user_id: SELLER, home_branch_id: BRANCH_A }] };
    }
    if (/FROM products WHERE shop_id IN/.test(sql)) {
      return { rows: [{
        id: PRODUCT_A, shop_id: SHOP_A, name: '18K Gold Solitaire Diamond Ring', category: 'Diamond Rings',
        karat_weight: '18K', price: 52000, status: 'approved', image_url: 'https://cdn/ring.png', created_at: START,
      }] };
    }
    if (/FROM auctions WHERE product_id IN/.test(sql)) {
      return { rows: [{
        id: AUCTION_A, product_id: PRODUCT_A, auction_code: 'LOT-3041', status: 'live',
        start_price: 30000, current_bid: 41000, minimum_bid_increment: 1000,
        start_time: START, end_time: END, created_at: START,
      }] };
    }
    if (/FROM bids WHERE auction_id IN/.test(sql)) {
      return { rows: [
        { id: 'bid-1', auction_id: AUCTION_A, user_id: CUSTOMER_A, amount: 41000, flagged: false, created_at: END },
        { id: 'bid-2', auction_id: AUCTION_A, user_id: CUSTOMER_B, amount: 40000, flagged: false, created_at: START },
      ] };
    }
    if (/FROM orders WHERE auction_id IN/.test(sql)) {
      return { rows: [] };
    }
    if (/FROM users WHERE id IN/.test(sql)) {
      return { rows: [
        { id: SELLER, name: 'Adrian Villanueva' },
        { id: CUSTOMER_A, name: 'Maria S.' },
        { id: CUSTOMER_B, name: 'Rafael C.' },
      ] };
    }
    if (/FROM branches ORDER BY name/.test(sql)) {
      return { rows: [
        { id: BRANCH_A, name: 'Gmall Branch', address: 'Gmall, Davao', status: 'Open' },
        { id: BRANCH_B, name: 'Abreeza Branch', address: 'Abreeza, Davao', status: 'Temporarily Closed' },
      ] };
    }
    if (/FROM shops WHERE home_branch_id IS NOT NULL/.test(sql)) {
      return { rows: [
        { id: SHOP_A, shop_name: 'Golden Heritage Co.', user_id: SELLER, home_branch_id: BRANCH_A },
        { id: SHOP_B, shop_name: 'Other Co.', user_id: SELLER, home_branch_id: BRANCH_B },
      ] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  poolQuery.mockReset();
  defaultPool();
  presence.__resetPresence();
});

// ─────────────────────────────────────────────────────────────
// authorization
// ─────────────────────────────────────────────────────────────
describe('admin branches — authorization', () => {
  it('the admin router stays behind requireAuth + requireRole(admin)', () => {
    const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    expect(indexSrc).toMatch(/app\.use\('\/admin',\s*requireAuth,\s*requireRole\(\['admin'\]\)/);
  });

  it('the branch overview read endpoint lives on the admin router', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/admin.routes.js'), 'utf8');
    expect(routes).toMatch(/router\.get\('\/branches\/:id\/overview',\s*getBranchOverview\)/);
    // The branch write endpoints are unchanged.
    expect(routes).toMatch(/router\.post\('\/branches',\s*createBranch\)/);
    expect(routes).toMatch(/router\.put\('\/branches\/:id',\s*updateBranch\)/);
    expect(routes).toMatch(/router\.delete\('\/branches\/:id',\s*deleteBranch\)/);
  });

  it('rejects an anonymous request', async () => {
    const res = mockRes();
    const next = vi.fn();
    await requireAuth({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a non-admin (customer / seller) request', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ role: 'customer' }] });
    const res = mockRes();
    const next = vi.fn();
    await requireRole(['admin'])({ user: { id: CUSTOMER_A } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows an admin read', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ role: 'admin' }] });
    const res = mockRes();
    const next = vi.fn();
    await requireRole(['admin'])({ user: { id: ADMIN } }, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('the admin auction controller exposes no bid / mutation endpoint', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/admin/auction.controller.js'), 'utf8');
    expect(src).not.toMatch(/router\.post/);
    expect(src).not.toMatch(/placeBid|submitBid|bid:create/i);
  });

  it('the customer bid route stays on the customer router (admin cannot bid)', () => {
    const customerRoutes = fs.readFileSync(path.join(__dirname, '../routes/customer.routes.js'), 'utf8');
    expect(customerRoutes).toMatch(/bids/);
    const adminRoutes = fs.readFileSync(path.join(__dirname, '../routes/admin.routes.js'), 'utf8');
    expect(adminRoutes).not.toMatch(/bids?['"]/);
  });
});

// ─────────────────────────────────────────────────────────────
// branch scoping
// ─────────────────────────────────────────────────────────────
describe('admin branches — server-side scoping', () => {
  it('scopes the shops by home_branch_id (the authoritative branch link)', async () => {
    const res = mockRes();
    await getBranchOverview(req({ id: BRANCH_A }), res);
    const shopCall = poolQuery.mock.calls.find(([sql]) => /FROM shops WHERE home_branch_id=/.test(sql));
    expect(shopCall).toBeTruthy();
    expect(shopCall[0]).toMatch(/home_branch_id=\$1/);
    expect(shopCall[1]).toEqual([BRANCH_A]);
  });

  it('never queries listings or auctions outside the selected branch', async () => {
    const res = mockRes();
    await getBranchOverview(req({ id: BRANCH_A }), res);
    const productCall = poolQuery.mock.calls.find(([sql]) => /FROM products WHERE shop_id IN/.test(sql));
    const auctionCall = poolQuery.mock.calls.find(([sql]) => /FROM auctions WHERE product_id IN/.test(sql));
    expect(productCall[1]).toEqual([SHOP_A]);
    expect(auctionCall[1]).toEqual([PRODUCT_A]);
    // The other branch's ids never reach the query.
    expect(productCall[1]).not.toContain(SHOP_B);
    expect(auctionCall[1]).not.toContain(PRODUCT_B);
  });

  it('returns only the selected branch record', async () => {
    const res = mockRes();
    await getBranchOverview(req({ id: BRANCH_A }), res);
    const body = payload(res);
    expect(body.branch.id).toBe(BRANCH_A);
    expect(body.branch.name).toBe('Gmall Branch');
    expect(body.listings.every((l) => l.branch.id === BRANCH_A)).toBe(true);
    expect(body.auctions.every((a) => a.branch.id === BRANCH_A)).toBe(true);
  });

  it('404s for an unknown branch', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/FROM branches WHERE id=/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const res = mockRes();
    await getBranchOverview(req({ id: 'missing' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────────────────────────
// the data itself
// ─────────────────────────────────────────────────────────────
describe('admin branches — real listing / auction / bid data', () => {
  it('returns the branch listings with their real seller and branch', async () => {
    const res = mockRes();
    await getBranchOverview(req({ id: BRANCH_A }), res);
    const body = payload(res);
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0]).toMatchObject({
      id: PRODUCT_A,
      name: '18K Gold Solitaire Diamond Ring',
      category: 'Diamond Rings',
      price: 52000,
    });
    expect(body.listings[0].shop.name).toBe('Golden Heritage Co.');
    expect(body.listings[0].branch.name).toBe('Gmall Branch');
  });

  it('returns the branch auctions with the real bid counts and leader', async () => {
    const res = mockRes();
    await getBranchOverview(req({ id: BRANCH_A }), res);
    const body = payload(res);
    expect(body.auctions).toHaveLength(1);
    expect(body.auctions[0]).toMatchObject({
      id: AUCTION_A,
      auction_code: 'LOT-3041',
      start_price: 30000,
      current_bid: 41000,
      total_bids: 2,
      status: 'live',
    });
    // Highest eligible bid wins; a live auction has a LEADER, never a winner.
    expect(body.auctions[0].leader).toMatchObject({ name: 'Maria S.', amount: 41000 });
    expect(body.auctions[0].order).toBeNull();
  });

  it('derives the overview KPIs from the same records', async () => {
    const res = mockRes();
    await getBranchOverview(req({ id: BRANCH_A }), res);
    const body = payload(res);
    expect(body.kpis.total_jewelry).toBe(1);
    expect(body.kpis.live_auctions).toBe(1);
    expect(body.kpis.total_bids).toBe(2);
    expect(body.kpis.revenue).toBe(0);
  });

  it('the branch list keeps its array shape and adds the real per-branch aggregates', async () => {
    const res = mockRes();
    await listBranches(req(), res);
    const rows = payload(res);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveProperty('lot_count');
    expect(rows[0]).toHaveProperty('active_lot_count');
    expect(rows[0]).toHaveProperty('revenue');
    expect(rows[0]).toHaveProperty('manager_name');
  });
});

// ─────────────────────────────────────────────────────────────
// live watcher presence
// ─────────────────────────────────────────────────────────────
describe('auction presence — watcher definition', () => {
  function fakeSocket(id, userId) {
    const rooms = new Set();
    return {
      id,
      data: { userId },
      rooms,
      io: { to: () => ({ emit: vi.fn() }) },
      join: (r) => rooms.add(r),
      leave: (r) => rooms.delete(r),
    };
  }

  function roleOf(role) {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT role FROM users WHERE id=/.test(sql)) return { rows: [{ role }] };
      return { rows: [] };
    });
  }

  it('counts one watcher per unique authenticated customer', async () => {
    roleOf('customer');
    await presence.joinAuction(fakeSocket('s1', CUSTOMER_A), AUCTION_A);
    expect(presence.getWatcherCount(AUCTION_A)).toBe(1);
  });

  it('counts a customer with two tabs only once', async () => {
    roleOf('customer');
    await presence.joinAuction(fakeSocket('s1', CUSTOMER_A), AUCTION_A);
    await presence.joinAuction(fakeSocket('s2', CUSTOMER_A), AUCTION_A);
    expect(presence.getWatcherCount(AUCTION_A)).toBe(1);
  });

  it('counts two different customers twice', async () => {
    roleOf('customer');
    await presence.joinAuction(fakeSocket('s1', CUSTOMER_A), AUCTION_A);
    await presence.joinAuction(fakeSocket('s2', CUSTOMER_B), AUCTION_A);
    expect(presence.getWatcherCount(AUCTION_A)).toBe(2);
  });

  it('bidding never adds a watcher', async () => {
    roleOf('customer');
    const socket = fakeSocket('s1', CUSTOMER_A);
    await presence.joinAuction(socket, AUCTION_A);
    // The bid endpoint never touches the presence registry.
    const before = presence.getWatcherCount(AUCTION_A);
    const bidSrc = fs.readFileSync(path.join(__dirname, '../controllers/customer/bid.controller.js'), 'utf8');
    expect(bidSrc).not.toMatch(/auctionPresence|joinAuction|getWatcherCount/);
    expect(presence.getWatcherCount(AUCTION_A)).toBe(before);
  });

  it('excludes an admin viewer from the customer watcher count', async () => {
    roleOf('admin');
    await presence.joinAuction(fakeSocket('s1', ADMIN), AUCTION_A);
    expect(presence.getWatcherCount(AUCTION_A)).toBe(0);
  });

  it('excludes a seller viewer from the customer watcher count', async () => {
    roleOf('shop_owner');
    await presence.joinAuction(fakeSocket('s1', SELLER), AUCTION_A);
    expect(presence.getWatcherCount(AUCTION_A)).toBe(0);
  });

  it('removes the watcher when the last socket disconnects', async () => {
    roleOf('customer');
    const s1 = fakeSocket('s1', CUSTOMER_A);
    const s2 = fakeSocket('s2', CUSTOMER_A);
    await presence.joinAuction(s1, AUCTION_A);
    await presence.joinAuction(s2, AUCTION_A);
    presence.handleDisconnect(s1);
    expect(presence.getWatcherCount(AUCTION_A)).toBe(1); // the second tab is still open
    presence.handleDisconnect(s2);
    expect(presence.getWatcherCount(AUCTION_A)).toBe(0);
  });

  it('drops the watcher when the viewer leaves the auction', async () => {
    roleOf('customer');
    const s1 = fakeSocket('s1', CUSTOMER_A);
    await presence.joinAuction(s1, AUCTION_A);
    presence.leaveAuction(s1, AUCTION_A);
    expect(presence.getWatcherCount(AUCTION_A)).toBe(0);
  });

  it('drops every watcher once the auction ends and everybody leaves', async () => {
    roleOf('customer');
    const s1 = fakeSocket('s1', CUSTOMER_A);
    await presence.joinAuction(s1, AUCTION_A);
    presence.handleDisconnect(s1);
    expect(presence.getWatcherCount(AUCTION_A)).toBe(0);
  });

  it('broadcasts the watcher count to the auction room', async () => {
    roleOf('customer');
    const emit = vi.fn();
    const socket = fakeSocket('s1', CUSTOMER_A);
    socket.io = { to: vi.fn(() => ({ emit })) };
    await presence.joinAuction(socket, AUCTION_A);
    expect(socket.io.to).toHaveBeenCalledWith(`auction:${AUCTION_A}`);
    expect(emit).toHaveBeenCalledWith('auction:presence', { auctionId: AUCTION_A, watchers: 1 });
  });

  it('the admin auction detail exposes the live watcher count and the leader', async () => {
    roleOf('customer');
    await presence.joinAuction(fakeSocket('s1', CUSTOMER_A), AUCTION_A);
    const { crud } = await import('../controllers/admin/auction.controller.js');
    poolQuery.mockImplementation(async (sql) => {
      if (/FROM auctions WHERE id=/.test(sql)) {
        return { rows: [{
          id: AUCTION_A, product_id: PRODUCT_A, auction_code: 'LOT-3041', status: 'live',
          start_price: 30000, current_bid: 41000, minimum_bid_increment: 1000,
          start_time: START, end_time: END,
        }] };
      }
      if (/FROM products WHERE id=/.test(sql)) {
        return { rows: [{ id: PRODUCT_A, name: 'Ring', category: 'Diamond Rings', shop_id: SHOP_A, image_url: 'x', price: 52000 }] };
      }
      if (/FROM shops WHERE id=/.test(sql)) {
        return { rows: [{ id: SHOP_A, shop_name: 'Golden Heritage Co.', user_id: SELLER, home_branch_id: BRANCH_A }] };
      }
      if (/FROM branches WHERE id=/.test(sql)) {
        return { rows: [{ id: BRANCH_A, name: 'Gmall Branch', address: 'Gmall, Davao' }] };
      }
      if (/FROM users WHERE id=/.test(sql)) return { rows: [{ id: SELLER, name: 'Adrian', email: 'a@b.c' }] };
      if (/FROM bids WHERE auction_id=/.test(sql)) {
        return { rows: [{ id: 'b1', user_id: CUSTOMER_A, amount: 41000, created_at: START }] };
      }
      if (/FROM orders WHERE auction_id=/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const res = mockRes();
    await crud.get({ params: { id: AUCTION_A } }, res);
    const body = payload(res);
    expect(body.watchers).toBe(1);
    expect(body.leader).toMatchObject({ amount: 41000 });
    expect(body.total_bids).toBe(1);
  });
});
