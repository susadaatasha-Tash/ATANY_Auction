// backend/src/controllers/customer/bid.controller.js
// Route handler — thin, delegates to services/bidLogic.js (per structure rule)
import { placeBid } from '../../services/bidLogic.js';
import { pool } from '../../db/pool.js';

export async function placeBidController(req, res) {
  try {
    const { auctionId, amount } = req.body;
    const userId = req.user.id;
    const result = await placeBid({ auctionId, userId, amount });
    // Emit to auction room only — clients in watchlist/live grid subscribed via join:auction
    req.io?.to(`auction:${auctionId}`).emit('bid:update', { auctionId, currentBid: amount, flagged: result.flagged });
    req.io?.emit('bid:update', { auctionId, currentBid: amount }); // fallback global for dashboards
    res.json(result);
  } catch (e) {
    const code = e.code || null;
    // H4 business errors → 409; validation/unavailable → 400
    const status = code === 'AUCTION_NOT_LIVE' || code === 'AUCTION_NOT_FOUND' ? 409 : 400;
    res.status(status).json({ message: e.message, code });
  }
}

export async function listBids(req, res) {
  const userId = req.user.id;
  const { rows: bids } = await pool.query('SELECT * FROM bids WHERE user_id=$1 ORDER BY created_at DESC', [userId]);
  if (!bids.length) return res.json([]);
  const auctionIds = [...new Set(bids.map(b => b.auction_id))];
  const { rows: auctions } = await pool.query(`SELECT * FROM auctions WHERE id IN (${auctionIds.map((_,i)=>`$${i+1}`).join(',')})`, auctionIds);
  const auctionMap = Object.fromEntries(auctions.map(a => [a.id, a]));
  const productIds = [...new Set(auctions.map(a => a.product_id).filter(Boolean))];
  let productMap = {};
  if (productIds.length) {
    const { rows: products } = await pool.query(`SELECT * FROM products WHERE id IN (${productIds.map((_,i)=>`$${i+1}`).join(',')})`, productIds);
    productMap = Object.fromEntries(products.map(p => [p.id, p]));
  }
  // Count bids per auction
  const bidCounts = {};
  const auctionMapForCount = {};
  for (const aid of auctionIds) {
    const { rows } = await pool.query('SELECT COUNT(*)::int as cnt FROM bids WHERE auction_id=$1', [aid]);
    bidCounts[aid] = rows[0]?.cnt || 0;
  }
  const now = new Date();
  const rows = bids.map(b => {
    const a = auctionMap[b.auction_id] || {};
    const p = productMap[a.product_id] || {};
    return {
      id: b.id,
      yourBid: b.amount,
      currentBid: a.current_bid,
      bidsCount: bidCounts[a.id] || 0,
      endsInSec: a.end_time ? Math.max(0, Math.floor((new Date(a.end_time) - now)/1000)) : 0,
      flagged: b.flagged,
      flagReason: b.flag_reason,
      status: a.status,
      item: p.name,
      img: p.image_url,
      auction_id: a.id,
      created_at: b.created_at,
    };
  });
  // Map status for My Bids: winning/outbid/won/lost based on current highest
  const withStatus = rows.map((r) => {
    // Determine if this bid is the current highest for its auction
    // For simplicity, status is pending vs winning based on whether yourBid == currentBid
    let status = 'outbid';
    if (r.yourBid === r.currentBid) status = 'winning';
    // If auction ended, determine won/lost
    if (r.status === 'ended') status = r.yourBid === r.currentBid ? 'won' : 'lost';
    return { ...r, status };
  });
  res.json(withStatus);
}
