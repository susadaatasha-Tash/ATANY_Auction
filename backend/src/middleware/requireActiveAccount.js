// backend/src/middleware/requireActiveAccount.js
// Centralized ATANY account-state enforcement.
//
// AUTHENTICATION ≠ AUTHORIZATION
//   A valid Supabase token proves WHO the user is. It says nothing about whether
//   their ATANY account may currently use the platform. A suspended customer can
//   still hold a perfectly valid identity-provider token, so every protected
//   surface must re-check the AUTHORITATIVE `users.status`.
//
// This is the ONE place that decision is made. Controllers never repeat
// `if (user.status === 'suspended')` themselves.
//
// Response contract (stable, machine-readable):
//   HTTP 403
//   { success: false, error: { code: 'ACCOUNT_SUSPENDED', message: '...' } }
// A suspended user is 403 — NOT 401. They are authenticated, just not allowed.
import { pool } from '../db/pool.js';

export const ACCOUNT_SUSPENDED_CODE = 'ACCOUNT_SUSPENDED';

export function suspendedPayload(message = 'Your ATANY account has been suspended. You cannot access this resource.') {
  return { success: false, error: { code: ACCOUNT_SUSPENDED_CODE, message } };
}

/**
 * Pure predicate — no DB — so it can be unit-tested and reused.
 * Only 'suspended' blocks. Any other status (active, or a future value added to
 * the user_status enum) is allowed, so this middleware can never silently lock
 * out accounts the platform does not consider suspended.
 */
export function isSuspendedStatus(status) {
  return String(status || '').toLowerCase() === 'suspended';
}

/**
 * requireActiveAccount
 * @param {{roles?: string[]|null}} [opts] optionally also enforce roles
 */
export function requireActiveAccount(opts = {}) {
  const roles = opts.roles ? (Array.isArray(opts.roles) ? opts.roles : [opts.roles]) : null;

  return async function activeAccount(req, res, next) {
    try {
      if (!req.user?.id) {
        return res.status(403).json({ message: 'Forbidden — requires an authenticated ATANY account' });
      }
      let rows;
      try {
        ({ rows } = await pool.query('SELECT id, role, status FROM public.users WHERE id = $1', [req.user.id]));
      } catch (dbErr) {
        // A DB failure is NOT an authorization decision — fail closed but honestly.
        console.error('[requireActiveAccount] DB query failed:', dbErr.message);
        return res.status(500).json({ message: 'Database service unavailable' });
      }
      const account = rows[0];
      if (!account) {
        return res.status(403).json({ message: 'Forbidden — no ATANY account for this identity' });
      }

      req.account = account;
      req.accountStatus = account.status;
      req.user.trustedRole = account.role;

      if (roles && !roles.includes(account.role)) {
        return res.status(403).json({ message: `Forbidden — requires ${roles.join(' or ')}` });
      }
      if (isSuspendedStatus(account.status)) {
        return res.status(403).json(suspendedPayload());
      }
      return next();
    } catch (e) {
      console.error('[requireActiveAccount] unexpected error:', e.message);
      return res.status(500).json({ message: 'Internal server error' });
    }
  };
}

/**
 * Resolve the authoritative account-state for a user id (used by the socket
 * layer and the admin suspension pipeline, which must never trust a
 * browser-supplied status).
 */
export async function loadAccountState(userId) {
  const { rows } = await pool.query('SELECT id, role, status FROM public.users WHERE id = $1', [userId]);
  return rows[0] || null;
}

export default requireActiveAccount;