// backend/src/lib/monthKey.js
// Timezone-safe calendar-month helpers.
//
// ATANY's seller-facing UI groups money by the PHILIPPINE calendar month
// (Asia/Manila, UTC+8). Building a month key with
//
//   new Date(y, m, 1).toISOString().slice(0, 7)
//
// is WRONG: local midnight on the 1st of October is still September 30th in
// UTC, so the key comes out as "2026-09" while the label says "OCT 2026" —
// every month's revenue is shifted one month into the previous bucket.
//
// The key and the label must always be derived from the SAME local calendar
// month, so the two helpers below are used together.

/**
 * The local (business timezone) calendar month key of a date: "YYYY-MM".
 * @param {Date|string|number} value
 * @returns {string}
 */
export function localMonthKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * The local calendar month label, e.g. "SEP 2026".
 * Derived from the same local calendar month as localMonthKey().
 * @param {Date|string|number} value
 * @returns {string}
 */
export function localMonthLabel(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const monthYear = d.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
  const [mo, yr] = monthYear.split(' ');
  return `${(mo || '').toUpperCase()} ${yr || ''}`.trim();
}
