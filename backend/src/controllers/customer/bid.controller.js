// backend/src/controllers/customer/bid.controller.js
// Route handler — thin, delegates to services/bidLogic.js (per structure rule)
import { placeBid } from '../../services/bidLogic.js';
import { effectiveStatus } from '../../services/auctionService.js';
import { pool } from '../../db/pool.js';

export async function placeBidController(req, res) {
  try {
    const { auctionId, amount } = req.body;
    const userId = req.user.id;
    // Account status guard — a suspended account must not be able to bid.
    // (Admin can suspend users via Admin → Users; status lives in public.users.)
    try {
      const { rows: statusRows } = await pool.query('SELECT status FROM public.users WHERE id = $1', [userId]);
      const accountStatus = String(statusRows[0]?.status || '').toLowerCase();
      if (accountStatus === 'suspended') {
        return res.status(403).json({
          code: 'ACCOUNT_SUSPENDED',
          message: 'Your account is suspended and cannot place bids. Contact support for help.',
        });
      }
    } catch (statusErr) {
      // Lookup failure must not silently allow a suspended account to bid —
      // fail closed with a safe message instead.
      console.error('[bid] account status check failed:', statusErr.message);
      return res.status(503).json({ code: 'ACCOUNT_STATUS_UNAVAILABLE', message: 'Unable to verify account status. Please try again.' });
    }
    const result = await placeBid({ auctionId, userId, amount });
    // Emit to auction room only — clients in watchlist/live grid subscribed via join:auction
    req.io?.to(`auction:${auctionId}`).emit('bid:update', { auctionId, currentBid: amount, flagged: result.flagged });
    req.io?.emit('bid:update', { auctionId, currentBid: amount }); // fallback global for dashboards
    res.json(result);
  } catch (e) {
    const code = e.code || null;
    // H4 business errors → 409; validation/unavailable → 400
    const status = code === 'AUCTION_NOT_LIVE' || code === 'AUCTION_NOT_FOUND' ? 409 : 400;
    const body = { message: e.message, code };
    // Include structured bid-minimum data for BID_TOO_LOW so frontend can show helpful message
    if (code === 'BID_TOO_LOW' && e.extra) {
      body.current_bid = e.extra.current_bid;
      body.minimum_bid_increment = e.extra.minimum_bid_increment;
      body.minimum_bid = e.extra.minimum_bid;
    }
    res.status(status).json(body);
  }
}

