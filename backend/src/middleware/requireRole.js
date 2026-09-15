// backend/src/middleware/requireRole.js
// Spec: Each role's routes protected so customer token can never hit admin endpoint.
// Usage: router.use(requireRole('admin')), requireRole('shop_owner'), requireRole('customer')
  // Also supports array: requireRole(['admin'])
// SECURITY: Role is always checked against the database (public.users.role).
// No fallback to JWT user_metadata — if the DB lookup fails, access is denied.
import { pool } from '../db/pool.js';

export function requireRole(allowed) {
  const roles = Array.isArray(allowed) ? allowed : [allowed];
  return async (req, res, next) => {
    try {
      if (!req.user?.id) {
        return res.status(403).json({ message: `Forbidden — requires ${roles.join(' or ')}` });
      }
      const { rows } = await pool.query('SELECT role FROM public.users WHERE id = $1', [req.user.id]);
      const userRole = rows[0]?.role;
      if (!userRole || !roles.includes(userRole)) {
        return res.status(403).json({ message: `Forbidden — requires ${roles.join(' or ')}` });
      }
      req.user.trustedRole = userRole;
      next();
    } catch (e) {
      console.error('requireRole DB check failed', e.message);
      return res.status(403).json({ message: `Forbidden — requires ${roles.join(' or ')}` });
    }
  };
}
