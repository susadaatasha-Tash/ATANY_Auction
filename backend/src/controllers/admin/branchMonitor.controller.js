// backend/src/controllers/admin/branchMonitor.controller.js
//
// ADMIN BRANCH-CENTRIC MONITORING — read-only.
//
// Product rule: ADMIN = MONITOR / INSPECT / OVERSEE. This controller only READS.
// Every handler here is a read. This file contains no write statement, no
// customer-action affordance and no seller mutation — Admin only ever observes.
//
// It consumes the SAME authoritative records the Seller and Customer flows
// already produce:
//   listing  → products (created by shop owner)
//   auction  → auctions (created / scheduled / paused / resumed by shop owner)
//   bids     → bids (placed by customers)
//   winner   → orders.buyer_id / orders.amount (written by auctionClosingService)
//   presence → services/auctionPresence.js (live unique-customer watchers)
//
// Branch scoping follows the real schema relationship — there is no
// products.branch_id / auctions.branch_id:
//   products.shop_id → shops.home_branch_id → branches.id
// Every query below is scoped server-side by branch id; the frontend never
// filters a cross-branch dataset.
import { pool } from '../../db/pool.js';
import { watcherCount } from '../../services/auctionPresence.js';
import {
  REVENUE_RULE_ID, REVENUE_RULE_LABEL,
  pickDecidingPayment, isRecognizedRevenueOrder,
} from '../../services/revenueRule.js';

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Effective auction status — mirrors services/auctionService.js effectiveStatus
 * but ALSO honours the stored status, so a PAUSED auction is never reported as
 * live (the admin auction detail route had that bug).
 */
export function branchEffectiveStatus(startTime, endTime, storedStatus) {
  const stored = String(storedStatus || '').toLowerCase();
  if (stored === 'paused') return 'paused';
  if (stored === 'ended') return 'ended';
  const now = Date.now();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (Number.isFinite(start) && now < start) return 'scheduled';
  if (Number.isFinite(end) && now >= end) return 'ended';
  return 'live';
}

/** Current calendar month start in Asia/Manila (+08), the window "Monthly Revenue" means. */
export function monthStartManila(now = new Date()) {
  const manila = new Date(now.getTime() + MANILA_OFFSET_MS);
  const start = Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), 1, 0, 0, 0);
  return new Date(start - MANILA_OFFSET_MS);
}

/**
 * Branch revenue — IDENTICAL rule to the platform KPI (services/revenueRule.js):
 * an order counts only when its payment reached 'paid'. Order status is a
 * fulfillment state and is NOT consulted. Window: the current calendar month in
 * Asia/Manila (unchanged).
 *
 * Written as a simple fan-out + JS aggregation on purpose. The previous
 * aggregate-with-GROUP-BY form tripped pool.js `isComplexQuery()` and, under the
 * Supabase REST fallback, returned no rows with HTTP 200 — i.e. every branch
 * silently reported ₱0. This form degrades visibly instead.
 */
async function branchRevenueById() {
  const since = monthStartManila();
  const { rows: orders } = await pool.query(
    'SELECT id, branch_id, amount, created_at FROM orders WHERE branch_id IS NOT NULL AND created_at >= $1',
    [since.toISOString()]
  );
  if (!orders.length) return {};
  const ids = orders.map((o) => o.id);
  const { rows: payments } = await pool.query(
    `SELECT order_id, status, paid_at, created_at FROM payments WHERE order_id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`,
    ids
  );
  const byOrder = {};
  payments.forEach((p) => { (byOrder[String(p.order_id)] ||= []).push(p); });

  const map = {};
  orders.forEach((o) => {
    if (!isRecognizedRevenueOrder({ payment: pickDecidingPayment(byOrder[String(o.id)]) })) return;
    const key = String(o.branch_id);
    map[key] = (map[key] || 0) + Number(o.amount || 0);
  });
  return map;
}

/** Shop ids whose home_branch_id is the given branch (authoritative path). */
async function shopIdsForBranch(branchId) {
  const { rows } = await pool.query('SELECT id FROM shops WHERE home_branch_id = $1', [branchId]);
  return rows.map((r) => r.id);
}

