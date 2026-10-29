// backend/src/services/emailService.js
// Spec 4.6: Resend for notification emails + Supabase Auth custom SMTP for auth emails.
// Auth emails (verification/reset) are configured in Supabase dashboard → Auth → SMTP → Resend SMTP.
// This service handles notification emails only; keys server-side per spec 5.6.
export function resolveFromEmail() {
  const configured = (process.env.RESEND_FROM_EMAIL || '').trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  // Development fallback — works without domain verification (Resend test sender)
  return 'ATANY Test <onboarding@resend.dev>';
}

/**
 * Send a notification email.
 *
 * @param {object}   opts
 * @param {string}   opts.to       recipient(s)
 * @param {string}   opts.subject
 * @param {string}   opts.html
 * @param {string?}  opts.replyTo  optional Reply-To address, so the recipient can
 *                                 reply straight to the person who asked for help.
 *                                 Sanitised by the caller/config helper.
 *
 * NOTE ON THE SENDER: `from` stays the existing verified ATANY sender. The
 * destination mailbox is only ever a RECIPIENT — it is never used as a FROM
 * address, because doing so would require the provider to trust a mailbox we do
 * not control.
 */
export async function sendNotificationEmail({ to, subject, html, replyTo }) {
  // Provider-agnostic. EMAIL_PROVIDER selects Gmail SMTP or the original Resend
  // implementation; both honour the same { to, subject, html, replyTo } contract,
  // so callers (contact + support notifications) are unaware of the transport.
  const { deliver } = await import('./emailTransport.js');
  return deliver({ to, subject, html, replyTo, from: resolveFromEmail() });
}
