// backend/src/tests/adminBranchMonitor.test.js
// Admin branch-centric monitoring — server-side branch scoping, real listings /
// auctions / bids / winner reads, live unique-customer watcher counts, and the
// authorization + "admin never bids" contracts.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const poolQuery = vi.hoisted(() => vi.fn());
vi.mock('../db/pool.js', () => ({ pool: { query: poolQuery } }));
const presence = vi.hoisted(() => ({ watcherCount: vi.fn(() => 0), joinWatcher: vi.fn(), leaveWatcher: vi.fn(), removeSocket: vi.fn(), clearAuction: vi.fn(), __resetPresence: vi.fn() }));
vi.mock('../services/auctionPresence.js', () => presence);

import {
  listBranchMonitorOverview,
  getBranchOverview,
  listBranchListings,
  listBranchAuctions,
  getBranchAuctionMonitor,
  branchEffectiveStatus,
  displayBidderName,
} from '../controllers/admin/branchMonitor.controller.js';

const BR_A = 'branch-gmall';
const BR_B = 'branch-abreeza';
const SHOP_A = 'shop-a';
const SHOP_B = 'shop-b';
const P_A1 = 'prod-a1';
const P_A2 = 'prod-a2';
const P_B1 = 'prod-b1';
const A_LIVE = 'auc-live';
const A_PAUSED = 'auc-paused';
const A_SCHED = 'auc-sched';
const A_ENDED = 'auc-ended';
const A_B = 'auc-other-branch';

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const BRANCHES = [
  { id: BR_A, name: 'Gmall Branch', address: 'Gmall Davao', lat: 7, lng: 125, status: 'Open', hours: '9AM-9PM', phone: '123' },
  { id: BR_B, name: 'Abreeza Branch', address: 'Abreeza', lat: 7, lng: 125, status: 'Temporarily Closed' },
];
const SHOPS = [
  { id: SHOP_A, shop_name: 'Golden Heritage Co.', user_id: 'u1', home_branch_id: BR_A, owner_name: 'Maria Seller' },
  { id: SHOP_B, shop_name: 'Other Shop', user_id: 'u2', home_branch_id: BR_B, owner_name: 'X' },
];
const PRODUCTS = [
  { id: P_A1, shop_id: SHOP_A, name: '18K Gold Solitaire Diamond Ring', category: 'Diamond Rings', karat_weight: '18K', price: 45000, status: 'approved', image_url: 'https://x/a.jpg' },
  { id: P_A2, shop_id: SHOP_A, name: 'Sapphire Halo Engagement Ring', category: 'Diamond Rings', karat_weight: '18K', price: 55000, status: 'pending', image_url: null },
  { id: P_B1, shop_id: SHOP_B, name: 'Other Branch Item', category: 'Gold Jewelry', price: 99999, status: 'approved' },
];
const AUCTIONS = [
  { id: A_LIVE, product_id: P_A1, auction_code: 'LOT-3041', start_price: 30000, current_bid: 41000, minimum_bid_increment: 1000, status: 'live', start_time: iso(now - 3600e3), end_time: iso(now + 5400e3), paused_at: null },
  { id: A_PAUSED, product_id: P_A2, auction_code: 'LOT-3052', start_price: 40000, current_bid: 52000, minimum_bid_increment: 1000, status: 'paused', start_time: iso(now - 7200e3), end_time: iso(now + 3600e3), paused_at: iso(now - 600e3) },
  { id: A_SCHED, product_id: P_A2, auction_code: 'LOT-3050', start_price: 45000, current_bid: 45000, minimum_bid_increment: 1000, status: 'scheduled', start_time: iso(now + 86400e3), end_time: iso(now + 93600e3), paused_at: null },
  { id: A_ENDED, product_id: P_A1, auction_code: 'LOT-3001', start_price: 20000, current_bid: 35000, minimum_bid_increment: 500, status: 'ended', start_time: iso(now - 172800e3), end_time: iso(now - 90000e3), paused_at: null },
  { id: A_B, product_id: P_B1, auction_code: 'LOT-9999', start_price: 1, current_bid: 1, minimum_bid_increment: 1, status: 'live', start_time: iso(now - 1000), end_time: iso(now + 90000e3) },
];
const BIDS = [
  { id: 'b1', auction_id: A_LIVE, user_id: 'c1', amount: 41000, flagged: false, created_at: iso(now - 120e3) },
  { id: 'b2', auction_id: A_LIVE, user_id: 'c2', amount: 40000, flagged: false, created_at: iso(now - 240e3) },
  { id: 'b3', auction_id: A_LIVE, user_id: 'c1', amount: 35000, flagged: false, created_at: iso(now - 600e3) },
  { id: 'b4', auction_id: A_PAUSED, user_id: 'c3', amount: 52000, flagged: false, created_at: iso(now - 720e3) },
];
// Branch revenue fixtures — recognized revenue requires a PAID payment
// (services/revenueRule.js). 486,200 collected; the unpaid rows below must be
// excluded so the test would fail if a status-based rule came back.
const BRANCH_ORDERS = [
  { id: 'bo1', branch_id: BR_A, amount: 286200, status: 'completed', created_at: iso(now - 2 * 86400e3) },
  { id: 'bo2', branch_id: BR_A, amount: 150000, status: 'preparing', created_at: iso(now - 3 * 86400e3) },
  { id: 'bo3', branch_id: BR_A, amount: 50000, status: 'completed', created_at: iso(now - 4 * 86400e3) },
  { id: 'bo-unpaid', branch_id: BR_A, amount: 999999, status: 'pending', created_at: iso(now - 86400e3) },
];
const PAYMENTS = [
  { order_id: 'bo1', status: 'paid', paid_at: iso(now - 2 * 86400e3), created_at: iso(now - 2 * 86400e3) },
  { order_id: 'bo2', status: 'paid', paid_at: iso(now - 3 * 86400e3), created_at: iso(now - 3 * 86400e3) },
  { order_id: 'bo3', status: 'paid', paid_at: iso(now - 4 * 86400e3), created_at: iso(now - 4 * 86400e3) },
  { order_id: 'bo-unpaid', status: 'failed', created_at: iso(now - 86400e3) },
];
const ORDER_ENDED = { id: 'o1', auction_id: A_ENDED, buyer_id: 'c9', amount: 35000, branch_id: BR_A, status: 'pending', transaction_code: 'TXN-9001', winner_rank: 1, created_at: iso(now - 90000e3) };
const USERS = { c1: 'Maria Santos', c2: 'Rafael Cruz', c3: 'Anna Dela Cruz', c9: 'Winner Person' };

