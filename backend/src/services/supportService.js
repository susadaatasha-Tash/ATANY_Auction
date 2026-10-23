// backend/src/services/supportService.js
// ─────────────────────────────────────────────────────────────────────────────
// THE single backend implementation for every ATANY support flow.
//
// Public contact form, customer portal, shop owner portal, suspended-account
// inquiries and expired-winner inquiries ALL funnel through this service:
//   validate → persist → (best-effort) notify the official ATANY inbox.
//
// Contract:
//   • The support_requests ROW is authoritative. It is written FIRST.
//   • The email notification is best-effort. If the provider is missing,
//     misconfigured or temporarily failing, the request STAYS stored and the
//     caller is told honestly that the notification was delayed.
//   • The recipient is always resolveSupportEmail() (ATANY_SUPPORT_EMAIL).
//   • The requester's validated email is used as Reply-To so ATANY staff can
//     press Reply and answer the person directly. The requester is NEVER
//     used as the From address.
//   • No provider credential ever leaves this module.
import { pool } from '../db/pool.js';
import {
  resolveSupportEmail,
  supportEmailSource,
  isValidEmail,
  isOfficialSupportEmail,
  SUPPORT_CATEGORIES,
  SUPPORT_SOURCES,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  validateSupportAttachmentFilename,
} from '../config/support.js';

export {
  SUPPORT_CATEGORIES,
  SUPPORT_SOURCES,
  resolveSupportEmail,
  supportEmailSource,
  isOfficialSupportEmail,
};

const MAX_NAME = 150;
const MAX_SUBJECT = 200;
const MAX_MESSAGE = 5000;

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a support request. Backend validation is authoritative.
 * @returns {{code:string,field:string,message:string}|null} null when valid.
 */
export function validateSupportRequest({ name, email, subject, category, message, attachment } = {}) {
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  const cName = clean(name);
  const cEmail = clean(email).toLowerCase();
  const cCategory = clean(category) || 'General Inquiry';
  const cSubject = clean(subject);
  const cMessage = clean(message);

  if (!cName || cName.length > MAX_NAME) {
    return { code: 'INVALID_NAME', field: 'name', message: 'Please provide your name (max 150 characters).' };
  }
  if (!isValidEmail(cEmail)) {
    return { code: 'INVALID_EMAIL', field: 'email', message: 'Please provide a valid email address.' };
  }
  if (!SUPPORT_CATEGORIES.includes(cCategory)) {
    return { code: 'INVALID_CATEGORY', field: 'category', message: 'Please choose a valid category.' };
  }
  if (cSubject.length > MAX_SUBJECT) {
    return { code: 'INVALID_SUBJECT', field: 'subject', message: 'Please keep the subject under 200 characters.' };
  }
  if (!cMessage || cMessage.length > MAX_MESSAGE) {
    return { code: 'INVALID_MESSAGE', field: 'message', message: 'Please provide a message (max 5000 characters).' };
  }
  if (attachment && attachment.path) {
    const fileErr = validateSupportAttachmentFilename(attachment.filename);
    if (fileErr) return { code: 'INVALID_ATTACHMENT', field: 'attachment', message: fileErr };
    const size = Number(attachment.size || 0);
    if (size > SUPPORT_ATTACHMENT_MAX_BYTES) {
      return { code: 'INVALID_ATTACHMENT', field: 'attachment', message: 'Please attach a JPG, PNG, or WEBP image under 5 MB.' };
    }
  }
  return null;
}

// ── Reference id ────────────────────────────────────────────────────────────

/**
 * Human-readable support reference derived from the stored row id.
 * e.g. "SUP-9F3A2C"
 */
export function supportReference(id) {
  return `SUP-${String(id || '').replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

// ── Email body ──────────────────────────────────────────────────────────────

const escapeHtml = (v) =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** "[ATANY Support] Account Issue — Customer" */
export function buildSupportEmailSubject({ category, role, reference }) {
  const label = SUPPORT_CATEGORIES.includes(category) ? category : 'General Inquiry';
  const roleLabel = role === 'shop_owner' ? 'Shop Owner' : role === 'customer' ? 'Customer' : role === 'admin' ? 'Administrator' : 'Guest';
  const base = `[ATANY Support] ${label} — ${roleLabel}`;
  return reference ? `${base} #${String(reference).replace(/^SUP-/, '')}` : base;
}

