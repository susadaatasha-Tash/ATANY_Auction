// backend/src/services/revenueRule.js
//
// THE single authoritative definition of recognized revenue for ATANY.
//
// WHY THIS EXISTS
// ---------------
// Before this module the platform had two incompatible revenue rules:
//
//   a) admin/analytics.controller.js — "revenue" = orders whose ORDER STATUS is
//      in ['completed','pending','ready_pickup']. Payment was never consulted.
//   b) services/sellerSales.js — "eligible sale" = the order's latest PAYMENT is
//      'paid'.
//
// They disagreed in both directions. Rule (a) counted orders that had no payment
// row at all, and missed every paid order sitting in 'preparing' (a status that
// did not exist when the list was written).
//
// THE LIFECYCLE THIS ENCODES (traced, not assumed)
// -------------------------------------------------
//   auction ends        → orders row created with status 'pending'
//                         (services/auctionClosingService.js)
//   customer pays       → payments row created 'pending' (customer/payment.controller.js)
//                         → gateway confirms → payments.status='paid', paid_at=now()
//                         (webhook.controller.js / payment.controller.js polling fallback)
//                         ** orders.status is NEVER touched by a payment **
//   seller/admin fulfil → pending → preparing → ready_pickup → completed
//                         (both writers REFUSE these transitions unless a paid
//                          payment exists — sales.controller.js / transaction.controller.js)
//   7-day rule          → unpaid pending order rotates to the next bidder, or
//                         becomes 'expired' when nobody remains eligible
//
// Therefore order.status is a FULFILLMENT axis and carries no payment
// information at all, and 'paid' is a terminal, atomic, race-guarded, immutable
// state. Money is legitimately recognized exactly when a payment is 'paid'.
//
// This rule matches the intent recorded in migration 015 —
//   "separates payment status from order fulfillment … Payment paid does NOT
//    auto-complete order; fulfillment progresses separately"
// — and the only rule that survives the two fulfillment gates.
//
// IT DOES NOT change: time windows, currency, commission maths, or any UI.
export const PAID_PAYMENT_STATUS = 'paid';

/** Stable identifier surfaced to the UI so a report can state its own basis. */
export const REVENUE_RULE_ID = 'paid-payments-v1';
export const REVENUE_RULE_LABEL =
  'Recognized revenue = orders with a confirmed paid payment (order status is a fulfillment state, not a payment state)';

/** True when a payment row represents money actually received. */
export function isPaidPayment(payment) {
  return String(payment?.status || '').toLowerCase() === PAID_PAYMENT_STATUS;
}

/**
 * Pick the payment that decides an order, matching services/sellerSales.js
 * `pickLatest`: a 'paid' row always wins, otherwise the newest row.
 */
export function pickDecidingPayment(payments = []) {
  const rows = Array.isArray(payments) ? payments : [];
  const paid = rows.find(isPaidPayment);
  if (paid) return paid;
  return rows.slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;
}

/** True when this order counts as recognized revenue. */
export function isRecognizedRevenueOrder(order) {
  return isPaidPayment(order?.payment);
}

/** Group orders into recognized / not, and return the recognized total. */
export function recognizedRevenue(orders = [], getPayments = () => []) {
  let total = 0;
  let count = 0;
  (orders || []).forEach((o) => {
    if (isPaidPayment(pickDecidingPayment(getPayments(o)))) { total += Number(o.amount || 0); count += 1; }
  });
  return { total, count };
}

/**
 * SQL fragment for direct-pg callers. The payments sub-select is written with an
 * explicit alias because `pool.js` treats parentheses/JOINs as "complex" and
 * silently returns [] under the Supabase REST fallback — every caller of this
 * helper must therefore be on direct pg (see assertRevenueSource in tests).
 */
export const RECOGNIZED_REVENUE_SQL = "EXISTS (SELECT 1 FROM payments pay WHERE pay.order_id = o.id AND pay.status = 'paid')";

/**
 * REST-safe helper used by the controllers: one simple payments read for the
 * order ids in scope, then recognition applied in JS. Mirrors the fan-out style
 * the rest of this codebase already uses (the pool cannot translate JOINs).
 */
export async function recognizedRevenueTotals(pool, orders) {
  const rows = Array.isArray(orders) ? orders : [];
  const ids = [...new Set(rows.map((o) => o.id).filter(Boolean))];
  if (!ids.length) return { total: 0, count: 0 };
  let payments = [];
  try {
    ({ rows: payments } = await pool.query(
      `SELECT order_id, status, paid_at, created_at FROM payments WHERE order_id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`,
      ids
    ));
  } catch {
    // A DB without the payments table cannot prove money was received, so it
    // recognizes nothing. Under-reporting is the only safe direction here.
    return { total: 0, count: 0 };
  }
  const byOrder = {};
  payments.forEach((p) => { (byOrder[String(p.order_id)] ||= []).push(p); });
  return recognizedRevenue(rows, (o) => byOrder[String(o.id)]);
}

export default {
  PAID_PAYMENT_STATUS,
  REVENUE_RULE_ID,
  REVENUE_RULE_LABEL,
  RECOGNIZED_REVENUE_SQL,
  isPaidPayment,
  pickDecidingPayment,
  isRecognizedRevenueOrder,
  recognizedRevenue,
  recognizedRevenueTotals,
};