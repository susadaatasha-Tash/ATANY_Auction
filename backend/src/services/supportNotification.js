// backend/src/services/supportNotification.js
//
// One place that renders and sends the ATANY contact/support notification, so
// the guest and customer flows cannot drift in recipient, Reply-To or layout.
//
// Behaviour contract
// ------------------
// · The row in `support_requests` is the authoritative record. This notification
//   is strictly best-effort AFTER persistence: a mail failure never deletes or
//   invalidates the stored request.
// · The recipient comes from config (SUPPORT_RECIPIENT_EMAIL), never from the
//   caller, so no request body can redirect the mail.
// · Reply-To is the person who asked for help, so pressing Reply just works.
// · No passwords, tokens, or unrelated account data are ever included.
import { sendNotificationEmail } from './emailService.js';
import { createSupportSignedUrl } from './storageService.js';
import { SUPPORT_RECIPIENT_EMAIL, sanitizeReplyTo } from '../config/contact.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Build the notification HTML.
 * @param {object} o
 * @param {'guest'|'customer'} o.kind
 * @param {string} o.name
 * @param {string} o.email
 * @param {string} o.subject
 * @param {string} o.message
 * @param {string?} o.attachmentPath
 * @param {string?} o.attachmentUrl  signed, time-limited link
 */
export function buildSupportEmail({ kind, name, email, subject, message, attachmentUrl }) {
  const title = kind === 'customer'
    ? 'ATANY Customer Support Request'
    : 'ATANY Guest Contact';

  const rows = [
    ['Sender', name],
    ['Sender email', email],
    ['Subject', subject],
  ]
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#8A94A8;font-size:13px;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:4px 0;color:#142A4A;font-size:13px;font-weight:600">${esc(v)}</td></tr>`)
    .join('');

  const attachmentBlock = attachmentUrl
    ? `<p style="margin:18px 0 6px;color:#142A4A;font-size:13px;font-weight:700">Attachment</p>
       <p style="margin:0"><a href="${esc(attachmentUrl)}" style="color:#8A6D2B;font-size:13px">View the attached image</a></p>
       <p style="margin:8px 0 0;color:#8A94A8;font-size:11px">This private link expires in 7 days. Ask ATANY support to re-send it if it has lapsed.</p>`
    : `<p style="margin:18px 0 0;color:#8A94A8;font-size:11px">No image was attached to this request.</p>`;

  return `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:640px">
  <div style="background:#142A4A;color:#fff;padding:18px 24px;border-radius:12px 12px 0 0">
    <div style="font-size:15px;font-weight:800;letter-spacing:.5px">${esc(title)}</div>
  </div>
  <div style="background:#FFFEFB;border:1px solid #EDE9E1;border-top:none;padding:22px 24px;border-radius:0 0 12px 12px">
    <table style="border-collapse:collapse;margin-bottom:16px">${rows}</table>
    <p style="margin:0 0 6px;color:#142A4A;font-size:13px;font-weight:700">Message</p>
    <div style="color:#3B4654;font-size:13px;line-height:1.65;white-space:pre-wrap">${esc(message)}</div>
    ${attachmentBlock}
  </div>
</div>`;
}

/**
 * Send the notification. Never throws — callers persist first and treat mail as
 * optional, so a provider outage must not surface to the person who submitted.
 * @returns {Promise<{ delivered: boolean, reason?: string }>}
 */
export async function sendSupportNotification({ kind, name, email, subject, message, attachmentPath }) {
  let attachmentUrl = null;
  if (attachmentPath) {
    try {
      attachmentUrl = await createSupportSignedUrl(attachmentPath);
    } catch (e) {
      console.warn('[supportNotification] could not sign attachment link:', e?.message || e);
    }
  }

  const html = buildSupportEmail({ kind, name, email, subject, message, attachmentUrl });
  const replyTo = sanitizeReplyTo(email);

  try {
    await sendNotificationEmail({
      to: SUPPORT_RECIPIENT_EMAIL,
      subject: `[ATANY ${kind === 'customer' ? 'support' : 'contact'}] ${subject} — ${name}`,
      html,
      replyTo,
    });
    return { delivered: true };
  } catch (e) {
    // Logged server-side only; the stored request is untouched and the caller
    // still reports success to the user.
    console.error('[supportNotification] delivery failed (request already stored):', e?.message || e);
    return { delivered: false, reason: 'email-failed' };
  }
}

export const __test = { buildSupportEmail, esc };
