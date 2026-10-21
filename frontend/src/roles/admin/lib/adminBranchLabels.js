// frontend/src/roles/admin/lib/adminBranchLabels.js
// Presentation helpers for the Admin branch-centric monitoring UI.
// Only presentation lives here — every value still comes from the real
// ATANY records (branches, listings, auctions, bids, orders, presence).

/** The branch states the platform actually stores (branches.status). */
export const BRANCH_STATUS = {
  OPEN: 'Open',
  CLOSED: 'Temporarily Closed',
};

/** The effective auction states used across the admin monitoring screens. */
export const AUCTION_STATUS = {
  LIVE: 'live',
  SCHEDULED: 'scheduled',
  PAUSED: 'paused',
  ENDED: 'ended',
};

/** A branch is open when its stored status is exactly "Open". */
export function isBranchOpen(branch) {
  return String(branch?.status || '').toLowerCase() === 'open';
}

/** "Open" / "Closed" — the two states the branch filter uses. */
export function branchState(branch) {
  return isBranchOpen(branch) ? 'open' : 'closed';
}

export function branchStatusLabel(branch) {
  return isBranchOpen(branch) ? 'Open' : 'Closed';
}

/** Peso amount — always real, never fabricated. */
export function peso(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₱—';
  return `₱${Math.round(n).toLocaleString('en-PH')}`;
}

/** Compact peso for KPI tiles: 1874000 → ₱1.87M · 486200 → ₱486,200 */
export function compactPeso(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₱—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `₱${(n / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  return peso(n);
}

export function auctionStatusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'live') return 'Live';
  if (s === 'scheduled') return 'Scheduled';
  if (s === 'paused') return 'Paused';
  if (s === 'ended') return 'Ended';
  return '—';
}

/**
 * The state of a branch listing:
 *  · live / scheduled / paused / ended come from the listing's own auction
 *  · 'draft' means the listing exists but no auction was created for it yet
 */
export function listingStatus(listing) {
  const auction = listing?.auction || listing;
  const status = String(auction?.status || '').toLowerCase();
  if (!status) return 'draft';
  if (['live', 'scheduled', 'paused', 'ended'].includes(status)) return status;
  return 'draft';
}

export function listingStatusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'draft') return 'Draft';
  return auctionStatusLabel(s);
}

/** Listing states that are "not started yet" (used by the Draft filter). */
export function isNotStarted(status) {
  const s = String(status || '').toLowerCase();
  return s === 'draft' || s === 'scheduled';
}

export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function timeAgo(iso, now = new Date()) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 0) return 'just now';
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

export function formatClock(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/** "Today · 6:00 PM" for a scheduled auction start. */
export function formatStartLabel(iso, now = new Date()) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today · ${time}`;
  return `${d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} · ${time}`;
}

/** HH:MM:SS countdown from a target timestamp (cosmetic only — the server decides the winner). */
export function countdownTo(targetIso, now = Date.now()) {
  if (!targetIso) return '—';
  const t = new Date(targetIso).getTime();
  if (Number.isNaN(t)) return '—';
  let sec = Math.max(0, Math.floor((t - now) / 1000));
  const h = Math.floor(sec / 3600);
  sec -= h * 3600;
  const m = Math.floor(sec / 60);
  sec -= m * 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/** The lot identifier shown on the cards (real auction_code / listing id). */
export function lotCode(listingOrAuction, fallback = '—') {
  const code = listingOrAuction?.auction_code || listingOrAuction?.auction?.auction_code;
  if (code) return code;
  const id = listingOrAuction?.id || listingOrAuction?.auction?.id;
  if (!id) return fallback;
  return `LOT-${String(id).slice(0, 8).toUpperCase()}`;
}

/** "2 of 2 listings at Gmall Branch" */
export function scopedCountLabel(shown, total, noun, branchName) {
  return `${shown} of ${total} ${noun} at ${branchName}`;
}
