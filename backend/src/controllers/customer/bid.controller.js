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
    // H4 business errors -> 409; infrastructure unavailability -> 503;
    // genuine validation errors -> 400.
    // DB_UNAVAILABLE must NOT be 400: bidding fails closed when direct Postgres
    // is unreachable (SERIALIZABLE + FOR UPDATE cannot run over REST), which is a
    // transient server-side condition, not a malformed request. Reporting 400 told
    // the client its payload was wrong and is not retryable. 503 matches the
    // convention already asserted in tests/priority1Security.test.js.
    const UNAVAILABLE = new Set(['DB_UNAVAILABLE', 'BIDDING_UNAVAILABLE']);
    const status = UNAVAILABLE.has(code)
      ? 503
      : code === 'AUCTION_NOT_LIVE' || code === 'AUCTION_NOT_FOUND'
        ? 409
        : 400;
    const body = { message: e.message, code };
    // BID_TOO_LOW carries authoritative recalculation for the UI to display
    // (never trust client-computed minimums).
    if (code === 'BID_TOO_LOW') {
      if (Number.isFinite(Number(e.current_bid))) body.current_bid = Number(e.current_bid);
      if (Number.isFinite(Number(e.minimum_bid_increment))) body.minimum_bid_increment = Number(e.minimum_bid_increment);
      if (Number.isFinite(Number(e.minimum_bid))) body.minimum_bid = Number(e.minimum_bid);
    }
    res.status(status).json(body);
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
  // Count bids per auction. Single scan instead of one COUNT(*) per auction (N+1
  // round trips). It also drops the `COUNT(` keyword deliberately: pool.js flags
  // COUNT/JOIN/GROUP BY as "complex", and under the Supabase REST fallback those
  // return NO ROWS, so every bidsCount silently came back 0 whenever direct
  // Postgres was unreachable. This simple form works on both paths and yields
  // identical numbers.
  const bidCounts = {};
  const { rows: allBidRows } = await pool.query('SELECT auction_id FROM bids');
  for (const row of allBidRows) {
    const k = String(row.auction_id);
    bidCounts[k] = (bidCounts[k] || 0) + 1;
  }
  const now = new Date();
  const rows = bids.map(b => {
    const a = auctionMap[b.auction_id] || {};
    const p = productMap[a.product_id] || {};
    return {
      id: b.id,
      yourBid: b.amount,
      currentBid: a.current_bid,
      bidsCount: bidCounts[String(a.id)] || 0,
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
