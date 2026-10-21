// backend/src/services/adminAccountStatus.js
// THE account-status service for administrators.
//
// It is the ONE suspension pipeline in ATANY. Admin → Users & Roles and
// Admin → Security Alerts → Review → Suspend Customer both call it, so the
// rules, the persistence, the audit trail and the realtime notification can
// never drift apart.
//
//  • the target must be a real user (404 otherwise)
//  • the status must be a real public.users.status value
//  • a SUSPENSION always needs an admin-provided reason (5–500 chars)
//  • the reason is persisted on public.users.suspension_reason (the CURRENT
//    reason) and written to public.audit_logs (the HISTORY)
//  • reactivating clears the current reason but never the audit history
//  • an admin can never suspend their own account
//  • the last active administrator can never be locked out
//  • a suspended account is notified in real time (account:status) and loses
//    its live auction watcher presence
import { pool } from '../db/pool.js';
import { writeAuditLog } from './auditLog.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The real account states (public.users.status enum). */
export const VALID_STATUSES = ['active', 'suspended', 'invited', 'on_leave'];
/** A suspension reason must be meaningful but never a wall of text. */
export const SUSPENSION_REASON_MIN = 5;
export const SUSPENSION_REASON_MAX = 500;

/**
 * Validate an admin-provided suspension reason.
 * Whitespace-only text is NOT a reason.
 */
export function validateSuspensionReason(reason) {
  if (typeof reason !== 'string') {
    return { ok: false, message: 'Please provide a reason for suspension.' };
  }
  const clean = reason.trim();
  if (!clean) return { ok: false, message: 'Please provide a reason for suspension.' };
  if (clean.length < SUSPENSION_REASON_MIN) {
    return { ok: false, message: `Please provide a reason for suspension (at least ${SUSPENSION_REASON_MIN} characters).` };
  }
  if (clean.length > SUSPENSION_REASON_MAX) {
    return { ok: false, message: `The reason must be at most ${SUSPENSION_REASON_MAX} characters.` };
  }
  return { ok: true, reason: clean };
}

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
 * @param {string}  opts.adminId    the acting administrator
 * @param {string}  opts.targetId   the account to change
 * @param {string=} opts.nextStatus explicit status; when omitted it toggles
 *                                   between 'active' and the current state
 * @param {string=} opts.reason     REQUIRED when the next status is 'suspended'
 * @param {string=} opts.source     where the action came from (audit detail)
 * @param {object=} opts.io         the Socket.io server (for account:status)
 * @returns {{ ok: boolean, user?: object, previousStatus?: string, reason?: string|null, code?: number, message?: string }}
 */
export async function setAccountStatus({
  adminId,
  targetId,
  nextStatus = null,
  reason = null,
  source = 'admin_users',
  io = null,
}) {
  if (!UUID_RE.test(String(targetId || ''))) {
    return { ok: false, code: 400, message: 'Invalid user id' };
  }

  const { rows: found } = await pool.query(
    'SELECT id, name, role, status, suspension_reason FROM users WHERE id = $1',
    [targetId]
  );
  const target = found[0];
  if (!target) return { ok: false, code: 404, message: 'User not found' };

  const requested = nextStatus ? String(nextStatus).toLowerCase() : null;
  if (requested && !VALID_STATUSES.includes(requested)) {
    return { ok: false, code: 400, message: `Status must be one of: ${VALID_STATUSES.join(', ')}` };
  }

  const resolved = requested || (target.status === 'active' ? 'suspended' : 'active');

  // ── safety protections first (a reason never overrides them) ──
  if (String(targetId) === String(adminId) && resolved !== 'active') {
    return { ok: false, code: 403, message: 'You cannot suspend your own account.' };
  }

  const guard = await assertAdminContinuity(targetId, { nextStatus: resolved });
  if (guard.error) return { ok: false, code: guard.code || 400, message: guard.error };

  // ── a suspension ALWAYS needs a real reason ──
  let cleanReason = null;
  if (resolved === 'suspended') {
    const check = validateSuspensionReason(reason);
    if (!check.ok) return { ok: false, code: 400, message: check.message, field: 'reason' };
    cleanReason = check.reason;
  }

  // The CURRENT reason lives on the account row (cleared on reactivation).
  const { rows } = await pool.query(
    `UPDATE users
        SET status = $1,
            suspension_reason = $2
      WHERE id = $3
      RETURNING id, name, email, role, status, suspension_reason, created_at, preferred_branch_id`,
    [resolved, cleanReason, targetId]
  );
  if (!rows.length) return { ok: false, code: 404, message: 'User not found' };

  // The audit trail keeps the HISTORY (also after a reactivation).
  await writeAuditLog({
    adminId,
    action: 'user_status_toggled',
    entityType: 'user',
    entityId: targetId,
    details: {
      target_user_id: targetId,
      target_role: target.role,
      new_status: resolved,
      previous_status: target.status,
      reason: cleanReason,
      source,
    },
  });

  // A suspended account must not keep a live auction watcher presence.
  if (resolved === 'suspended') {
    try {
      const { removeUserFromAllAuctions } = await import('./auctionPresence.js');
      removeUserFromAllAuctions(targetId);
    } catch (e) {
      console.warn('[accountStatus] watcher presence cleanup failed:', e?.message || e);
    }
  }

  // Real-time notification (the account owner) — the DB stays authoritative.
  if (io && typeof io.to === 'function') {
    try {
      io.to(`user:${targetId}`).emit('account:status', {
        status: resolved,
        reason: resolved === 'suspended' ? cleanReason : null,
      });
    } catch (e) {
      console.warn('[accountStatus] account:status emit failed:', e?.message || e);
    }
  }

  return {
    ok: true,
    user: rows[0],
    previousStatus: target.status,
    previousReason: target.suspension_reason || null,
    reason: cleanReason,
  };
}

export default setAccountStatus;
