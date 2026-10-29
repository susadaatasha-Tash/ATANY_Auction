// backend/src/controllers/customer/account.controller.js
//
// Customer profile — authoritative, self-service, and deliberately narrow.
//
// SECURITY CONTRACT
// -----------------
// · The acting user ALWAYS comes from the verified session (req.user.id).
//   A client-supplied user id / userId in the body is never read as authority,
//   so one customer can never edit another account.
// · updateAccount writes a strict ALLOW-LIST of columns: name and phone only.
//   role, status, admin flags, shop ownership, subscriptions, created_at and
//   suspension state are structurally unreachable — they are not merely ignored,
//   they are never interpolated into any statement.
// · Preferred Branch stays on its own dedicated endpoint (PUT /customer/preferred-branch)
//   so it cannot be smuggled through the profile update.
// · Passwords never appear here. Password change lives entirely inside Supabase
//   Auth; this file has no password column, no hashing and no comparison.
import { pool } from '../../db/pool.js';

/**
 * Philippine mobile numbers.
 *
 * Accepts the formats people actually type, and normalises to a single
 * E.164-ish canonical form so the stored value is comparable:
 *   09XXXXXXXXX      -> +639XXXXXXXXX
 *   9XXXXXXXXX       -> +639XXXXXXXXX
 *   +639XXXXXXXXX    -> +639XXXXXXXXX
 *   63XXXXXXXXX      -> +639XXXXXXXXX
 * Spaces, dashes, dots and parentheses are ignored.
 *
 * Landlines (02 ...) and short codes are deliberately NOT accepted: this field
 * is a mobile contact number used for bid/pickup coordination.
 */
// Each alternative carries its own digit count. Writing `(\+?63|0?9)\d{9}`
// was an off-by-one bug: "+639XXXXXXXXX" has TEN digits after +63, so every
// stored +63 number would have been rejected on its next save.
const PHONE_ALLOWED = /^(\+?63\d{10}|09\d{9}|9\d{9})$/;

/**
 * Normalise + validate a Philippine mobile number.
 * @returns {{ ok: true, value: string } | { ok: false }}
 */
export function normalizePhone(raw) {
  if (raw === undefined || raw === null) return { ok: false };
  const cleaned = String(raw).replace(/[\s().-]/g, '');
  if (!PHONE_ALLOWED.test(cleaned)) return { ok: false };
  let digits = cleaned.replace(/^\+/, '');
  if (digits.startsWith('63')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 10 || !digits.startsWith('9')) return { ok: false };
  return { ok: true, value: `+63${digits}` };
}

/** Shared, user-facing phone error. Never leaks the regex or server internals. */
export const PHONE_INVALID_MESSAGE = 'Enter a valid Philippine mobile number.';

const MAX_NAME_LENGTH = 120;

/**
 * Validate the profile fields a customer is allowed to change.
 * Returns `{ changes, error }` — `changes` only ever contains name/phone.
 */
export function validateProfileUpdate(body = {}) {
  const changes = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim().replace(/\s+/g, ' ');
    if (name.length < 2) return { error: 'Enter your full name.' };
    if (name.length > MAX_NAME_LENGTH) return { error: `Name must be ${MAX_NAME_LENGTH} characters or fewer.` };
    changes.name = name;
  }

  if (body.phone !== undefined) {
    // An explicit empty string clears the phone; anything else must be valid.
    if (body.phone === null || String(body.phone).trim() === '') {
      changes.phone = null;
    } else {
      const result = normalizePhone(body.phone);
      if (!result.ok) return { error: PHONE_INVALID_MESSAGE };
      changes.phone = result.value;
    }
  }

  return { changes };
}

/** Only the fields a customer may read about themselves. */
function publicProfile(u, preferred_branch_name) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone || null,
    preferred_branch_id: u.preferred_branch_id,
    preferred_branch_name: preferred_branch_name || null,
    created_at: u.created_at,
  };
}

