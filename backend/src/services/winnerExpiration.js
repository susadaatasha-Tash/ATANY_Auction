// backend/src/services/winnerExpiration.js
// Problem 1: 7-day payment rule — winner eligibility, payment deadline, expiration, next-bidder
// This service is the backend/database source of truth for the 7-day rule.
// It does NOT rely on frontend timers, localStorage, or browser state.

import { pool } from '../db/pool.js';

// Helper: Check if an order's payment is paid (via payments table)
async function isOrderPaid(orderId, client = pool) {
  const { rows } = await client.query(
    `SELECT status FROM payments WHERE order_id = $1 AND status = 'paid' LIMIT 1`,
    [orderId]
  );
  return rows.length > 0;
}

// Helper: Get ranked valid bidders for an auction (highest amount first, earliest first on tie)
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
  if (order.payment_deadline) return new Date(order.payment_deadline);
  const base = order.winner_confirmed_at || order.created_at;
  return new Date(new Date(base).getTime() + 7 * 24 * 60 * 60 * 1000);
}

export async function checkAndExpireWinners() {
  // Find all pending orders where the 7-day deadline has passed and payment not paid
  // SELECT * so payment_deadline/winner_confirmed_at/winner_rank are used when migration 021 is applied,
  // and safely ignored (undefined) when it is not.
  const { rows: pendingOrders } = await pool.query(
    `SELECT * FROM orders WHERE status = 'pending'`
  );

  for (const order of pendingOrders) {
    const paymentDeadline = deadlineFor(order);

    // Check if deadline has passed
    if (new Date() < paymentDeadline) {
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
    try {
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
      if (new Date() < lockedDeadline) {
        await client.query('ROLLBACK');
        continue;
      }
      // Re-check payment status within transaction
      const { rows: paidCheck } = await client.query(`SELECT status FROM payments WHERE order_id = $1 AND status = 'paid' LIMIT 1`, [order.id]);
      if (paidCheck.length) {
        await client.query('ROLLBACK');
        continue;
      }

      if (nextBidder) {
        // CRITICAL: buyer_id = nextBidder.user_id (NOT amount), amount = nextBidder.amount
        // Persist winner_confirmed_at/payment_deadline/winner_rank when migration 021 columns exist
        // so display (order/payment controllers) and expiration share one deadline; fall back to
        // the legacy created_at-only update when the columns are absent.
        const nextRank = Number(lockedOrder.winner_rank ?? order.winner_rank ?? 1) + 1;
        const confirmedAt = new Date();
        const nextDeadline = new Date(confirmedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        try {
          await client.query(
            `UPDATE orders SET buyer_id = $1, amount = $2, created_at = NOW(), winner_confirmed_at = $3, payment_deadline = $4, winner_rank = $5 WHERE id = $6 AND status = 'pending' AND buyer_id = $7`,
            [nextBidder.user_id, nextBidder.amount, confirmedAt.toISOString(), nextDeadline.toISOString(), nextRank, order.id, order.buyer_id]
          );
        } catch (e) {
          // Fallback when migration 021 columns are absent (undefined column) — legacy behavior
          if (e.code !== '42703') throw e;
          await client.query(
            `UPDATE orders SET buyer_id = $1, amount = $2, created_at = NOW() WHERE id = $3 AND status = 'pending' AND buyer_id = $4`,
            [nextBidder.user_id, nextBidder.amount, order.id, order.buyer_id]
          );
        }
        // Verify the update actually affected a row (prevents duplicate reassignment)
        const { rows: verify } = await client.query(`SELECT buyer_id FROM orders WHERE id = $1`, [order.id]);
        if (String(verify[0]?.buyer_id) !== String(nextBidder.user_id)) {
          await client.query('ROLLBACK');
          continue;
        }

        // Also need to handle the case where orders table doesn't have updated_at, fallback to just created_at
        // If updated_at doesn't exist, the above will fail, so try without it
        // We do a separate check: if the update failed due to missing column, try again without updated_at
        // For now, we assume created_at is sufficient

        // Create a notification for the new eligible winner (for future Problems 2/4).
        // Stores auction_id when the column exists (42703 fallback); message wording unchanged.
        const newDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        try {
          try {
            await client.query(
              `INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1, 'auction', $2, $3)`,
              [nextBidder.user_id, `You are now the eligible winner for auction ${order.auction_id}. Please complete payment by ${newDeadline.toLocaleDateString()} (7 days).`, order.auction_id]
            );
          } catch (insErr) {
            if (insErr.code !== '42703') throw insErr;
            await client.query(
              `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'auction', $2)`,
              [nextBidder.user_id, `You are now the eligible winner for auction ${order.auction_id}. Please complete payment by ${newDeadline.toLocaleDateString()} (7 days).`]
            );
          }
        } catch (notifErr) {
          console.warn('[winnerExpiration] Failed to create notification for next bidder', notifErr.message);
        }

        // Optionally, notify the expired winner that their eligibility has expired
        try {
          try {
            await client.query(
              `INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1, 'auction', $2, $3)`,
              [order.buyer_id, `Your payment eligibility for auction ${order.auction_id} has expired. The item has been offered to the next bidder.`, order.auction_id]
            );
          } catch (insErr) {
            if (insErr.code !== '42703') throw insErr;
            await client.query(
              `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'auction', $2)`,
              [order.buyer_id, `Your payment eligibility for auction ${order.auction_id} has expired. The item has been offered to the next bidder.`]
            );
          }
        } catch {}

        // Problem 4B: seller + admin notifications for the NEW current winner.
        // Inside the TX so a rollback discards them — never notifies for a failed transition.
        // Guard is keyed to recipient + order ref + current winner name, so A→B and B→C
        // each produce exactly one notice and cron re-runs cannot duplicate them.
        try {
          const txRef = order.transaction_code || String(order.id).slice(0, 8);
          const { rows: wUserRows } = await client.query(`SELECT name FROM users WHERE id=$1`, [nextBidder.user_id]);
          const newWinnerName = wUserRows[0]?.name || 'A customer';
          const { rows: aucProdRows } = await client.query(`SELECT product_id FROM auctions WHERE id=$1`, [order.auction_id]);
          const reassignProductId = aucProdRows[0]?.product_id;
          let reassignProdName = 'your jewelry';
          let reassignShopId = null;
          if (reassignProductId) {
            const { rows: pr } = await client.query(`SELECT name, shop_id FROM products WHERE id=$1`, [reassignProductId]);
            if (pr[0]?.name) reassignProdName = pr[0].name;
            reassignShopId = pr[0]?.shop_id || null;
          }
          let reassignSellerId = null;
          let reassignShopName = null;
          if (reassignShopId) {
            const { rows: sh } = await client.query(`SELECT user_id, shop_name FROM shops WHERE id=$1`, [reassignShopId]);
            reassignSellerId = sh[0]?.user_id || null;
            reassignShopName = sh[0]?.shop_name || null;
          }
          const { shouldDeliverNotification: shouldDeliver4B } = await import('./notificationPreference.js');
          const insert4B = async (uid, msg) => {
            try {
              await client.query("INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1, 'auction', $2, $3)", [uid, msg, order.auction_id]);
            } catch (e) {
              if (e.code !== '42703') throw e;
              await client.query("INSERT INTO notifications (user_id, type, message) VALUES ($1, 'auction', $2)", [uid, msg]);
            }
          };
          const sellerMsg = `🏆 Your auction for "${reassignProdName}" has a new winner: ${newWinnerName} with a winning bid of ₱${Number(nextBidder.amount).toLocaleString()}. Order ${txRef}. Status: Awaiting Payment. The winner has 7 days to complete payment. [Seller Winner Notice ${txRef} — ${newWinnerName}]`;
          const adminMsg = `🏆 Auction winner updated: "${reassignProdName}" — ${newWinnerName} is now the winner with ₱${Number(nextBidder.amount).toLocaleString()}. Order ${txRef}. Shop: ${reassignShopName || 'Unknown shop'}. Status: Awaiting Payment. [Admin Winner Notice ${txRef} — ${newWinnerName}]`;
          // Seller (skip when the shop has no owner; never throws)
          if (reassignSellerId) {
            try {
              const { rows: dupS } = await client.query(
                `SELECT id FROM notifications WHERE user_id=$1 AND message LIKE $2 AND message LIKE $3 AND message LIKE $4 LIMIT 1`,
                [reassignSellerId, `%${txRef}%`, `%Seller Winner Notice%`, `%${newWinnerName}%`]
              );
              if (!dupS.length && await shouldDeliver4B(reassignSellerId, 'auction', sellerMsg)) {
                await insert4B(reassignSellerId, sellerMsg);
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
                if (!dupA.length && await shouldDeliver4B(adm.id, 'auction', adminMsg)) {
                  await insert4B(adm.id, adminMsg);
                }
              } catch (e) { console.warn('[4B] admin reassignment notification failed', order.id, e.message); }
            }
          } catch (e) { console.warn('[4B] admin lookup failed', order.id, e.message); }
        } catch (e) { console.warn('[4B] seller/admin reassignment notifications failed', order.id, e.message); }

        console.log(`[winnerExpiration] Reassigned auction ${order.auction_id} from ${order.buyer_id} to ${nextBidder.user_id} (rank ${currentWinnerIndex + 2})`);
      } else {
        // No more eligible bidders: mark order as expired (or keep pending but with no buyer?)
        // We will set status to 'expired' if that value exists, otherwise keep as pending but log
        // Try to set to 'expired', fallback to keeping pending
        try {
          await client.query(`UPDATE orders SET status = 'expired' WHERE id = $1`, [order.id]);
          console.log(`[winnerExpiration] No more bidders for auction ${order.auction_id}, marked order ${order.id} as expired`);
        } catch (e) {
          // If 'expired' enum value doesn't exist, just log and keep pending
          console.warn(`[winnerExpiration] Could not mark as expired (enum missing), keeping pending for ${order.id}:`, e.message);
          // As fallback, we could delete the order or keep it pending - for now keep pending
        }

        // Notify the expired buyer — idempotent: skip if already notified recently
        // (when the 'expired' enum is absent the order stays pending and this branch re-runs each minute)
        try {
          const { rows: recent } = await client.query(
            `SELECT id FROM notifications WHERE user_id = $1 AND message LIKE $2 AND created_at > NOW() - INTERVAL '1 day' LIMIT 1`,
            [order.buyer_id, `%${order.auction_id}%no more eligible bidders%`]
          );
          if (!recent.length) {
            try {
              await client.query(
                `INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1, 'auction', $2, $3)`,
                [order.buyer_id, `Your payment eligibility for auction ${order.auction_id} has expired and there are no more eligible bidders.`, order.auction_id]
              );
            } catch (insErr) {
              if (insErr.code !== '42703') throw insErr;
              await client.query(
                `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'auction', $2)`,
                [order.buyer_id, `Your payment eligibility for auction ${order.auction_id} has expired and there are no more eligible bidders.`]
              );
            }
          }
        } catch {}
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`[winnerExpiration] Failed to process expiration for order ${order.id}:`, e.message);
    } finally {
      client.release();
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
          `UPDATE orders SET buyer_id = $1, amount = $2, created_at = NOW(), winner_confirmed_at = $3, payment_deadline = $4, winner_rank = $5 WHERE id = $6`,
          [nextBidder.user_id, nextBidder.amount, confirmedAt.toISOString(), nextDeadline.toISOString(), Number(order.winner_rank ?? 1) + 1, order.id]
        );
      } catch (e) {
        if (e.code !== '42703') throw e;
        await client.query(`UPDATE orders SET buyer_id = $1, amount = $2, created_at = NOW() WHERE id = $3`, [nextBidder.user_id, nextBidder.amount, order.id]);
      }
      try {
        await client.query(`INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1, 'auction', $2, $3)`, [nextBidder.user_id, `You are now the eligible winner.`, order.auction_id]);
      } catch (insErr) {
        if (insErr.code !== '42703') throw insErr;
        await client.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1, 'auction', $2)`, [nextBidder.user_id, `You are now the eligible winner.`]);
      }
      await client.query('COMMIT');
      return { reassignedTo: nextBidder.user_id, rank: currentWinnerIndex + 2 };
    } else {
      await client.query(`UPDATE orders SET status = 'expired' WHERE id = $1`, [order.id]);
      await client.query('COMMIT');
      return { expired: true };
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
