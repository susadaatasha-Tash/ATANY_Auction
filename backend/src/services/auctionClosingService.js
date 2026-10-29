// backend/src/services/auctionClosingService.js
// Single authoritative auction closing — used by cron (auctionCloser) and manual End now.
// Ensures winner rules, tie-break, idempotency, and transactional safety are identical.
import { pool } from '../db/pool.js';
import { ensureDirectPgAvailable, acquireTxClient, ServiceUnavailableError } from '../db/dbGuard.js';
import { clearAuction } from './auctionPresence.js';
import { deadlineFrom, getEligibleRankedBidders } from './winnerRules.js';

/**
 * Close a single auction transactionally, determine winner, create order once.
 * @param {string} auctionId
 * @param {{ client?: any }} opts — if client provided, caller manages transaction; else service creates one.
 * @returns {{ alreadyEnded: boolean, winnerId: string|null, orderId: string|null, auctionRow: any }}
 */
export async function closeSingleAuction(auctionId, { client: externalClient } = {}) {
  // Strong consistency requires direct pg — verified on demand so a stale
  // fallback flag never blocks a recovered database (still fails closed).
  try {
    await ensureDirectPgAvailable('auctionClose');
  } catch {
    throw new ServiceUnavailableError('AUCTION_OPERATION_UNAVAILABLE: direct DB required for closing', 'DB_UNAVAILABLE');
  }

  const ownsTransaction = !externalClient;
  // Dedicated fresh direct client when the shared pool is saturated — real
  // transaction, never REST. Throws DB_UNAVAILABLE only if pg is unreachable.
  const tx = externalClient ? null : await acquireTxClient('auctionClose');
  const client = externalClient || tx.client;
  if (client?.__restFallback) throw new ServiceUnavailableError('AUCTION_OPERATION_UNAVAILABLE: REST fallback cannot close auction', 'DB_UNAVAILABLE');

  let committed = false;
  try {
    if (ownsTransaction) await client.query('BEGIN');
    // Atomic claim (paused excluded by caller SELECT; keep paused_at untouched here)
    const claimed = await client.query(
      "UPDATE auctions SET status = 'ended' WHERE id = $1 AND status != 'ended' RETURNING *",
      [auctionId]
    );
    const alreadyEnded = (claimed.rowCount ?? claimed.rows?.length ?? 0) === 0;
    if (alreadyEnded) {
      if (ownsTransaction) await client.query('ROLLBACK');
      // Fetch current row for idempotent return
      const { rows: existingAuctions } = await pool.query('SELECT * FROM auctions WHERE id=$1', [auctionId]);
      return { alreadyEnded: true, winnerId: null, orderId: null, auctionRow: existingAuctions[0] || null };
    }
    const auctionRow = claimed.rows[0];
    // Winner: highest eligible DISTINCT bid. The eligibility rule is the shared
    // one in services/winnerRules.js — deliberately the SAME helper the fallback
    // rotation uses, so the two can never diverge.
    const rankedBids = await getEligibleRankedBidders(auctionId, client);
    const top = rankedBids[0] || null;
    let winnerId = top ? String(top.user_id) : null;
    let winningAmount = top ? top.amount : null;
    let orderId = null;
    if (top) {
      const { rows: existingOrders } = await client.query('SELECT id FROM orders WHERE auction_id=$1', [auctionId]);
      if (existingOrders.length) {
        orderId = existingOrders[0].id;
      } else {
        // Resolve branch via product→shop→home_branch
        let branchId = null;
        try {
          const { rows: ap } = await client.query('SELECT product_id FROM auctions WHERE id=$1', [auctionId]);
          const pid = ap[0]?.product_id;
          if (pid) {
            const { rows: ps } = await client.query('SELECT shop_id FROM products WHERE id=$1', [pid]);
            const sid = ps[0]?.shop_id;
            if (sid) {
              const { rows: sb } = await client.query('SELECT home_branch_id FROM shops WHERE id=$1', [sid]);
              branchId = sb[0]?.home_branch_id || null;
            }
          }
        } catch {}
        try {
          // Winner #1 gets an EXPLICIT, stored payment window. The frontend
          // renders orders.payment_deadline; nothing derives +7 days in React.
          const confirmedAt = new Date();
          const deadline = deadlineFrom(confirmedAt);
          const res = await client.query(
            `INSERT INTO orders (auction_id, buyer_id, amount, branch_id, status,
                                 winner_confirmed_at, payment_deadline, winner_rank)
             VALUES ($1,$2,$3,$4,'pending',$5,$6,1) RETURNING id`,
            [auctionId, top.user_id, top.amount, branchId,
              confirmedAt.toISOString(), deadline.toISOString()]
          );
          orderId = res.rows[0]?.id || null;
        } catch (insErr) {
          if (insErr.code === '23505') {
            const { rows: existing } = await client.query('SELECT id FROM orders WHERE auction_id=$1', [auctionId]);
            orderId = existing[0]?.id || null;
          } else throw insErr;
        }
      }
    }
    if (ownsTransaction) {
      await client.query('COMMIT');
      committed = true;
    }
    // Auction is ended: drop live-viewer presence (broadcasts watcherCount 0).
    try { clearAuction(auctionId); } catch {}
    return { alreadyEnded: false, winnerId, winningAmount, orderId, auctionRow };
  } catch (e) {
    if (ownsTransaction && !committed) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    throw e;
  } finally {
    if (ownsTransaction) {
      if (tx) tx.release();
      else { try { client.release(); } catch {} }
    }
  }
}