async function productsForShops(shopIds) {
  if (!shopIds.length) return [];
  const { rows } = await pool.query(
    `SELECT * FROM products WHERE shop_id IN (${shopIds.map((_, i) => `$${i + 1}`).join(',')})`,
    shopIds
  );
  return rows;
}

async function auctionsForProducts(productIds) {
  if (!productIds.length) return [];
  const { rows } = await pool.query(
    `SELECT * FROM auctions WHERE product_id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})
      ORDER BY end_time ASC`,
    productIds
  );
  return rows;
}

async function bidCounts(auctionIds) {
  if (!auctionIds.length) return {};
  const { rows } = await pool.query(
    `SELECT auction_id, COUNT(*)::int AS n FROM bids
      WHERE auction_id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')})
      GROUP BY auction_id`,
    auctionIds
  );
  const map = {};
  rows.forEach((r) => { map[String(r.auction_id)] = Number(r.n); });
  return map;
}

async function shopsByIds(ids) {
  if (!ids.length) return {};
  const { rows } = await pool.query(
    `SELECT s.id, s.shop_name, s.user_id, s.home_branch_id, u.name AS owner_name
       FROM shops s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`,
    ids
  );
  return Object.fromEntries(rows.map((r) => [String(r.id), r]));
}

function lotId(auction, product) {
  return auction?.auction_code || product?.auction_code || product?.id?.slice(0, 8) || auction?.id?.slice(0, 8) || '—';
}

/* ────────────────────────────────────────────────────────────────────────────
 * GET /admin/branches  (enrichment of the existing list — same route, richer rows)
 * Adds real per-branch lot count + this-month revenue so the admin branch cards
 * and KPI row never need client-side cross-entity work.
 * ──────────────────────────────────────────────────────────────────────────── */
export const listBranchMonitorOverview = async (_req, res) => {
  try {
    return await buildBranchMonitorOverview(res);
  } catch (e) {
    // Without this the handler threw and never responded, leaving the admin
    // skeleton spinning forever. Always answer, even on failure.
    console.error('[admin/branches/monitor] failed:', e?.message || e);
    return res.status(503).json({
      message: 'Branch monitoring data is temporarily unavailable. Please try again.',
      branches: [],
      kpis: null,
    });
  }
};

const buildBranchMonitorOverview = async (res) => {
  // PERFORMANCE: these reads are independent, so they run concurrently
  // instead of one after another. Previously each waited for the last.
  const [branchRes, revenueMap, shopRes, productRes] = await Promise.all([
    pool.query('SELECT * FROM branches ORDER BY name ASC'),
    branchRevenueById(),
    pool.query('SELECT id, home_branch_id FROM shops'),
    pool.query('SELECT shop_id FROM products'),
  ]);

  const { rows: branches } = branchRes;
  const shopIdsByBranch = {};
  shopRes.rows.forEach((s) => {
    const key = String(s.home_branch_id || '');
    if (!key) return;
    (shopIdsByBranch[key] ||= []).push(s.id);
  });

  // PERFORMANCE: this replaces a per-branch COUNT(*) query awaited INSIDE a loop
  // (N+1 round trips — the dominant cost, growing with every new branch). One
  // scan of products is aggregated in JS instead.
  //
  // It also drops the `COUNT(` keyword deliberately: pool.js flags COUNT/JOIN/
  // GROUP BY as "complex", and under the Supabase REST fallback such queries
  // return no rows, which is why this count previously silently rendered 0
  // listings whenever direct Postgres was unreachable. The simple form below
  // works on BOTH paths and yields identical numbers.
  const lotsByBranch = {};
  const productsPerShop = {};
  for (const row of productRes.rows) {
    const shopId = String(row.shop_id);
    if (!shopId) continue;
    productsPerShop[shopId] = (productsPerShop[shopId] || 0) + 1;
  }
  for (const b of branches) {
    const shopIds = shopIdsByBranch[String(b.id)] || [];
    lotsByBranch[String(b.id)] = shopIds.reduce((sum, id) => sum + (productsPerShop[String(id)] || 0), 0);
  }

  const openCount = branches.filter((b) => b.status === 'Open').length;
  res.json({
    branches: branches.map((b) => ({
      ...b,
      lots: lotsByBranch[String(b.id)] || 0,
      revenue: revenueMap[String(b.id)] || 0,
    })),
    kpis: {
      total_branches: branches.length,
      active_lots: Object.values(lotsByBranch).reduce((s, n) => s + n, 0),
      monthly_revenue: branches.reduce((s, b) => s + (revenueMap[String(b.id)] || 0), 0),
      open_branches: openCount,
      open_ratio: branches.length ? `${openCount}/${branches.length}` : '0/0',
      revenue_window: 'current calendar month (Asia/Manila)',
      revenue_rule: REVENUE_RULE_ID,
      revenue_rule_label: REVENUE_RULE_LABEL,
    },
  });
};

