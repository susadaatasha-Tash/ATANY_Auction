// backend/src/services/paymentReminder.js
// Problem 4A: payment reminders before the 7-day deadline (3 days, 1 day, 6 hours remaining).
// Runs every minute via node-cron (registered in backend/src/index.js), same pattern as
// auctionStarter / winnerExpiration. Backend/database is the source of truth.
//
// Deadline source of truth (same as winnerExpiration + order/payment display controllers):
//   payment_deadline OR (winner_confirmed_at || created_at) + 7 days
// Only pending, unpaid orders whose deadline has NOT passed are reminded.
// Recipient is always the CURRENT order buyer (buyer_id can rotate on reassignment).
// One notification max per order per stage — enforced by distinctive natural-language
// markers checked against existing rows (no schema change).

import { pool } from '../db/pool.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// Cron runs ~every minute; 60-minute windows guarantee the tick is caught
// even if the process restarts or a tick is delayed, without spamming.
const WINDOW_MS = 60 * 60 * 1000;

const STAGES = [
  {
    key: '3D',
    // fires when deadline is between 3 days and (3 days - 60min) away
    inWindow: (msLeft) => msLeft <= 3 * DAY_MS && msLeft > 3 * DAY_MS - WINDOW_MS,
    marker: 'due in 3 days',
    subject: (product, deadlineStr) =>
      `Your payment for "${product}" is due in 3 days. Please complete your payment by ${deadlineStr}.`,
  },
  {
    key: '1D',
    inWindow: (msLeft) => msLeft <= 1 * DAY_MS && msLeft > 1 * DAY_MS - WINDOW_MS,
    marker: 'due tomorrow',
    subject: (product, deadlineStr) =>
      `Reminder: your payment for "${product}" is due tomorrow, ${deadlineStr}. Please complete your payment.`,
  },
  {
    key: '6H',
    inWindow: (msLeft) => msLeft <= 6 * HOUR_MS && msLeft > 6 * HOUR_MS - WINDOW_MS,
    marker: 'about 6 hours',
    subject: (product, deadlineStr) =>
      `Your payment deadline for "${product}" is in about 6 hours. Please complete payment by ${deadlineStr}.`,
  },
];

function deadlineFor(order) {
  if (order.payment_deadline) return new Date(order.payment_deadline);
  const base = order.winner_confirmed_at || order.created_at;
  if (!base) return null;
  return new Date(new Date(base).getTime() + 7 * DAY_MS);
}

export async function sendPaymentReminders() {
  let pendingOrders = [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at ASC LIMIT 500`
    );
    pendingOrders = rows;
  } catch (e) {
    console.error('[paymentReminder] failed to load pending orders:', e.message);
    return;
  }
  if (!pendingOrders.length) return;

  for (const order of pendingOrders) {
    try {
      if (!order.buyer_id) continue;
      const deadline = deadlineFor(order);
      if (!deadline || isNaN(deadline.getTime())) continue;
      const msLeft = deadline.getTime() - Date.now();
      if (msLeft <= 0) continue; // expired — winnerExpiration owns this, not reminders

      // Skip paid orders (payment success is handled by webhook/polling notifications)
      const { rows: paid } = await pool.query(
        `SELECT id FROM payments WHERE order_id = $1 AND status = 'paid' LIMIT 1`,
        [order.id]
      );
      if (paid.length) continue;

      const stage = STAGES.find((s) => s.inWindow(msLeft));
      if (!stage) continue;

      // Per-order identity: transaction_code when available, else short order id
      const orderRef = order.transaction_code || String(order.id).slice(0, 8);
      // Idempotency: same order + same stage marker already sent?
      const { rows: existing } = await pool.query(
        `SELECT id FROM notifications WHERE user_id = $1 AND message LIKE $2 AND message LIKE $3 LIMIT 1`,
        [order.buyer_id, `%${orderRef}%`, `%${stage.marker}%`]
      );
      if (existing.length) continue;

      // Product name for a clear message (best-effort; never blocks the reminder)
      let productName = 'your jewelry';
      try {
        const { rows: aucRows } = await pool.query(`SELECT product_id FROM auctions WHERE id = $1`, [order.auction_id]);
        if (aucRows[0]?.product_id) {
          const { rows: prodRows } = await pool.query(`SELECT name FROM products WHERE id = $1`, [aucRows[0].product_id]);
          if (prodRows[0]?.name) productName = prodRows[0].name;
        }
      } catch {}
      const deadlineStr = deadline.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
      const msg = `${stage.subject(productName, deadlineStr)} (Order ${orderRef}.)`;

      const { shouldDeliverNotification } = await import('./notificationPreference.js');
      if (!(await shouldDeliverNotification(order.buyer_id, 'payout', msg))) continue;
      // Store auction_id when the column exists (42703 fallback); message wording unchanged.
      try {
        await pool.query(`INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1, 'payout', $2, $3)`, [order.buyer_id, msg, order.auction_id || null]);
      } catch (insErr) {
        if (insErr.code !== '42703') throw insErr;
        await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1, 'payout', $2)`, [order.buyer_id, msg]);
      }
      console.log(`[paymentReminder] ${stage.key} reminder sent to ${order.buyer_id} for order ${order.id}`);
    } catch (e) {
      // One failed order must not prevent other orders from being processed
      console.error('[paymentReminder] failed for order', order.id, e.message);
    }
  }
}
