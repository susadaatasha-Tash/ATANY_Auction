// backend/src/services/winnerExpiration.js
// Problem 1: 7-day payment rule — winner eligibility, payment deadline, expiration, next-bidder
// This service is the backend/database source of truth for the 7-day rule.
// It does NOT rely on frontend timers, localStorage, or browser state.
//
// The verified fallback mechanics (preserved):
//   • bids are ranked by amount DESC (created_at ASC breaks ties)
//   • one entry per USER (their own highest bid) → the next DISTINCT bidder
//   • the SAME order row is rotated (buyer_id, amount, fresh deadline, rank+1)
//   • historical bids are never touched
//   • a previous winner can never re-enter the ranking (the selection always
//     moves forward in the ranked list)

import { pool, isDirectPg } from '../db/pool.js';
import { requireDirectPg } from '../db/dbGuard.js';
import { sendNotificationEmail } from './emailService.js';
import {
  resolveDeadline, formatDeadline, buildExpiredWinnerMessage, buildFallbackWinnerMessage,
  buildNoBiddersMessage, buildSellerNoBiddersMessage, buildSellerWinnerMessage,
  buildAdminWinnerMessage, MARKERS, peso, DEADLINE_DAYS,
} from './winnerNotificationService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CANDIDATE_BATCH = 100;

// Helper: Check if an order's payment is paid (via payments table)
async function isOrderPaid(orderId, client = pool) {
  const { rows } = await client.query(
    `SELECT status FROM payments WHERE order_id = $1 AND status = 'paid' LIMIT 1`,
    [orderId]
  );
  return rows.length > 0;
}

// Helper: Get ranked valid bidders for an auction (highest amount first, earliest first on tie)
// Exclude flagged bids as invalid per fraud check
async function getRankedBidders(auctionId, client = pool) {
  // Fetch all bids for the auction, ordered by amount DESC, created_at ASC (to break ties by earliest)
  // Exclude flagged bids as invalid per fraud check
  const { rows: bids } = await client.query(
    `SELECT user_id, amount, created_at FROM bids WHERE auction_id = $1 AND (flagged = false OR flagged IS NULL) ORDER BY amount DESC, created_at ASC`,
    [auctionId]
  );
  // Deduplicate by user_id, keeping highest amount per user (since a user may have multiple bids, keep highest)
  const seen = new Map();
  for (const bid of bids) {
    if (!seen.has(bid.user_id)) {
      seen.set(bid.user_id, bid);
    }
  }
  return Array.from(seen.values());
}

// Single source of truth for the 7-day deadline — mirrors
// order.controller.js / payment.controller.js display logic:
// stored payment_deadline wins, else (winner_confirmed_at || created_at) + 7 days.
// When migration 021 columns are absent/null, this falls back to created_at + 7 days.
function deadlineFor(order) {
  return resolveDeadline(order);
}

/** Load the item context (product name, auction code, shop owner) for one auction. */
async function loadItemContext(auctionId, client = pool) {
  const ctx = { productName: null, auctionCode: null, sellerId: null, shopName: null, branchName: null };
  try {
    const { rows: aucRows } = await client.query('SELECT auction_code, product_id FROM auctions WHERE id=$1', [auctionId]);
    if (!aucRows[0]) return ctx;
    ctx.auctionCode = aucRows[0].auction_code || null;
    const { rows: prodRows } = await client.query('SELECT name, shop_id FROM products WHERE id=$1', [aucRows[0].product_id]);
    ctx.productName = prodRows[0]?.name || null;
    const shopId = prodRows[0]?.shop_id;
    if (shopId) {
      const { rows: shopRows } = await client.query('SELECT user_id, shop_name, home_branch_id FROM shops WHERE id=$1', [shopId]);
      ctx.sellerId = shopRows[0]?.user_id || null;
      ctx.shopName = shopRows[0]?.shop_name || null;
      if (shopRows[0]?.home_branch_id) {
        const { rows: brRows } = await client.query('SELECT name FROM branches WHERE id=$1', [shopRows[0].home_branch_id]);
        ctx.branchName = brRows[0]?.name || null;
      }
    }
  } catch { /* context is best-effort — never breaks the flow */ }
  return ctx;
}