export const getAccount = async (req, res) => {
  try {
    const { rows: users } = await pool.query(
      'SELECT id, name, email, phone, preferred_branch_id, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    const u = users[0];
    if (!u) return res.status(404).json({ message: 'Account not found' });
    let preferred_branch_name = null;
    if (u.preferred_branch_id) {
      const { rows: branches } = await pool.query('SELECT name FROM branches WHERE id=$1', [u.preferred_branch_id]);
      preferred_branch_name = branches[0]?.name || null;
    }
    res.json(publicProfile(u, preferred_branch_name));
  } catch (e) {
    console.error('getAccount failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch account' });
  }
};

export const updateAccount = async (req, res) => {
  const { changes, error } = validateProfileUpdate(req.body);
  if (error) return res.status(400).json({ message: error });

  // Nothing recognised was supplied. Report success without touching the DB so
  // the client can treat a no-op save as a clean outcome.
  if (Object.keys(changes).length === 0) {
    const { rows } = await pool.query(
      'SELECT id, name, email, phone, preferred_branch_id, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Account not found' });
    let branchName = null;
    if (rows[0].preferred_branch_id) {
      const b = await pool.query('SELECT name FROM branches WHERE id=$1', [rows[0].preferred_branch_id]);
      branchName = b.rows[0]?.name || null;
    }
    return res.json({ profile: publicProfile(rows[0], branchName) });
  }

  try {
    // Build the SET list ONLY from validated allow-listed keys. Column names are
    // literals chosen here; every value is a bound parameter.
    const sets = [];
    const values = [];
    if (changes.name !== undefined) { values.push(changes.name); sets.push(`name = $${values.length}`); }
    if (changes.phone !== undefined) { values.push(changes.phone); sets.push(`phone = $${values.length}`); }
    values.push(req.user.id);

    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length}
       RETURNING id, name, email, phone, preferred_branch_id, created_at`,
      values
    );
    const updated = rows[0];
    if (!updated) return res.status(404).json({ message: 'Account not found' });

    let branchName = null;
    if (updated.preferred_branch_id) {
      const b = await pool.query('SELECT name FROM branches WHERE id=$1', [updated.preferred_branch_id]);
      branchName = b.rows[0]?.name || null;
    }
    res.json({ profile: publicProfile(updated, branchName) });
  } catch (e) {
    console.error('updateAccount failed:', e.message);
    res.status(500).json({ message: 'Unable to update profile.' });
  }
};

export const getPreferredBranch = async (req, res) => {
  try {
    const { rows: users } = await pool.query('SELECT preferred_branch_id FROM users WHERE id=$1', [req.user.id]);
    const preferred_branch_id = users[0]?.preferred_branch_id || null;
    if (!preferred_branch_id) return res.json({ preferred_branch_id: null });
    const { rows: branches } = await pool.query('SELECT * FROM branches WHERE id=$1', [preferred_branch_id]);
    res.json({
      preferred_branch_id,
      branch_name: branches[0]?.name || null,
      branch_address: branches[0]?.address || null,
    });
  } catch (e) {
    console.error('getPreferredBranch failed:', e.message);
    res.status(500).json({ message: 'Failed to get preferred branch' });
  }
};

export const setPreferredBranch = async (req, res) => {
  const branchId = req.body?.branch_id;
  if (branchId === null) {
    // Explicit clear is allowed; the account simply has no default branch.
    await pool.query('UPDATE users SET preferred_branch_id = NULL WHERE id = $1', [req.user.id]);
    return res.json({ preferred_branch_id: null, branch_name: null });
  }
  if (!branchId) return res.status(400).json({ message: 'branch_id required' });
  try {
    // Only a real, existing branch can be selected.
    const branch = await pool.query('SELECT id, name FROM branches WHERE id = $1', [branchId]);
    if (!branch.rows[0]) return res.status(404).json({ message: 'Branch not found' });

    await pool.query('UPDATE users SET preferred_branch_id = $1 WHERE id = $2', [branchId, req.user.id]);
    res.json({ preferred_branch_id: branchId, branch_name: branch.rows[0].name });
  } catch (e) {
    console.error('setPreferredBranch failed:', e.message);
    res.status(500).json({ message: 'Unable to set preferred branch.' });
  }
};
