import { isPaymentWindowClosed } from './paymentDeadline';
// frontend/src/roles/customer/lib/purchaseStatus.js
// Single normalization layer for My Purchases order/payment states.
// Backend remains authoritative; this maps API values → UI states only.

export const PURCHASE_STATES = {
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_PROCESSING: 'PAYMENT_PROCESSING',
  PAID: 'PAID',
  PREPARING: 'PREPARING',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  COLLECTED: 'COLLECTED',
  PAYMENT_EXPIRED: 'PAYMENT_EXPIRED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
};

export function isPaidPayment(order) {
  const s = String(order?.payment_status || '').toLowerCase();
  return s === 'paid';
}

export function normalizePurchaseStatus(order) {
  if (!order) return PURCHASE_STATES.PAYMENT_PENDING;
  const raw = String(order.status || '').toLowerCase();
  const pay = String(order.payment_status || '').toLowerCase();
  const expired = !!order.is_expired || raw === 'expired';

  if (raw === 'cancelled' || raw === 'canceled') return PURCHASE_STATES.CANCELLED;
  if (raw === 'refunded') return PURCHASE_STATES.REFUNDED;
  if (expired && !isPaidPayment(order)) return PURCHASE_STATES.PAYMENT_EXPIRED;
  if (raw === 'completed') return PURCHASE_STATES.COLLECTED;
  if (raw === 'ready_pickup' || raw === 'ready-pickup') return PURCHASE_STATES.READY_FOR_PICKUP;
  if (raw === 'preparing') return PURCHASE_STATES.PREPARING;
  if (raw === 'pending') {
    if (isPaidPayment(order)) return PURCHASE_STATES.PAID;
    if (pay === 'processing' || pay === 'pending') return PURCHASE_STATES.PAYMENT_PENDING;
    return PURCHASE_STATES.PAYMENT_PENDING;
  }
  if (pay === 'paid') return PURCHASE_STATES.PAID;
  return PURCHASE_STATES.PAYMENT_PENDING;
}

export function getPurchaseStatusBadge(order) {
  const state = normalizePurchaseStatus(order);
  switch (state) {
    case PURCHASE_STATES.COLLECTED:
      return { label: 'Collected', tone: 'collected' };
    case PURCHASE_STATES.READY_FOR_PICKUP:
      return { label: 'Ready for pickup', tone: 'ready' };
    case PURCHASE_STATES.PREPARING:
    case PURCHASE_STATES.PAID:
      return { label: 'Awaiting pickup', tone: 'ready' };
    case PURCHASE_STATES.PAYMENT_EXPIRED:
      return { label: 'Payment expired', tone: 'expired' };
    case PURCHASE_STATES.CANCELLED:
      return { label: 'Cancelled', tone: 'expired' };
    case PURCHASE_STATES.REFUNDED:
      return { label: 'Refunded', tone: 'collected' };
    case PURCHASE_STATES.PAYMENT_PROCESSING:
    case PURCHASE_STATES.PAYMENT_PENDING:
    default:
      return { label: 'Payment pending', tone: 'pending' };
  }
}

export function getPaymentStatusBadge(order) {
  const state = normalizePurchaseStatus(order);
  const pay = String(order?.payment_status || '').toLowerCase();
  if (state === PURCHASE_STATES.COLLECTED || state === PURCHASE_STATES.READY_FOR_PICKUP || state === PURCHASE_STATES.PREPARING || state === PURCHASE_STATES.PAID) {
    const method = formatPaymentMethod(order?.payment_method || pay);
    return { label: method ? `Paid · ${method}` : 'Paid', tone: 'paid' };
  }
  if (state === PURCHASE_STATES.PAYMENT_EXPIRED) return { label: 'Payment expired', tone: 'expired' };
  if (state === PURCHASE_STATES.PAYMENT_PROCESSING || pay === 'processing') return { label: 'Payment processing', tone: 'pending' };
  return { label: 'Payment pending', tone: 'pending' };
}

export function formatPaymentMethod(raw) {
  const m = String(raw || '').toLowerCase();
  if (!m || m === 'paid' || m === 'pending' || m === 'processing' || m === 'failed') return '';
  const map = {
    gcash: 'GCash',
    card: 'Card',
    paymaya: 'PayMaya',
    maya: 'PayMaya',
    grab_pay: 'GrabPay',
    qrph: 'QR Ph',
    billease: 'BillEase',
    bank: 'Bank transfer',
    bank_transfer: 'Bank transfer',
    counter: 'Branch counter',
    branch_counter: 'Branch counter',
  };
  return map[m] || raw;
}