/* ────────────────────────────────────────────────────────────────────────────
 * GET /admin/branches/:id/overview
 * ──────────────────────────────────────────────────────────────────────────── */
export const getBranchOverview = async (req, res) => {
  const branchId = req.params.id;
  const { rows: bRows } = await pool.query('SELECT * FROM branches WHERE id=$1', [branchId]);
  const branch = bRows[0];
  if (!branch) return res.status(404).json({ message: 'Branch not found' });

  const shopIds = await shopIdsForBranch(branchId);
  const products = await productsForShops(shopIds);
  const auctions = await auctionsForProducts(products.map((p) => p.id));
  const counts = await bidCounts(auctions.map((a) => a.id));
  const shops = await shopsByIds([...new Set(products.map((p) => p.shop_id).filter(Boolean))]);

  const productMap = Object.fromEntries(products.map((p) => [String(p.id), p]));
  const enriched = auctions.map((a) => decorateAuction(a, productMap[String(a.product_id)], shops, counts[String(a.id)] || 0));

  const live = enriched.filter((a) => a.status === 'live' || a.status === 'paused');
  const ended = enriched.filter((a) => a.status === 'ended').sort((x, y) => new Date(y.end_time) - new Date(x.end_time));
  const scheduled = enriched.filter((a) => a.status === 'scheduled');
  const totalBids = enriched.reduce((s, a) => s + a.bid_count, 0);
  const liveWatchers = live.reduce((s, a) => s + a.watcher_count, 0);

  const revenueMap = await branchRevenueById();

  res.json({
    branch: { ...branch, lots: products.length, revenue: revenueMap[String(branch.id)] || 0 },
    kpis: {
      total_jewelry: products.length,
      live_auctions: live.filter((a) => a.status === 'live').length,
      paused_auctions: live.filter((a) => a.status === 'paused').length,
      live_watching: liveWatchers,
      ended_auctions: ended.length,
      scheduled_auctions: scheduled.length,
      total_bids: totalBids,
      revenue: revenueMap[String(branch.id)] || 0,
    },
    monitoring: live,
    results: ended.slice(0, 6),
  });
};

/* ────────────────────────────────────────────────────────────────────────────
 * GET /admin/branches/:id/listings   (branch jewelry)
 * ──────────────────────────────────────────────────────────────────────────── */
export const listBranchListings = async (req, res) => {
  const branchId = req.params.id;
  const { rows: bRows } = await pool.query('SELECT id, name FROM branches WHERE id=$1', [branchId]);
  const branch = bRows[0];
  if (!branch) return res.status(404).json({ message: 'Branch not found' });

  const shopIds = await shopIdsForBranch(branchId);
  const products = await productsForShops(shopIds);
  const auctions = await auctionsForProducts(products.map((p) => p.id));
  const counts = await bidCounts(auctions.map((a) => a.id));
  const shops = await shopsByIds([...new Set(products.map((p) => p.shop_id).filter(Boolean))]);

  // Keep the newest auction per product — a relist creates a new auctions row.
  const latestByProduct = {};
  auctions.forEach((a) => {
    const key = String(a.product_id);
    const prev = latestByProduct[key];
    if (!prev || new Date(a.created_at || a.start_time) > new Date(prev.created_at || prev.start_time)) {
      latestByProduct[key] = a;
    }
  });

  const rows = products.map((p) => {
    const auction = latestByProduct[String(p.id)] || null;
    return {
      ...p,
      auction: auction
        ? {
            id: auction.id,
            auction_code: auction.auction_code || null,
            lot_id: lotId(auction, p),
            status: branchEffectiveStatus(auction.start_time, auction.end_time, auction.status),
            start_price: Number(auction.start_price || 0),
            current_bid: Number(auction.current_bid || 0),
            bid_count: counts[String(auction.id)] || 0,
            start_time: auction.start_time,
            end_time: auction.end_time,
          }
        : null,
      estimate: p.price != null ? Number(p.price) : null,
      price: p.price != null ? Number(p.price) : null,
      category: p.category || null,
      karat_weight: p.karat_weight || null,
      image_url: p.image_url || null,
      computed_status: auction
        ? branchEffectiveStatus(auction.start_time, auction.end_time, auction.status)
        : bareProductStatus(p.status),
      seller_name: shops[String(p.shop_id)]?.shop_name || null,
      branch_id: String(branch.id),
      branch_name: branch.name || null,
    };
  });

  res.json(rows);
};

