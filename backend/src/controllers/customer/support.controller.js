// backend/src/controllers/customer/support.controller.js
//
// Authenticated "Contact Us" for signed-in customers (Profile → Help & Support).
//
// WHY THIS EXISTS
// ---------------
// The old customer Settings page wrote support requests straight from the
// browser with `supabase.from('support_requests').insert(...)`, trusting
// client-supplied name/email. That bypassed backend validation, rate limiting
// and any identity check.
//
// SECURITY CONTRACT
// -----------------
// · The request body carries ONLY subject + message. Name and email are read
//   from the verified session's own row, so a client cannot file a support
//   request as somebody else.
// · Rate limited per client.
// · The stored support_requests row remains the authoritative record; a failed
//   notification email never turns a stored request into a failed request.
import { pool } from '../../db/pool.js';
import { sendSupportNotification } from '../../services/supportNotification.js';

const MAX_SUBJECT = 80;
const MAX_MESSAGE = 4000;

export function validateSupportRequest(body = {}) {
  const subject = String(body.subject || '').trim();
  const message = String(body.message || '').trim();
  const errors = {};
  if (!subject) errors.subject = 'Please choose a subject.';
  else if (subject.length > MAX_SUBJECT) errors.subject = 'Subject is too long.';
  if (message.length < 5) errors.message = 'Please tell us a little more.';
  else if (message.length > MAX_MESSAGE) errors.message = 'Message is too long.';
  return { value: { subject, message }, errors };
}

export const createCustomerSupportRequest = async (req, res) => {
  const { value, errors } = validateSupportRequest(req.body);
  if (Object.keys(errors).length) {
    return res.status(400).json({ message: 'Please check the form and try again.', errors });
  }

  // Identity is server-derived — never taken from the request body.
  // The lookup is inside the guarded block too: a database failure here must
  // produce the same safe 503 as a failed insert, never an unhandled rejection.
  let account = null;
  try {
    const { rows } = await pool.query('SELECT name, email FROM users WHERE id = $1', [req.user.id]);
    account = rows[0];
  } catch (e) {
    console.error('[customer/support] identity lookup failed:', e.message);
    return res.status(503).json({ message: 'We could not record your message. Please try again shortly.' });
  }
  if (!account) return res.status(404).json({ message: 'Account not found' });

  // Optional image attachment, already uploaded to the PRIVATE support bucket.
  // Only the object path is accepted/stored — never raw bytes or a public URL.
  const attachmentPath = typeof req.body?.attachment_path === 'string' && req.body.attachment_path.trim()
    ? req.body.attachment_path.trim().slice(0, 300)
    : null;

  let inserted = null;
  try {
    const result = await pool.query(
      `INSERT INTO public.support_requests (name, email, subject, message, status, attachment_path)
       VALUES ($1, $2, $3, $4, 'new', $5) RETURNING id, created_at`,
      [account.name, account.email, value.subject, value.message, attachmentPath]
    );
    inserted = result.rows[0] || null;
  } catch (e) {
    console.error('[customer/support] insert failed:', e.message);
    return res.status(503).json({ message: 'We could not record your message. Please try again shortly.' });
  }

  // Best-effort notification; the database row is authoritative. Recipient comes
  // from config and Reply-To is the authenticated customer, so pressing Reply in
  // the inbox reaches the customer directly.
  await sendSupportNotification({
    kind: 'customer',
    name: account.name,
    email: account.email,
    subject: value.subject,
    message: value.message,
    attachmentPath,
  });

  return res.status(201).json({ ok: true, id: inserted?.id || null });
};

export const __test = { validateSupportRequest, MAX_SUBJECT, MAX_MESSAGE };