// My Bids — the authenticated customer's own participation history.
//
// One row per AUCTION the customer has bid on (not one row per bid), enriched
// with the real product / branch data, the authoritative current bid, the total
// bid count, the current leader and the authoritative order / winner state.
//
// Security: the customer id always comes from req.user.id (the verified JWT
// subject) — a body/query user_id is never accepted.
//
// Performance: 5 fixed queries, no N+1 (the previous version ran one COUNT
// query per auction).
//
// The status vocabulary is unchanged (winning | outbid | won | lost) so the
// customer Dashboard keeps working without changes.
export const listBids = async (req, res) => {
  const userId = req.user.id;
  try {
    // 1. The customer's own bids, aggregated per auction.
    const { rows: mine } = await pool.query(
      `SELECT auction_id,
              MAX(amount) FILTER (WHERE flagged = false OR flagged IS NULL) AS best_bid,
              MAX(amount) AS max_bid,
              COUNT(*)::int AS my_bid_count,
              BOOL_OR(COALESCE(flagged, false)) AS any_flagged,
              MAX(created_at) AS last_bid_at
         FROM bids
        WHERE user_id = $1
        GROUP BY auction_id`,
      [userId]
    );
    if (!mine.length) return res.json([]);
    const auctionIds = mine.map((m) => m.auction_id);

    // 2. Auctions + product + shop + branch + the authoritative order in one
    //    JOIN (a LATERAL pick keeps one order row per auction).
    const { rows: auctions } = await pool.query(
      `SELECT a.id, a.auction_code, a.status, a.start_time, a.end_time, a.current_bid,
              a.minimum_bid_increment, a.start_price,
              p.id AS product_id, p.name AS item, p.category, p.karat_weight, p.image_url AS img,
              s.home_branch_id AS branch_id, b.name AS branch_name,
              o.id AS order_id, o.buyer_id AS order_buyer_id, o.status AS order_status,
              o.transaction_code, o.winner_rank
         FROM auctions a
         LEFT JOIN products p ON p.id = a.product_id
         LEFT JOIN shops s ON s.id = p.shop_id
         LEFT JOIN branches b ON b.id = s.home_branch_id
         LEFT JOIN LATERAL (
           SELECT id, buyer_id, status, transaction_code, winner_rank
             FROM orders WHERE auction_id = a.id
            ORDER BY created_at DESC LIMIT 1
         ) o ON true
        WHERE a.id = ANY($1::uuid[])`,
      [auctionIds]
    );
    if (!auctions.length) return res.json([]);

    // 3. Total bid count + the current leader per auction in ONE query.
    //    The leader rule is the SAME rule the auction closer uses (highest
    //    amount, earliest bid wins a tie, flagged bids excluded).
    const { rows: stats } = await pool.query(
      `WITH counts AS (
         SELECT auction_id, COUNT(*)::int AS total_bids
           FROM bids WHERE auction_id = ANY($1::uuid[])
          GROUP BY auction_id
       ), leaders AS (
         SELECT DISTINCT ON (auction_id) auction_id, user_id
           FROM bids
          WHERE auction_id = ANY($1::uuid[]) AND (flagged = false OR flagged IS NULL)
          ORDER BY auction_id, amount DESC, created_at ASC
       )
       SELECT c.auction_id, c.total_bids, l.user_id AS leader_user_id
         FROM counts c LEFT JOIN leaders l ON l.auction_id = c.auction_id`,
      [auctionIds]
    );
    const statMap = Object.fromEntries(
      stats.map((s) => [s.auction_id, { total: s.total_bids || 0, leader: s.leader_user_id }])
    );

    const myBids = Object.fromEntries(mine.map((m) => [m.auction_id, m]));

    const rows = auctions.map((a) => {
      const m = myBids[a.id] || {};
      const stat = statMap[a.id] || { total: 0, leader: null };
      const auctionStatus = effectiveStatus(a.start_time, a.end_time, a.status);
      const isEnded = auctionStatus === 'ended';
      const isLeading = stat.leader === userId;
      // The effective customer bid: the highest unflagged bid (the bid that can
      // still win). Falls back to the highest bid when every bid was flagged.
      const yourBid = Number(m.best_bid ?? m.max_bid ?? 0) || 0;
      // Won = the customer is the order's buyer AND the order is still valid
      // (an expired order lost the win to the next eligible bidder).
      const won = !!(a.order_id && String(a.order_buyer_id) === String(userId) && a.order_status !== 'expired');
      let status;
      if (isEnded) status = won ? 'won' : 'lost';
      else status = isLeading ? 'winning' : 'outbid';

      return {
        id: a.id,
        auction_id: a.id,
        auction_code: a.auction_code,
        item: a.item,
        category: a.category,
        karat_weight: a.karat_weight,
        img: a.img,
        branch_id: a.branch_id || null,
        branch_name: a.branch_name || null,
        auction_status: auctionStatus,
        stored_status: a.status,
        start_time: a.start_time,
        end_time: a.end_time,
        minimum_bid_increment: a.minimum_bid_increment,
        yourBid,
        currentBid: a.current_bid,
        bidsCount: stat.total,
        total_bids: stat.total,
        my_bid_count: m.my_bid_count || 0,
        is_leading: isLeading,
        flagged: !!m.any_flagged,
        status,
        won,
        order_id: a.order_id || null,
        order_status: a.order_status || null,
        transaction_code: a.transaction_code || null,
        created_at: m.last_bid_at || null,
      };
    });

    // Newest participation first, live auctions before ended ones.
    rows.sort((a, b) => {
      const aEnded = a.auction_status === 'ended' ? 1 : 0;
      const bEnded = b.auction_status === 'ended' ? 1 : 0;
      if (aEnded !== bEnded) return aEnded - bEnded;
      const ae = a.end_time ? new Date(a.end_time).getTime() : 0;
      const be = b.end_time ? new Date(b.end_time).getTime() : 0;
      if (ae !== be) return ae - be;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

    res.json(rows);
  } catch (e) {
    console.error('[customer/bids:list]', e.message);
    res.status(500).json({ message: 'Failed to load your bids' });
  }
};
