// backend/src/controllers/public.controller.js
//
// PUBLIC, UNAUTHENTICATED reads for the marketing landing page.
//
// SECURITY CONTRACT
// -----------------
// These endpoints are reachable by anyone on the internet. They therefore return
// AGGREGATE COUNTS and PUBLIC BRANCH FACTS only — never identities, never money,
// never private account state. Every value here is already visible elsewhere in
// the UI (branch addresses on a store locator; totals that anyone could count).
//
// Everything is served from the SAME authoritative tables the Admin portal
// manages (/admin/branches → branches; auctions/products/users below), so the
// landing page can never drift into showing its own hardcoded copy.

import { pool } from '../db/pool.js';
import { sendSupportNotification } from '../services/supportNotification.js';

/** Fields of `branches` that are safe to publish. Nothing else is exposed. */
const PUBLIC_BRANCH_FIELDS = 'id, name, address, lat, lng, hours, phone, status, branch_image_url';

/**
 * Real, database-derived counters for the landing statistics strip.
 *
 * Definitions are deliberately conservative and countable:
 *   registeredCustomers — role=customer accounts (any status: registration is
 *                         the fact being counted)
 *   jewelryPieces       — products in the catalogue
 *   completedAuctions   — auctions that reached status 'ended'
 *   branches            — active branches a visitor can actually visit
 *
 * There is deliberately NO "satisfaction rate": the platform stores no such
 * measurement, and the landing page must not imply one.
 */
export async function getPublicStats(_req, res) {
  try {
    const [customers, pieces, endedAuctions, branchRows] = await Promise.all([
      pool.query(`SELECT count(*)::int AS n FROM users WHERE role = 'customer'`),
      pool.query('SELECT count(*)::int AS n FROM products'),
      pool.query(`SELECT count(*)::int AS n FROM auctions WHERE status = 'ended'`),
      pool.query(`SELECT count(*)::int AS n FROM branches WHERE status = 'Open'`),
    ]);
    res.json({
      registeredCustomers: customers.rows[0]?.n ?? 0,
      jewelryPieces: pieces.rows[0]?.n ?? 0,
      completedAuctions: endedAuctions.rows[0]?.n ?? 0,
      branches: branchRows.rows[0]?.n ?? 0,
      source: 'database',
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    // The landing page degrades to "—" rather than showing invented numbers, so
    // an honest failure is better than a fabricated fallback.
    console.error('[public/stats]', e.message);
    res.status(503).json({ message: 'Statistics are temporarily unavailable.' });
  }
}

/** Public branch read used by /branches and the landing page. */
export async function getPublicBranches(_req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT ${PUBLIC_BRANCH_FIELDS} FROM branches ORDER BY name ASC`
    );
    res.json(rows);
  } catch (e) {
    console.error('[public/branches]', e.message);
    res.status(503).json({ message: 'Branch information is temporarily unavailable.' });
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Contact — the landing form previously wrote straight to Supabase from the
 * browser (anonymous insert, no rate limit, no validation server-side). It now
 * goes through the backend so it can be validated and rate-limited, while the
 * database row stays the authoritative record.
 * ──────────────────────────────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBJECTS = ['General Inquiry', 'Bid Support', 'Payout Question', 'Account Issue', 'Partnership'];

function validateContact(body = {}) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const subject = String(body.subject || 'General Inquiry').trim();
  const message = String(body.message || '').trim();
  const errors = {};
  if (name.length < 2 || name.length > 120) errors.name = 'Name must be 2-120 characters.';
  if (!EMAIL_RE.test(email) || email.length > 160) errors.email = 'A valid email address is required.';
  if (subject.length > 80) errors.subject = 'Subject is too long.';
  if (message.length < 5 || message.length > 4000) errors.message = 'Message must be 5-4000 characters.';
  return { value: { name, email, subject, message }, errors, subjectKnown: SUBJECTS.includes(subject) };
}

export async function postPublicContact(req, res) {
  const { value, errors } = validateContact(req.body);
  if (Object.keys(errors).length) {
    return res.status(400).json({ message: 'Please check the form and try again.', errors });
  }

  // An optional image attachment, already uploaded to the PRIVATE support
  // bucket. Only the object path is accepted/stored — never raw bytes.
  const attachmentPath = typeof req.body?.attachment_path === 'string' && req.body.attachment_path.trim()
    ? req.body.attachment_path.trim().slice(0, 300)
    : null;

  let inserted = null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.support_requests (name, email, subject, message, status, attachment_path)
       VALUES ($1, $2, $3, $4, 'new', $5) RETURNING id, created_at`,
      [value.name, value.email, value.subject, value.message, attachmentPath]
    );
    inserted = rows[0] || null;
  } catch (e) {
    console.error('[public/contact] insert failed', e.message);
    return res.status(503).json({ message: 'We could not record your message. Please try again shortly.' });
  }

  // Notification is best-effort and NEVER blocks the stored request: the row is
  // authoritative. Recipient/Reply-To/template are centralised in
  // services/supportNotification.js so guests and customers cannot drift.
  await sendSupportNotification({
    kind: 'guest',
    name: value.name,
    email: value.email,
    subject: value.subject,
    message: value.message,
    attachmentPath,
  });

  return res.status(201).json({ ok: true, id: inserted?.id || null });
}

export const __test = { validateContact, PUBLIC_BRANCH_FIELDS, SUBJECTS };