/** The professional plain-text body ATANY staff receive. */
export function buildSupportEmailText({ reference, source, name, role, email, category, subject, message, submittedAt, attachmentLabel }) {
  const lines = [
    'ATANY SUPPORT REQUEST',
    '',
    `Reference: ${reference}`,
    `Source: ${source}`,
    '',
    `Name: ${name}`,
    `Role: ${role === 'shop_owner' ? 'Shop Owner' : role === 'customer' ? 'Customer' : role === 'admin' ? 'Administrator' : 'Guest'}`,
    `Email: ${email}`,
    `Category: ${category}`,
    `Subject: ${subject || '—'}`,
    '',
    'Message:',
    message,
    '',
    `Submitted: ${submittedAt}`,
  ];
  if (attachmentLabel) lines.push('', `Attachment: ${attachmentLabel}`);
  lines.push('', 'Reply directly to this email to respond to the requester.');
  return lines.join('\n');
}

/** The HTML twin of buildSupportEmailText. */
export function buildSupportEmailHtml(ctx) {
  const rows = [
    ['Reference', ctx.reference],
    ['Source', ctx.source],
    ['Name', ctx.name],
    ['Role', ctx.role === 'shop_owner' ? 'Shop Owner' : ctx.role === 'customer' ? 'Customer' : ctx.role === 'admin' ? 'Administrator' : 'Guest'],
    ['Email', ctx.email],
    ['Category', ctx.category],
    ['Subject', ctx.subject || '—'],
    ['Submitted', ctx.submittedAt],
  ]
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#848b96;font-size:12px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:4px 0;color:#1a2744;font-size:14px;font-weight:600;">${escapeHtml(v)}</td></tr>`)
    .join('');

  const attachment = ctx.attachmentLabel
    ? `<p style="margin:16px 0 0;font-size:13px;color:#1a2744;"><strong>Attachment:</strong> <a href="${escapeHtml(ctx.attachmentUrl || '#')}" style="color:#1a2744;">${escapeHtml(ctx.attachmentLabel)}</a> (secure link, expires shortly)</p>`
    : '';

  return `<div style="font-family:Helvetica,Arial,sans-serif;max-width:640px;">
  <h2 style="margin:0 0 4px;font-size:18px;color:#1a2744;letter-spacing:.04em;">ATANY SUPPORT REQUEST</h2>
  <p style="margin:0 0 18px;font-size:13px;color:#848b96;">A new support request was submitted through ATANY.</p>
  <table style="border-collapse:collapse;margin-bottom:16px;">${rows}</table>
  <div style="border-left:3px solid #c4a265;padding:10px 14px;background:#faf8f3;color:#1e2a3a;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(ctx.message)}</div>
  ${attachment}
  <p style="margin:18px 0 0;font-size:12px;color:#848b96;">Reply directly to this email to respond to the requester.</p>
</div>`;
}

// ── Persistence + notification ──────────────────────────────────────────────

/**
 * Persist a support request and fire the best-effort notification.
 *
 * @param {object} input
 * @param {string} input.source           one of SUPPORT_SOURCES
 * @param {string} input.requesterName    display name of the requester
 * @param {string} input.requesterEmail   validated reply address
 * @param {string} [input.requesterRole]  customer | shop_owner | admin | public
 * @param {string} [input.requesterUserId] authenticated user id (never from the client body)
 * @param {string} [input.subject]        free-text subject
 * @param {string} [input.category]       one of SUPPORT_CATEGORIES
 * @param {string} input.message          the inquiry
 * @param {object} [input.attachment]     { path, filename, size }
 * @param {object} [input.metadata]       safe context lines (no secrets)
 * @returns {Promise<{id:string,reference:string,status:string,received:boolean,
 *                    emailNotification:{sent:boolean,reason?:string}}>}
 */
