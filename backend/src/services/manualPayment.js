// backend/src/services/manualPayment.js
//
// AUTHORITATIVE manual / counter payment service.
//
// WHY THIS EXISTS
// ---------------
// Money collected away from the gateway (cash at a branch counter, or an amount
// an admin confirms was received) previously had NO authoritative record:
//
//   - POST /customer/orders/:id/pay set orders.status='ready_pickup' directly.
//     No `payments` row was ever created, so:
//       * services/revenueRule.js did not recognize the sale;
//       * services/winnerExpiration.js treated it as UNPAID and could rotate the
//         lot to the next bidder — money collected, goods handed to the wrong
//         person;
//       * both fulfillment gates (admin + seller) then REFUSED the order because
//         they require a 'paid' payment row, so a genuinely paid order could not
//         be fulfilled.
//   - PATCH /admin/transactions/:id/pay did the same blind write with no payment
//     evidence and no transition validation at all.
//
// Both flows now go through this one service, so a manual payment is financially
// identical to a gateway payment: same table, same status, same evidence.
//
// INTEGRITY RULES ENFORCED HERE
// ----------------------------
//  1. Payment and fulfillment are SEPARATE state machines. Recording payment
//     never implies a fulfillment state, and a fulfillment state never implies
//     payment. `recordManualPayment()` touches ONLY `payments`.
//  2. The amount ALWAYS comes from the server-side order row, never the request.
//  3. Idempotent: a second confirmation never creates a second 'paid' row and
//     never rewrites an existing terminal payment.
//  4. No fabricated gateway identifiers. `provider_reference_id` and
//     `checkout_session_id` stay NULL — the partial unique indexes only cover
//     non-NULL values, so NULL is the correct representation of "no gateway".
//  5. An 'expired' order can never take a payment — the 7-day rule already
//     decided nobody paid. Every other state may take a back-fill, and the
//     payment always belongs to the order's current buyer.
import { pool, isDirectPg } from '../db/pool.js';
import { isPastDeadline, PAYMENT_WINDOW_EXPIRED } from './winnerRules.js';

/** provider value written for money that did not pass through a gateway. */
export const MANUAL_PROVIDER = 'counter';

/** payment_status values that may still be claimed as paid. */
export const CLAIMABLE_PAYMENT_STATUSES = ['pending', 'processing', 'failed', 'expired', 'cancelled'];

/** The one order-status transition map for the whole platform. */
export const ALLOWED_TRANSITIONS = Object.freeze({
  pending: ['preparing'],
  preparing: ['ready_pickup'],
  ready_pickup: ['completed'],
  completed: [],
});

/** Fulfillment states that must be backed by a paid payment. */
export const PAYMENT_GATED_STATUSES = Object.freeze(['preparing', 'ready_pickup', 'completed']);

// Re-exported for callers that already import from this module. The single
// definition lives in services/winnerRules.js.
export { PAYMENT_WINDOW_EXPIRED };

/**
 * Manual/counter payment admissibility.
 *
 * Deliberately BROADER than paymentRaceGuard.PAYABLE_ORDER_STATUSES, which
 * guards GATEWAY payments: a stale PayMongo checkout session can settle a lot
 * that has already been reassigned. A counter payment carries no such risk — it
 * is recorded at the moment cash changes hands and is always bound to the
 * order's CURRENT buyer, so a back-fill after fulfillment advanced is a
 * correction, not a new charge.
 *
 * The hard stops are:
 *   'expired'              — the 7-day chain finished with no eligible bidder
 *   payment_deadline past  — the current winner's window has closed
 */
export function canAcceptManualPayment(order) {
  if (!order) return { ok: false, reason: 'ORDER_NOT_FOUND' };
  if (String(order.status || '').toLowerCase() === 'expired') {
    return { ok: false, reason: 'ORDER_EXPIRED', status: order.status };
  }
  if (isPastDeadline(order)) {
    return { ok: false, reason: PAYMENT_WINDOW_EXPIRED, deadline: order.payment_deadline };
  }
  return { ok: true };
}

async function loadPayments(orderId, client = pool) {
  const { rows } = await client.query(
    'SELECT * FROM payments WHERE order_id=$1 ORDER BY created_at DESC',
    [orderId]
  );
  return rows;
}

/**
 * Record a legitimate manual/counter payment for an order.
 *
 * Runs inside one transaction that holds `SELECT … FROM orders FOR UPDATE`, the
 * SAME lock services/winnerExpiration.js takes before rotating an expired
 * winner. That is what makes the two operations mutually exclusive.
 *
 * @returns {{ok:boolean, reason?:string, payment?:object, order?:object, created?:boolean, alreadyPaid?:boolean}}
 */
