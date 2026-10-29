// backend/src/config/contact.js
//
// SINGLE SOURCE OF TRUTH for where ATANY contact/support notifications are
// delivered. Both the public contact endpoint and the authenticated customer
// support endpoint import this, so the recipient address is never duplicated
// (or silently drifting) across controllers.
//
// The address is a public destination, not a secret. No credentials live here.
// Override with SUPPORT_RECIPIENT_EMAIL in the environment.
export const SUPPORT_RECIPIENT_EMAIL = (
  process.env.SUPPORT_RECIPIENT_EMAIL || 'goldjewelryauction@gmail.com'
).trim();

/**
 * Reply-To: the person who asked for help, so whoever reads the notification
 * can simply hit Reply.
 *
 * Sanitised here rather than at each call site: only a plain, single
 * `local@domain.tld` address is allowed through, which is enough to stop a
 * caller from smuggling extra header content (e.g. injected newlines) into the
 * provider payload.
 */
export function sanitizeReplyTo(email) {
  const value = String(email || '').trim();
  if (!value) return null;
  // Reject anything with whitespace, angle brackets, commas or CRLF — all of
  // which are the usual vectors for header injection.
  if (/[\s<>,;"']/.test(value)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  return value;
}
