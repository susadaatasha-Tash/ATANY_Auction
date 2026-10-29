// backend/src/services/winnerExpiration.js
//
// THE 7-DAY WINNER FALLBACK — backend/database source of truth.
// No frontend timer, no localStorage, no browser state participates.
//
// LIFECYCLE (see services/winnerRules.js for the shared rules)
// -----------------------------------------------------------
//   auction ended -> Winner #1 (rank 1) -> 7-day window
//     · payments.status = 'paid'  -> financially secured, NEVER rotated
//     · unpaid at deadline       -> SAME order reassigned to the next eligible
//                                   DISTINCT bidder at THEIR OWN highest valid
//                                   bid (rank + 1) with a FRESH 7-day window
//     · no eligible bidder left  -> order.status = 'expired' (auction stays ended)
//
// REASSIGNMENT UPDATES THE EXISTING ORDER ROW. It never inserts a second order
// (orders_auction_id_unique) and never rewrites orders.created_at, so a fallback
// cannot move an old auction into a new reporting month.
//
// WHY THIS FILE LOOKS DIFFERENT FROM BEFORE
// -----------------------------------------
// The previous version tried a 6-column UPDATE, caught "undefined column" and
// retried a legacy UPDATE *inside the already-aborted transaction* — which
// Postgres answers with 25P02, so nothing ever committed. Schema capability is
// now verified ONCE, BEFORE any transaction opens (assertWinnerFallbackSchema);
// once it passes, exactly one correct transactional UPDATE is executed and any
// error rolls the whole thing back. There is no catch-and-retry.

import { pool, isDirectPg } from '../db/pool.js';
import {
  WINNER_PAYMENT_WINDOW_DAYS,
  deadlineFrom,
  resolveDeadline,
  getEligibleRankedBidders,
  nextEligibleBidder,
} from './winnerRules.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CANDIDATE_BATCH = 200;

/* ────────────────────────────────────────────────────────────────────────────
 * Payment truth
 * PAID := an authoritative payments row for this order with status = 'paid'.
 * orders.status is fulfillment state and is NEVER evidence that money arrived.
 * ──────────────────────────────────────────────────────────────────────────── */
