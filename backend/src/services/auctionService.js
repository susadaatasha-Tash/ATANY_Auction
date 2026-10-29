// backend/src/services/auctionService.js
// REST-compatible version: fetches data via simple queries and composes in JS.
// The original JOIN-heavy query can't run through the Supabase REST fallback.
import { pool } from '../db/pool.js';

// Compute the effective auction status from start/end times instead of trusting the stored DB status.
// The DB status is set once at creation and only updated by cron jobs, which may lag behind real time.
// Terminal/authoritative stored states always win:
// - 'paused' stays paused regardless of time window (clock frozen, resume shifts end_time).
// - 'ended' stays ended regardless of time window. A manually ended auction keeps
//   its original (future) end_time, so time-only computation would resurrect it
//   as 'live' in every feed (seller My Auctions, portal sidebar, customer lists).
//   Ended is terminal — relisting creates a NEW auction row, never revives this one.
export function effectiveStatus(startTime, endTime, storedStatus) {
  const stored = String(storedStatus).toLowerCase();
  if (stored === 'paused') return 'paused';
  if (stored === 'ended') return 'ended';
  const now = new Date();
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (now < start) return 'scheduled';
  if (now >= end) return 'ended';
  return 'live';
}

export async function listAuctions({ shopId, branchId, status } = {}) {
  // 1. Fetch auctions with simple WHERE (no JOINs)
  let auctionSql = 'SELECT * FROM auctions WHERE 1=1';
  const params = [];
  if (status && ['live', 'scheduled', 'ended', 'paused'].includes(status)) {
    params.push(status);
    auctionSql += ` AND status = $${params.length}`;
  } else if (status === 'all') {
    // no filter — effective filter will keep only live+scheduled
  } else {
    // Customer/default: live + scheduled only (paused/ended excluded)
    auctionSql += ` AND status IN ('live','scheduled')`;
  }
  auctionSql += ' ORDER BY end_time';
  const { rows: auctions } = await pool.query(auctionSql, params);

  if (!auctions.length) return [];

  // 2. Collect unique product IDs and fetch products in one query
  const productIds = [...new Set(auctions.map(a => a.product_id))];
  const { rows: products } = await pool.query(
    `SELECT * FROM products WHERE id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`,
    productIds
  );
  const productMap = Object.fromEntries(products.map(p => [p.id, p]));

  // 3. Filter by shopId if requested
  let filtered = auctions;
  if (shopId) {
    filtered = filtered.filter(a => {
      const p = productMap[a.product_id];
      return p && p.shop_id === shopId;
    });
  }

  // 4. Collect unique shop IDs from products and fetch shops
  const shopIds = [...new Set(filtered.map(a => productMap[a.product_id]?.shop_id).filter(Boolean))];
  let shopMap = {};
  if (shopIds.length) {
    const { rows: shops } = await pool.query(
      `SELECT * FROM shops WHERE id IN (${shopIds.map((_, i) => `$${i + 1}`).join(',')})`,
      shopIds
    );
    shopMap = Object.fromEntries(shops.map(s => [s.id, s]));
  }

  // 5. Filter by branchId if requested
  if (branchId) {
    filtered = filtered.filter(a => {
      const p = productMap[a.product_id];
      const s = shopMap[p?.shop_id];
      return s && s.home_branch_id === branchId;
    });
  }

  // 6. Collect unique branch IDs and fetch branches
  const branchIds = [...new Set(filtered.map(a => {
    const p = productMap[a.product_id];
    const s = shopMap[p?.shop_id];
    return s?.home_branch_id;
  }).filter(Boolean))];
  let branchMap = {};
  if (branchIds.length) {
    const { rows: branches } = await pool.query(
      `SELECT * FROM branches WHERE id IN (${branchIds.map((_, i) => `$${i + 1}`).join(',')})`,
      branchIds
    );
    branchMap = Object.fromEntries(branches.map(b => [b.id, b]));
  }

  // 7. Count bids and unique participants per auction — REST-compatible (avoid COUNT)
  const auctionIds = filtered.map(a => a.id);
  let bidCounts = {};
  let participantCounts = {};
  if (auctionIds.length) {
    // Batch fetch all bids for filtered auctions to avoid N+1 COUNT queries
    const { rows: allBids } = await pool.query(
      `SELECT auction_id, user_id FROM bids WHERE auction_id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')})`,
      auctionIds
    );
    for (const aid of auctionIds) {
      const bidsForAuction = allBids.filter(b => String(b.auction_id) === String(aid));
      bidCounts[aid] = bidsForAuction.length;
      participantCounts[aid] = new Set(bidsForAuction.map(b => b.user_id)).size;
    }
  }

  // 8. Compose final result and apply effective status filter
  const now = new Date();
  return filtered.map(a => {
    const p = productMap[a.product_id] || {};
    const s = shopMap[p.shop_id] || {};
    const b = branchMap[s.home_branch_id] || {};
    const computedStatus = effectiveStatus(a.start_time, a.end_time, a.status);
    return {
      id: a.id,
      auction_code: a.auction_code,
      productId: a.product_id,
      startPrice: a.start_price,
      currentBid: a.current_bid,
      minimum_bid_increment: Number(a.minimum_bid_increment) > 0 ? Number(a.minimum_bid_increment) : 1000,
      bids: bidCounts[a.id] || 0,
      participants: participantCounts[a.id] || 0,
      status: computedStatus,
      startTime: a.start_time,
      endTime: a.end_time,
      startsInSec: Math.max(0, Math.floor((new Date(a.start_time) - now) / 1000)),
      endsInSec: Math.max(0, Math.floor((new Date(a.end_time) - now) / 1000)),
      name: p.name,
      img: p.image_url,
      category: p.category,
      karat_weight: p.karat_weight,
      shop_id: s.id,
      shop_name: s.shop_name,
      branch_id: b.id,
      branch_name: b.name,
      branch_address: b.address,
    };
  }).filter(a => {
    // Apply effective status filtering on top of DB status
    // Customer Auctions supports Live+Scheduled only — paused/ended excluded by default
    if (status === 'ended') return a.status === 'ended';
    if (status === 'live') return a.status === 'live';
    if (status === 'scheduled') return a.status === 'scheduled';
    if (status === 'paused') return a.status === 'paused';
    if (status === 'all') return a.status === 'live' || a.status === 'scheduled';
    // Default (no status param): All = live+scheduled, paused/ended excluded
    return a.status === 'live' || a.status === 'scheduled';
  });
}
