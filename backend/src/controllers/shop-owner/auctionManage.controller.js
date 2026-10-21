// backend/src/controllers/shop-owner/auctionManage.controller.js
// Seller Auction Management: grouped view, filters, leaderboards, controls
// All operations derive shop ownership from authenticated session only.
import { pool, isDirectPg } from '../../db/pool.js';
import { ensureDirectPgAvailable, acquireTxClient, ServiceUnavailableError } from '../../db/dbGuard.js';
import { isConnFailure } from '../../db/connectionInfo.js';
import { effectiveStatus } from '../../services/auctionService.js';
import { closeSingleAuction } from '../../services/auctionClosingService.js';

// Structured 503 for direct-only auction mutations. Only true connection
// failures map here — SQL/business errors keep their 500/409/400 responses.
// Server logs retain the detailed error; the client gets a stable contract.
function auctionUnavailable(res, operation, err) {
  try {
    console.error(`[${operation}] direct DB unavailable:`, (err && err.message) || 'unknown');
  } catch {}
  return res.status(503).json({ code: 'AUCTION_OPERATION_UNAVAILABLE', message: 'Auction action temporarily unavailable.' });
}

async function getOwnShop(userId) {
  const { rows } = await pool.query('SELECT id FROM shops WHERE user_id=$1', [userId]);
  if (rows[0]) return rows[0];
  // Auto-create shop if missing (same as listAuctions)
  try {
    const { rows: u } = await pool.query('SELECT name,email FROM users WHERE id=$1', [userId]);
    const name = u[0]?.name || u[0]?.email || 'My Shop';
    await pool.query('INSERT INTO shops (user_id, shop_name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, name]);
    const { rows: r2 } = await pool.query('SELECT id FROM shops WHERE user_id=$1', [userId]);
    return r2[0] || null;
  } catch { return null; }
}

async function loadOwnedAuction(auctionId, shopId) {
  const { rows: aucRows } = await pool.query('SELECT * FROM auctions WHERE id=$1', [auctionId]);
  const auction = aucRows[0];
  if (!auction) return { error: { code: 404, message: 'Auction not found' } };
  const { rows: prodRows } = await pool.query('SELECT shop_id FROM products WHERE id=$1', [auction.product_id]);
  const shop_id = prodRows[0]?.shop_id;
  if (!shop_id || String(shop_id) !== String(shopId)) return { error: { code: 404, message: 'Auction not found' } };
  return { auction, productShopId: shop_id };
}

// Batch helpers
async function enrichAuctions(rawAuctions, { leaderboardLimit = 25 } = {}) {
  if (!rawAuctions.length) return [];
  const now = new Date();
  const productIds = [...new Set(rawAuctions.map(a => a.product_id))];
  const { rows: products } = productIds.length
    ? await pool.query(`SELECT * FROM products WHERE id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`, productIds)
    : { rows: [] };
  const productMap = Object.fromEntries(products.map(p => [p.id, p]));
  const shopIds = [...new Set(products.map(p => p.shop_id).filter(Boolean))];
  let shopMap = {};
  if (shopIds.length) {
    const { rows: shops } = await pool.query(`SELECT * FROM shops WHERE id IN (${shopIds.map((_, i) => `$${i + 1}`).join(',')})`, shopIds);
    shopMap = Object.fromEntries(shops.map(s => [s.id, s]));
  }
  const branchIds = [...new Set(Object.values(shopMap).map(s => s.home_branch_id).filter(Boolean))];
  let branchMap = {};
  if (branchIds.length) {
    const { rows: branches } = await pool.query(`SELECT * FROM branches WHERE id IN (${branchIds.map((_, i) => `$${i + 1}`).join(',')})`, branchIds);
    branchMap = Object.fromEntries(branches.map(b => [b.id, b]));
  }
  const auctionIds = rawAuctions.map(a => a.id);
  let bidCounts = {};
  let bidsByAuction = {};
  let watcherCounts = {};
  if (auctionIds.length) {
    // Bids batch
    try {
      const { rows: allBids } = await pool.query(`SELECT auction_id, user_id, amount, created_at FROM bids WHERE auction_id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY amount DESC`, auctionIds);
      for (const aId of auctionIds) {
        const list = allBids.filter(b => String(b.auction_id) === String(aId));
        bidCounts[aId] = list.length;
        bidsByAuction[aId] = list;
      }
    } catch { /* fallback */ }
    // Watchers: canonical source is watchlists(product_id) — not favorites.
    // favorites is buyer-side "heart" for product listings; watchlists is auction watch intent.
    // Documented watcher_count = COUNT(DISTINCT user_id) in watchlists for the lot's product_id.
    if (productIds.length) {
      try {
        const { rows: allWatches } = await pool.query(`SELECT user_id, product_id FROM watchlists WHERE product_id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`, productIds);
        const watchCountByProduct = {};
        for (const w of allWatches) watchCountByProduct[w.product_id] = (watchCountByProduct[w.product_id] || 0) + 1;
        for (const a of rawAuctions) {
          watcherCounts[a.id] = watchCountByProduct[a.product_id] || 0;
        }
      } catch { /* ignore */ }
    }
  }
  // Order winner lookup for ended auctions (authoritative winner + fulfillment
  // state). Loaded BEFORE the user batch so a confirmed winner's name is always
  // resolved in the same query round-trip (no N+1).
  let orderMap = {};
  if (auctionIds.length) {
    try {
      const { rows: orders } = await pool.query(`SELECT auction_id, buyer_id, amount, status, payment_deadline, winner_confirmed_at, winner_rank FROM orders WHERE auction_id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')})`, auctionIds);
      for (const o of orders) orderMap[String(o.auction_id)] = o;
    } catch {}
  }
  // Fetch user names for leaderboards + winner (dedup)
  const allUserIds = [...new Set([
    ...Object.values(bidsByAuction).flat().map(b => b.user_id).filter(Boolean),
    ...Object.values(orderMap).map(o => o.buyer_id).filter(Boolean),
  ])];
  let userMap = {};
  if (allUserIds.length) {
    const { rows: users } = await pool.query(`SELECT id, name FROM users WHERE id IN (${allUserIds.map((_, i) => `$${i + 1}`).join(',')})`, allUserIds);
    userMap = Object.fromEntries(users.map(u => [String(u.id), u.name]));
  }

  return rawAuctions.map(a => {
    const p = productMap[a.product_id] || {};
    const s = shopMap[p.shop_id] || {};
    const b = branchMap[s.home_branch_id] || {};
    const computed = effectiveStatus(a.start_time, a.end_time, a.status);
    const bids = bidsByAuction[a.id] || [];
    // Deduplicate per bidder, keep highest
    const seen = new Map();
    for (const bid of bids) {
      if (!seen.has(String(bid.user_id))) seen.set(String(bid.user_id), bid);
    }
    // Authoritative winner: the order row (buyer_id) is the source of truth —
    // it also reflects the 7-day payment fallback that can pass the opportunity
    // to the next eligible bidder. An expired order has no confirmed winner.
    const order = orderMap[String(a.id)] || null;
    const orderStatus = order ? String(order.status || '').toLowerCase() : null;
    const winnerId = order && order.buyer_id ? String(order.buyer_id) : null;
    const winnerConfirmed = !!winnerId && orderStatus !== 'expired';
    const ranked = Array.from(seen.values()).sort((x, y) => Number(y.amount) - Number(x.amount)).slice(0, leaderboardLimit).map((bid, idx) => {
      const isWinner = winnerConfirmed && String(bid.user_id) === winnerId;
      return {
        rank: idx + 1,
        bidder_id: bid.user_id,
        bidder_name: userMap[String(bid.user_id)] || 'Bidder',
        amount: bid.amount,
        created_at: bid.created_at,
        is_winner: !!isWinner,
        is_leading: idx === 0 && computed === 'live',
        is_top_bidder: idx === 0,
      };
    });
    // Result state derived from the real auction/order state (never guessed in the UI).
    const bid_count = bidCounts[a.id] || 0;
    const watcher_count = watcherCounts[a.id] || 0;
    let resultState = 'live';
    if (computed === 'ended') {
      if (!winnerId) resultState = bid_count > 0 ? 'no_winner' : 'no_bids';
      else if (orderStatus === 'expired') resultState = 'winner_expired';
      else if (orderStatus === 'completed') resultState = 'completed';
      else if (orderStatus === 'ready_pickup') resultState = 'ready_pickup';
      else if (orderStatus === 'preparing') resultState = 'preparing';
      else resultState = 'payment_pending';
    }
    const RESULT_LABELS = {
      live: 'Auction live',
      payment_pending: 'Winner confirmed — payment pending',
      preparing: 'Payment received — preparing fulfillment',
      ready_pickup: 'Ready for pickup',
      completed: 'Completed — picked up',
      winner_expired: 'Winner expired — payment deadline passed',
      no_winner: 'Ended — no confirmed winner',
      no_bids: 'Ended — no bids',
    };
    const result = {
      state: resultState,
      label: RESULT_LABELS[resultState] || RESULT_LABELS.live,
      winner_confirmed: winnerConfirmed,
      final_bid: winnerConfirmed ? Number(order?.amount) || 0 : 0,
      highest_bid: bids.length ? Number(bids[0].amount) || 0 : 0,
      total_bids: bid_count,
      watcher_count,
      order_status: orderStatus,
      payment_deadline: order?.payment_deadline || null,
      winner_confirmed_at: order?.winner_confirmed_at || null,
      winner_rank: order?.winner_rank ?? null,
    };
    const winner = winnerConfirmed
      ? { id: winnerId, name: userMap[winnerId] || 'Bidder', amount: Number(order?.amount) || 0 }
      : null;
    // Mask emails not needed — we return name only
    // Ends/starts in seconds
    const startsInSec = Math.max(0, Math.floor((new Date(a.start_time) - now) / 1000));
    const endsInSec = Math.max(0, Math.floor((new Date(a.end_time) - now) / 1000));
    return {
      id: a.id,
      auction_code: a.auction_code,
      lot_code: a.auction_code || `LOT-${String(a.id).slice(0, 4).toUpperCase()}`,
      product_id: a.product_id,
      productId: a.product_id,
      title: p.name || 'Untitled',
      name: p.name,
      category: p.category || 'Other',
      karat_weight: p.karat_weight,
      description: p.description || null,
      image_url: p.image_url,
      img: p.image_url,
      branch: b.name || null,
      branch_id: b.id || null,
      branch_name: b.name || null,
      status: computed,
      stored_status: a.status,
      start_time: a.start_time,
      end_time: a.end_time,
      startTime: a.start_time,
      endTime: a.end_time,
      startsInSec,
      endsInSec,
      start_price: a.start_price,
      startPrice: a.start_price,
      minimum_bid_increment: a.minimum_bid_increment,
      minimumBidIncrement: a.minimum_bid_increment,
      current_bid: a.current_bid,
      currentBid: a.current_bid,
      bid_count,
      bids: bid_count,
      watcher_count,
      watchers: watcher_count,
      leaderboard: ranked,
      result,
      winner,
      // Relisting is only legal from a terminal (ended) auction.
      can_relist: computed === 'ended',
      paused_at: a.paused_at || null,
      participants: new Set(bids.map(bb => String(bb.user_id))).size,
    };
  });
}

export const manageAuctions = async (req, res) => {
  const shop = await getOwnShop(req.user.id);
  if (!shop) return res.status(404).json({ message: 'Shop not found' });
  const { rows: prodRows } = await pool.query('SELECT id FROM products WHERE shop_id=$1', [shop.id]);
  const productIds = prodRows.map(r => r.id);
  if (!productIds.length) {
    return res.json({ summary: { total: 0, live: 0, scheduled: 0, paused: 0, ended: 0 }, categories: [], auctions: [], pagination: { total: 0, page: 1, limit: 20, pages: 0 } });
  }
  const { rows: allAuctions } = await pool.query(`SELECT * FROM auctions WHERE product_id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY end_time ASC`, productIds);
  let enriched = await enrichAuctions(allAuctions);

  // Summary from enriched (effective status)
  const summary = { total: enriched.length, live: 0, scheduled: 0, paused: 0, ended: 0 };
  for (const a of enriched) {
    if (a.status === 'live') summary.live++;
    else if (a.status === 'scheduled') summary.scheduled++;
    else if (a.status === 'paused') summary.paused++;
    else if (a.status === 'ended') summary.ended++;
  }
  // Categories
  const catMap = {};
  for (const a of enriched) catMap[a.category] = (catMap[a.category] || 0) + 1;
  const categories = Object.entries(catMap).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));

  // Apply filters: status, category, search
  const { status, category, search, q } = req.query;
  const searchTerm = (search || q || '').toLowerCase().trim();
  let filtered = enriched;
  if (status && ['live', 'scheduled', 'paused', 'ended'].includes(status)) {
    filtered = filtered.filter(a => a.status === status);
  }
  if (category && category !== 'All categories' && category !== 'all') {
    filtered = filtered.filter(a => String(a.category).toLowerCase() === String(category).toLowerCase());
  }
  if (searchTerm) {
    filtered = filtered.filter(a =>
      (a.title || '').toLowerCase().includes(searchTerm) ||
      (a.lot_code || '').toLowerCase().includes(searchTerm) ||
      (a.auction_code || '').toLowerCase().includes(searchTerm) ||
      (a.category || '').toLowerCase().includes(searchTerm) ||
      (a.branch || '').toLowerCase().includes(searchTerm)
    );
  }
  // Pagination
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const total = filtered.length;
  const pages = Math.ceil(total / limit) || 0;
  const start = (page - 1) * limit;
  const paged = filtered.slice(start, start + limit);

  res.json({
    summary,
    categories,
    auctions: paged,
    pagination: { total, page, limit, pages, showing: paged.length },
  });
};

