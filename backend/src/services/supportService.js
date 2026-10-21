// backend/src/services/supportService.js
// Shared support-request writer for the ATANY support flow.
//
// The support_requests row is the authoritative record. An optional Resend
// notification to the support inbox is best-effort and never blocks storage.
//
// NOTE: the public landing endpoint (POST /api/public/contact) keeps its own
// inline implementation so the proven public flow is untouched; both write to
// the same table with the same subject whitelist.
import { pool } from '../db/pool.js';

export const SUPPORT_SUBJECTS = [
  'General Inquiry',
  'Bid Support',
  'Payout Question',
  'Account Issue',
  'Partnership',
];

const MAX_NAME = 150;
const MAX_MESSAGE = 5000;

/**
 * Validate a support request.
 * @returns {{code:string,field:string,message:string}|null} null when valid.
 */
export function validateSupportRequest({ name, email, subject, message }) {
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  const cName = clean(name);
  const cEmail = clean(email).toLowerCase();
  const cSubject = clean(subject) || 'General Inquiry';
  const cMessage = clean(message);

  if (!cName || cName.length > MAX_NAME) {
    return { code: 'INVALID_NAME', field: 'name', message: 'Please provide your name (max 150 characters).' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cEmail) || cEmail.length > 254) {
    return { code: 'INVALID_EMAIL', field: 'email', message: 'Please provide a valid email address.' };
  }
  if (!SUPPORT_SUBJECTS.includes(cSubject)) {
    return { code: 'INVALID_SUBJECT', field: 'subject', message: 'Please choose a valid subject.' };
  }
  if (!cMessage || cMessage.length > MAX_MESSAGE) {
    return { code: 'INVALID_MESSAGE', field: 'message', message: 'Please provide a message (max 5000 characters).' };
  }
  return null;
}

/**
 * Persist a support request and fire the best-effort email notification.
 * @returns {Promise<{id:string,received:boolean}>}
 */
export async function createSupportRequest({ name, email, subject, message }) {
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  const cName = clean(name);
  const cEmail = clean(email).toLowerCase();
  const cSubject = clean(subject) || 'General Inquiry';
  const cMessage = clean(message);

  const { rows } = await pool.query(
    'INSERT INTO support_requests (name, email, subject, message) VALUES ($1,$2,$3,$4) RETURNING id, created_at',
    [cName, cEmail, cSubject, cMessage]
  );

  try {
    const { sendNotificationEmail } = await import('./emailService.js');
    await sendNotificationEmail({
      to: process.env.SUPPORT_EMAIL || 'support@atany.ph',
      subject: `ATANY contact — ${cSubject}`,
      html: `<p><strong>${cName}</strong> (${cEmail})</p><p>${cMessage}</p>`,
    });
  } catch (mailErr) {
    console.warn('[supportService] email notification failed (row stored):', mailErr.message);
  }

  return { id: rows[0].id, received: true };
}
