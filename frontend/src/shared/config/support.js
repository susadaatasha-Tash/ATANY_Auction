// frontend/src/shared/config/support.js
// ─────────────────────────────────────────────────────────────────────────────
// The ONE place the official ATANY support address is declared for the UI.
//
// SECURITY: this is a public ADDRESS only. It contains no credential and it
// is never used to authenticate anything. The backend keeps its own
// authoritative copy (backend/src/config/support.js, driven by
// ATANY_SUPPORT_EMAIL) and owns all delivery.
//
// Use this module instead of re-typing the address in a component.
export const SUPPORT_EMAIL = 'goldjewelryauction@gmail.com';

/**
 * Build a properly URL-encoded mailto: link (secondary fallback only — the
 * persisted support form is the primary channel).
 * @param {string} subject
 * @param {string} body
 */
export function supportMailto(subject, body) {
  const params = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${SUPPORT_EMAIL}${params.length ? `?${params.join('&')}` : ''}`;
}

// The support categories the backend accepts. Kept in sync with
// backend/src/config/support.js (SUPPORT_CATEGORIES).
export const SUPPORT_CATEGORIES = [
  'General Inquiry',
  'Bid Support',
  'Payout Question',
  'Account Issue',
  'Partnership',
  'Billing / Subscription',
  'Auction / Payment Support',
];

export default SUPPORT_EMAIL;