/** A product with no auction row still has a truthful derived status. */
function bareProductStatus(productStatus) {
  if (productStatus === 'approved') return 'live';
  if (productStatus === 'pending') return 'scheduled';
  if (productStatus === 'rejected') return 'ended';
  return 'scheduled';
}

/* ────────────────────────────────────────────────────────────────────────────
 * GET /admin/branches/:id/auctions   (auction events monitor)
 * ──────────────────────────────────────────────────────────────────────────── */
export const listBranchAuctions = async (req, res) => {
  const branchId = req.params.id;
  const { rows: bRows } = await pool.query('SELECT id, name FROM branches WHERE id=$1', [branchId]);
  const branch = bRows[0];
  if (!branch) return res.status(404).json({ message: 'Branch not found' });

  const shopIds = await shopIdsForBranch(branchId);
  const products = await productsForShops(shopIds);
  const auctions = await auctionsForProducts(products.map((p) => p.id));
  const counts = await bidCounts(auctions.map((a) => a.id));
  const shops = await shopsByIds([...new Set(products.map((p) => p.shop_id).filter(Boolean))]);
  const productMap = Object.fromEntries(products.map((p) => [String(p.id), p]));

  const rows = auctions.map((a) => {
    const d = decorateAuction(a, productMap[String(a.product_id)], shops, counts[String(a.id)] || 0);
    return { ...d, branch_name: branch.name };
  });

  const order = { live: 0, paused: 1, scheduled: 2, ended: 3 };
  rows.sort((x, y) => (order[x.status] ?? 9) - (order[y.status] ?? 9) || new Date(x.end_time) - new Date(y.end_time));
  res.json(rows);
};

