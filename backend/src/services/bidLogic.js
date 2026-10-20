// backend/src/services/bidLogic.js
// Shared business logic — NOT inside route handlers (per requested structure).
// Spec 5.1: SERIALIZABLE transaction + row locking. Spec 4.1: min increment server-side.
// Priority 1 / H4: enforce live auction time window inside the same locked transaction.
// Minimum bid increment is per-auction (stored in auctions.minimum_bid_increment),
// not a global constant.
import { pool } from '../db/pool.js';
import { checkFraud } from './fraudCheck.js';

function bidError(message, code, extra) {
  const err = new Error(message);
  err.code = code;
  if (extra) err.extra = extra;
  return err;
}

/**
 * Validate auction can accept bids using DB timestamps (source of truth).
 * Does NOT rely on cron-updated status alone.
 * @returns {{ok:true}|{ok:false, code:string, message:string}}
 */
export function validateAuctionBidWindow(auction, now = new Date()) {
  if (!auction) return { ok: false, code: 'AUCTION_NOT_FOUND', message: 'Auction not found' };
  const status = String(auction.status || '').toLowerCase();
  if (status === 'ended' || status === 'cancelled' || status === 'canceled' || status === 'paused') {
    return { ok: false, code: status === 'paused' ? 'AUCTION_PAUSED' : 'AUCTION_NOT_LIVE', message: status === 'paused' ? 'Auction is paused' : 'Auction is not live' };
  }
  const start = auction.start_time ? new Date(auction.start_time) : null;
  const end = auction.end_time ? new Date(auction.end_time) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, code: 'AUCTION_NOT_LIVE', message: 'Auction is not live' };
  }
  if (now.getTime() < start.getTime()) {
    return { ok: false, code: 'AUCTION_NOT_LIVE', message: 'Auction has not started' };
  }
  if (now.getTime() >= end.getTime()) {
    return { ok: false, code: 'AUCTION_NOT_LIVE', message: 'Auction has ended' };
  }
  // Window open: allow even if status lags 'scheduled' (cron lag). Time is authoritative.
  return { ok: true };
}

export async function placeBid({ auctionId, userId, amount, now = new Date() }) {
  const client = await pool.connect();
  try {
    // Priority 1 / H2 fail-closed: SERIALIZABLE + FOR UPDATE require direct pg.
    // REST fallback cannot guarantee bid atomicity — reject rather than weaken.
    if (client?.__restFallback) {
      throw bidError('Bidding is temporarily unavailable', 'BIDDING_UNAVAILABLE');
    }
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const { rows } = await client.query(
      'SELECT current_bid, status, start_time, end_time, minimum_bid_increment FROM auctions WHERE id = $1 FOR UPDATE',
      [auctionId]
    );
    if (!rows.length) throw bidError('Auction not found', 'AUCTION_NOT_FOUND');

    // H4: live window check inside the locked transaction
    const windowCheck = validateAuctionBidWindow(rows[0], now);
    if (!windowCheck.ok) throw bidError(windowCheck.message, windowCheck.code);

    const currentBid = Number(rows[0].current_bid);
    const minIncrement = Number(rows[0].minimum_bid_increment) || 1000;
    const minimumNextBid = currentBid + minIncrement;
    if (amount < minimumNextBid) {
      throw bidError(
        `Bid must be at least ₱${minimumNextBid.toLocaleString()}`,
        'BID_TOO_LOW',
        { current_bid: currentBid, minimum_bid_increment: minIncrement, minimum_bid: minimumNextBid }
      );
    }

    await client.query('UPDATE auctions SET current_bid = $1 WHERE id = $2', [amount, auctionId]);
    const bidRes = await client.query(
      'INSERT INTO bids (auction_id, user_id, amount) VALUES ($1,$2,$3) RETURNING *',
      [auctionId, userId, amount]
    );

    // Spec 4.2 + 4.6: fraud check server-side (don't block bid), outbid notification to previous leader
    const fraud = await checkFraud({ client, auctionId, userId, amount, previousBid: currentBid });
    if (fraud.flagged) {
      await client.query('UPDATE bids SET flagged = true, flag_reason = $1 WHERE id = $2', [fraud.reason, bidRes.rows[0].id]);
      await client.query(
        "INSERT INTO security_alerts (user_id, type, severity, status, detail, activity_trail) VALUES ($1,$2,'high','new',$3,$4)",
        [userId, fraud.type, fraud.detail, JSON.stringify(fraud.trail)]
      );
    }
    // Notify previous highest bidder they were outbid (spec 4.6) — respect preference.
    const prev = await client.query('SELECT user_id FROM bids WHERE auction_id=$1 AND user_id != $2 ORDER BY amount DESC LIMIT 1', [auctionId, userId]);
    if (prev.rows.length) {
      const { shouldDeliverNotification } = await import('./notificationPreference.js');
      const msg = `You were outbid — new current bid is ₱${amount.toLocaleString()}.`;
      if (await shouldDeliverNotification(prev.rows[0].user_id, 'auction', msg)) {
        let outbidDup = [];
        try {
          const { rows } = await client.query(
            `SELECT id FROM notifications WHERE user_id=$1 AND auction_id=$2 AND message LIKE $3 AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1`,
            [prev.rows[0].user_id, auctionId, `%₱${amount.toLocaleString()}%`]
          );
          outbidDup = rows;
        } catch (gErr) {
          if (gErr.code !== '42703') throw gErr;
        }
        if (!outbidDup.length) {
          try {
            await client.query("INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1,'auction',$2,$3)", [prev.rows[0].user_id, msg, auctionId]);
          } catch (insErr) {
            if (insErr.code !== '42703') throw insErr;
            await client.query("INSERT INTO notifications (user_id, type, message) VALUES ($1,'auction',$2)", [prev.rows[0].user_id, msg]);
          }
        }
      }
    }

    await client.query('COMMIT');
    return { bid: bidRes.rows[0], flagged: fraud.flagged, reason: fraud.reason };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back or mock */ }
    throw e;
  } finally {
    client.release();
  }
}
