// frontend/src/roles/admin/lib/securityLabels.js
// Presentation helpers for Admin → Security Alerts.
// The severity / status values come from the real database enums
// (public.alert_severity, public.alert_status) — nothing is invented here.

export const ALERT_SEVERITY_META = {
  high: { label: 'High', tone: 'red' },
  medium: { label: 'Medium', tone: 'gold' },
  low: { label: 'Low', tone: 'blue' },
};

export const ALERT_STATUS_META = {
  new: { label: 'New', tone: 'red' },
  investigating: { label: 'Under Review', tone: 'blue' },
  resolved: { label: 'Resolved', tone: 'green' },
  dismissed: { label: 'Dismissed', tone: 'grey' },
};

/** Severity tabs: All + the real severities. */
export const ALERT_SEVERITY_TABS = [
  { value: 'all', label: 'All', tone: 'navy' },
  { value: 'high', label: 'High', tone: 'red' },
  { value: 'medium', label: 'Medium', tone: 'gold' },
  { value: 'low', label: 'Low', tone: 'blue' },
];

/** Status tabs: the real alert statuses. */
export const ALERT_STATUS_TABS = [
  { value: 'new', label: 'New', tone: 'red' },
  { value: 'investigating', label: 'Under Review', tone: 'blue' },
  { value: 'resolved', label: 'Resolved', tone: 'green' },
  { value: 'dismissed', label: 'Dismissed', tone: 'grey' },
];

export const ALERT_SEVERITY_OPTIONS = [
  { value: 'all', label: 'All Severity' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export const ALERT_STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'new', label: 'New' },
  { value: 'investigating', label: 'Under Review' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
];

export const ALERT_DATE_PRESETS = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: 'month', label: 'This Month' },
  { value: 'custom', label: 'Custom Range' },
];

export const ALERT_PAGE_SIZES = [10, 25, 50];

export function alertSeverityLabel(severity) {
  return ALERT_SEVERITY_META[severity]?.label || '—';
}
export function alertSeverityTone(severity) {
  return ALERT_SEVERITY_META[severity]?.tone || 'grey';
}
export function alertStatusLabel(status) {
  return ALERT_STATUS_META[status]?.label || '—';
}
export function alertStatusTone(status) {
  return ALERT_STATUS_META[status]?.tone || 'grey';
}
/** An alert still needs attention. */
export function isOpenAlert(alert) {
  return alert?.status === 'new' || alert?.status === 'investigating';
}

/** Human relative time ("5 days ago") from the real timestamp. */
export function formatRelativeTime(value, now = new Date()) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/** Full date/time for the tooltip / accessible label. */
export function formatAbsoluteTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-PH', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/**
 * Resolve a date preset into an absolute [from, to] window.
 * Computed in the viewer's timezone and sent as ISO instants, so the server
 * compares timestamps without any timezone ambiguity.
 */
export function resolveAlertDateRange(preset, from, to) {
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
      return { date_from: iso(end), date_to: iso(start) };
    }
    return { date_from: iso(start), date_to: iso(end) };
  }
  return { date_from: '', date_to: '' };
}

/** "↑ 32% from last month" — only when there is a real comparable base. */
export function formatTrend(trend, { suffix = 'from last month' } = {}) {
  if (!trend || !Number.isFinite(trend.pct)) return null;
  const arrow = trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→';
  return `${arrow} ${Math.abs(trend.pct)}% ${suffix}`;
}
