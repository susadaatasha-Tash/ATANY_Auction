// backend/src/services/adminAccountStatus.js
// THE account-status service for administrators.
//
// It was extracted from Admin → Users & Roles so that EVERY admin surface
// (including Admin → Security Alerts → Suspend Customer) suspends an account
// through exactly the same rules, audit trail and protections:
//
//  • the target must be a real user (404 otherwise)
//  • the status must be a real public.users.status value
//  • an admin can never suspend their own account
//  • the last active administrator can never be locked out
//  • every change is written to public.audit_logs
//
// There is exactly ONE suspension mechanism in ATANY — this one.
import { pool } from '../db/pool.js';
import { writeAuditLog } from './auditLog.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The real account states (public.users.status enum). */
export const VALID_STATUSES = ['active', 'suspended', 'invited', 'on_leave'];

/**
 * Guard: never lock out the last privileged account.
 * Exported because Admin → Users & Roles also uses it for role changes.
 */
export async function assertAdminContinuity(targetId, { nextStatus, nextRole } = {}) {
  const { rows: targetRows } = await pool.query(
    'SELECT id, role, status FROM users WHERE id = $1',
    [targetId]
  );
  const target = targetRows[0];
  if (!target) return { error: 'User not found', code: 404 };

  const status = nextStatus || target.status;
  const role = nextRole || target.role;
  const removesAdmin = target.role === 'admin' && (role !== 'admin' || status !== 'active');
  if (!removesAdmin) return { target };

  const { rows: others } = await pool.query(
    "SELECT count(*)::int AS c FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1",
    [targetId]
  );
  if (!others[0]?.c) {
    return {
      error: 'At least one active administrator must remain on the platform.',
      code: 400,
    };
  }
  return { target };
}

/**
 * Change an account's status.
 *
 * @param {object}  opts
 * @param {string}  opts.adminId   the acting administrator
 * @param {string}  opts.targetId  the account to change
 * @param {string=} opts.nextStatus explicit status; when omitted it toggles
 *                                   between 'active' and the current state
 * @param {string=} opts.source    where the action came from (audit detail)
 * @returns {{ ok: boolean, user?: object, previousStatus?: string, code?: number, message?: string }}
 */
export async function setAccountStatus({ adminId, targetId, nextStatus = null, source = 'admin_users' }) {
  if (!UUID_RE.test(String(targetId || ''))) {
    return { ok: false, code: 400, message: 'Invalid user id' };
  }

  const { rows: found } = await pool.query('SELECT id, role, status FROM users WHERE id = $1', [targetId]);
  const target = found[0];
  if (!target) return { ok: false, code: 404, message: 'User not found' };

  const requested = nextStatus ? String(nextStatus).toLowerCase() : null;
  if (requested && !VALID_STATUSES.includes(requested)) {
    return { ok: false, code: 400, message: `Status must be one of: ${VALID_STATUSES.join(', ')}` };
  }

  const resolved = requested || (target.status === 'active' ? 'suspended' : 'active');

  if (String(targetId) === String(adminId) && resolved !== 'active') {
    return { ok: false, code: 403, message: 'You cannot suspend your own account.' };
  }

  const guard = await assertAdminContinuity(targetId, { nextStatus: resolved });
  if (guard.error) return { ok: false, code: guard.code || 400, message: guard.error };

  const { rows } = await pool.query(
    'UPDATE users SET status = $1 WHERE id = $2 RETURNING id, name, email, role, status, created_at, preferred_branch_id',
    [resolved, targetId]
  );
  if (!rows.length) return { ok: false, code: 404, message: 'User not found' };

  await writeAuditLog({
    adminId,
    action: 'user_status_toggled',
    entityType: 'user',
    entityId: targetId,
    details: { new_status: resolved, previous_status: target.status, source },
  });

  return { ok: true, user: rows[0], previousStatus: target.status };
}

export default setAccountStatus;
