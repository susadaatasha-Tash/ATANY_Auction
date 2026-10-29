// backend/src/services/paymentRaceGuard.js
// Priority 1 / H3: prevent stale winner checkouts from marking reassigned orders paid.
// Re-reads authoritative order state immediately before any paid transition.
//
// ALSO: the single serialization point between "money arrived" and "the winner
// changed". services/winnerExpiration.js holds `SELECT … FOR UPDATE` on the
// order row while it rotates an expired winner; every path that commits
// payments.status='paid' now takes that SAME row lock here, so the two can never
// interleave:
//   payment locks first -> paid; expiration later sees paid and does NOT rotate
//   expiration locks first -> order rotates; the old winner's payment is refused
//                           as a stale assignment instead of becoming evidence
//                           for the new winner.
import { pool, isDirectPg } from '../db/pool.js';

/** Only 'pending' orders are payable. Fulfillment statuses are not. */
export const PAYABLE_ORDER_STATUSES = ['pending'];

/** Payment rows that may still be claimed as paid. */
export const CLAIMABLE_PAYMENT_STATUSES = ['pending', 'processing', 'failed', 'expired', 'cancelled'];

/**
 * Pure validation — no DB.
 * @param {{ payment: object, order: object|null }} input
 */
export function isPaymentStillValid({ payment, order }) {
  if (!payment || !order) return { ok: false, reason: 'MISSING_RECORD' };
  if (String(payment.order_id) !== String(order.id)) {
    return { ok: false, reason: 'PAYMENT_ORDER_MISMATCH' };
  }
  if (String(payment.customer_id) !== String(order.buyer_id)) {
    return { ok: false, reason: 'BUYER_MISMATCH' };
  }
  const status = String(order.status || '').toLowerCase();
  if (!PAYABLE_ORDER_STATUSES.includes(status)) {
    return { ok: false, reason: 'ORDER_NOT_PAYABLE' };
  }
  return { ok: true, order };
}

export async function loadOrderForPayment(orderId) {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id=$1', [orderId]);
  return rows[0] || null;
}

/**
 * Load current order and validate payment still belongs to current buyer + is payable.
 * @returns {Promise<{ok:boolean, reason?:string, order?:object}>}
 */
export async function assertPaymentStillPayable(payment) {
  const order = await loadOrderForPayment(payment?.order_id);
  return isPaymentStillValid({ payment, order });
}

/**
 * Flag a stale/orphaned payment without touching the reassigned order.
 * payment_status enum: pending|processing|paid|failed|cancelled|expired → use 'cancelled'.
 * Never silently transfer old-winner payment to new winner.
 */
