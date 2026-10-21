// backend/src/controllers/customer/account.controller.js
// Customer self-service profile: read + update own account only.
//
// Security model
//  • The acting user is ALWAYS req.user.id (the verified JWT subject).
//    A userId in the body is ignored — a customer can never touch another
//    account.
//  • The update payload is whitelisted. Only `name` and `phone` are writable.
//    role / status / id / email / subscription / branch ownership are NEVER
//    accepted from a customer request (role+status are admin-only; email
//    changes require a verification flow that does not exist yet).
//  • Preferred branch has its own customer-only endpoint
//    (PUT /customer/preferred-branch) so it keeps its own validation.
import { pool } from '../../db/pool.js';
import { validatePhilippinePhone, normalizePhilippinePhone } from '../../validation/authValidation.js';

const MAX_NAME_LENGTH = 120;

export const getAccount = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Authentication required' });
  try {
    const { rows: users } = await pool.query('SELECT * FROM users WHERE id=$1', [userId]);
    const u = users[0];
    if (!u) return res.status(404).json({ message: 'Account not found' });
    let preferred_branch_name = null;
    if (u.preferred_branch_id) {
      const { rows: branches } = await pool.query('SELECT name FROM branches WHERE id=$1', [u.preferred_branch_id]);
      preferred_branch_name = branches[0]?.name || null;
    }
    res.json({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      created_at: u.created_at,
      preferred_branch_id: u.preferred_branch_id,
      preferred_branch_name,
      phone: u.phone || null,
    });
  } catch (e) {
    console.error('getAccount failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch account' });
  }
};

export const updateAccount = async (req, res) => {
  const userId = req.user?.id; // never req.body.userId
  if (!userId) return res.status(401).json({ message: 'Authentication required' });
  try {
    const { name, phone } = req.body || {};

    // A suspended account cannot edit its profile (same rule as bidding).
    // Support stays reachable through the account-suspension page.
    const { rows: statusRows } = await pool.query('SELECT status FROM users WHERE id=$1', [userId]);
    const accountStatus = String(statusRows[0]?.status || '').toLowerCase();
    if (accountStatus === 'suspended') {
      return res.status(403).json({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account is suspended. Contact support to update your profile.',
      });
    }

    const updates = [];
    const values = [];

    if (name !== undefined) {
      const cleanName = String(name || '').trim();
      if (!cleanName) {
        return res.status(400).json({ code: 'INVALID_NAME', field: 'name', message: 'Full name is required.' });
      }
      if (cleanName.length > MAX_NAME_LENGTH) {
        return res.status(400).json({
          code: 'INVALID_NAME',
          field: 'name',
          message: `Full name must be at most ${MAX_NAME_LENGTH} characters.`,
        });
      }
      updates.push(`name=$${values.length + 1}`);
      values.push(cleanName);
    }

    if (phone !== undefined) {
      const rawPhone = String(phone || '').trim();
      if (!rawPhone) {
        // Explicitly clearing the phone is allowed (column is nullable).
        updates.push(`phone=$${values.length + 1}`);
        values.push(null);
      } else {
        const phoneErr = validatePhilippinePhone(rawPhone);
        if (phoneErr) {
          return res.status(400).json({ code: 'INVALID_PHONE', field: 'phone', message: phoneErr });
        }
        updates.push(`phone=$${values.length + 1}`);
        values.push(normalizePhilippinePhone(rawPhone));
      }
    }

    if (!updates.length) {
      return res.status(400).json({ code: 'NO_CHANGES', message: 'Nothing to update.' });
    }

    values.push(userId);
    const { rows: updated } = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id=$${values.length} RETURNING id, name, email, role, status, phone, preferred_branch_id`,
      values
    );
    const u = updated[0];
    if (!u) return res.status(404).json({ message: 'Account not found' });

    let preferred_branch_name = null;
    if (u.preferred_branch_id) {
      const { rows: branches } = await pool.query('SELECT name FROM branches WHERE id=$1', [u.preferred_branch_id]);
      preferred_branch_name = branches[0]?.name || null;
    }

    res.json({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      phone: u.phone || null,
      preferred_branch_id: u.preferred_branch_id,
      preferred_branch_name,
      updated: true,
    });
  } catch (e) {
    console.error('updateAccount failed:', e.message);
    res.status(500).json({ message: 'Failed to update account' });
  }
};

export const getPreferredBranch = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Authentication required' });
  try {
    const { rows: users } = await pool.query('SELECT preferred_branch_id FROM users WHERE id=$1', [userId]);
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
    res.status(500).json({ message: 'Failed to fetch preferred branch' });
  }
};

export const setPreferredBranch = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Authentication required' });
  const { branch_id } = req.body || {};
  if (!branch_id) return res.status(400).json({ message: 'branch_id required' });
  try {
    // Verify branch exists
    const branch = await pool.query('SELECT id, name FROM branches WHERE id = $1', [branch_id]);
    if (!branch.rows[0]) return res.status(404).json({ message: 'Branch not found' });

    await pool.query('UPDATE users SET preferred_branch_id = $1 WHERE id = $2', [branch_id, userId]);
    res.json({ preferred_branch_id: branch_id, branch_name: branch.rows[0].name });
  } catch (e) {
    console.error('setPreferredBranch failed:', e.message);
    res.status(500).json({ message: 'Failed to set preferred branch' });
  }
};
