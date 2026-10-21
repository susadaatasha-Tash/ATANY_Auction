// frontend/src/roles/admin/lib/orderLabels.js
// Presentation helpers for the Admin → Orders screen.
// The order states come from the real database enum (public.order_status):
// pending · preparing · ready_pickup · completed · expired.

export const ORDER_STATUS_META = {
  pending: { label: 'Pending', tone: 'gold' },
  preparing: { label: 'Preparing', tone: 'blue' },
  ready_pickup: { label: 'Ready for pickup', tone: 'blue' },
  completed: { label: 'Completed', tone: 'green' },
  expired: { label: 'Expired', tone: 'grey' },
};

/** The status tabs (All first) — only real ATANY states. */
export const ORDER_STATUS_TABS = [
  { value: 'all', label: 'All', tone: 'navy' },
  { value: 'pending', label: 'Pending', tone: 'gold' },
  { value: 'preparing', label: 'Preparing', tone: 'blue' },
  { value: 'ready_pickup', label: 'Ready for pickup', tone: 'blue' },
  { value: 'completed', label: 'Completed', tone: 'green' },
  { value: 'expired', label: 'Expired', tone: 'grey' },
];

export const ORDER_STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready_pickup', label: 'Ready for pickup' },
  { value: 'completed', label: 'Completed' },
  { value: 'expired', label: 'Expired' },
];

export const DATE_PRESETS = [
  { value: 'all', label: 'All Dates' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
];

export const PAGE_SIZES = [10, 25, 50];

export function orderStatusLabel(status) {
  return ORDER_STATUS_META[status]?.label || '—';
}

export function orderStatusTone(status) {
  return ORDER_STATUS_META[status]?.tone || 'grey';
}

/** Philippine peso formatting: 366500 → ₱366,500 */
export function peso(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₱0';
  return `₱${Math.round(n).toLocaleString('en-PH')}`;
}

/** 19/10/2026, 2:45 PM */
export function formatOrderDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-PH', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/**
 * Resolve a date preset into an absolute [from, to] window.
 * Everything is computed in the viewer's timezone and sent as ISO instants,
 * so the server compares timestamps without any timezone ambiguity.
 */
export function resolveDateRange(preset, from, to) {
  const now = new Date();
  const iso = (d) => (d && !Number.isNaN(d.getTime()) ? d.toISOString() : '');

  if (preset === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { date_from: iso(start), date_to: iso(end) };
  }
  if (preset === '7d') {
    return { date_from: iso(new Date(now.getTime() - 7 * 86400000)), date_to: iso(now) };
  }
  if (preset === '30d') {
    return { date_from: iso(new Date(now.getTime() - 30 * 86400000)), date_to: iso(now) };
  }
  if (preset === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { date_from: iso(start), date_to: iso(now) };
  }
  if (preset === 'custom') {
    const start = from ? new Date(`${from}T00:00:00`) : null;
    const end = to ? new Date(`${to}T23:59:59.999`) : null;
    if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start > end) {
      // A reversed range is corrected instead of silently returning nothing.
      return { date_from: iso(end), date_to: iso(start) };
    }
    return { date_from: iso(start), date_to: iso(end) };
  }
  return { date_from: '', date_to: '' };
}
