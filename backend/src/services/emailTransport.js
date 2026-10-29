// backend/src/services/emailTransport.js
//
// Outgoing email transport with a provider abstraction.
//
// WHY THIS EXISTS
// ---------------
// The contact/support notifications previously went out through Resend using its
// shared test sender (`onboarding@resend.dev`). Resend only permits that sender
// to deliver to the account owner's own address, so real enquiries to
// goldjewelryauction@gmail.com were rejected with HTTP 403.
//
// ATANY can now deliver through Gmail SMTP instead, which requires an App
// Password (NOT the normal Gmail password) on the account.
//
// PROVIDERS
// ---------
//   EMAIL_PROVIDER=gmail   -> Gmail SMTP via nodemailer (host/port/secure from
//                            SMTP_HOST / SMTP_PORT / SMTP_SECURE)
//   EMAIL_PROVIDER=resend  -> the original Resend HTTP implementation
//   (unset)                -> resend, preserving today's behaviour
//
// SECURITY RULES (enforced here, not by convention)
//   · SMTP credentials are read ONLY from the environment. Nothing is hardcoded.
//   · The App Password is never logged, never returned, never attached to an
//     error message, and never reaches an API response.
//   · Diagnostics name the MISSING VARIABLE, never its value.
//   · `from` is always an address we control; the destination mailbox is only
//     ever a recipient (or the authenticated sender for Gmail SMTP).
import nodemailer from 'nodemailer';
import { sanitizeReplyTo } from '../config/contact.js';

const providerName = () => String(process.env.EMAIL_PROVIDER || 'resend').trim().toLowerCase();

const bool = (v, fallback) => {
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
};

/** Public, credential-free snapshot of the effective configuration. */
export function describeConfig() {
  const provider = providerName();
  if (provider !== 'gmail') {
    return { provider, configured: Boolean(process.env.RESEND_API_KEY) };
  }
  const missing = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']
    .filter((k) => !String(process.env[k] || '').trim());
  return {
    provider,
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || '465',
    secure: bool(process.env.SMTP_SECURE, true),
    // user is an address, not a secret; reported so misconfiguration is obvious
    user: process.env.SMTP_USER ? String(process.env.SMTP_USER).trim() : null,
    from: process.env.SMTP_FROM || (process.env.SMTP_USER ? `ATANY Support <${process.env.SMTP_USER}>` : null),
    configured: missing.length === 0,
    missing,
  };
}

let cached = null;

/** Lazily built nodemailer transport (never created at import time). */
export function getSmtpTransport() {
  if (cached) return cached;
  const cfg = describeConfig();
  if (!cfg.configured) {
    // Name the variable, never the value.
    const err = new Error(`Gmail SMTP is not configured. Missing environment variable(s): ${cfg.missing.join(', ')}.`);
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  cached = nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port),
    secure: cfg.secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return cached;
}

/** Reset the memoised transporter (used by tests and after a config change). */
export function resetTransport() { cached = null; }

/* ── Gmail SMTP ─────────────────────────────────────────────────────────── */

export async function sendViaGmailSmtp({ to, subject, html, replyTo: rawReplyTo }) {
  const cfg = describeConfig();
  // Defence in depth: this is the last hop before an SMTP header, so the
  // Reply-To is sanitised here too, not only by the calling service.
  const replyTo = sanitizeReplyTo(rawReplyTo);
  if (rawReplyTo && !replyTo) {
    console.warn('[email] Reply-To rejected as unsafe/invalid — continuing without it.');
  }
  if (!cfg.configured) {
    console.error(`[email] Gmail SMTP not configured — missing: ${cfg.missing.join(', ')}. Message NOT sent.`);
    return { delivered: false, provider: 'gmail', error: 'smtp-not-configured' };
  }
  try {
    const info = await getSmtpTransport().sendMail({
      from: cfg.from,                       // ATANY Support <smtp user>
      to,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),     // Reply targets the enquirer
    });
    return { delivered: true, provider: 'gmail', accepted: info.accepted || [], rejected: info.rejected || [] };
  } catch (e) {
    // Provider errors can echo the auth user; strip anything credential-shaped
    // and never surface the App Password.
    console.error('[email] Gmail SMTP send failed:', safeError(e));
    return { delivered: false, provider: 'gmail', error: 'smtp-send-failed' };
  }
}

/**
 * Verify SMTP credentials.
 * Diagnostic wording is intentionally actionable without exposing secrets.
 */
export async function verifySmtp() {
  const cfg = describeConfig();
  if (!cfg.configured) {
    const message = `Gmail SMTP is not configured. Missing: ${cfg.missing.join(', ')}.`;
    console.error(`[email] ${message}`);
    return { ok: false, configured: false, message };
  }
  try {
    await getSmtpTransport().verify();
    console.log('Gmail SMTP connection verified.');
    return { ok: true, configured: true, message: 'Gmail SMTP connection verified.' };
  } catch (e) {
    const message = 'Gmail SMTP authentication failed. Check 2-Step Verification and App Password configuration.';
    console.error(`[email] ${message}`, safeError(e));
    return { ok: false, configured: true, message };
  }
}

/* ── Resend (existing behaviour) ────────────────────────────────────────── */

export async function sendViaResend({ to, subject, html, replyTo: rawReplyTo, from }) {
  const replyTo = sanitizeReplyTo(rawReplyTo);
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[email] RESEND_API_KEY missing — skip email to', to);
    return { delivered: false, provider: 'resend', error: 'no-api-key' };
  }
  if (!from) {
    console.error('[email] RESEND_FROM_EMAIL missing — email not sent to', to);
    return { delivered: false, provider: 'resend', error: 'no-from' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error('Resend error', await res.text());
      return { delivered: false, provider: 'resend', error: 'resend-http-error' };
    }
    return { delivered: true, provider: 'resend' };
  } catch (e) {
    console.error('[email] Resend send failed (best-effort):', safeError(e));
    return { delivered: false, provider: 'resend', error: 'resend-failed' };
  }
}

/* ── helpers ────────────────────────────────────────────────────────────── */

/** Strip credential-shaped fragments out of provider error text before logging. */
export function safeError(e) {
  const raw = String(e?.message || e?.code || e || 'unknown error');
  return raw
    .replace(/(pass|password|auth|secret|token|apikey|api_key|bearer)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 300);
}

/** Provider-agnostic entry point used by sendNotificationEmail(). */
export async function deliver({ to, subject, html, replyTo, from }) {
  if (providerName() === 'gmail') return sendViaGmailSmtp({ to, subject, html, replyTo });
  return sendViaResend({ to, subject, html, replyTo, from });
}

export default { deliver, describeConfig, verifySmtp, resetTransport, getSmtpTransport };
