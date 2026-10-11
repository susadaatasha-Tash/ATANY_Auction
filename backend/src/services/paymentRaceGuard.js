// backend/src/services/paymentRaceGuard.js
// Priority 1 / H3: prevent stale winner checkouts from marking reassigned orders paid.
// Re-reads authoritative order state immediately before any paid transition.
import { pool } from '../db/pool.js';

/** Only 'pending' orders are payable. Fulfillment statuses are not. */
export const PAYABLE_ORDER_STATUSES = ['pending'];

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
