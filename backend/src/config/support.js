// backend/src/config/support.js
// ─────────────────────────────────────────────────────────────────────────────
// THE single source of truth for the official ATANY support destination.
//
// Every support flow (public contact, customer portal, shop owner portal,
// suspended-account inquiries, expired-winner inquiries, billing/payment
// questions) resolves the recipient through THIS module — the address is
// never re-declared in a controller, a route or a service.
//
// Deployment source of truth:  ATANY_SUPPORT_EMAIL
//   (SUPPORT_EMAIL is accepted as a legacy alias so existing deployments keep
//    working; the explicit ATANY_ name always wins.)
//
// SECURITY: this module contains an ADDRESS only. Credentials (Resend API key,
// SMTP password, OAuth refresh token) stay in process.env and are never
// imported by, or returned from, anything reachable by a browser.
// The official ATANY support inbox — the ONE literal declaration of this
// address in the backend. Everything else resolves it through this module.
export const OFFICIAL_SUPPORT_EMAIL = 'goldjewelryauction@gmail.com';

/**
 * Resolve the support inbox address.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} a validated-looking email address (never empty)
 */
export function resolveSupportEmail(env = process.env) {
  const raw = (env.ATANY_SUPPORT_EMAIL || env.SUPPORT_EMAIL || '').trim();
  const candidate = raw || OFFICIAL_SUPPORT_EMAIL;
  return isValidEmail(candidate) ? candidate : OFFICIAL_SUPPORT_EMAIL;
}

/** Where the resolved address came from (safe to log — it is only a key name). */
export function supportEmailSource(env = process.env) {
  if ((env.ATANY_SUPPORT_EMAIL || '').trim()) return 'env:ATANY_SUPPORT_EMAIL';
  if ((env.SUPPORT_EMAIL || '').trim()) return 'env:SUPPORT_EMAIL';
  return 'default';
}

/** Is the resolved address the official ATANY inbox? */
export function isOfficialSupportEmail(address) {
  return String(address || '').trim().toLowerCase() === OFFICIAL_SUPPORT_EMAIL.toLowerCase();
}

/**
 * Shared email shape check. Deliberately permissive but rejects the obvious
 * injection/typo cases (no spaces, no angle brackets, one @, a dotted domain).
 */
export function isValidEmail(value) {
  const v = String(value || '').trim();
  if (!v || v.length > 254) return false;
  if (/[\s<>,;"'()]/.test(v)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

// ── Support categories ───────────────────────────────────────────────────────
// The original public-contact categories are preserved verbatim; the two
// additional values are the categories the newer flows (billing/subscription
// and expired-winner payment inquiries) need.
export const SUPPORT_CATEGORIES = [
  'General Inquiry',
  'Bid Support',
  'Payout Question',
  'Account Issue',
  'Partnership',
  'Billing / Subscription',
  'Auction / Payment Support',
];

/** Where a support request came from (stored on the row + shown in the email). */
export const SUPPORT_SOURCES = {
  PUBLIC: 'Public Contact Form',
  CUSTOMER: 'Customer Portal',
  SELLER: 'Shop Owner Portal',
  ACCOUNT: 'Account Support',
};

// ── Attachments ─────────────────────────────────────────────────────────────
// Images only, 5 MB max — the same restrictions ATANY already applies to
// listing/branch photos. Never archives, executables or documents.
export const SUPPORT_ATTACHMENT_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
export const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const SUPPORT_ATTACHMENT_BUCKET = 'atany-support';

/**
 * Validate an attachment filename.
 * @returns {string|null} an error message, or null when the name is allowed
 */
export function validateSupportAttachmentFilename(filename) {
  if (!filename || typeof filename !== 'string') return 'Attachment filename required';
  const lower = filename.trim().toLowerCase();
  const ok = SUPPORT_ATTACHMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
  if (!ok) return 'Please attach a JPG, PNG, or WEBP image under 5 MB.';
  return null;
}
