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

export async function sendNotificationEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn('RESEND_API_KEY missing — skip email to', to); return; }
  const from = resolveFromEmail();
  if (!from) {
    console.error('RESEND_FROM_EMAIL missing in production — email not sent to', to);
    return;
  }
  // Best-effort notification: bound the wait so a stalled email provider can
  // never wedge a cron job (which would hold its pool client + onceAtATime flag
  // forever and slowly exhaust the pg pool).
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) console.error('Resend error', await res.text());
  } catch (e) {
    console.error('Resend send failed (best-effort, skipped):', e?.name || e?.message || e);
  }
}
