// backend/src/services/winnerNotificationService.js
// Single source of truth for the customer-facing wording of the auction
// winner / payment-deadline notifications.
//
// Why one module:
//  • the in-app notice, the email and the reminder must never disagree
//  • the privacy rules live in ONE place: a customer-facing message NEVER
//    names another bidder (no previous winner, no next winner, no id/email)
//  • the dedup markers are deterministic, so a repeated cron run can never
//    insert the same notice twice
//
// All values are REAL (product name, order amount, order reference, the stored
// payment deadline). Nothing is hardcoded.

export const DEADLINE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The one deadline rule used everywhere (stored column wins). */
export function resolveDeadline({ payment_deadline, winner_confirmed_at, created_at } = {}) {
  if (payment_deadline) return new Date(payment_deadline);
  const base = winner_confirmed_at || created_at;
  if (!base) return null;
  const d = new Date(base);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + DEADLINE_DAYS * DAY_MS);
}

/** Human deadline, e.g. "October 29, 2026 at 8:30 PM". */
export function formatDeadline(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} at ${time}`;
}

/** Short deadline for compact messages, e.g. "Oct 29, 2026". */
export function formatDeadlineShort(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function peso(value) {
  const n = Number(value || 0);
  return `₱${n.toLocaleString('en-PH')}`;
}

function orderRef({ transaction_code, id }) {
  return transaction_code || String(id || '').slice(0, 8).toUpperCase();
}

/* ── dedup markers ────────────────────────────────────────────────
   Each notice carries a deterministic marker so the flow can check
   "was this exact notice already delivered?" without a new table. */
export const MARKERS = {
  initialWinner: (o) => `winner-notice:${orderRef(o)}`,
  // NOTE: the markers are embedded in the customer-visible message, so they
  // must NEVER contain a user id (no other customer's identifier may leak).
  winnerExpired: (o, _buyerId, rank) => `winner-expired:${o.id}:${rank}`,
  fallbackWinner: (o, _buyerId, rank) => `fallback-winner:${o.id}:${rank}`,
  noBiddersLeft: (o) => `no-bidders:${o.id}`,
  sellerNoBidders: (o) => `seller-no-bidders:${o.id}`,
  sellerWinner: (o, winnerName) => `seller-winner:${orderRef(o)}:${winnerName}`,
  adminWinner: (o, winnerName) => `admin-winner:${orderRef(o)}:${winnerName}`,
  paymentConfirmed: (o) => `payment-confirmed:${o.id}`,
  reminder: (o, stage) => `reminder:${orderRef(o)}:${stage}`,
};

/* ── customer-facing messages ────────────────────────────────────── */

/** Winner #1 — "you won". */
export function buildInitialWinnerMessage({ product, amount, order, auctionCode, branchName, deadline, paymentUrl }) {
  const deadlineStr = formatDeadline(deadline);
  const lines = [
    `Congratulations! You won "${product || 'an ATANY lot'}" for ${peso(amount)}.`,
    `Order: ${orderRef(order)}`,
  ];
  if (auctionCode) lines.push(`Auction: ${auctionCode}`);
  if (branchName) lines.push(`Pickup branch: ${branchName}`);
  if (deadlineStr) {
    lines.push(`Please complete payment by: ${deadlineStr}`);
    lines.push(`You have ${DEADLINE_DAYS} days to complete payment.`);
  }
  lines.push('Complete payment from My Purchases to confirm your item.');
  if (paymentUrl) lines.push(`View Order & Pay: ${paymentUrl}`);
  return lines.join('\n');
}

/** The current winner's payment period ended. */
export function buildExpiredWinnerMessage({ product, amount, order, deadline, supportUrl }) {
  const deadlineStr = formatDeadline(deadline);
  const lines = [
    `Payment Period Expired`,
    `Your ${DEADLINE_DAYS}-day payment period for "${product || 'your ATANY lot'}" has ended.`,
    `Winning amount: ${peso(amount)}`,
    `Order: ${orderRef(order)}`,
  ];
  if (deadlineStr) lines.push(`Payment deadline: ${deadlineStr}`);
  lines.push(
    'Because payment was not completed within the required period, your winning claim is no longer active and the item has been offered to the next eligible bidder.'
  );
  lines.push('If you believe there is an issue or have questions about this auction, please contact ATANY Support.');
  if (supportUrl) lines.push(`Contact ATANY Support: ${supportUrl}`);
  return lines.join('\n');
}

/** The new (fallback) winner. */
export function buildFallbackWinnerMessage({ product, amount, order, deadline, paymentUrl }) {
  const deadlineStr = formatDeadline(deadline);
  const lines = [
    `You Are Now the Winning Bidder`,
    `The previous winning claim for "${product || 'an ATANY lot'}" expired.`,
    `The item has now been offered to you based on your highest eligible bid.`,
    `Your winning amount: ${peso(amount)}`,
    `Order: ${orderRef(order)}`,
  ];
  if (deadlineStr) lines.push(`Payment deadline: ${deadlineStr}`);
  lines.push(`You have a fresh ${DEADLINE_DAYS}-day period to complete payment.`);
  lines.push('Complete payment from My Purchases to confirm your item.');
  if (paymentUrl) lines.push(`View Order & Pay: ${paymentUrl}`);
  return lines.join('\n');
}

/** No eligible bidder remains. */
export function buildNoBiddersMessage({ product, order, supportUrl }) {
  const lines = [
    `Auction Payment Opportunity Ended`,
    `Your payment period for "${product || 'your ATANY lot'}" has expired.`,
    `Order: ${orderRef(order)}`,
    `There are no more eligible bidders remaining for this auction.`,
    'If you have questions about this order, please contact ATANY Support.',
  ];
  if (supportUrl) lines.push(`Contact Support: ${supportUrl}`);
  return lines.join('\n');
}

/** Payment confirmed. */
export function buildPaymentConfirmedMessage({ product, amount, order, orderStatus }) {
  const lines = [
    `Payment Confirmed`,
    `Your payment of ${peso(amount)} for "${product || 'your ATANY lot'}" has been confirmed.`,
    `Order: ${orderRef(order)}`,
  ];
  lines.push(
    orderStatus === 'ready_pickup'
      ? 'Your order is ready for pickup.'
      : 'Your order is now being prepared.'
  );
  lines.push('View your purchase in My Purchases.');
  return lines.join('\n');
}

/** Deadline reminder (3 days / 1 day / 6 hours). */
export function buildReminderMessage({ stage, product, amount, deadline, order }) {
  const deadlineStr = formatDeadline(deadline);
  const head = {
    '3D': `Your payment for "${product || 'your ATANY lot'}" is due in 3 days.`,
    '1D': `Reminder: your payment for "${product || 'your ATANY lot'}" is due tomorrow.`,
    '6H': `Your payment deadline for "${product || 'your ATANY lot'}" is in about 6 hours.`,
  }[stage] || `Your payment for "${product || 'your ATANY lot'}" is due soon.`;
  const lines = [head];
  lines.push(`Amount: ${peso(amount)}`);
  if (deadlineStr) lines.push(`Payment deadline: ${deadlineStr}`);
  lines.push(`Order: ${orderRef(order)}`);
  lines.push('Complete payment from My Purchases to keep your winning claim.');
  return lines.join('\n');
}

/**
 * The "payment confirmed" notice — ONE implementation shared by the PayMongo
 * webhook and the checkout-polling fallback, so a repeated confirmation can
 * never produce a duplicate notice.
 *
 * @returns {Promise<boolean>} true when a new notice was created
 */
export async function createPaymentConfirmedNotification(client, { payment, order, productName, auctionId }) {
  const marker = MARKERS.paymentConfirmed(order || { id: payment.order_id });
  const userId = payment.customer_id;
  const { rows: existing } = await client.query(
    `SELECT id FROM notifications WHERE user_id = $1 AND message LIKE $2 LIMIT 1`,
    [userId, `%${marker}%`]
  );
  if (existing.length) return false;

  const msg = `${buildPaymentConfirmedMessage({
    product: productName,
    amount: order?.amount ?? payment.amount,
    order: order || { id: payment.order_id },
    orderStatus: order?.status || 'pending',
  })} [${marker}]`;

  try {
    await client.query(
      `INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1,'payout',$2,$3)`,
      [userId, msg, auctionId || null]
    );
  } catch (insErr) {
    if (insErr.code !== '42703') throw insErr;
    await client.query(
      `INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)`,
      [userId, msg]
    );
  }
  return true;
}

/* ── staff-facing messages (seller / admin) ─────────────────────── */
/** Seller: the winner changed (initial or reassignment). */
export function buildSellerWinnerMessage({ product, winnerName, amount, order, auctionCode, changed }) {
  const lines = [
    changed
      ? `🏆 Your auction for "${product || 'your lot'}" has a new winner: ${winnerName} with a winning bid of ${peso(amount)}.`
      : `🏆 Your auction for "${product || 'your lot'}" has a winner: ${winnerName} with a winning bid of ${peso(amount)}.`,
    `Order: ${orderRef(order)}`,
  ];
  if (auctionCode) lines.push(`Auction: ${auctionCode}`);
  lines.push('Status: Awaiting Payment. The winner has 7 days to complete payment.');
  return lines.join(' ');
}

/** Seller: no eligible bidder remains. */
export function buildSellerNoBiddersMessage({ product, order, auctionCode }) {
  const lines = [
    `🏆 Auction Winner Payment Expired`,
    `The final eligible winner for "${product || 'your lot'}" did not complete payment within the required period.`,
    'There are no remaining eligible bidders.',
  ];
  if (auctionCode) lines.push(`Auction: ${auctionCode}`);
  lines.push(`Order: ${orderRef(order)}`);
  lines.push('The auction remains ended. You can relist it from your auction list if you wish to sell it again.');
  return lines.join(' ');
}

/** Admin: the current assigned winner changed. */
export function buildAdminWinnerMessage({ product, winnerName, amount, order, shopName, changed }) {
  const lines = [
    changed
      ? `🏆 Auction winner updated: "${product || 'your lot'}" — ${winnerName} is now the winner with ${peso(amount)}.`
      : `🏆 Auction winner confirmed: "${product || 'your lot'}" — ${winnerName} won with ${peso(amount)}.`,
    `Order: ${orderRef(order)}`,
  ];
  if (shopName) lines.push(`Shop: ${shopName}`);
  lines.push('Status: Awaiting Payment.');
  return lines.join(' ');
}
