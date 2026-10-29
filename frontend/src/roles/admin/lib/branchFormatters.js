// frontend/src/roles/admin/lib/branchFormatters.js
// Shared display formatters for the admin branch-centric monitoring screens.
// Extracted (rather than living in a page) so the drawers can format values
// without importing a page module.
import { peso } from './currency';

export function fmtMoney(n) {
  return n == null || n === '' ? '—' : peso(n);
}

export function fmtWhen(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? `Today · ${time}`
    : `${d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} · ${time}`;
}

export function fmtWhenShort(value) {
  return fmtWhen(value);
}

export function timeAgo(value) {
  if (!value) return '—';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60e3) return 'just now';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} min ago`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)}h ago`;
  if (diff < 7 * 86400e3) return `${Math.floor(diff / 86400e3)}d ago`;
  return fmtWhen(value);
}

export function capitaliseStatus(s) {
  const str = String(s || '');
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function countdownFrom(endTime, now = Date.now()) {
  const secs = Math.max(0, Math.floor((new Date(endTime).getTime() - now) / 1000));
  const h = String(Math.floor(secs / 3600)).padStart(2, '0');
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