/** Insert a notification row, tolerating a missing auction_id column (42703). */
async function insertNotification(client, { userId, message, auctionId }) {
  try {
    await client.query(
      `INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1, 'auction', $2, $3)`,
      [userId, message, auctionId || null]
    );
  } catch (insErr) {
    if (insErr.code !== '42703') throw insErr;
    await client.query(
      `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'auction', $2)`,
      [userId, message]
    );
  }
}

/** Has this exact notice already been delivered? (deterministic dedup marker) */
async function noticeExists(client, { userId, marker }) {
  const { rows } = await client.query(
    `SELECT id FROM notifications WHERE user_id = $1 AND message LIKE $2 LIMIT 1`,
    [userId, `%${marker}%`]
  );
  return rows.length > 0;
}

export async function checkAndExpireWinners() {
  // H2: winner reassignment is a money path (buyer_id/amount/payment_deadline).
  // Requires FOR UPDATE + multi-statement transaction → fail closed on REST fallback.
  let direct = true;
  try { direct = typeof isDirectPg === 'function' ? !!isDirectPg() : true; } catch { direct = false; }
  if (!direct) {
    console.warn('[winnerExpiration] skipping — direct Postgres unavailable (fail closed)');
    return { skipped: true, reason: 'DB_UNAVAILABLE' };
  }
  // Find the pending orders whose 7-day deadline has already passed.
  // The COALESCE keeps the legacy rows (no stored payment_deadline) working:
  //   payment_deadline → winner_confirmed_at + 7d → created_at + 7d
  // Batched (LIMIT) so a large backlog never floods the pool; the deterministic
  // ORDER BY means the oldest deadline is always handled first.
  const { rows: pendingOrders } = await pool.query(
    `SELECT * FROM orders
      WHERE status = 'pending'
        AND COALESCE(
              payment_deadline,
              (winner_confirmed_at + INTERVAL '${DEADLINE_DAYS} days'),
              (created_at + INTERVAL '${DEADLINE_DAYS} days')
            ) <= NOW()
      ORDER BY COALESCE(
              payment_deadline,
              (winner_confirmed_at + INTERVAL '${DEADLINE_DAYS} days'),
              (created_at + INTERVAL '${DEADLINE_DAYS} days')
             ) ASC
      LIMIT ${CANDIDATE_BATCH}`
  );

  for (const order of pendingOrders) {
    const paymentDeadline = deadlineFor(order);

    // Check if deadline has passed
    if (!paymentDeadline || new Date() < paymentDeadline) {
      continue; // Still within 7-day window
    }

    // Initial check before acquiring lock (fast path)
    const paidBeforeLock = await isOrderPaid(order.id);
    if (paidBeforeLock) {
      continue; // Already paid, don't expire
    }

    console.log(`[winnerExpiration] Order ${order.id} for auction ${order.auction_id} has expired (deadline ${paymentDeadline.toISOString()}, winner ${order.buyer_id})`);

    // Find next eligible bidder (outside transaction, as it's read-only and not critical to lock)
    const rankedBidders = await getRankedBidders(order.auction_id);
    const currentWinnerIndex = rankedBidders.findIndex(b => String(b.user_id) === String(order.buyer_id));

    let nextBidder = null;
    if (currentWinnerIndex !== -1 && currentWinnerIndex + 1 < rankedBidders.length) {
      nextBidder = rankedBidders[currentWinnerIndex + 1];
    } else if (currentWinnerIndex === -1 && rankedBidders.length > 0) {
      nextBidder = rankedBidders[0];
    }

    const client = await pool.connect();
    // Emails are sent AFTER the commit (never inside the transaction).
    let postCommitEmails = [];
    let committed = false;
    try {
      if (client?.__restFallback) {
        console.warn('[winnerExpiration] skipping order', order.id, '— REST fallback (fail closed)');
        continue;
      }
      await client.query('BEGIN');
      // Lock the order row for update to prevent concurrent expiration
      const { rows: lockedOrders } = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [order.id]);
      if (!lockedOrders.length) {
        await client.query('ROLLBACK');
        continue;
      }
      const lockedOrder = lockedOrders[0];
      // Re-check within transaction: still pending, still expired, still not paid, still same buyer (not already reassigned)
      if (lockedOrder.status !== 'pending') {
        await client.query('ROLLBACK');
        continue;
      }
      if (String(lockedOrder.buyer_id) !== String(order.buyer_id)) {
        await client.query('ROLLBACK');
        continue; // Already reassigned by another process
      }
      const lockedDeadline = deadlineFor(lockedOrder);
      if (!lockedDeadline || new Date() < lockedDeadline) {
        await client.query('ROLLBACK');
        continue;
      }
      // Re-check payment status within transaction
      const { rows: paidCheck } = await client.query(`SELECT status FROM payments WHERE order_id = $1 AND status = 'paid' LIMIT 1`, [order.id]);
      if (paidCheck.length) {
        await client.query('ROLLBACK');
        continue;
      }

      const item = await loadItemContext(order.auction_id, client);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5174';
      const paymentUrl = `${frontendUrl}/customer/purchases`;
      const supportUrl = `${frontendUrl}/customer/messages`;

      if (nextBidder) {
        // CRITICAL: buyer_id = nextBidder.user_id (NOT amount), amount = nextBidder.amount
        // Persist winner_confirmed_at/payment_deadline/winner_rank when migration 021 columns exist
        // so display (order/payment controllers) and expiration share one deadline; fall back to
        // the legacy created_at-only update when the columns are absent.
        const nextRank = Number(lockedOrder.winner_rank ?? order.winner_rank ?? 1) + 1;
        const confirmedAt = new Date();
        const nextDeadline = new Date(confirmedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        // NOTE: created_at is set from a JS timestamp param (not NOW()) because the
        // Supabase REST fallback only translates col=$N / col='literal' assignments
        // and silently drops NOW()/expression assignments — the fresh 7-day deadline
        // depends on created_at being reset at rotation time.
        try {
          await client.query(
            `UPDATE orders SET buyer_id = $1, amount = $2, created_at = $3, winner_confirmed_at = $4, payment_deadline = $5, winner_rank = $6 WHERE id = $7 AND status = 'pending' AND buyer_id = $8`,
            [nextBidder.user_id, nextBidder.amount, confirmedAt.toISOString(), confirmedAt.toISOString(), nextDeadline.toISOString(), nextRank, order.id, order.buyer_id]
          );
        } catch (e) {
          // Fallback when migration 021 columns are absent (undefined column) — legacy behavior
          const missingColumn = e.code === '42703'
            || /Could not find the '(payment_deadline|winner_confirmed_at|winner_rank)' column/i.test(e.message || '');
          if (!missingColumn) throw e;
          await client.query(
            `UPDATE orders SET buyer_id = $1, amount = $2, created_at = $3 WHERE id = $4 AND status = 'pending' AND buyer_id = $5`,
            [nextBidder.user_id, nextBidder.amount, confirmedAt.toISOString(), order.id, order.buyer_id]
          );
        }
        // Verify the update actually affected a row (prevents duplicate reassignment)
        const { rows: verify } = await client.query(`SELECT buyer_id FROM orders WHERE id = $1`, [order.id]);
        if (String(verify[0]?.buyer_id) !== String(nextBidder.user_id)) {
          await client.query('ROLLBACK');
          continue;
        }

        // ── the new winner ──────────────────────────────────────
        // The message carries the NEW winner's OWN amount (the rotated order
        // amount = nextBidder.amount) and their OWN fresh deadline.
        const newWinnerMarker = MARKERS.fallbackWinner(order, nextBidder.user_id, nextRank);
        const fallbackMessage = `${buildFallbackWinnerMessage({
          product: item.productName,
          amount: nextBidder.amount,
          order: { id: order.id, transaction_code: order.transaction_code },
          deadline: nextDeadline,
          paymentUrl,
        })} [${newWinnerMarker}]`;
        try {
          if (!(await noticeExists(client, { userId: nextBidder.user_id, marker: newWinnerMarker }))) {
            await insertNotification(client, {
              userId: nextBidder.user_id,
              message: fallbackMessage,
              auctionId: order.auction_id,
            });
          }
        } catch (notifErr) {
          console.warn('[winnerExpiration] Failed to create notification for next bidder', notifErr.message);
        }

        // ── the expired winner ───────────────────────────────────
        // Privacy: the previous winner is NEVER told who the next bidder is.
        const expiredMarker = MARKERS.winnerExpired(order, order.buyer_id, nextRank - 1);
        const expiredMessage = `${buildExpiredWinnerMessage({
          product: item.productName,
          amount: order.amount,
          order: { id: order.id, transaction_code: order.transaction_code },
          deadline: paymentDeadline,
          supportUrl,
        })} [${expiredMarker}]`;
        try {
          if (!(await noticeExists(client, { userId: order.buyer_id, marker: expiredMarker }))) {
            await insertNotification(client, {
              userId: order.buyer_id,
              message: expiredMessage,
              auctionId: order.auction_id,
            });
          }
        } catch {}

        // Email for the expired winner (sent after the commit; a failure never
        // rolls the reassignment back).
        try {
          const { rows: oldUserRows } = await client.query('SELECT email FROM users WHERE id=$1', [order.buyer_id]);
          if (oldUserRows[0]?.email) {
            postCommitEmails.push({
              to: oldUserRows[0].email,
              subject: `ATANY: Your payment period for "${item.productName || 'your lot'}" has expired`,
              html: `
                <div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif; color:#1a1a1a; max-width:600px;">
                  <h2 style="color:#7a2e2e;">Your ATANY payment period has expired</h2>
                  <p><strong>Item:</strong> ${item.productName || 'your ATANY lot'}</p>
                  <p><strong>Winning amount:</strong> ${peso(order.amount)}</p>
                  <p><strong>Order:</strong> ${order.transaction_code || order.id.slice(0, 8).toUpperCase()}</p>
                  <p><strong>Payment deadline:</strong> ${formatDeadline(paymentDeadline)}</p>
                  <p>Your payment window has ended and the item has been offered to the next eligible bidder.</p>
                  <p>If you have questions about this auction, please contact ATANY Support: <a href="${supportUrl}" style="color:#0f3d2e; font-weight:600;">${supportUrl}</a>.</p>
                </div>
              `,
            });
          }
        } catch (e) {
          console.warn('[winnerExpiration] expired-winner email lookup failed', order.id, e.message);
        }

        // Problem 4B: seller + admin notifications for the NEW current winner.
        // Inside the TX so a rollback discards them — never notifies for a failed transition.
        // Guard is keyed to recipient + order ref + current winner name, so A→B and B→C
        // each produce exactly one notice and cron re-runs cannot duplicate them.
        try {
          const { rows: wUserRows } = await client.query(`SELECT name, email FROM users WHERE id=$1`, [nextBidder.user_id]);
          const newWinnerName = wUserRows[0]?.name || 'A customer';
          const newWinnerEmail = wUserRows[0]?.email || null;
          const txRef = order.transaction_code || String(order.id).slice(0, 8);
          const sellerMsg = `${buildSellerWinnerMessage({
            product: item.productName, winnerName: newWinnerName, amount: nextBidder.amount,
            order: { id: order.id, transaction_code: order.transaction_code },
            auctionCode: item.auctionCode, changed: true,
          })} [${MARKERS.sellerWinner(order, newWinnerName)}]`;
          const adminMsg = `${buildAdminWinnerMessage({
            product: item.productName, winnerName: newWinnerName, amount: nextBidder.amount,
            order: { id: order.id, transaction_code: order.transaction_code },
            shopName: item.shopName || 'Unknown shop', changed: true,
          })} [${MARKERS.adminWinner(order, newWinnerName)}]`;
          // Seller (skip when the shop has no owner; never throws)
          if (item.sellerId) {
            try {
              const { rows: dupS } = await client.query(
                `SELECT id FROM notifications WHERE user_id=$1 AND message LIKE $2 AND message LIKE $3 AND message LIKE $4 LIMIT 1`,
                [item.sellerId, `%${txRef}%`, `%Seller Winner Notice%`, `%${newWinnerName}%`]
              );
              if (!dupS.length) {
                await insertNotification(client, { userId: item.sellerId, message: sellerMsg, auctionId: order.auction_id });
              }
            } catch (e) { console.warn('[4B] seller reassignment notification failed', order.id, e.message); }
          }
          // Admins individually (one failure never blocks the others)
          try {
            const { rows: admins } = await client.query(`SELECT id FROM users WHERE role='admin' LIMIT 5`);
            for (const adm of admins) {
              try {
                const { rows: dupA } = await client.query(
                  `SELECT id FROM notifications WHERE user_id=$1 AND message LIKE $2 AND message LIKE $3 AND message LIKE $4 LIMIT 1`,
                  [adm.id, `%${txRef}%`, `%Admin Winner Notice%`, `%${newWinnerName}%`]
                );
                if (!dupA.length) {
                  await insertNotification(client, { userId: adm.id, message: adminMsg, auctionId: order.auction_id });
                }
              } catch (e) { console.warn('[4B] admin reassignment notification failed', order.id, e.message); }
            }
          } catch (e) { console.warn('[4B] admin lookup failed', order.id, e.message); }

          // Emails are collected here but SENT after the commit.
          if (newWinnerEmail) {
            postCommitEmails.push({
              to: newWinnerEmail,
              subject: `ATANY: You are now the winning bidder for "${item.productName || 'your lot'}"`,
              html: `
                <div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif; color:#1a1a1a; max-width:600px;">
                  <h2 style="color:#0f3d2e;">You are now the winning bidder 🎉</h2>
                  <p>The previous winning claim for <strong>${item.productName || 'your ATANY lot'}</strong> expired and the item has been offered to you based on your highest eligible bid.</p>
                  <p><strong>Your winning amount:</strong> ₱${Number(nextBidder.amount).toLocaleString()}</p>
                  <p><strong>Order:</strong> ${order.transaction_code || order.id.slice(0, 8).toUpperCase()}</p>
                  <p><strong>Payment deadline:</strong> ${formatDeadline(nextDeadline)}</p>
                  <p>You have a fresh 7-day period to complete payment. Please complete payment before pickup via your purchases page: <a href="${paymentUrl}" style="color:#0f3d2e; font-weight:600;">${paymentUrl}</a>.</p>
                  ${item.branchName ? `<p><strong>Pickup branch:</strong> ${item.branchName}</p>` : ''}
                </div>
              `,
            });
          }
        } catch (e) { console.warn('[4B] seller/admin reassignment notifications failed', order.id, e.message); }

        console.log(`[winnerExpiration] Reassigned auction ${order.auction_id} from ${order.buyer_id} to ${nextBidder.user_id} (rank ${currentWinnerIndex + 2})`);
      } else {
        // No more eligible bidders: the order expires permanently.
        try {
          await client.query(`UPDATE orders SET status = 'expired' WHERE id = $1`, [order.id]);
          console.log(`[winnerExpiration] No more bidders for auction ${order.auction_id}, marked order ${order.id} as expired`);
        } catch (e) {
          // If 'expired' enum value doesn't exist, just log and keep pending
          console.warn(`[winnerExpiration] Could not mark as expired (enum missing), keeping pending for ${order.id}:`, e.message);
        }

        // Notify the expired buyer — idempotent via a deterministic marker.
        const noBidderMarker = MARKERS.noBiddersLeft(order, order.buyer_id);
        const noBidderMessage = `${buildNoBiddersMessage({
          product: item.productName,
          order: { id: order.id, transaction_code: order.transaction_code },
          supportUrl,
        })} [${noBidderMarker}]`;
        try {
          if (!(await noticeExists(client, { userId: order.buyer_id, marker: noBidderMarker }))) {
            await insertNotification(client, {
              userId: order.buyer_id,
              message: noBidderMessage,
              auctionId: order.auction_id,
            });
          }
        } catch {}

        // The SELLER must know that the final eligible winner expired.
        try {
          const sellerMarker = MARKERS.sellerNoBidders(order);
          if (item.sellerId && !(await noticeExists(client, { userId: item.sellerId, marker: sellerMarker }))) {
            await insertNotification(client, {
              userId: item.sellerId,
              message: `${buildSellerNoBiddersMessage({
                product: item.productName,
                order: { id: order.id, transaction_code: order.transaction_code },
                auctionCode: item.auctionCode,
              })} [${sellerMarker}]`,
              auctionId: order.auction_id,
            });
          }
          // Admins may also see the terminal state (same notification system).
          const { rows: admins } = await client.query(`SELECT id FROM users WHERE role='admin' LIMIT 5`);
          for (const adm of admins) {
            if (await noticeExists(client, { userId: adm.id, marker: sellerMarker })) continue;
            await insertNotification(client, {
              userId: adm.id,
              message: `${buildSellerNoBiddersMessage({
                product: item.productName,
                order: { id: order.id, transaction_code: order.transaction_code },
                auctionCode: item.auctionCode,
              })} [${sellerMarker}]`,
              auctionId: order.auction_id,
            });
          }
        } catch (e) { console.warn('[winnerExpiration] seller no-bidder notice failed', order.id, e.message); }
      }

      await client.query('COMMIT');
      committed = true;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`[winnerExpiration] Failed to process expiration for order ${order.id}:`, e.message);
    } finally {
      client.release();
    }

    // ── post-commit emails (never inside the transaction) ──────
    if (committed) {
      for (const mail of postCommitEmails) {
        try {
          await sendNotificationEmail(mail);
        } catch (e) {
          console.warn('[winnerExpiration] winner email failed (reassignment stays valid):', e.message);
        }
      }
    }
  }
}