/** 4-stage progress for the approved timeline. */
export function getPurchaseProgress(order) {
  const state = normalizePurchaseStatus(order);
  const paid = isPaidPayment(order) || [PURCHASE_STATES.PAID, PURCHASE_STATES.PREPARING, PURCHASE_STATES.READY_FOR_PICKUP, PURCHASE_STATES.COLLECTED].includes(state);

  const stages = [
    { key: 'won', label: 'Lot won', done: true },
    {
      key: 'paid',
      label: 'Payment confirmed',
      done: paid && state !== PURCHASE_STATES.PAYMENT_PENDING && state !== PURCHASE_STATES.PAYMENT_EXPIRED,
      // Never mark payment confirmed while still pending/expired.
      forcedDone: false,
    },
    {
      key: 'ready',
      label: 'Ready for pickup',
      done: [PURCHASE_STATES.READY_FOR_PICKUP, PURCHASE_STATES.COLLECTED].includes(state),
    },
    {
      key: 'collected',
      label: 'Collected',
      done: state === PURCHASE_STATES.COLLECTED,
    },
  ];

  // Fix payment-confirmed done flag with explicit rules
  stages[1].done = [PURCHASE_STATES.PAID, PURCHASE_STATES.PREPARING, PURCHASE_STATES.READY_FOR_PICKUP, PURCHASE_STATES.COLLECTED].includes(state);

  const doneCount = stages.filter(s => s.done).length;
  // Current step = first not-done stage (or last if all done)
  let currentIndex = stages.findIndex(s => !s.done);
  if (currentIndex === -1) currentIndex = stages.length - 1;

  return {
    stages,
    doneCount,
    currentIndex,
    percent: Math.round((doneCount / stages.length) * 100),
    text: `${doneCount} of ${stages.length} steps · ${Math.round((doneCount / stages.length) * 100)}%`,
  };
}

export function getPurchaseActions(order) {
  const state = normalizePurchaseStatus(order);
  // Local clock check against the SERVER-SUPPLIED payment_deadline. Purely a
  // UX guard: the backend re-validates the window on every payment attempt.
  const windowClosed = isPaymentWindowClosed(order);
  const canPay = state === PURCHASE_STATES.PAYMENT_PENDING && !order?.is_expired && !windowClosed;
  const hasBranch = !!(order?.branch || order?.branch_address || (order?.branch_lat != null && order?.branch_lng != null));
  const actions = [];

  if (canPay) {
    actions.push({ key: 'pay', label: 'Pay now', variant: 'gold', to: `/customer/orders/${order.id}` });
  }
  if (!canPay && state === PURCHASE_STATES.PAYMENT_PENDING && windowClosed) {
    // Not an error state — the winner chain is simply being resolved.
    actions.push({
      key: 'window-closed',
      label: 'Payment window expired',
      variant: 'outline',
      disabled: true,
      note: 'Payment window expired. Waiting for winner reassignment.',
    });
  }
  if (state !== PURCHASE_STATES.CANCELLED) {
    actions.push({
      key: 'invoice',
      label: 'View invoice',
      variant: canPay ? 'outline' : 'navy',
      to: `/customer/orders/${order.id}`,
    });
  }
  if (hasBranch && state !== PURCHASE_STATES.CANCELLED) {
    actions.push({ key: 'directions', label: 'Get directions', variant: 'outline', kind: 'directions' });
  }
  if (!canPay && state !== PURCHASE_STATES.COLLECTED) {
    actions.push({ key: 'details', label: 'View details', variant: 'outline', to: `/customer/orders/${order.id}` });
  }
  if (state === PURCHASE_STATES.COLLECTED) {
    actions.push({ key: 'details', label: 'View details', variant: 'outline', to: `/customer/orders/${order.id}` });
  }
  return actions;
}

export function buildDirectionsUrl(order) {
  const lat = order?.branch_lat;
  const lng = order?.branch_lng;
  if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  }
  if (order?.branch_address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.branch_address)}`;
  }
  return null;
}
