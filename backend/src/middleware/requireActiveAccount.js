// backend/src/middleware/requireActiveAccount.js
// Centralized account-status guard.
//
// A suspended account must not reach protected functionality. The guard reads
// the authoritative state from public.users (the same source as /auth/me) and
// answers with the machine-readable 403 contract:
//
//   { code: 'ACCOUNT_SUSPENDED', message: '...', reason: '<the admin reason>' }
//
// The reason is the account OWNER's own information (it is what the
// /account-suspended screen shows) — no admin-only notes or audit metadata.
import { pool } from '../db/pool.js';

export function requireActiveAccount() {
  return async (req, res, next) => {
    try {
      if (!req.user?.id) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const { rows } = await pool.query(
        'SELECT status, suspension_reason FROM public.users WHERE id = $1',
        [req.user.id]
      );
      const status = String(rows[0]?.status || '').toLowerCase();
      if (status === 'suspended') {
        return res.status(403).json({
          code: 'ACCOUNT_SUSPENDED',
          message: 'Your ATANY account has been suspended.',
          reason: rows[0].suspension_reason || null,
        });
      }
      next();
    } catch (e) {
      // A DB failure is not an authorization decision — never lock a user out
      // because the database hiccuped.
      console.error('[requireActiveAccount] DB query failed:', e.message);
      return res.status(500).json({ message: 'Database service unavailable' });
    }
  };
}

export default requireActiveAccount;
