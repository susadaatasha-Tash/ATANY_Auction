// backend/src/services/bidLogic.js
// Shared business logic — NOT inside route handlers (per requested structure).
// Spec 5.1: SERIALIZABLE transaction + row locking. Spec 4.1: min increment server-side.
// Priority 1 / H4: enforce live auction time window inside the same locked transaction.
import { pool } from '../db/pool.js';
import { acquireTxClient } from '../db/dbGuard.js';
import { checkFraud } from './fraudCheck.js';

// Fallback increment for legacy rows predating migration 031 (or NULLs).
// Authoritative value always comes from auctions.minimum_bid_increment.
export const DEFAULT_MIN_INCREMENT = 1000;
// Money policy: integer pesos (same as start_price/current_bid/amount).
export const MAX_BID_AMOUNT = 2147483647;

function bidError(message, code, fields = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, fields);
  return err;
}

/** Shared increment validation (create + relist + bid paths use the same rule). */
export function validateBidIncrement(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(n)) {
    return { ok: false, code: 'INVALID_BID_INCREMENT', message: 'Enter a valid minimum bid increment.' };
  }
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, code: 'INVALID_BID_INCREMENT', message: 'Minimum bid increment must be greater than zero.' };
  }
  if (n > MAX_BID_AMOUNT) {
    return { ok: false, code: 'INVALID_BID_INCREMENT', message: 'Minimum bid increment is too large.' };
  }
  return { ok: true, value: n };
}

/** Shared bid-amount validation (integer pesos, DB-safe). */
export function validateBidAmount(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(n)) {
    return { ok: false, code: 'INVALID_BID', message: 'Enter a valid bid amount.' };
  }
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, code: 'INVALID_BID', message: 'Bid amount must be greater than zero.' };
  }
  if (n > MAX_BID_AMOUNT) {
    return { ok: false, code: 'INVALID_BID', message: 'Bid amount is too large.' };
  }
  return { ok: true, value: n };
}

/**
 * Minimum accepted bid = current authoritative highest + increment.
 * Rule: submitted >= minimum (NOT exact, NOT a multiple).
 * First-bid rule (PRESERVED): current_bid starts at start_price, so the first
 * bid must be >= start_price + increment.
 */
export function minimumNextBid(currentBid, increment) {
  return Number(currentBid || 0) + Number(increment || DEFAULT_MIN_INCREMENT);
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
  // Acquire a transaction-capable DIRECT client: shared pool when healthy,
  // otherwise one dedicated fresh client (same SERIALIZABLE + FOR UPDATE
  // guarantees, never REST). A stale cached directOk=false or a saturated
  // pool must not permanently report "temporarily unavailable" while pg is
  // actually reachable. Throws ServiceUnavailableError only if truly down.
  const tx = await acquireTxClient('placeBid');
  const client = tx.client;
  const releaseTx = tx.release;
  try {
    // Priority 1 / H2 fail-closed: SERIALIZABLE + FOR UPDATE require direct pg.
    // REST fallback cannot guarantee bid atomicity — reject rather than weaken.
    if (client?.__restFallback) {
      throw bidError('Bidding is temporarily unavailable', 'BIDDING_UNAVAILABLE');
    }
    // Malformed amounts fail before touching the transaction.
    const amountCheck = validateBidAmount(amount);
    if (!amountCheck.ok) throw bidError(amountCheck.message, amountCheck.code);

    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    // minimum_bid_increment requires migration 031; on a pre-migration DB
    // fall back to the legacy platform default rather than breaking bidding.
    let rows;
    try {
      ({ rows } = await client.query(
        'SELECT current_bid, status, start_time, end_time, minimum_bid_increment FROM auctions WHERE id = $1 FOR UPDATE',
        [auctionId]
      ));
    } catch (e) {
      if (e?.code !== '42703') throw e;
      ({ rows } = await client.query(
        'SELECT current_bid, status, start_time, end_time FROM auctions WHERE id = $1 FOR UPDATE',
        [auctionId]
      ));
    }
    if (!rows.length) throw bidError('Auction not found', 'AUCTION_NOT_FOUND');

    // H4: live window check inside the locked transaction
    const windowCheck = validateAuctionBidWindow(rows[0], now);
    if (!windowCheck.ok) throw bidError(windowCheck.message, windowCheck.code);

    // Authoritative increment from DB (legacy/NULL → platform default).
    // Recalculated INSIDE the lock: a concurrent higher bid raises the
    // minimum before we compare, so stale frontend minimums cannot slip in.
    const increment = Number(rows[0].minimum_bid_increment) > 0
      ? Number(rows[0].minimum_bid_increment)
      : DEFAULT_MIN_INCREMENT;
    const currentBid = Number(rows[0].current_bid);
    const minimum = minimumNextBid(currentBid, increment);
    if (amountCheck.value < minimum) {
      throw bidError(
        `Your bid is too low. The minimum next bid is ₱${minimum.toLocaleString()}.`,
        'BID_TOO_LOW',
        { current_bid: currentBid, minimum_bid_increment: increment, minimum_bid: minimum }
      );
    }
    amount = amountCheck.value;

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
    releaseTx();
  }
}
