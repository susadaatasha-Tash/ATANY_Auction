// frontend/src/roles/shop-owner/components/StatusBadge.jsx
// Reusable status pill — presentation only; DB status values unchanged.

const TONE_BY_KEY = {
  // Auctions
  live: 'success',
  scheduled: 'warn',
  ended: 'muted',
  draft: 'neutral',
  cancelled: 'danger',
  canceled: 'danger',
  // Payout (derived presentation)
  released: 'success',
  pending_settlement: 'warn',
  awaiting_payment: 'warn',
  // Fulfillment
  pending: 'neutral',
  preparing: 'info',
  ready_pickup: 'warn',
  readypickup: 'warn',
  completed: 'success',
  expired: 'muted',
  // Payments
  paid: 'success',
  processing: 'info',
  failed: 'danger',
  // Listings
  approved: 'success',
  rejected: 'danger',
};

export function statusTone(key) {
  return TONE_BY_KEY[key] || 'neutral';
}

export function StatusBadge({ status, label, tone }) {
  const key = String(status || '').toLowerCase();
  const resolvedTone = tone || statusTone(key);
  const display = label || key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
  return (
    <span className={`sdash-status sdash-status--${resolvedTone}`}>
      {display}
    </span>
  );
}

/** Presentation mapping for seller sales/orders — never mutates backend values. */
export function payoutPresentation(sale) {
  const status = sale?.status;
  const payment = sale?.payment_status;
  if (status === 'completed') return { status: 'released', label: 'Released', tone: 'success' };
  if (status === 'expired') return { status: 'expired', label: 'Expired', tone: 'muted' };
  if (payment === 'paid') return { status: 'pending_settlement', label: 'Pending settlement', tone: 'warn' };
  return { status: 'awaiting_payment', label: 'Awaiting payment', tone: 'warn' };
}

export function fulfillmentPresentation(sale) {
  const status = sale?.status;
  const map = {
    pending: { status: 'pending', label: 'Pending', tone: 'neutral' },
    preparing: { status: 'preparing', label: 'Preparing', tone: 'info' },
    ready_pickup: { status: 'ready_pickup', label: 'Ready for pickup', tone: 'warn' },
    completed: { status: 'completed', label: 'Picked up', tone: 'success' },
    expired: { status: 'expired', label: 'Expired', tone: 'muted' },
  };
  return map[status] || { status: status || 'unknown', label: status || '—', tone: 'neutral' };
}

export function auctionPresentation(status) {
  const key = String(status || '').toLowerCase();
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  return { status: key, label, tone: statusTone(key) };
}

export default StatusBadge;