export const getTopBidders = async (req, res) => {
  const shop = await getOwnShop(req.user.id);
  if (!shop) return res.json([]);
  const { rows: prodRows } = await pool.query('SELECT id FROM products WHERE shop_id=$1', [shop.id]);
  const pids = prodRows.map(r => r.id);
  if (!pids.length) return res.json([]);
  const { rows: aucRows } = await pool.query(`SELECT id FROM auctions WHERE product_id IN (${pids.map((_, i) => `$${i + 1}`).join(',')})`, pids);
  const auctionIds = aucRows.map(r => r.id);
  if (!auctionIds.length) return res.json([]);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  // Fetch bids this month for seller's auctions
  const { rows: bids } = await pool.query(
    `SELECT user_id, amount, auction_id FROM bids WHERE auction_id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')}) AND created_at >= $${auctionIds.length + 1}`,
    [...auctionIds, monthStart.toISOString()]
  );
  if (!bids.length) return res.json([]);
  // Group by user
  const byUser = {};
  for (const b of bids) {
    const uid = String(b.user_id);
    if (!byUser[uid]) byUser[uid] = { user_id: b.user_id, bids: 0, lotsWon: 0, total: 0, auctions: new Set() };
    byUser[uid].bids += 1;
    byUser[uid].auctions.add(String(b.auction_id));
  }
  // Lots won: distinct auctions where user is winner order buyer
  try {
    const { rows: orders } = await pool.query(`SELECT auction_id, buyer_id, amount FROM orders WHERE auction_id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')})`, auctionIds);
    for (const o of orders) {
      const uid = String(o.buyer_id);
      if (byUser[uid]) { byUser[uid].lotsWon += 1; byUser[uid].total += Number(o.amount) || 0; }
    }
  } catch {}
  const userIds = Object.keys(byUser);
  let names = {};
  if (userIds.length) {
    const { rows: users } = await pool.query(`SELECT id, name FROM users WHERE id IN (${userIds.map((_, i) => `$${i + 1}`).join(',')})`, userIds);
    for (const u of users) names[String(u.id)] = u.name;
  }
  const ranked = Object.values(byUser).map(v => ({
    bidder_id: v.user_id,
    bidder_name: names[String(v.user_id)] || 'Bidder',
    bids: v.bids,
    lots_won: v.lotsWon,
    total_won: v.total,
    auctions_bid: v.auctions.size,
  })).sort((a, b) => b.bids - a.bids || b.lots_won - a.lots_won).slice(0, 5);
  res.json(ranked);
};

