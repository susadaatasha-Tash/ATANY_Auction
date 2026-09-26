// backend/src/services/bidLogic.js
// Shared business logic — NOT inside route handlers (per requested structure).
// Spec 5.1: SERIALIZABLE transaction + row locking. Spec 4.1: min increment server-side.
import { pool } from '../db/pool.js';
import { checkFraud } from './fraudCheck.js';

const MIN_INCREMENT = 1000;

export async function placeBid({ auctionId, userId, amount }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const { rows } = await client.query('SELECT current_bid FROM auctions WHERE id = $1 FOR UPDATE', [auctionId]);
    if (!rows.length) throw new Error('Auction not found');
    const currentBid = Number(rows[0].current_bid);
    if (amount < currentBid + MIN_INCREMENT) throw new Error(`Bid must be at least ₱${currentBid + MIN_INCREMENT}`);

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
    // Duplicate guard is keyed to this exact outbid event (auction + new bid amount)
    // so legitimate later outbids at higher amounts still notify. Message wording unchanged.
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
          // notifications.auction_id column absent: fall back to legacy unguarded insert
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
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
