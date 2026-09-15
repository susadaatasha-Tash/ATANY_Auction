// backend/src/services/emailService.js
// Spec 4.6: Resend for notification emails + Supabase Auth custom SMTP for auth emails.
// Auth emails (verification/reset) are configured in Supabase dashboard → Auth → SMTP → Resend SMTP.
// This service handles notification emails only; keys server-side per spec 5.6.
export async function sendNotificationEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn('RESEND_API_KEY missing — skip email to', to); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'ATANY <noreply@atany.ph>', to, subject, html }),
  });
  if (!res.ok) console.error('Resend error', await res.text());
}