export async function isOrderPaid(orderId, client = pool) {
  const { rows } = await client.query(
    `SELECT id FROM payments WHERE order_id = $1 AND status = 'paid' LIMIT 1`,
    [orderId]
  );
  return rows.length > 0;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Schema capability — checked BEFORE opening a transaction.
 * Fails closed with a loud, actionable message instead of half-applying work.
 * ──────────────────────────────────────────────────────────────────────────── */
let schemaCache = null;
export function resetSchemaCache() { schemaCache = null; }

export async function assertWinnerFallbackSchema(client = pool) {
  if (schemaCache) return schemaCache;
  const { rows: cols } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders'
        AND column_name IN ('payment_deadline','winner_confirmed_at','winner_rank')`
  );
  const have = new Set(cols.map((c) => c.column_name));
  const missing = ['payment_deadline', 'winner_confirmed_at', 'winner_rank'].filter((c) => !have.has(c));
  const { rows: enumRows } = await client.query(
    `SELECT 1 FROM pg_enum WHERE enumlabel = 'expired' AND enumtypid = 'public.order_status'::regtype`
  );
  if (missing.length || !enumRows.length) {
    const why = [
      missing.length ? `orders columns missing: ${missing.join(', ')}` : null,
      !enumRows.length ? `order_status enum value missing: 'expired'` : null,
    ].filter(Boolean).join('; ');
    const err = new Error(
      `winner-expiration schema not ready (${why}). Apply migrations: npm run migrate:sql`
    );
    err.code = 'WINNER_SCHEMA_NOT_READY';
    throw err;
  }
  schemaCache = { ok: true };
  return schemaCache;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Notifications — all inside the transaction, so a rollback discards them.
 * ──────────────────────────────────────────────────────────────────────────── */
async function insertNotification(client, { userId, message, auctionId }) {
  try {
    await client.query(
      `INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1,'auction',$2,$3)`,
      [userId, message, auctionId]
    );
  } catch (e) {
    if (e.code !== '42703') throw e; // auction_id column missing
    await client.query(
      `INSERT INTO notifications (user_id, type, message) VALUES ($1,'auction',$2)`,
      [userId, message]
    );
  }
}

const pesos = (n) => `₱${Number(n || 0).toLocaleString('en-PH')}`;

function deadlineLabel(deadline) {
  return new Date(deadline).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

async function loadItemContext(client, auctionId) {
  const { rows } = await client.query(
    `SELECT a.product_id, p.name AS product_name, p.shop_id, s.shop_name, s.user_id AS seller_id
       FROM auctions a
       LEFT JOIN products p ON p.id = a.product_id
       LEFT JOIN shops   s ON s.id = p.shop_id
      WHERE a.id = $1`,
    [auctionId]
  );
  const row = rows[0] || {};
  return {
    productId: row.product_id || null,
    productName: row.product_name || 'the item',
    shopName: row.shop_name || null,
    sellerId: row.seller_id || null,
  };
}

/**
 * Notices for a successful fallback: new winner, expired winner, seller, admins.
 * Seller/admin notices carry a stable [marker txRef — winner] tag so repeated
 * cron executions can never duplicate them.
 */
async function notifyReassignment(client, { order, auctionId, item, next, previousWinner, deadline }) {
  const when = deadlineLabel(deadline);
  const label = `[Winner Reassigned ${order.transaction_code || String(order.id).slice(0, 8)} — rank ${order.winner_rank}]`;
  const ref = order.transaction_code || String(order.id).slice(0, 8);

  await insertNotification(client, {
    userId: next.user_id,
    auctionId,
    message: `You are now the eligible winner for "${item.productName}". `
      + `Amount due: ${pesos(next.amount)}. `
      + `Pay by: ${when}. `
      + `You have ${WINNER_PAYMENT_WINDOW_DAYS} days from now to complete payment.`,
  });

  if (previousWinner && String(previousWinner) !== String(next.user_id)) {
    await insertNotification(client, {
      userId: previousWinner,
      auctionId,
      message: `Your payment eligibility for "${item.productName}" has expired. `
        + `The item has been offered to the next eligible bidder. `
        + `Your bid history for this auction is unchanged and still visible in your account.`,
    });
  }

  // Seller + admins: idempotent via a distinctive tag checked before insert.
  const targets = [];
  if (item.sellerId) targets.push(item.sellerId);
  try {
    const { rows: admins } = await client.query(`SELECT id FROM public.users WHERE role='admin' LIMIT 5`);
    for (const a of admins) targets.push(a.id);
  } catch { /* admins lookup never blocks the money path */ }

  for (const uid of targets) {
    const isSeller = String(uid) === String(item.sellerId);
    const marker = isSeller ? 'Seller Winner Notice' : 'Admin Winner Notice';
    const who = isSeller ? item.shopName || 'the shop' : 'ATANY admin';
    const message = isSeller
      ? `🏆 Winner reassigned for "${item.productName}": ${next.user_name || 'the next eligible bidder'} `
        + `is now the eligible winner at ${pesos(next.amount)}. Order ${ref}. Status: Awaiting Payment. `
        + `Pay by ${when}. [${marker} ${ref} — ${next.user_name || next.user_id}]`
      : `🏆 Winner reassigned for "${item.productName}" — ${next.user_name || 'the next eligible bidder'} `
        + `is now the eligible winner at ${pesos(next.amount)}. Order ${ref}. Shop: ${who}. `
        + `Status: Awaiting Payment. Pay by ${when}. [${marker} ${ref} — ${next.user_name || next.user_id}]`;
    try {
      const { rows: dup } = await client.query(
        `SELECT id FROM notifications
          WHERE user_id = $1 AND message LIKE $2 AND message LIKE $3 AND message LIKE $4 LIMIT 1`,
        [uid, `%${ref}%`, `%${marker}%`, `%${next.user_name || next.user_id}%`]
      );
      if (!dup.length) await insertNotification(client, { userId: uid, message, auctionId });
    } catch (e) {
      console.warn('[winnerExpiration] winner-change notice failed', order.id, e.message);
    }
  }
  return label;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The transactional core. Internal + directly unit/integration tested.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Process ONE order. Returns a result descriptor instead of throwing, so one bad
 * order can never stop the batch.
 *
 * @returns {Promise<{action:'skipped'|'paid'|'reassigned'|'expired'|'none'|'error', ...}>}
 */
export async function processOrderExpiry(orderId, { now = new Date(), client: injected = null } = {}) {
  const ownsClient = !injected;
  const client = injected || await pool.connect();
  if (client?.__restFallback) {
    console.warn('[winnerExpiration] skipping order', orderId, '— REST fallback cannot guarantee atomicity (fail closed)');
    if (ownsClient) client.release();
    return { action: 'skipped', reason: 'DB_UNAVAILABLE', orderId };
  }

  try {
    await client.query('BEGIN');

    // 1) lock the order row — the SAME row every payment path must lock
    const { rows: lockedRows } = await client.query(
      `SELECT * FROM public.orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    if (!lockedRows.length) {
      await client.query('ROLLBACK');
      return { action: 'skipped', reason: 'ORDER_NOT_FOUND', orderId };
    }
    const order = lockedRows[0];

    // 2) still the terminal-state-free, still-assigned-to-someone candidate?
    if (String(order.status) !== 'pending') {
      await client.query('ROLLBACK');
      return { action: 'skipped', reason: 'NOT_PENDING', status: order.status, orderId };
    }

    // 3) deadline really passed (re-read under the lock)
    const deadline = resolveDeadline(order);
    if (!deadline || now.getTime() < deadline.getTime()) {
      await client.query('ROLLBACK');
      return { action: 'skipped', reason: 'DEADLINE_NOT_REACHED', deadline, orderId };
    }

    // 4) payment truth, re-checked INSIDE the transaction
    if (await isOrderPaid(order.id, client)) {
      await client.query('ROLLBACK');
      return { action: 'skipped', reason: 'PAID', orderId };
    }

    const ranked = await getEligibleRankedBidders(order.auction_id, client);
    const next = nextEligibleBidder({
      ranked,
      currentBuyerId: order.buyer_id,
      winnerRank: Number(order.winner_rank || 1),
    });
    const item = await loadItemContext(client, order.auction_id);

    // 5) ONE authoritative write — reassign, or expire when the chain is spent
    if (next) {
      const confirmedAt = new Date();
      const nextDeadline = deadlineFrom(confirmedAt);
      const nextRank = (Number(order.winner_rank) || 1) + 1;
      // created_at is intentionally NOT touched: it is the auction-close stamp
      // used by revenue/reporting attribution. The new window lives in
      // winner_confirmed_at + payment_deadline.
      const { rowCount } = await client.query(
        `UPDATE public.orders
            SET buyer_id              = $1,
                amount                = $2,
                winner_confirmed_at   = $3,
                payment_deadline      = $4,
                winner_rank           = $5
          WHERE id = $6
            AND status = 'pending'
            AND buyer_id = $7
            AND (winner_rank IS NULL OR winner_rank = $8)`,
        [
          next.user_id, next.amount,
          confirmedAt.toISOString(), nextDeadline.toISOString(), nextRank,
          order.id, order.buyer_id, Number(order.winner_rank) || 1,
        ]
      );
      if (!rowCount) {
        await client.query('ROLLBACK');
        return { action: 'skipped', reason: 'GUARD_MISMATCH', orderId };
      }
    } else {
      const { rowCount } = await client.query(
        `UPDATE public.orders SET status = 'expired'
          WHERE id = $1 AND status = 'pending' AND buyer_id = $2`,
        [order.id, order.buyer_id]
      );
      if (!rowCount) {
        await client.query('ROLLBACK');
        return { action: 'skipped', reason: 'GUARD_MISMATCH', orderId };
      }
    }

    // 6) verify post-write state before any notice is written
    const { rows: after } = await client.query(
      `SELECT buyer_id, amount, status, winner_rank, winner_confirmed_at, payment_deadline
         FROM public.orders WHERE id = $1`,
      [order.id]
    );
    const written = after[0] || {};

    if (next) {
      if (String(written.buyer_id) !== String(next.user_id)
        || Number(written.winner_rank) !== (Number(order.winner_rank) || 1) + 1
        || String(written.status) !== 'pending') {
        await client.query('ROLLBACK');
        return { action: 'skipped', reason: 'VERIFY_FAILED', orderId };
      }
    } else if (String(written.status) !== 'expired') {
      await client.query('ROLLBACK');
      return { action: 'skipped', reason: 'VERIFY_FAILED', orderId };
    }

    // 7) notices — from the STORED deadline, never recomputed in prose
    let nextUserName = null;
    if (next) {
      const { rows: u } = await client.query(`SELECT name FROM public.users WHERE id=$1`, [next.user_id]);
      nextUserName = u[0]?.name || null;
    }
    if (next) {
      await notifyReassignment(client, {
        order: { ...order, winner_rank: Number(written.winner_rank) },
        auctionId: order.auction_id,
        item,
        next: { ...next, user_name: nextUserName },
        previousWinner: order.buyer_id,
        deadline: written.payment_deadline,
      });
    } else {
      // Chain exhausted. One-per-day guard so a stuck row cannot spam.
      const { rows: recent } = await client.query(
        `SELECT id FROM notifications
          WHERE user_id = $1 AND message LIKE $2 AND message LIKE $3
            AND created_at > NOW() - INTERVAL '1 day' LIMIT 1`,
        [order.buyer_id, `%${order.auction_id}%`, '%no more eligible bidders%']
      );
      if (!recent.length) {
        await insertNotification(client, {
          userId: order.buyer_id,
          auctionId: order.auction_id,
          message: `Your payment eligibility for "${item.productName}" has expired and there are no more eligible bidders. `
            + `The auction is closed and the item is no longer assigned. Your bid history is unchanged.`,
        });
      }
    }

    await client.query('COMMIT');
    if (next) {
      console.log(
        `[winnerExpiration] order ${order.id} auction ${order.auction_id}: `
        + `rank ${order.winner_rank || 1} -> ${written.winner_rank}, `
        + `buyer ${order.buyer_id} -> ${written.buyer_id} at ${written.amount}, `
        + `deadline ${new Date(written.payment_deadline).toISOString()}`
      );
      return {
        action: 'reassigned', orderId: order.id, auctionId: order.auction_id,
        from: order.buyer_id, to: written.buyer_id, amount: Number(written.amount),
        winnerRank: Number(written.winner_rank), deadline: written.payment_deadline,
      };
    }
    console.log(`[winnerExpiration] order ${order.id} auction ${order.auction_id}: no eligible bidder left — order expired`);
    return { action: 'expired', orderId: order.id, auctionId: order.auction_id, buyer: order.buyer_id };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    console.error('[winnerExpiration] failed for order', orderId, e.message);
    return { action: 'error', orderId, error: e.message };
  } finally {
    if (ownsClient) client.release();
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Cron entry point.
 * ──────────────────────────────────────────────────────────────────────────── */
export async function checkAndExpireWinners() {
  let direct = true;
  try { direct = typeof isDirectPg === 'function' ? !!isDirectPg() : true; } catch { direct = false; }
  if (!direct) {
    console.warn('[winnerExpiration] skipping — direct Postgres unavailable (fail closed)');
    return { skipped: true, reason: 'DB_UNAVAILABLE' };
  }

  // Schema capability BEFORE any transaction: no catch-and-retry inside a
  // transaction that Postgres has already aborted.
  try {
    await assertWinnerFallbackSchema();
  } catch (e) {
    console.error(`[winnerExpiration] ${e.message}`);
    return { skipped: true, reason: 'SCHEMA_NOT_READY', error: e.message };
  }

  // Index-backed candidate query: only orders that are actually due.
  const { rows: candidates } = await pool.query(
    `SELECT id FROM public.orders
      WHERE status = 'pending'
        AND payment_deadline IS NOT NULL
        AND payment_deadline <= NOW()
      ORDER BY payment_deadline ASC
      LIMIT $1`,
    [CANDIDATE_BATCH]
  );

  const summary = { scanned: candidates.length, reassigned: 0, expired: 0, skipped: 0, errors: 0 };
  for (const { id } of candidates) {
    const result = await processOrderExpiry(id);
    if (result.action === 'reassigned') summary.reassigned += 1;
    else if (result.action === 'expired') summary.expired += 1;
    else if (result.action === 'error') summary.errors += 1;
    else summary.skipped += 1;
  }
  if (summary.reassigned || summary.expired) {
    console.log(`[winnerExpiration] scanned ${summary.scanned}: ${summary.reassigned} reassigned, ${summary.expired} expired, ${summary.skipped} skipped`);
  }
  return summary;
}

/**
 * Manual trigger for ONE order.
 *
 * Deliberately NOT exposed as an HTTP route: an endpoint that expires arbitrary
 * orders is a money-path foot-gun. It exists for the integration test and for
 * operators running the service directly.
 */
export async function expireSpecificOrder(orderId) {
  await assertWinnerFallbackSchema();
  const { rows } = await pool.query(`SELECT * FROM public.orders WHERE id = $1`, [orderId]);
  if (!rows.length) throw new Error('Order not found');
  if (await isOrderPaid(orderId)) throw new Error('Order already paid, cannot expire');
  const result = await processOrderExpiry(orderId);
  if (result.action === 'error') throw new Error(result.error);
  return result;
}

export const __test = { DAY_MS, deadlineLabel, pesos };
export default checkAndExpireWinners;