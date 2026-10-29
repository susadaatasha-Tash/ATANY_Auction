// frontend/src/roles/shop-owner/components/auctionScheduleUtils.js
// Date/time helpers for the auction Schedule step.
// Uses native Date only — no new date library.
// Draft/publish model stays datetime-local strings ('YYYY-MM-DDTHH:mm'),
// converted to UTC ISO at submit (same as existing CreateAuctionModal).

export const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function toDateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local current date (browser timezone — never UTC-shifted). */
export function getLocalToday() {
  const n = new Date();
  return {
    year: n.getFullYear(),
    month: n.getMonth(),
    day: n.getDate(),
    dateKey: toDateKey(n),
  };
}

export function fromDateKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Local wall-clock string without timezone — matches existing toLocal() convention. */
export function toLocal(dt) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}T${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

export function parseLocal(dt) {
  if (!dt || typeof dt !== 'string') return null;
  const m = dt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const hour24 = Number(m[4]);
  const minute = Number(m[5]);
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    dateKey: `${m[1]}-${m[2]}-${m[3]}`,
    year: Number(m[1]),
    month: Number(m[2]) - 1,
    day: Number(m[3]),
    hour12,
    minute,
    period,
  };
}

export function composeLocal(dateKey, hour12, minute, period) {
  const d = fromDateKey(dateKey);
  let h = Number(hour12) % 12;
  if (period === 'PM') h += 12;
  d.setHours(h, Number(minute), 0, 0);
  return toLocal(d);
}

export function addDaysToKey(dateKey, days) {
  const d = fromDateKey(dateKey);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** 6x7 grid cells for a calendar month. Handles leap years, short months, year rolls. */
export function buildMonthMatrix(year, month) {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) {
    cells.push({ day: daysInPrevMonth - firstDow + 1 + i, inMonth: false, dateKey: null });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({
      day,
      inMonth: true,
      dateKey: `${year}-${pad2(month + 1)}-${pad2(day)}`,
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({
      day: cells.length - firstDow - daysInMonth + 1,
      inMonth: false,
      dateKey: null,
    });
  }
  return cells;
}

export function formatMonthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export function formatDayLabel(dateKey) {
  if (!dateKey) return '—';
  const d = fromDateKey(dateKey);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTime12(hour12, minute, period) {
  return `${hour12}:${pad2(minute)} ${period}`;
}

export function formatTimeFromLocal(local) {
  const p = parseLocal(local);
  if (!p) return '—';
  return formatTime12(p.hour12, p.minute, p.period);
}

/** Dynamic duration from end − start: "3 hours", "7 days", "7 days 3 hours". */
export function durationText(startLocal, endLocal) {
  const s = new Date(startLocal);
  const e = new Date(endLocal);
  if (!startLocal || !endLocal || isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) {
    return null;
  }
  const totalMin = Math.floor((e - s) / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  const parts = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (days === 0 && hours === 0 && mins > 0) parts.push(`${mins} min`);
  if (!parts.length) parts.push('0 min');
  return parts.join(' ');
}

/**
 * Frontend schedule validation for Continue.
 * Backend remains source of truth on submit (end > start, valid timestamps).
 * Past start is blocked in this wizard UX; backend still accepts start <= now
 * for existing live-now behavior on other entry points.
 */
export function scheduleValidation(startLocal, endLocal) {
  if (!startLocal) return { field: 'start', message: 'Auction start date and time are required' };
  if (!endLocal) return { field: 'end', message: 'Auction end date and time are required' };
  const s = new Date(startLocal);
  const e = new Date(endLocal);
  if (isNaN(s.getTime())) return { field: 'start', message: 'Invalid auction start date/time' };
  if (isNaN(e.getTime())) return { field: 'end', message: 'Invalid auction end date/time' };
  if (e <= s) return { field: 'end', message: 'End time must be later than the auction start time' };
  if (s.getTime() < Date.now() - 60 * 1000) {
    return { field: 'start', message: 'Auction start cannot be in the past' };
  }
  return null;
}

/** Keep end after start when a quick-start shortcut would invalidate the current end. */
export function ensureEndAfterStart(startLocal, endLocal) {
  const s = new Date(startLocal);
  const e = endLocal ? new Date(endLocal) : null;
  if (!e || isNaN(e.getTime()) || e <= s) {
    const p = parseLocal(startLocal);
    if (!p) return endLocal || '';
    return composeLocal(addDaysToKey(p.dateKey, 7), p.hour12, p.minute, p.period);
  }
  return endLocal;
}