// Mutations — all verify direct pg on demand (ensureDirectPgAvailable) for transactional safety

export const startAuction = async (req, res) => {
  const shop = await getOwnShop(req.user.id);
  if (!shop) return res.status(404).json({ message: 'Shop not found' });
  const { error, auction } = await loadOwnedAuction(req.params.id, shop.id);
  if (error) return res.status(error.code).json({ message: error.message });
  const now = new Date();
  const s = new Date(auction.start_time);
  const e = new Date(auction.end_time);
  const computed = effectiveStatus(auction.start_time, auction.end_time, auction.status);
  if (computed !== 'scheduled') return res.status(409).json({ message: 'Only scheduled auctions can be started' });
  // Preserve original configured duration: newEnd = now + (oldEnd - oldStart)
  const dur = e.getTime() - s.getTime();
  const newEnd = new Date(now.getTime() + (dur > 0 ? dur : 7 * 86400000));
  try { await ensureDirectPgAvailable('startAuction'); } catch (err) { return auctionUnavailable(res, 'startAuction', err); }
  let tx;
  try {
    tx = await acquireTxClient('startAuction');
  } catch (err) {
    return auctionUnavailable(res, 'startAuction', err);
  }
  const client = tx.client;
  const releaseTx = tx.release;
  try {
    if (client.__restFallback) throw new ServiceUnavailableError('startAuction requires direct DB');
    await client.query('BEGIN');
    const { rows } = await client.query("UPDATE auctions SET status='live', start_time=$1, end_time=$2 WHERE id=$3 AND status='scheduled' RETURNING *", [now.toISOString(), newEnd.toISOString(), req.params.id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Auction already started' }); }
    await client.query('COMMIT');
    const enriched = await enrichAuctions(rows);
    req.io?.to(`auction:${req.params.id}`).emit('auction:update', enriched[0]);
    req.io?.emit('auction:update', enriched[0]);
    res.json(enriched[0]);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    if (e instanceof ServiceUnavailableError || isConnFailure(e)) return auctionUnavailable(res, 'startAuction', e);
    res.status(500).json({ message: 'Failed to start auction' });
  } finally { releaseTx(); }
};

export const extendAuction = async (req, res) => {
  const shop = await getOwnShop(req.user.id);
  if (!shop) return res.status(404).json({ message: 'Shop not found' });
  const { error, auction } = await loadOwnedAuction(req.params.id, shop.id);
  if (error) return res.status(error.code).json({ message: error.message });
  const computed = effectiveStatus(auction.start_time, auction.end_time, auction.status);
  if (computed !== 'live') return res.status(409).json({ message: 'Only live auctions can be extended' });
  const minutes = Math.round(Number(req.body?.minutes ?? 5));
  if (![5].includes(minutes)) return res.status(400).json({ message: 'Only 5 minute extensions allowed' });
  try { await ensureDirectPgAvailable('extendAuction'); } catch (err) { return auctionUnavailable(res, 'extendAuction', err); }
  let tx;
  try {
    tx = await acquireTxClient('extendAuction');
  } catch (err) {
    return auctionUnavailable(res, 'extendAuction', err);
  }
  const client = tx.client;
  const releaseTx = tx.release;
  try {
    if (client.__restFallback) throw new ServiceUnavailableError('extendAuction requires direct DB');
    await client.query('BEGIN');
    const { rows } = await client.query("UPDATE auctions SET end_time = end_time + INTERVAL '5 minutes' WHERE id=$1 AND status='live' RETURNING *", [req.params.id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Auction not live' }); }
    await client.query('COMMIT');
    const enriched = await enrichAuctions(rows);
    req.io?.to(`auction:${req.params.id}`).emit('auction:update', enriched[0]);
    req.io?.emit('auction:update', enriched[0]);
    res.json(enriched[0]);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    if (e instanceof ServiceUnavailableError || isConnFailure(e)) return auctionUnavailable(res, 'extendAuction', e);
    res.status(500).json({ message: 'Failed to extend auction' });
  } finally { releaseTx(); }
};

export const pauseAuction = async (req, res) => {
  const shop = await getOwnShop(req.user.id);
  if (!shop) return res.status(404).json({ message: 'Shop not found' });
  const { error, auction } = await loadOwnedAuction(req.params.id, shop.id);
  if (error) return res.status(error.code).json({ message: error.message });
  const computed = effectiveStatus(auction.start_time, auction.end_time, auction.status);
  if (computed !== 'live') return res.status(409).json({ message: 'Only live auctions can be paused' });
  try { await ensureDirectPgAvailable('pauseAuction'); } catch (err) { return auctionUnavailable(res, 'pauseAuction', err); }
  let tx;
  try {
    tx = await acquireTxClient('pauseAuction');
  } catch (err) {
    return auctionUnavailable(res, 'pauseAuction', err);
  }
  const client = tx.client;
  const releaseTx = tx.release;
  try {
    if (client.__restFallback) throw new ServiceUnavailableError('pauseAuction requires direct DB');
    await client.query('BEGIN');
    // Requires migration 030 (auction_status 'paused' + auctions.paused_at). Fail clearly if missing.
    const { rows } = await client.query("UPDATE auctions SET status='paused', paused_at=NOW() WHERE id=$1 AND status='live' RETURNING *", [req.params.id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Auction not live' }); }
    await client.query('COMMIT');
    const enriched = await enrichAuctions(rows);
    req.io?.to(`auction:${req.params.id}`).emit('auction:update', { auction_id: enriched[0].id, status: enriched[0].status, current_bid: enriched[0].current_bid, bid_count: enriched[0].bid_count, end_time: enriched[0].end_time, start_time: enriched[0].start_time, paused_at: enriched[0].paused_at });
    req.io?.emit('auction:update', { auction_id: enriched[0].id, status: enriched[0].status });
    res.json(enriched[0]);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    if (e instanceof ServiceUnavailableError || isConnFailure(e)) return auctionUnavailable(res, 'pauseAuction', e);
    if (String(e.message).includes('invalid input value for enum') || String(e.message).includes('column "paused_at" does not exist')) {
      return res.status(500).json({ message: 'Pause not available — migration 030_auction_pause_support not applied', code: 'MIGRATION_MISSING' });
    }
    res.status(500).json({ message: 'Failed to pause auction' });
  } finally { releaseTx(); }
};

export const resumeAuction = async (req, res) => {
  const shop = await getOwnShop(req.user.id);
  if (!shop) return res.status(404).json({ message: 'Shop not found' });
  const { error, auction } = await loadOwnedAuction(req.params.id, shop.id);
  if (error) return res.status(error.code).json({ message: error.message });
  const stored = String(auction.status).toLowerCase();
  if (stored !== 'paused' && !auction.paused_at) return res.status(409).json({ message: 'Auction is not paused' });
  try { await ensureDirectPgAvailable('resumeAuction'); } catch (err) { return auctionUnavailable(res, 'resumeAuction', err); }
  // Transaction-capable direct client: shared pool when healthy, otherwise a
  // dedicated fresh client (never REST) so pool saturation alone can't 503 us.
  let tx;
  try {
    tx = await acquireTxClient('resumeAuction');
  } catch (err) {
    return auctionUnavailable(res, 'resumeAuction', err);
  }
  const client = tx.client;
  const releaseTx = tx.release;
  try {
    if (client.__restFallback) throw new ServiceUnavailableError('resumeAuction requires direct DB');
    await client.query('BEGIN');
    // Shift end_time forward by paused duration (single shift — paused_at cleared, so repeated resume cannot shift again)
    const pausedAt = auction.paused_at ? new Date(auction.paused_at) : new Date();
    const pausedMs = Math.max(0, Date.now() - pausedAt.getTime());
    const { rows } = await client.query("UPDATE auctions SET status='live', paused_at=NULL, end_time = end_time + ($1::bigint * INTERVAL '1 millisecond') WHERE id=$2 AND status='paused' RETURNING *", [String(pausedMs), req.params.id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Auction not paused' }); }
    await client.query('COMMIT');
    const enriched = await enrichAuctions(rows);
    req.io?.to(`auction:${req.params.id}`).emit('auction:update', { auction_id: enriched[0].id, status: enriched[0].status, end_time: enriched[0].end_time, start_time: enriched[0].start_time });
    req.io?.emit('auction:update', { auction_id: enriched[0].id, status: enriched[0].status });
    res.json(enriched[0]);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    // Only true connection failures map to 503. SQL/business errors keep 500.
    if (e instanceof ServiceUnavailableError || isConnFailure(e)) return auctionUnavailable(res, 'resumeAuction', e);
    if (String(e.message).includes('invalid input value for enum') || String(e.message).includes('column "paused_at" does not exist')) {
      return res.status(500).json({ message: 'Resume not available — migration 030_auction_pause_support not applied', code: 'MIGRATION_MISSING' });
    }
    res.status(500).json({ message: 'Failed to resume auction' });
  } finally { releaseTx(); }
};

export const endAuction = async (req, res) => {
  const shop = await getOwnShop(req.user.id);
  if (!shop) return res.status(404).json({ message: 'Shop not found' });
  const { error, auction } = await loadOwnedAuction(req.params.id, shop.id);
  if (error) return res.status(error.code).json({ message: error.message });
  const stored = String(auction.status).toLowerCase();
  if (stored === 'ended') {
    const enriched = await enrichAuctions([auction]);
    return res.json(enriched[0]); // idempotent
  }
  const computed = effectiveStatus(auction.start_time, auction.end_time, auction.status);
  if (computed === 'scheduled') return res.status(409).json({ message: 'Cannot end a scheduled auction' });
  // Strong-consistency: fail closed on REST fallback
  try { await ensureDirectPgAvailable('endAuction'); } catch (err) { return auctionUnavailable(res, 'endAuction', err); }
  let result;
  try {
    result = await closeSingleAuction(req.params.id);
  } catch (e) {
    if (e.code === 'DB_UNAVAILABLE' || isConnFailure(e)) return auctionUnavailable(res, 'endAuction', e);
    return res.status(500).json({ message: 'Failed to end auction' });
  }
  // Fetch enriched row for response + socket. Authoritative post-commit state:
  // status is 'ended' (stored terminal state survives time computation), and
  // winner/order summary comes from the close result (single close, idempotent).
  const { rows: freshRows } = await pool.query('SELECT * FROM auctions WHERE id=$1', [req.params.id]);
  const enriched = await enrichAuctions(freshRows);
  const base = enriched[0] || freshRows[0];
  const payload = {
    ...base,
    status: 'ended',
    winner_id: result?.winnerId ?? null,
    order_id: result?.orderId ?? null,
  };
  const socketPayload = { auction_id: payload.id, status: 'ended', current_bid: payload.current_bid, bid_count: payload.bid_count, start_time: payload.start_time, end_time: payload.end_time, paused_at: null };
  req.io?.to(`auction:${req.params.id}`).emit('auction:update', socketPayload);
  req.io?.emit('auction:update', socketPayload);
  res.json(payload);
};

export const relistAuction = async (req, res) => {
  const shop = await getOwnShop(req.user.id);
  if (!shop) return res.status(404).json({ message: 'Shop not found' });
  const { error, auction } = await loadOwnedAuction(req.params.id, shop.id);
  if (error) return res.status(error.code).json({ message: error.message });
  const computed = effectiveStatus(auction.start_time, auction.end_time, auction.status);
  if (computed !== 'ended' && String(auction.status).toLowerCase() !== 'ended') return res.status(409).json({ message: 'Only ended auctions can be relisted' });
  const { start_time, end_time, duration, start_price, minimum_bid_increment } = req.body || {};
  let start = start_time ? new Date(start_time) : new Date(Date.now() + 24 * 3600 * 1000);
  let end = end_time ? new Date(end_time) : null;
  if (!end && duration) end = new Date(start.getTime() + Number(duration) * 3600 * 1000);
  if (!end) end = new Date(start.getTime() + 7 * 86400000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return res.status(400).json({ message: 'Invalid schedule' });
  // Bidding rules for the NEW auction. Unset values inherit from the source
  // auction (unchanged behaviour); supplied values must be valid.
  const inheritedStartPrice = Number(auction.start_price) || 0;
  const inheritedIncrement = Number(auction.minimum_bid_increment) || 1000;
  let finalStartPrice = inheritedStartPrice;
  if (start_price !== undefined && start_price !== null && start_price !== '') {
    const n = Number(start_price);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ message: 'Starting price must be greater than 0' });
    finalStartPrice = Math.round(n);
  }
  let finalIncrement = inheritedIncrement;
  if (minimum_bid_increment !== undefined && minimum_bid_increment !== null && minimum_bid_increment !== '') {
    const n = Number(minimum_bid_increment);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ message: 'Minimum bid increment must be greater than 0' });
    finalIncrement = Math.round(n);
  }
  if (!finalStartPrice || finalStartPrice <= 0) return res.status(400).json({ message: 'Starting price must be greater than 0' });
  const { rows: prodRows } = await pool.query('SELECT * FROM products WHERE id=$1', [auction.product_id]);
  const prod = prodRows[0];
  if (!prod) return res.status(404).json({ message: 'Product not found' });
  // Transactional mutation — fail closed when direct Postgres is unavailable
  // (never downgrade to a REST write that cannot honour BEGIN/COMMIT).
  try { await ensureDirectPgAvailable('relistAuction'); } catch (err) { return auctionUnavailable(res, 'relistAuction', err); }
  let tx;
  try {
    tx = await acquireTxClient('relistAuction');
  } catch (err) {
    return auctionUnavailable(res, 'relistAuction', err);
  }
  const client = tx.client;
  const releaseTx = tx.release;
  try {
    if (client.__restFallback) throw new ServiceUnavailableError('relistAuction requires direct DB');
    await client.query('BEGIN');
    // Spec: create a NEW auction for the same product. The original ended
    // auction, its bids, its order and its winner are never touched.
    const status = start <= new Date() ? 'live' : 'scheduled';
    const { rows: newAuc } = await client.query(
      'INSERT INTO auctions (product_id, start_price, current_bid, minimum_bid_increment, status, start_time, end_time) VALUES ($1,$2,$2,$3,$4,$5,$6) RETURNING *',
      [prod.id, finalStartPrice, finalIncrement, status, start.toISOString(), end.toISOString()]
    );
    await client.query('COMMIT');
    const enriched = await enrichAuctions(newAuc);
    res.status(201).json(enriched[0]);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    if (e instanceof ServiceUnavailableError || isConnFailure(e)) return auctionUnavailable(res, 'relistAuction', e);
    res.status(500).json({ message: 'Failed to relist auction' });
  } finally { releaseTx(); }
};

/**
 * GET /shop-owner/auctions/:id/result
 * Authoritative result payload for ONE seller-owned auction. Used by the
 * Auction Result modal so it always shows current server state (winner order
 * row, final bid, bid count, watcher count, full bidder leaderboard).
 * Cross-seller access returns 404 (same convention as the other seller routes)
 * so no private bidding data can be inferred.
 */
export const getAuctionResult = async (req, res) => {
  const shop = await getOwnShop(req.user.id);
  if (!shop) return res.status(404).json({ message: 'Shop not found' });
  const { error, auction } = await loadOwnedAuction(req.params.id, shop.id);
  if (error) return res.status(error.code).json({ message: error.message });
  const [enriched] = await enrichAuctions([auction], { leaderboardLimit: 100 });
  if (!enriched) return res.status(404).json({ message: 'Auction not found' });
  res.json({
    auction: {
      id: enriched.id,
      auction_code: enriched.auction_code,
      lot_code: enriched.lot_code,
      status: enriched.status,
      stored_status: enriched.stored_status,
      start_time: enriched.start_time,
      end_time: enriched.end_time,
      start_price: enriched.start_price,
      current_bid: enriched.current_bid,
      minimum_bid_increment: enriched.minimum_bid_increment,
      product_id: enriched.product_id,
    },
    product: {
      id: enriched.product_id,
      name: enriched.name,
      title: enriched.title,
      category: enriched.category,
      karat_weight: enriched.karat_weight,
      description: enriched.description,
      image_url: enriched.image_url,
    },
    branch: enriched.branch_id ? { id: enriched.branch_id, name: enriched.branch_name } : null,
    result: enriched.result,
    winner: enriched.winner,
    leaderboard: enriched.leaderboard,
    can_relist: enriched.can_relist,
  });
};