// For testing: allow manual trigger with auctionId
export async function expireSpecificOrder(orderId) {
  const { rows } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  if (!rows.length) throw new Error('Order not found');
  const order = rows[0];
  const paid = await isOrderPaid(order.id);
  if (paid) throw new Error('Order already paid, cannot expire');

  const rankedBidders = await getRankedBidders(order.auction_id);
  const currentWinnerIndex = rankedBidders.findIndex(b => String(b.user_id) === String(order.buyer_id));
  let nextBidder = null;
  if (currentWinnerIndex !== -1 && currentWinnerIndex + 1 < rankedBidders.length) {
    nextBidder = rankedBidders[currentWinnerIndex + 1];
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (nextBidder) {
      const confirmedAt = new Date();
      const nextDeadline = new Date(confirmedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      try {
        await client.query(
          `UPDATE orders SET buyer_id = $1, amount = $2, created_at = $3, winner_confirmed_at = $4, payment_deadline = $5, winner_rank = $6 WHERE id = $7`,
          [nextBidder.user_id, nextBidder.amount, confirmedAt.toISOString(), confirmedAt.toISOString(), nextDeadline.toISOString(), Number(order.winner_rank ?? 1) + 1, order.id]
        );
      } catch (e) {
        const missingColumn = e.code === '42703'
          || /Could not find the '(payment_deadline|winner_confirmed_at|winner_rank)' column/i.test(e.message || '');
        if (!missingColumn) throw e;
        await client.query(`UPDATE orders SET buyer_id = $1, amount = $2, created_at = $3 WHERE id = $4`, [nextBidder.user_id, nextBidder.amount, confirmedAt.toISOString(), order.id]);
      }
      const item = await loadItemContext(order.auction_id, client);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5174';
      const paymentUrl = `${frontendUrl}/customer/purchases`;
      const nextRank = Number(order.winner_rank ?? 1) + 1;
      const marker = MARKERS.fallbackWinner(order, nextBidder.user_id, nextRank);
      const message = `${buildFallbackWinnerMessage({
        product: item.productName,
        amount: nextBidder.amount,
        order: { id: order.id, transaction_code: order.transaction_code },
        deadline: nextDeadline,
        paymentUrl,
      })} [${marker}]`;
      try {
        await insertNotification(client, { userId: nextBidder.user_id, message, auctionId: order.auction_id });
      } catch (insErr) {
        if (insErr.code !== '42703') throw insErr;
        await client.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1, 'auction', $2)`, [nextBidder.user_id, message]);
      }
      await client.query('COMMIT');
      return { reassignedTo: nextBidder.user_id, amount: nextBidder.amount, rank: nextRank, deadline: nextDeadline.toISOString() };
    }
    await client.query(`UPDATE orders SET status = 'expired' WHERE id = $1`, [order.id]);
    await client.query('COMMIT');
    return { expired: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
