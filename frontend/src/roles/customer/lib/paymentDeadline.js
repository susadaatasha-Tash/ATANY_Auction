// frontend/src/roles/customer/lib/paymentDeadline.js
// 7-day payment deadline helpers — display only.
// Server stores payment_deadline (winner_confirmed_at + 7 days) and enforces expiry.

export const PAYMENT_POLICY_DAYS = 7;

export function resolvePaymentDeadline(order) {
  if (order?.payment_deadline) {
    const d = new Date(order.payment_deadline);
    if (!isNaN(d.getTime())) return d;
  }
  const base = order?.winner_confirmed_at || order?.date || order?.created_at;
  if (!base) return null;
  const t = new Date(base).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + PAYMENT_POLICY_DAYS * 24 * 60 * 60 * 1000);
}

export function formatLongDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatShortDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Remaining time copy for collapsed deadline row. */
export function getRemainingPaymentTime(order, now = Date.now()) {
  const deadline = resolvePaymentDeadline(order);
  if (!deadline) return { text: '—', tone: 'neutral', expired: false, hoursLeft: null };
  const ms = deadline.getTime() - now;
  if (ms <= 0) {
    return { text: 'Payment expired', tone: 'expired', expired: true, hoursLeft: 0, deadline };
  }
  const hoursLeft = Math.ceil(ms / (1000 * 60 * 60));
  const daysLeft = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (hoursLeft <= 24) {
    if (hoursLeft <= 1) return { text: 'Due today', tone: 'urgent', expired: false, hoursLeft, deadline };
    return { text: 'Due tomorrow', tone: 'strong', expired: false, hoursLeft, deadline };
  }
  if (daysLeft <= 2) return { text: `${daysLeft} days remaining`, tone: 'strong', expired: false, hoursLeft, deadline };
  return { text: `${daysLeft} days remaining`, tone: 'soft', expired: false, hoursLeft, deadline };
}

export function getPaymentDeadlineState(order, now = Date.now()) {
  const remaining = getRemainingPaymentTime(order, now);
  const deadline = remaining.deadline || resolvePaymentDeadline(order);
  const wonOn = order?.winner_confirmed_at || order?.date || order?.created_at || null;
  const show = !!(order && (order.status === 'pending' || String(order.status) === 'expired') && !['paid'].includes(String(order.payment_status || '').toLowerCase()));
  // Only surface deadline UI for unpaid orders still in pending/expired payment window
  const unpaid = !['paid'].includes(String(order?.payment_status || '').toLowerCase());
  const pendingish = String(order?.status || '').toLowerCase() === 'pending' || !!order?.is_expired || remaining.expired;
  return {
    visible: unpaid && pendingish,
    deadline,
    wonOn,
    remaining,
    expired: remaining.expired,
    collapsedLabel: remaining.expired
      ? 'Payment deadline expired'
      : `Payment due ${formatLongDate(deadline)}`,
  };
}

export function getPaymentDeadlinePolicyText(expired) {
  if (expired) {
    return 'The 7-day payment period for this purchase has expired. Under the auction payment policy, the winning bid may be forfeited and the item may be awarded to the next eligible bidder.';
  }
  return 'Payment must be completed within 7 days from the date the auction was won. If payment is not completed within this period, the winning bid will be forfeited and the item may be awarded to the second-highest eligible bidder.';
}