export async function recordManualPayment({
  orderId,
  actorId = null,
  paymentMethod = 'counter',
  provider = MANUAL_PROVIDER,
  source = 'counter',
  note = null,
  expectedBuyerId = null,
} = {}) {
  let direct = true;
  try { direct = typeof isDirectPg === 'function' ? !!isDirectPg() : true; } catch { direct = false; }
  if (!direct) return { ok: false, reason: 'DB_UNAVAILABLE' };

  const client = await pool.connect();
  if (client?.__restFallback) {
    client.release();
    return { ok: false, reason: 'DB_UNAVAILABLE' };
  }

  try {
    await client.query('BEGIN');

    const { rows: oRows } = await client.query(
      `SELECT * FROM orders WHERE id=$1 FOR UPDATE`,
      [orderId]
    );
    const order = oRows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'ORDER_NOT_FOUND' };
    }

    // Cross-user safety: a caller acting on behalf of the buyer must match.
    if (expectedBuyerId && String(order.buyer_id) !== String(expectedBuyerId)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'BUYER_MISMATCH' };
    }

    // Idempotency first: an already-settled order is reported, never re-charged
    // and never re-written.
    const existing = await loadPayments(orderId, client);
    const alreadyPaid = existing.find((p) => String(p.status).toLowerCase() === 'paid');
    if (alreadyPaid) {
      await client.query('COMMIT');
      return { ok: true, alreadyPaid: true, payment: alreadyPaid, order, created: false };
    }

    const payable = canAcceptManualPayment(order);
    if (!payable.ok) {
      await client.query('ROLLBACK');
      return { ok: false, reason: payable.reason, status: payable.status, deadline: payable.deadline, order };
    }

    const amount = Number(order.amount || 0);
    if (!amount) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'INVALID_ORDER_AMOUNT', order };
    }

    const metadata = {
      manual_payment: true,
      source,
      payment_method: paymentMethod,
      recorded_by: actorId,
      recorded_at: new Date().toISOString(),
      note,
    };

    // Prefer claiming an existing non-terminal attempt so retries do not pile up
    // rows (the schema records attempts, but 'paid' is unique per order).
    const claimable = existing.find((p) => CLAIMABLE_PAYMENT_STATUSES.includes(String(p.status).toLowerCase()));
    if (claimable) {
      const { rows } = await client.query(
        `UPDATE payments
            SET status='paid', paid_at=now(), updated_at=now(), amount=$1, payment_method=$2, metadata=metadata || $3::jsonb
          WHERE id=$4 AND status IN ('pending','processing','failed','expired','cancelled')
          RETURNING *`,
        [amount, paymentMethod, JSON.stringify(metadata), claimable.id]
      );
      if (rows[0]) {
        await client.query('COMMIT');
        return { ok: true, payment: rows[0], order, created: false };
      }
    }

    // No attempt on record — create the authoritative payment. provider stays
    // 'counter'; both gateway reference columns stay NULL on purpose.
    try {
      const { rows } = await client.query(
        `INSERT INTO payments (order_id, customer_id, provider, provider_reference_id, checkout_session_id,
                               amount, currency, payment_method, status, paid_at, updated_at, metadata)
         VALUES ($1,$2,$3,NULL,NULL,$4,'PHP',$5,'paid',now(),now(),$6)
         RETURNING *`,
        [orderId, order.buyer_id, provider, amount, paymentMethod, JSON.stringify(metadata)]
      );
      await client.query('COMMIT');
      return { ok: true, payment: rows[0], order, created: true };
    } catch (e) {
      // idx_payments_one_paid_per_order: a concurrent confirmation won the race.
      if (e?.code === '23505') {
        const raced = (await loadPayments(orderId, client)).find((p) => String(p.status).toLowerCase() === 'paid');
        if (raced) {
          await client.query('COMMIT');
          return { ok: true, payment: raced, order, created: false, alreadyPaid: true };
        }
      }
      throw e;
    }
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    return { ok: false, reason: 'RECORD_FAILED', error: e.message };
  } finally {
    client.release();
  }
}

/** True when the order has authoritative paid-payment evidence. */
export async function hasPaidPayment(orderId) {
  const { rows } = await pool.query(
    `SELECT status FROM payments WHERE order_id=$1 AND status='paid' LIMIT 1`,
    [orderId]
  );
  return rows.length > 0;
}

/**
 * Apply ONE valid fulfillment transition, refusing anything that is not a
 * declared next step and refusing fulfillment states without payment evidence.
 * Returns the updated order or a refusal reason. Never skips a step.
 */
export async function applyOrderTransition(orderId, nextStatus) {
  const target = String(nextStatus || '').toLowerCase();
  const { rows: cur } = await pool.query('SELECT * FROM orders WHERE id=$1', [orderId]);
  const order = cur[0];
  if (!order) return { ok: false, reason: 'ORDER_NOT_FOUND' };

  const current = String(order.status || '').toLowerCase();
  if (current === target) return { ok: true, order, unchanged: true };
  if (!(ALLOWED_TRANSITIONS[current] || []).includes(target)) {
    return { ok: false, reason: 'INVALID_TRANSITION', from: current, to: target };
  }
  if (PAYMENT_GATED_STATUSES.includes(target) && !(await hasPaidPayment(orderId))) {
    return { ok: false, reason: 'PAYMENT_NOT_CONFIRMED' };
  }
  const { rows } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [target, orderId]);
  return { ok: true, order: rows[0] };
}

/**
 * Walk an order forward to `targetStatus` one legal step at a time
 * (pending → preparing → ready_pickup → completed). Each step is validated and
 * payment-gated individually, so the end state is reached only through states
 * the platform actually allows.
 */
export async function advanceOrderTo(orderId, targetStatus) {
  const path = ['preparing', 'ready_pickup', 'completed'];
  const target = String(targetStatus || '').toLowerCase();
  const end = path.indexOf(target);
  if (end === -1) return { ok: false, reason: 'UNSUPPORTED_TARGET' };

  let order = null;
  for (let i = 0; i <= end; i += 1) {
    const step = await applyOrderTransition(orderId, path[i]);
    if (!step.ok) return step;
    if (step.unchanged) continue;
    order = step.order;
  }
  return { ok: true, order: order || (await pool.query('SELECT * FROM orders WHERE id=$1', [orderId])).rows[0] };
}

export default {
  MANUAL_PROVIDER,
  PAYMENT_WINDOW_EXPIRED,
  CLAIMABLE_PAYMENT_STATUSES,
  ALLOWED_TRANSITIONS,
  PAYMENT_GATED_STATUSES,
  canAcceptManualPayment,
  recordManualPayment,
  hasPaidPayment,
  applyOrderTransition,
  advanceOrderTo,
};