function mockRes() {
  const r = {};
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  return r;
}

function seed({ branches = BRANCHES } = {}) {
  poolQuery.mockImplementation(async (sql, params = []) => {
    const s = String(sql);
    if (/FROM branches ORDER BY name/.test(s)) return { rows: branches };
    if (/FROM branches WHERE id=\$1/.test(s)) {
      const b = branches.find((x) => x.id === params[0]);
      return { rows: b ? [b] : [] };
    }
    if (/FROM orders WHERE branch_id IS NOT NULL/.test(s)) return { rows: BRANCH_ORDERS };
    if (/FROM payments WHERE order_id IN/.test(s)) return { rows: PAYMENTS.filter((p) => params.includes(p.order_id)) };
    if (/SELECT id, home_branch_id FROM shops/.test(s)) return { rows: SHOPS.map(({ id, home_branch_id }) => ({ id, home_branch_id })) };
    if (/FROM shops s LEFT JOIN users u ON u.id = s.user_id/.test(s)) {
      const ids = params;
      return { rows: SHOPS.filter((x) => ids.includes(x.id)) };
    }
    if (/FROM shops WHERE home_branch_id = \$1/.test(s)) return { rows: SHOPS.filter((x) => x.home_branch_id === params[0]).map(({ id }) => ({ id })) };
    // Single-scan form used by the optimised monitor endpoint (replaces the
    // per-branch N+1 COUNT loop). Same numbers, one query.
    if (/^SELECT shop_id FROM products$/i.test(s.trim())) return { rows: PRODUCTS.map(({ shop_id }) => ({ shop_id })) };
    if (/FROM products WHERE shop_id IN/.test(s)) return { rows: PRODUCTS.filter((p) => params.includes(p.shop_id)) };
    if (/FROM auctions WHERE product_id IN/.test(s)) return { rows: AUCTIONS.filter((a) => params.includes(a.product_id)) };
    if (/FROM auctions WHERE id=\$1/.test(s)) {
      const a = AUCTIONS.find((x) => x.id === params[0]);
      return { rows: a ? [a] : [] };
    }
    if (/FROM bids/.test(s) && /GROUP BY auction_id/.test(s)) {
      const map = {};
      AUCTIONS.forEach((a) => { map[a.id] = BIDS.filter((b) => b.auction_id === a.id).length; });
      return { rows: params.map((id) => ({ auction_id: id, n: map[id] || 0 })) };
    }
    if (/FROM products WHERE id=\$1/.test(s)) {
      const p = PRODUCTS.find((x) => x.id === params[0]);
      return { rows: p ? [p] : [] };
    }
    if (/SELECT a.id FROM auctions a/.test(s)) {
      // scoping join
      const [auctionId, branchId] = params;
      const a = AUCTIONS.find((x) => x.id === auctionId);
      if (!a) return { rows: [] };
      const p = PRODUCTS.find((x) => x.id === a.product_id);
      const shop = SHOPS.find((x) => x.id === p?.shop_id);
      return { rows: shop?.home_branch_id === branchId ? [{ id: a.id }] : [] };
    }
    if (/FROM bids/.test(s) && /auction_id = \$1/.test(s)) return { rows: BIDS.filter((b) => b.auction_id === params[0]) };
    if (/SELECT id, name FROM users WHERE id IN/.test(s)) {
      return { rows: params.filter((id) => USERS[id]).map((id) => ({ id, name: USERS[id] })) };
    }
    if (/SELECT id, name FROM users WHERE id=\$1/.test(s)) {
      return { rows: USERS[params[0]] ? [{ id: params[0], name: USERS[params[0]] }] : [] };
    }
    if (/FROM orders WHERE auction_id=\$1/.test(s)) return { rows: params[0] === ORDER_ENDED.auction_id ? [ORDER_ENDED] : [] };
    return { rows: [] };
  });
}