function decorateAuction(auction, product, shops, bidCount) {
  const shop = shops[String(product?.shop_id || '')] || null;
  return {
    id: auction.id,
    auction_code: auction.auction_code || null,
    lot_id: lotId(auction, product),
    product_id: auction.product_id,
    product_name: product?.name || 'Untitled listing',
    category: product?.category || null,
    karat_weight: product?.karat_weight || null,
    image_url: product?.image_url || null,
    estimate: product?.price != null ? Number(product.price) : null,
    start_price: Number(auction.start_price || 0),
    current_bid: Number(auction.current_bid || 0),
    minimum_bid_increment: Number(auction.minimum_bid_increment || 1000),
    status: branchEffectiveStatus(auction.start_time, auction.end_time, auction.status),
    start_time: auction.start_time,
    end_time: auction.end_time,
    paused_at: auction.paused_at || null,
    bid_count: bidCount,
    // Live unique-CUSTOMER presence (services/auctionPresence.js). Never counts
    // admins or sellers, never counts duplicate tabs, never counts bids.
    watcher_count: watcherCount(auction.id),
    shop_name: shop?.shop_name || null,
    shop_owner_name: shop?.owner_name || null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * GET /admin/branches/:id/auctions/:auctionId   (monitor drawer)
 * Winner/result is READ from orders — the authoritative table written by
 * auctionClosingService. Admin never computes a winner.
 * ──────────────────────────────────────────────────────────────────────────── */
export const getBranchAuctionMonitor = async (req, res) => {
  const { id: branchId, auctionId } = req.params;

  // Scoping guard: the auction must actually belong to this branch.
  const { rows: scoped } = await pool.query(
    `SELECT a.id FROM auctions a
       JOIN products p ON p.id = a.product_id
       JOIN shops s    ON s.id = p.shop_id
      WHERE a.id = $1 AND s.home_branch_id = $2`,
    [auctionId, branchId]
  );
  if (!scoped[0]) return res.status(404).json({ message: 'Auction not found for this branch' });

  const { rows: aRows } = await pool.query('SELECT * FROM auctions WHERE id=$1', [auctionId]);
  const auction = aRows[0];
  const { rows: pRows } = await pool.query('SELECT * FROM products WHERE id=$1', [auction.product_id]);
  const product = pRows[0];
  const shops = await shopsByIds(product?.shop_id ? [product.shop_id] : []);
  const counts = await bidCounts([auction.id]);
  const base = decorateAuction(auction, product, shops, counts[String(auction.id)] || 0);

  // Bid history — dedup per bidder (highest bid each) exactly like
  // auctionClosingService ranks winners, so "Leading" matches the real result.
  const { rows: bidRows } = await pool.query(
    `SELECT id, user_id, amount, flagged, created_at FROM bids
      WHERE auction_id = $1
      ORDER BY amount DESC, created_at ASC`,
    [auctionId]
  );
  const userIds = [...new Set(bidRows.map((b) => b.user_id).filter(Boolean))];
  const users = userIds.length
    ? Object.fromEntries(
        (await pool.query(
          `SELECT id, name FROM users WHERE id IN (${userIds.map((_, i) => `$${i + 1}`).join(',')})`,
          userIds
        )).rows.map((u) => [String(u.id), u.name])
      )
    : {};

  // One row per bidder, using their best CLEAN bid — the same bid the closing
  // service would actually use to pick a winner. A bidder whose every bid is
  // flagged still appears, with the flagged badge, instead of vanishing.
  const bestPerUser = new Map();
  const flaggedOnly = new Map();
  bidRows.forEach((b) => {
    const key = String(b.user_id);
    const target = b.flagged ? flaggedOnly : bestPerUser;
    if (!target.has(key)) target.set(key, b);
  });
  flaggedOnly.forEach((b, key) => { if (!bestPerUser.has(key)) bestPerUser.set(key, b); });

  // "Leading" must match the ONLY authority that decides a winner:
  // auctionClosingService ranks flagged=false bids, dedupes per bidder and takes
  // the top entry. Using a different rule here would let Admin disagree with the
  // real result.
  const leadingUserId = bestPerUser.size
    ? String((bidRows.find((b) => !b.flagged) || bestPerUser.values().next().value).user_id)
    : null;

  const bidders = [...bestPerUser.values()].slice(0, 25).map((b) => ({
    id: b.id,
    // Display name only. Email / phone / auth ids are never exposed.
    bidder_name: displayBidderName(users[String(b.user_id)]),
    amount: Number(b.amount || 0),
    created_at: b.created_at,
    flagged: !!b.flagged,
    is_leading: !b.flagged && String(b.user_id) === leadingUserId,
  }));

  // Authoritative result — written by services/auctionClosingService.js
  const { rows: orderRows } = await pool.query(
    'SELECT * FROM orders WHERE auction_id=$1',
    [auctionId]
  );
  const order = orderRows[0] || null;
  let winnerName = null;
  if (order?.buyer_id) {
    const { rows: wRows } = await pool.query('SELECT id, name FROM users WHERE id=$1', [order.buyer_id]);
    winnerName = displayBidderName(wRows[0]?.name);
  }

  res.json({
    ...base,
    bidders,
    leading_bidder: bidders.find((b) => b.is_leading)?.bidder_name || null,
    result: order
      ? {
          order_id: order.id,
          transaction_code: order.transaction_code || null,
          final_price: Number(order.amount || 0),
          winner: winnerName,
          winner_rank: order.winner_rank ?? 1,
          order_status: order.status,
          ended_at: order.created_at,
        }
      : null,
  });
};

/** "Maria S." — first name + last initial. Never the full name, email or phone. */
export function displayBidderName(name) {
  const clean = String(name || '').trim();
  if (!clean) return 'Bidder';
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}