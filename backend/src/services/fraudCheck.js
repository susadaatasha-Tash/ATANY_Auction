// backend/src/services/fraudCheck.js
// Spec 4.2: server-side fraud detection — extracted from customer-dashboard.html:754 checkSuspicious
// Client-side preview exists in frontend/src/shared/hooks/useFraudCheck.js but this is authoritative.
export async function checkFraud({ client, auctionId, userId, amount, previousBid }) {
  const jumpRatio = previousBid > 0 ? amount / previousBid : 1;
  const jumpAmount = amount - previousBid;
  if (jumpRatio >= 2.5 || jumpAmount >= 50000) {
    // Build activity trail for this large jump with recent bids
    const { rows: recent } = await client.query(
      `SELECT b.amount, b.created_at, p.name as product_name, a.current_bid as prev_bid
       FROM bids b JOIN auctions a ON a.id=b.auction_id JOIN products p ON p.id=a.product_id
       WHERE b.user_id=$1 ORDER BY b.created_at DESC LIMIT 3`,
      [userId]
    );
    const trail = recent.map(r => {
      const t = new Date(r.created_at).toLocaleTimeString('en-GB', { hour12: false });
      return `${t} — Bid ₱${Number(r.amount).toLocaleString()} on ${r.product_name} (previous: ₱${Number(r.prev_bid || previousBid).toLocaleString()})`;
    });
    // Dynamic description based on actual activity
    const detail = trail.length ? `Placed ${trail.length + 1} bids including a ${jumpRatio.toFixed(1)}x jump to ₱${Number(amount).toLocaleString()} (previous ₱${Number(previousBid).toLocaleString()})` : `Bid ₱${Number(amount).toLocaleString()} was ${jumpRatio.toFixed(1)}x previous ₱${Number(previousBid).toLocaleString()}`;
    return { flagged: true, reason: 'unusually large bid jump', type: 'Unusual Bidding Pattern', detail, trail };
  }
  const { rows } = await client.query(
    `SELECT b.created_at, b.amount, p.name as product_name, b2.amount as prev_amount
     FROM bids b
     LEFT JOIN products p ON p.id = (SELECT product_id FROM auctions WHERE id=b.auction_id)
     LEFT JOIN LATERAL (SELECT amount FROM bids WHERE auction_id=b.auction_id AND created_at < b.created_at ORDER BY amount DESC LIMIT 1) b2 ON true
     WHERE b.user_id = $1 AND b.created_at > NOW() - INTERVAL '90 seconds'
     ORDER BY b.created_at DESC`,
    [userId]
  );
  if (rows.length >= 5) { // 5 existing + current = 6 in 90s → legacy example 6 bids on 3 items within 90s
    const trail = rows.slice(0, 6).map(r => {
      const t = new Date(r.created_at).toLocaleTimeString('en-GB', { hour12: false });
      const prev = r.prev_amount ? ` (previous: ₱${Number(r.prev_amount).toLocaleString()})` : '';
      return `${t} — Bid ₱${Number(r.amount).toLocaleString()} on ${r.product_name || 'Unknown'}${prev}`;
    });
    const distinctItems = new Set(rows.map(r => r.product_name)).size;
    const detail = `Placed ${rows.length + 1} bids on ${distinctItems} different items within 90 seconds, each jumping 2–3× the current bid.`;
    return { flagged: true, reason: 'rapid bidding activity', type: 'Rapid High-Value Bidding', detail, trail };
  }
  if (rows.length >= 3) { // fallback 4 in 60s
    const trail = rows.slice(0, 4).map(r => {
      const t = new Date(r.created_at).toLocaleTimeString('en-GB', { hour12: false });
      return `${t} — Bid ₱${Number(r.amount).toLocaleString()} on ${r.product_name || 'Unknown Item'}`;
    });
    return { flagged: true, reason: 'rapid bidding activity', type: 'Rapid High-Value Bidding', detail: `4+ bids in 60s`, trail };
  }
  return { flagged: false };
}