export async function sendSupportNotification({
  source,
  requesterName,
  requesterEmail,
  requesterRole = 'public',
  requesterUserId = null,
  subject = '',
  category = 'General Inquiry',
  message,
  attachment = null,
  metadata = null,
} = {}) {
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  const cName = clean(requesterName);
  const cEmail = clean(requesterEmail).toLowerCase();
  const cCategory = SUPPORT_CATEGORIES.includes(clean(category)) ? clean(category) : 'General Inquiry';
  const cSubject = clean(subject);
  const cMessage = clean(message);
  const cSource = clean(source) || SUPPORT_SOURCES.PUBLIC;
  const attachmentPath = attachment?.path ? clean(attachment.path) : null;

  // 1) Persist FIRST — the row is the authoritative record of the inquiry.
  const { rows } = await pool.query(
    `INSERT INTO support_requests
       (name, email, subject, message, status, user_id, requester_role, category, source, attachment_path)
     VALUES ($1,$2,$3,$4,'new',$5,$6,$7,$8,$9)
     RETURNING id, created_at, status`,
    [
      cName,
      cEmail,
      cSubject || cCategory, // legacy rows stored the category in `subject`
      cMessage,
      requesterUserId || null,
      clean(requesterRole) || 'public',
      cCategory,
      cSource,
      attachmentPath,
    ]
  );

  const row = rows[0];
  const reference = supportReference(row.id);
  const submittedAt = new Date(row.created_at).toISOString();
  console.log('[support] request created', row.id);

  // 2) Best-effort notification to the official ATANY inbox.
  const to = resolveSupportEmail();
  const emailSubject = buildSupportEmailSubject({ category: cCategory, role: requesterRole, reference });
  const ctx = {
    reference,
    source: cSource,
    name: cName,
    role: requesterRole,
    email: cEmail,
    category: cCategory,
    subject: cSubject,
    message: buildMessageWithMetadata(cMessage, metadata),
    submittedAt,
    attachmentLabel: attachment?.filename || null,
    attachmentUrl: null,
  };

  // A private attachment is delivered as a short-lived signed link (never a
  // permanent public URL, never a service-role credential).
  if (attachmentPath) {
    try {
      const { createSupportAttachmentSignedUrl } = await import('./storageService.js');
      const signed = await createSupportAttachmentSignedUrl(attachmentPath);
      if (signed) ctx.attachmentUrl = signed;
    } catch (e) {
      console.warn('[support] attachment link failed (row stored):', e?.message);
    }
  }

  let emailNotification = { sent: false, accepted: false, provider: 'resend', reason: 'provider_not_configured' };
  try {
    const { sendNotificationEmail } = await import('./emailService.js');
    const result = await sendNotificationEmail({
      to,
      subject: emailSubject,
      html: buildSupportEmailHtml(ctx),
      text: buildSupportEmailText(ctx),
      // Reply goes straight to the person who contacted support.
      replyTo: cEmail,
    });
    emailNotification = {
      sent: result.sent === true,
      accepted: result.accepted === true,
      provider: result.provider || 'resend',
      ...(result.emailId ? { emailId: result.emailId } : {}),
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      ...(result.message ? { message: result.message } : {}),
    };
    // Keep a short 'reason' for the frontend delay notice.
    if (!emailNotification.sent) {
      emailNotification.reason = emailNotification.errorCode || result.reason || emailNotification.message || 'provider_error';
    }
    if (emailNotification.sent) {
      console.log('[support] email notification accepted by provider');
    } else {
      console.warn('[support] email delivery failed:', emailNotification.errorCode || emailNotification.reason || 'unknown');
    }
  } catch (mailErr) {
    console.warn('[support] email delivery failed (row stored):', mailErr?.message);
    emailNotification = { sent: false, accepted: false, provider: 'resend', reason: 'provider_error' };
  }

  return {
    id: row.id,
    reference,
    status: row.status || 'new',
    received: true,
    emailNotification,
  };
}

/** Append safe metadata lines to the message body. Never secrets. */
function buildMessageWithMetadata(message, metadata) {
  if (!metadata) return message;
  const entries = Object.entries(metadata).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return message;
  const lines = entries.map(([k, v]) => `${k}: ${v}`);
  return `${message}\n\n—\n${lines.join('\n')}`;
}

// ── Safe metadata ───────────────────────────────────────────────────────────
// A client may attach a small, whitelisted set of context values to a support
// request (plan name, billing reference, payment status, item name, transaction
// reference, expired deadline, the customer's OWN winning amount …).
// Anything outside the whitelist — and anything that looks like a credential —
// is dropped. Never a secret, never a card number, never a webhook signature.
const ALLOWED_METADATA_KEYS = [
  'plan',
  'plan_name',
  'billing_reference',
  'payment_status',
  'provider',
  'reference_id',
  'item',
  'auction',
  'transaction_code',
  'expired_payment_deadline',
  'winning_amount',
  'role',
];

const FORBIDDEN_METADATA = /(secret|api[_-]?key|password|passcode|cvc|cvv|\bpan\b|card[_-]?number|signature|authorization|bearer|token)/i;

/**
 * Whitelist + sanitize client-supplied metadata.
 * @returns {object|null} the safe subset, or null when nothing survives
 */
export function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const out = {};
  for (const key of ALLOWED_METADATA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(metadata, key)) continue;
    const value = metadata[key];
    if (value === undefined || value === null || value === '') continue;
    const str = String(value);
    if (FORBIDDEN_METADATA.test(key) || FORBIDDEN_METADATA.test(str)) continue;
    out[key] = str.slice(0, 200);
  }
  return Object.keys(out).length ? out : null;
}

export { ALLOWED_METADATA_KEYS };

/**
 * Backwards-compatible helper: the original public-contact contract.
 * Kept so existing callers keep working while routing through the shared
 * service (one email implementation, one destination).
 */
export async function createSupportRequest({ name, email, subject, message, category, source }) {
  return sendSupportNotification({
    source: source || SUPPORT_SOURCES.PUBLIC,
    requesterName: name,
    requesterEmail: email,
    requesterRole: 'public',
    subject: '',
    category: category || subject || 'General Inquiry',
    message,
  });
}
