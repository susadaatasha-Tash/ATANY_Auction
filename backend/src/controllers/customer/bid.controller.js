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
    res.status(400).json({ message: e.message });
  }
}

export async function listBids(req, res) {
  const userId = req.user.id;
  const { rows } = await pool.query(`
    SELECT b.id, b.amount as "yourBid", a.current_bid as "currentBid",
           (SELECT COUNT(*) FROM bids WHERE auction_id = a.id)::int as "bidsCount",
           EXTRACT(EPOCH FROM (a.end_time - NOW()))::int as "endsInSec",
           b.flagged, b.flag_reason as "flagReason",
           a.status, p.name as item, p.image_url as img
    FROM bids b
    JOIN auctions a ON a.id = b.auction_id
    JOIN products p ON p.id = a.product_id
    WHERE b.user_id = $1
    ORDER BY b.created_at DESC
  `, [userId]);
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