beforeEach(() => {
  poolQuery.mockReset();
  presence.watcherCount.mockReset().mockReturnValue(0);
});

describe('effective status honours the stored status', () => {
  test('paused stays paused (never reported as live)', () => {
    expect(branchEffectiveStatus(iso(now - 1000), iso(now + 100000), 'paused')).toBe('paused');
  });
  test('ended stays ended', () => {
    expect(branchEffectiveStatus(iso(now - 100000), iso(now + 100000), 'ended')).toBe('ended');
  });
  test('window decides otherwise', () => {
    expect(branchEffectiveStatus(iso(now + 100000), iso(now + 200000), 'live')).toBe('scheduled');
    expect(branchEffectiveStatus(iso(now - 200000), iso(now - 100000), 'live')).toBe('ended');
    expect(branchEffectiveStatus(iso(now - 1000), iso(now + 100000), 'live')).toBe('live');
  });
});

describe('bidder display privacy', () => {
  test('first name + last initial only', () => {
    expect(displayBidderName('Maria Santos')).toBe('Maria S.');
    expect(displayBidderName('Rafael')).toBe('Rafael');
    expect(displayBidderName('')).toBe('Bidder');
  });
});

describe('GET /admin/branches/monitor', () => {
  test('returns real branch KPIs with no hardcoded values', async () => {
    seed();
    const res = mockRes();
    await listBranchMonitorOverview({ user: { id: 'admin' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.kpis.total_branches).toBe(2);
    // Real fixture totals: BR_A owns SHOP_A's 2 products, BR_B owns SHOP_B's 1.
    // (Previously this read 4 only because the mock stubbed "2 per branch" and
    // never counted the fixture; the optimised single-scan query counts rows.)
    expect(body.kpis.active_lots).toBe(3);
    expect(body.kpis.monthly_revenue).toBe(486200);
    expect(body.kpis.revenue_rule).toBe('paid-payments-v1');
    expect(body.kpis.open_branches).toBe(1);
    expect(body.kpis.open_ratio).toBe('1/2');
    expect(body.branches[0]).toMatchObject({ name: 'Gmall Branch', lots: 2, revenue: 486200 });
  });
});

describe('GET /admin/branches/:id/overview', () => {
  test('branch-scoped KPIs, live monitoring rows and real revenue', async () => {
    seed();
    presence.watcherCount.mockImplementation((id) => (id === A_LIVE ? 7 : id === A_PAUSED ? 3 : 0));
    const res = mockRes();
    await getBranchOverview({ params: { id: BR_A } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.kpis.total_jewelry).toBe(2);
    expect(body.kpis.live_auctions).toBe(1);
    expect(body.kpis.paused_auctions).toBe(1);
    expect(body.kpis.ended_auctions).toBe(1);
    expect(body.kpis.scheduled_auctions).toBe(1);
    expect(body.kpis.total_bids).toBe(4);
    expect(body.kpis.revenue).toBe(486200);
    expect(body.kpis.live_watching).toBe(10);
    expect(body.monitoring.map((a) => a.status).sort()).toEqual(['live', 'paused']);
    expect(body.results[0].status).toBe('ended');
    // jewelry is served by its own enriched endpoint, not duplicated here
    expect(body).not.toHaveProperty('listings');
  });

  test('unknown branch → 404', async () => {
    seed({ branches: [] });
    const res = mockRes();
    await getBranchOverview({ params: { id: 'nope' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('GET /admin/branches/:id/listings — branch-scoped jewelry', () => {
  test('only the selected branch listings, with real auction state', async () => {
    seed();
    const res = mockRes();
    await listBranchListings({ params: { id: BR_A } }, res);
    const rows = res.json.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.branch_id === BR_A)).toBe(true);
    const ring = rows.find((r) => r.id === P_A1);
    expect(ring.seller_name).toBe('Golden Heritage Co.');
    expect(ring.estimate).toBe(45000);
    expect(ring.auction).toMatchObject({ lot_id: 'LOT-3041', status: 'live', start_price: 30000, current_bid: 41000, bid_count: 3 });
    // A pending product with no newer auction keeps a truthful derived state
    const other = rows.find((r) => r.id === P_A2);
    expect(['scheduled', 'live', 'paused', 'ended']).toContain(other.computed_status);
  });

  test('a different branch never leaks listings', async () => {
    seed();
    const res = mockRes();
    await listBranchListings({ params: { id: BR_B } }, res);
    const rows = res.json.mock.calls[0][0];
    expect(rows.every((r) => r.branch_id === BR_B)).toBe(true);
    expect(rows.map((r) => r.id)).not.toContain(P_A1);
  });
});

describe('GET /admin/branches/:id/auctions — auction events', () => {
  test('branch-scoped auctions with live/scheduled/paused/ended and watcher counts', async () => {
    seed();
    presence.watcherCount.mockImplementation((id) => (id === A_LIVE ? 7 : id === A_PAUSED ? 3 : 0));
    const res = mockRes();
    await listBranchAuctions({ params: { id: BR_A } }, res);
    const rows = res.json.mock.calls[0][0];
    expect(rows.map((r) => r.id)).not.toContain(A_B);
    const live = rows.find((r) => r.id === A_LIVE);
    expect(live).toMatchObject({
      lot_id: 'LOT-3041', status: 'live', start_price: 30000, current_bid: 41000,
      bid_count: 3, watcher_count: 7, shop_name: 'Golden Heritage Co.', branch_name: 'Gmall Branch',
      minimum_bid_increment: 1000,
    });
    expect(rows.find((r) => r.id === A_PAUSED)).toMatchObject({ status: 'paused', watcher_count: 3 });
    expect(rows.find((r) => r.id === A_SCHED)).toMatchObject({ status: 'scheduled' });
    expect(rows.find((r) => r.id === A_ENDED)).toMatchObject({ status: 'ended' });
  });
});

describe('GET /admin/branches/:id/auctions/:auctionId — monitor drawer', () => {
  test('returns live bid, leader, bidders and no customer actions', async () => {
    seed();
    presence.watcherCount.mockReturnValue(7);
    const res = mockRes();
    await getBranchAuctionMonitor({ params: { id: BR_A, auctionId: A_LIVE } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ id: A_LIVE, lot_id: 'LOT-3041', current_bid: 41000, start_price: 30000, bid_count: 3, watcher_count: 7 });
    expect(body.leading_bidder).toBe('Maria S.');
    expect(body.bidders[0]).toMatchObject({ bidder_name: 'Maria S.', amount: 41000, is_leading: true });
    expect(body.bidders[1]).toMatchObject({ bidder_name: 'Rafael C.', amount: 40000, is_leading: false });
    // one row per bidder, highest bid each (c1 bid twice → single row)
    expect(body.bidders.filter((b) => b.bidder_name === 'Maria S.')).toHaveLength(1);
    // no bidder email / phone / auth id leaks
    expect(JSON.stringify(body)).not.toMatch(/@|password_hash|phone/);
    // admin is not a bidder and has no bid affordance in the payload
    expect(body.bidders.every((b) => b.bidder_name !== 'Admin User')).toBe(true);
    expect(body.result).toBeNull();
  });

  test('ended auction exposes the authoritative winner from orders', async () => {
    seed();
    const res = mockRes();
    await getBranchAuctionMonitor({ params: { id: BR_A, auctionId: A_ENDED } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe('ended');
    expect(body.result).toMatchObject({ final_price: 35000, winner: 'Winner P.', order_status: 'pending', transaction_code: 'TXN-9001' });
  });

  test('cross-branch auction is rejected (no cross-branch leakage)', async () => {
    seed();
    const res = mockRes();
    await getBranchAuctionMonitor({ params: { id: BR_A, auctionId: A_B } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toMatch(/not found for this branch/i);
  });
});

describe('watcher semantics in the admin read model', () => {
  test('admin reads the shared unique-customer presence count, never a socket count', async () => {
    seed();
    presence.watcherCount.mockReturnValue(2);
    const res = mockRes();
    await getBranchAuctionMonitor({ params: { id: BR_A, auctionId: A_LIVE } }, res);
    expect(presence.watcherCount).toHaveBeenCalledWith(A_LIVE);
    expect(res.json.mock.calls[0][0].watcher_count).toBe(2);
  });

  test('placing bids never touches presence (bid/watcher separation)', async () => {
    // The monitor controller only READS presence; the bid path (bidLogic.js)
    // never calls joinWatcher, so repeated bids cannot inflate the count.
    const bidLogicSrc = fs.readFileSync(path.join(__dirname, '../services/bidLogic.js'), 'utf8');
    expect(bidLogicSrc).not.toMatch(/joinWatcher|auctionPresence/);
    const branchCtrlSrc = fs.readFileSync(path.join(__dirname, '../controllers/admin/branchMonitor.controller.js'), 'utf8');
    expect(branchCtrlSrc).not.toMatch(/joinWatcher/);
    expect(branchCtrlSrc).toMatch(/import \{ watcherCount \}/);
  });
});

describe('authorization + read-only contracts', () => {
  const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  const routesSrc = fs.readFileSync(path.join(__dirname, '../routes/admin.routes.js'), 'utf8');
  const ctrlSrc = fs.readFileSync(path.join(__dirname, '../controllers/admin/branchMonitor.controller.js'), 'utf8');
  const indexSocket = indexSrc.slice(indexSrc.indexOf("io.on('connection'"), indexSrc.indexOf("io.on('connection'") + 4000);

  test('every new route sits behind the existing admin middleware mount', () => {
    expect(indexSrc).toMatch(/app\.use\('\/admin',\s*requireAuth,\s*requireRole\(\['admin'\]\),\s*adminRoutes\)/);
    expect(routesSrc).toMatch(/router\.get\('\/branches\/:id\/overview', branchMonitor\.getBranchOverview\)/);
    expect(routesSrc).toMatch(/router\.get\('\/branches\/:id\/listings', branchMonitor\.listBranchListings\)/);
    expect(routesSrc).toMatch(/router\.get\('\/branches\/:id\/auctions', branchMonitor\.listBranchAuctions\)/);
    expect(routesSrc).toMatch(/router\.get\('\/branches\/:id\/auctions\/:auctionId', branchMonitor\.getBranchAuctionMonitor\)/);
  });

  test('the branch monitor controller is strictly read-only', () => {
    expect(ctrlSrc).not.toMatch(/\bINSERT\b/i);
    expect(ctrlSrc).not.toMatch(/\bUPDATE\b/i);
    expect(ctrlSrc).not.toMatch(/\bDELETE\b/i);
    expect(ctrlSrc).not.toMatch(/router\.(post|put|patch|delete)/);
  });

  test('admin never gains a bid, favourite, reserve or checkout capability', () => {
    expect(ctrlSrc).not.toMatch(/placeBid|place_bid|favorite|favourite|wishlist|reserve|checkout/i);
    // bid mutation stays customer-only
    expect(indexSrc).toMatch(/app\.use\('\/customer',\s*requireAuth,\s*requireRole\('customer'\)/);
    expect(indexSocket).toMatch(/socket\.data\.role !== 'customer'/);
  });

  test('watcher presence is customer-only, unique per user, multi-tab safe', () => {
    expect(indexSocket).toMatch(/if \(socket\.data\.role !== 'customer'\) return;/);
    const presenceSrc = fs.readFileSync(path.join(__dirname, '../services/auctionPresence.js'), 'utf8');
    expect(presenceSrc).toMatch(/auctionId -> Map<userId, Set<socketId>>/);
    expect(presenceSrc).toMatch(/users\.size/); // unique user count, not socket count
  });
});