// frontend/src/shared/lib/bidMinimum.js
// Single source for customer-side minimum-bid math. Display/convenience ONLY:
// the backend recalculates authoritatively inside the bid transaction and
// rejects stale or low bids with BID_TOO_LOW. Rule: submitted >= minimum
// (never exact-match, never a multiple requirement).
export const DEFAULT_MIN_INCREMENT = 1000;

/** Per-auction increment with legacy fallback (pre-031 rows / missing field). */
export function incrementOf(auction) {
  const raw = auction?.minimum_bid_increment ?? auction?.minimumBidIncrement;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MIN_INCREMENT;
}

/** Minimum accepted next bid = current authoritative highest + increment. */
export function minimumNextBid(currentBid, increment) {
  return Number(currentBid || 0) + Number(increment || DEFAULT_MIN_INCREMENT);
}

export function formatPeso(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '₱—';
  return '₱' + Math.round(num).toLocaleString();
}