export async function markStalePayment(payment, { reason = 'STALE_PAYMENT', eventType = null } = {}) {
  const metadata = {
    stale_payment: true,
    anomaly: reason,
    webhook_type: eventType,
    handled_at: new Date().toISOString(),
  };
  try {
    await pool.query(
      `UPDATE payments SET status='cancelled', updated_at=now(), metadata=$1 WHERE id=$2 AND status <> 'paid'`,
      [JSON.stringify(metadata), payment.id]
    );
  } catch (e) {
    console.error('[payment-race] failed to mark stale payment', payment?.id, e.message);
  }
  console.error(
    `[payment-race] STALE_PAYMENT ${reason} payment=${payment?.id} order=${payment?.order_id} customer=${payment?.customer_id}`
  );
  return { ok: false, reason, payment_id: payment?.id };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ordered settlement — the ONLY place that turns a payment 'paid'.
 *
 * Every caller (PayMongo webhook, checkout polling/reconciliation, counter
 * payment, admin mark-paid) routes through this so they all serialize on the
 * order row against winnerExpiration:
 *   payment locks first  -> paid; expiration later sees paid and does NOT rotate
 *   expiration locks first -> order rotates; the old winner's payment is refused
 *                            as a stale assignment instead of becoming evidence
 *                            for the new winner.
 * It never partially commits: any failure rolls back.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * @param {object} input
 * @param {string} input.paymentId      payment row to settle
 * @param {string} input.orderId        order the payment belongs to
 * @param {string} input.customerId     payer; must still own the order
 * @param {object} [input.metadata]     merged into payments.metadata
 * @param {string} [input.eventType]    provenance (webhook / checkout_sync / counter / admin)
 * @param {string} [input.amount]       authoritative amount for a manual claim
 * @param {string} [input.paymentMethod]
 * @param {object} [input.client]       injected transaction client (tests)
 * @param {{ enforceWindow?: boolean }} [opts]
 *        enforceWindow — reject when the winner's 7-day window has already
 *        elapsed. True for counter/admin money. False for a gateway payment the
 *        provider already captured: there the row lock decides ownership and we
 *        record the anomaly rather than discarding captured money.
 * @returns {Promise<{ok:boolean, reason?:string, paymentId?:string}>}
 */
export async function settlePaidPaymentWithOrderLock(input, opts = {}) {
  const {
    paymentId, orderId, customerId, metadata = null,
    eventType = null, amount = null, paymentMethod = null, client: external = null,
  } = input || {};
  const enforceWindow = opts.enforceWindow === true;

  const ownsClient = !external;
  let client = external;
  if (!client) {
    let direct = true;
    try { direct = typeof isDirectPg === 'function' ? !!isDirectPg() : true; } catch { direct = false; }
    if (!direct) return { ok: false, reason: 'DB_UNAVAILABLE' };
    client = await pool.connect();
    if (client?.__restFallback) {
      client.release();
      return { ok: false, reason: 'DB_UNAVAILABLE' };
    }
  }

  try {
    await client.query('BEGIN');

    // The order row lock — the exact row services/winnerExpiration.js locks.
    const { rows: orders } = await client.query(
      `SELECT id, buyer_id, amount, status, payment_deadline FROM public.orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = orders[0];
    if (!order) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'MISSING_RECORD' };
    }

    // Settlement must not re-settle money another path already settled.
    const { rows: already } = await client.query(
      `SELECT id, status FROM public.payments WHERE order_id = $1 AND status = 'paid' LIMIT 1`,
      [orderId]
    );

    // A rotated-away winner can never attach their payment to the new holder.
    if (customerId && String(order.buyer_id) !== String(customerId)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'BUYER_MISMATCH', buyerId: order.buyer_id };
    }

    const orderStatus = String(order.status || '').toLowerCase();
    if (orderStatus !== 'pending') {
      if (already.length && orderStatus === 'expired') {
        // Money already proven for this order: report it, never double-settle.
        await client.query('ROLLBACK');
        return { ok: true, reason: 'ALREADY_PAID', paymentId: already[0].id };
      }
      await client.query('ROLLBACK');
      return { ok: false, reason: 'ORDER_NOT_PAYABLE', status: order.status };
    }

    // 7-day window gate.
    let pastWindow = false;
    try {
      const { isPastDeadline } = await import('./winnerRules.js');
      pastWindow = isPastDeadline(order);
    } catch { pastWindow = false; }
    if (enforceWindow && pastWindow) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'PAYMENT_WINDOW_EXPIRED', deadline: order.payment_deadline };
    }

    const { rows: claimed } = await client.query(
      `UPDATE public.payments
          SET status = 'paid',
              paid_at = COALESCE(paid_at, NOW()),
              updated_at = NOW(),
              amount = COALESCE($1, amount),
              payment_method = COALESCE($2, payment_method),
              metadata = metadata || $3::jsonb
        WHERE id = $4 AND status IN ('pending','processing','failed','expired','cancelled')
        RETURNING id`,
      [
        amount, paymentMethod,
        JSON.stringify({ ...(metadata || {}), event_type: eventType, settled_with_order_lock: true }),
        paymentId,
      ]
    );

    if (!claimed.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'PAYMENT_NOT_CLAIMABLE' };
    }
    // Captured after the window closed but the lock still belonged to this
    // buyer: keep the money (it is real), flag it for reconciliation.
    if (pastWindow) {
      try {
        await client.query(
          `UPDATE public.payments SET metadata = metadata || '{"payment_after_window":true}'::jsonb WHERE id = $1`,
          [paymentId]
        );
      } catch { /* flag is best-effort */ }
    }

    await client.query('COMMIT');
    return { ok: true, paymentId: claimed[0].id, paymentAfterWindow: pastWindow };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    return { ok: false, reason: 'SETTLEMENT_FAILED', error: e.message };
  } finally {
    if (ownsClient) client.release();
  }
}

export default {
  PAYABLE_ORDER_STATUSES,
  CLAIMABLE_PAYMENT_STATUSES,
  isPaymentStillValid,
  loadOrderForPayment,
  assertPaymentStillPayable,
  markStalePayment,
  settlePaidPaymentWithOrderLock,
};
