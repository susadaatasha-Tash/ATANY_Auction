// backend/src/services/emailService.js
// Spec 4.6: Resend for notification emails + Supabase Auth custom SMTP for auth emails.
// Auth emails (verification/reset) are configured in Supabase dashboard → Auth → SMTP → Resend SMTP.
// This service handles notification emails only; keys server-side per spec 5.6.
//
// SECURITY: the API key is read from process.env and is NEVER logged, never
// returned to a caller and never sent to the browser.
//
// The sender (From) is always the provider-authorized ATANY sender — the
// support inbox is a RECIPIENT, never a From address, because Resend only
// allows a From domain the account has verified. Replying to the requester
// is achieved with `reply_to`, which is the provider-sanctioned way to let
// staff answer the person who contacted support.
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
 * @param {object} opts
 * @param {string|string[]} opts.to        recipient(s)
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} [opts.text]             plain-text alternative
 * @param {string} [opts.replyTo]          reply address (the requester)
 * @returns {Promise<{sent:boolean, accepted:boolean, provider:string,
 *                    emailId?:string, errorCode?:string, message?:string}>}
 *          `sent`/`accepted` are true ONLY when the provider accepted the message.
 */
export async function sendNotificationEmail({ to, subject, html, text, replyTo }) {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) {
    console.warn('RESEND_API_KEY missing — skip email to', to);
    return { sent: false, accepted: false, provider: 'resend', errorCode: 'provider_not_configured', message: 'Email provider is not configured.' };
  }
  const from = resolveFromEmail();
  if (!from) {
    console.error('RESEND_FROM_EMAIL missing in production — email not sent to', to);
    return { sent: false, accepted: false, provider: 'resend', errorCode: 'sender_not_configured', message: 'Authorized sender is not configured.' };
  }

  const payload = { from, to, subject, html };
  if (text) payload.text = text;
  // The requester's validated address becomes Reply-To — staff can press
  // Reply and answer the requester directly. The requester is NEVER the From.
  if (replyTo) payload.reply_to = replyTo;

  // Best-effort notification: bound the wait so a stalled email provider can
  // never wedge a cron job (which would hold its pool client + onceAtATime flag
  // forever and slowly exhaust the pg pool).
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      let errorCode = 'provider_rejected';
      let message = `Resend returned HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.name) errorCode = body.name;
        if (body?.message) message = body.message;
      } catch {}
      console.error('Resend error:', errorCode, message);
      return { sent: false, accepted: false, provider: 'resend', errorCode, message };
    }
    const body = await res.json().catch(() => ({}));
    return { sent: true, accepted: true, provider: 'resend', emailId: body?.id || null };
  } catch (e) {
    console.error('Resend send failed:', e?.name || e?.message || e);
    return { sent: false, accepted: false, provider: 'resend', errorCode: 'provider_unreachable', message: 'Email provider is temporarily unreachable.' };
  }
}
