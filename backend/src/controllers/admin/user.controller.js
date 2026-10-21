// backend/src/controllers/admin/user.controller.js
// Admin → Users & Roles: list / aggregate / update / suspend / invite.
//
// Reused existing routes (no parallel "/v2" API):
//   GET    /admin/users              list + search + role/branch/status filters
//   POST   /admin/users              create account (unchanged behaviour)
//   PUT    /admin/users/:id          update name/email/role/status/branch
//   PATCH  /admin/users/:id/suspend  suspend / reactivate (toggle or explicit)
//   GET    /admin/users/summary      KPI aggregate over the FULL dataset
//   POST   /admin/users/invite       real Supabase Auth invitation
//   PATCH  /admin/users/:id/resend-invite
//   DELETE /admin/users/:id/invite   cancel a pending invitation
//
// Security model
//  • The whole admin router is mounted behind requireAuth + requireRole('admin')
//    (see routes/admin.routes.js + index.js) — the role is always read from
//    public.users.role, never from the JWT.
//  • Every mutation targets the authoritative user UUID from req.params.id.
//  • role / status / branch values are validated server-side against the real
//    enum values and the real branches table.
//  • An admin can never suspend/demote themselves, and the last active admin
//    can never be locked out.
import { pool } from '../../db/pool.js';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { sendNotificationEmail } from '../../services/emailService.js';
import { writeAuditLog } from '../../services/auditLog.js';
import { setAccountStatus, assertAdminContinuity, VALID_STATUSES } from '../../services/adminAccountStatus.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The real roles the platform supports (public.users.role enum).
const VALID_ROLES = ['customer', 'shop_owner', 'admin'];
// The real account states (public.users.status enum) — re-exported by the
// shared account-status service so every admin surface validates the same set.
export { VALID_STATUSES };
// Accounts an ATANY administrator manages as platform staff/partner accounts.
const STAFF_ROLES = ['admin', 'shop_owner'];
// Roles that belong to a specific branch (a shop is anchored to a home branch).
const BRANCH_SCOPED_ROLES = ['shop_owner'];
const INVITE_COOLDOWN_MS = 60_000;

function generateTempPassword() {
  // 16 bytes = 32 hex chars, plus mandatory uppercase + digit + symbol = satisfies all Supabase requirements
  return 'A1!' + crypto.randomBytes(13).toString('hex');
}

async function audit(adminId, action, entityId, details) {
  await writeAuditLog({ adminId, action, entityType: 'user', entityId, details });
}

/**
 * Auth activity (last sign-in / invitation timestamps) straight from Supabase
 * Auth. The SQL path is used when the DB role can read auth.users, otherwise we
 * fall back to the supported Supabase Auth admin API.
 */
async function loadAuthActivity(ids) {
  const map = new Map();
  if (!ids.length) return map;
  try {
    const { rows } = await pool.query(
      'SELECT id, last_sign_in_at, invited_at, confirmation_sent_at, email_confirmed_at FROM auth.users WHERE id = ANY($1::uuid[])',
      [ids]
    );
    rows.forEach((r) => map.set(r.id, r));
    return map;
  } catch (_) {
    /* fall through to the admin API */
  }
  try {
    const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    (data?.users || []).forEach((u) => {
      if (ids.includes(u.id)) {
        map.set(u.id, {
          id: u.id,
          last_sign_in_at: u.last_sign_in_at || null,
          invited_at: u.invited_at || null,
          confirmation_sent_at: u.confirmation_sent_at || null,
          email_confirmed_at: u.email_confirmed_at || null,
        });
      }
    });
  } catch (_) {
    /* activity data is optional — the row still renders */
  }
  return map;
}

/** Effective branch of an account: a shop's home branch wins, otherwise the
 *  account's own branch reference. Never fabricated.
 *  shops.user_id has no unique constraint, so a LATERAL pick takes ONE shop
 *  row per account (preferring the one that carries a home branch) — this
 *  keeps the user list one-row-per-account. */
const SHOP_PICK = `LEFT JOIN LATERAL (
  SELECT home_branch_id FROM shops WHERE user_id = u.id
   ORDER BY (home_branch_id IS NOT NULL) DESC, id
   LIMIT 1
) s ON true`;
const BRANCH_EXPR = 'COALESCE(s.home_branch_id, u.preferred_branch_id)';

/**
 * shops.user_id has no unique constraint (see auth.controller ensureShopRow),
 * so the row is checked first and then created or updated.
 */
async function upsertShopBranch(userId, shopName, branchId) {
  const { rows } = await pool.query('SELECT id FROM shops WHERE user_id = $1', [userId]);
  if (rows[0]) {
    await pool.query('UPDATE shops SET home_branch_id = $1 WHERE id = $2', [branchId, rows[0].id]);
    return;
  }
  await pool.query('INSERT INTO shops (user_id, shop_name, home_branch_id) VALUES ($1,$2,$3)', [
    userId,
    shopName ? `${shopName}'s Shop` : 'My Shop',
    branchId,
  ]);
}

export const listUsers = async (req, res) => {
  try {
    const { q, role, branch_id, status } = req.query || {};
    const where = [];
    const params = [];

    if (q && String(q).trim()) {
      const needle = `%${String(q).trim()}%`;
      params.push(needle);
      where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.role::text ILIKE $${params.length})`);
    }
    if (role && String(role).trim()) {
      params.push(String(role).trim().toLowerCase());
      where.push(`u.role = $${params.length}`);
    }
    if (branch_id && String(branch_id).trim()) {
      params.push(String(branch_id).trim());
      where.push(`${BRANCH_EXPR} = $${params.length}`);
    }
    if (status && String(status).trim()) {
      params.push(String(status).trim().toLowerCase());
      where.push(`u.status = $${params.length}`);
    }

    const { rows: users } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at, u.preferred_branch_id,
              ${BRANCH_EXPR} AS branch_id, b.name AS branch_name
         FROM users u
         ${SHOP_PICK}
         LEFT JOIN branches b ON b.id = ${BRANCH_EXPR}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY u.created_at DESC`,
      params
    );

    if (!users.length) return res.json([]);

    const ids = users.map((u) => u.id);
    const { rows: bids } = await pool.query(
      `SELECT user_id FROM bids WHERE user_id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`,
      ids
    );
    const counts = {};
    bids.forEach((b) => {
      counts[b.user_id] = (counts[b.user_id] || 0) + 1;
    });

    const activity = await loadAuthActivity(ids);

    res.json(
      users.map((u) => {
        const a = activity.get(u.id) || {};
        return {
          ...u,
          bids: counts[u.id] || 0,
          last_active: a.last_sign_in_at || null,
          invited_at: a.invited_at || null,
          invite_sent_at: a.confirmation_sent_at || a.invited_at || null,
          email_confirmed: !!a.email_confirmed_at,
        };
      })
    );
  } catch (e) {
    console.error('[admin/users:list]', e.message);
    res.status(500).json({ message: 'Failed to load users' });
  }
};

/**
 * KPI aggregate — computed over the FULL authorized account dataset (never
 * over the visible/paginated rows).
 */
export const getUsersSummary = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         count(*)::int AS total_accounts,
         count(*) FILTER (WHERE role = ANY($1))::int AS total_staff,
         count(*) FILTER (WHERE role = ANY($1) AND status = 'active')::int AS active_staff,
         count(*) FILTER (WHERE status = 'invited')::int AS pending_invites,
         count(*) FILTER (WHERE role = ANY($1) AND status = 'suspended')::int AS suspended_staff,
         count(*) FILTER (WHERE role = ANY($1) AND status = 'on_leave')::int AS on_leave_staff
       FROM users`,
      [STAFF_ROLES]
    );
    const { rows: branchRows } = await pool.query(
      `SELECT count(DISTINCT ${BRANCH_EXPR})::int AS staff_branch_count
         FROM users u
         ${SHOP_PICK}
        WHERE u.role = ANY($1) AND ${BRANCH_EXPR} IS NOT NULL`,
      [STAFF_ROLES]
    );
    const s = rows[0] || {};
    res.json({
      ...s,
      staff_branch_count: branchRows[0]?.staff_branch_count || 0,
      staff_roles: STAFF_ROLES,
    });
  } catch (e) {
    console.error('[admin/users:summary]', e.message);
    res.status(500).json({ message: 'Failed to load user summary' });
  }
};

/**
 * The "never lock out the last administrator" guard lives in the shared
 * account-status service (services/adminAccountStatus.js) so every admin
 * surface enforces it identically.
 */
export { assertAdminContinuity };

export const updateUser = async (req, res) => {
  const { name, email, role, status, branch_id } = req.body || {};
  const targetId = req.params.id;
  if (!UUID_RE.test(String(targetId || ''))) return res.status(400).json({ message: 'Invalid user id' });

  // Input validation
  if (name !== undefined && (!name || typeof name !== 'string' || !name.trim()))
    return res.status(400).json({ message: 'Name cannot be empty' });
  if (email !== undefined && (!email || !EMAIL_RE.test(email)))
    return res.status(400).json({ message: 'Invalid email format' });

  const normalizedRole = role ? String(role).toLowerCase().replace(/\s+/g, '_') : undefined;
  if (normalizedRole && !VALID_ROLES.includes(normalizedRole))
    return res.status(400).json({ message: `Role must be one of: ${VALID_ROLES.join(', ')}` });
  const normalizedStatus = status ? String(status).toLowerCase().replace(/\s+/g, '_') : undefined;
  if (normalizedStatus && !VALID_STATUSES.includes(normalizedStatus))
    return res.status(400).json({ message: `Status must be one of: ${VALID_STATUSES.join(', ')}` });

  // An admin must not lock themselves out.
  if (targetId === req.user.id) {
    if (normalizedStatus && normalizedStatus !== 'active')
      return res.status(403).json({ message: 'You cannot change the status of your own account.' });
    if (normalizedRole && normalizedRole !== 'admin')
      return res.status(403).json({ message: 'You cannot change your own role.' });
  }

  // Branch must exist (real branch ids only).
  let branch = null;
  if (branch_id !== undefined && branch_id !== null && branch_id !== '') {
    if (!UUID_RE.test(String(branch_id))) return res.status(400).json({ message: 'Branch not found' });
    const { rows: branchRows } = await pool.query('SELECT id, name FROM branches WHERE id = $1', [branch_id]);
    if (!branchRows[0]) return res.status(400).json({ message: 'Branch not found' });
    branch = branchRows[0];
  }

  const guard = await assertAdminContinuity(targetId, { nextStatus: normalizedStatus, nextRole: normalizedRole });
  if (guard.error) return res.status(guard.code || 400).json({ message: guard.error });
  const target = guard.target;

  // Build a PARTIAL update — only the fields that were actually sent.
  const sets = [];
  const params = [];
  const push = (col, val) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };

  if (name !== undefined) push('name', name.trim());
  if (email !== undefined) push('email', String(email).trim().toLowerCase());
  if (normalizedRole !== undefined) push('role', normalizedRole);
  if (normalizedStatus !== undefined) push('status', normalizedStatus);

  try {
    let updated = target;
    if (sets.length) {
      params.push(targetId);
      const { rows } = await pool.query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, name, email, role, status, created_at, preferred_branch_id`,
        params
      );
      if (!rows.length) return res.status(404).json({ message: 'User not found' });
      updated = rows[0];
    }

    // Branch assignment — shops carry their own home branch, other accounts
    // keep the per-account branch reference.
    if (branch) {
      if (updated.role === 'shop_owner') {
        await upsertShopBranch(targetId, updated.name || updated.email, branch.id);
      } else {
        await pool.query('UPDATE users SET preferred_branch_id = $1 WHERE id = $2', [branch.id, targetId]);
      }
    }

    await audit(req.user.id, 'user_updated', targetId, {
      name: name?.trim(),
      role: normalizedRole,
      status: normalizedStatus,
      branch_id: branch?.id || null,
    });

    res.json({ ...updated, branch_id: branch?.id || updated.preferred_branch_id || null, branch_name: branch?.name || null });
  } catch (e) {
    console.error('[admin/users:update]', e.message);
    res.status(500).json({ message: 'Failed to update user' });
  }
};

/**
 * Suspend / reactivate. Existing route — kept. An explicit target status may
 * be supplied (idempotent); without one the status is toggled as before.
 *
 * The actual status change runs through the SHARED account-status service
 * (services/adminAccountStatus.js) so Admin → Users & Roles and
 * Admin → Security Alerts enforce identical rules and audit identically.
 */
export const suspendUser = async (req, res) => {
  try {
    const result = await setAccountStatus({
      adminId: req.user.id,
      targetId: req.params.id,
      nextStatus: req.body?.status ? String(req.body.status).toLowerCase() : null,
      reason: req.body?.reason ?? null,
      source: 'admin_users',
      io: req.io || null,
    });
    if (!result.ok) {
      return res.status(result.code || 400).json({
        message: result.message,
        ...(result.field ? { field: result.field, code: 'REASON_REQUIRED' } : {}),
      });
    }
    res.json(result.user);
  } catch (e) {
    console.error('[admin/users:suspend]', e.message);
    res.status(500).json({ message: 'Failed to update user status' });
  }
};

/** Real invitation — Supabase Auth invitation + our own account row. */
export const inviteUser = async (req, res) => {
  const { name, email, role, branch_id } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim())
    return res.status(400).json({ message: 'Name is required' });
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ message: 'Valid email is required' });
  if (!role) return res.status(400).json({ message: 'Role is required' });
  const normalizedRole = String(role).toLowerCase().replace(/\s+/g, '_');
  if (!VALID_ROLES.includes(normalizedRole))
    return res.status(400).json({ message: `Role must be one of: ${VALID_ROLES.join(', ')}` });

  const cleanEmail = String(email).trim().toLowerCase();

  let branch = null;
  if (branch_id) {
    if (!UUID_RE.test(String(branch_id))) return res.status(400).json({ message: 'Branch not found' });
    const { rows: branchRows } = await pool.query('SELECT id, name FROM branches WHERE id = $1', [branch_id]);
    if (!branchRows[0]) return res.status(400).json({ message: 'Branch not found' });
    branch = branchRows[0];
  }
  if (BRANCH_SCOPED_ROLES.includes(normalizedRole) && !branch)
    return res.status(400).json({ message: 'A branch is required for this role' });

  try {
    // Duplicate protection — an existing account (any status) blocks a new invite.
    const { rows: existing } = await pool.query('SELECT id FROM users WHERE lower(email) = $1', [cleanEmail]);
    if (existing.length) return res.status(409).json({ message: 'An account with this email already exists' });

    // Real Supabase Auth invitation (the provider owns the invitation).
    // If the provider cannot deliver the email right now (SMTP rate limit /
    // not configured) we fall back to an unconfirmed account + our own
    // invitation link, so the invitation still completes.
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(cleanEmail, {
      data: { name: name.trim(), role: normalizedRole },
    });
    let userId = data?.user?.id || null;
    if (error || !userId) {
      const msg = String(error?.message || '');
      if (/already|registered|exists/i.test(msg))
        return res.status(409).json({ message: 'An account with this email already exists' });
      console.warn('[admin/users:invite] provider invite failed, using fallback:', msg);
      const { data: fallback, error: fallbackErr } = await supabase.auth.admin.createUser({
        email: cleanEmail,
        password: generateTempPassword(),
        email_confirm: false,
        user_metadata: { name: name.trim(), role: normalizedRole },
      });
      if (fallbackErr || !fallback?.user) {
        console.error('[admin/users:invite] auth error:', msg || fallbackErr?.message);
        return res.status(400).json({ message: 'Unable to send the invitation right now' });
      }
      userId = fallback.user.id;
    }

    const { rows } = await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role, status, preferred_branch_id)
       VALUES ($1,$2,$3,'supabase_auth',$4,'invited',$5) RETURNING id, name, email, role, status, created_at, preferred_branch_id`,
      [userId, name.trim(), cleanEmail, normalizedRole, branch?.id || null]
    );

    if (normalizedRole === 'shop_owner') {
      await upsertShopBranch(userId, name.trim(), branch.id);
    }

    // Best-effort invitation email (the provider may already have sent one).
    try {
      const { data: link } = await supabase.auth.admin.generateLink({ type: 'invite', email: cleanEmail });
      const actionLink = link?.properties?.action_link || null;
      const inviteUrl = actionLink || `${process.env.FRONTEND_URL || ''}/login`;
      await sendNotificationEmail({
        to: cleanEmail,
        subject: 'You have been invited to ATANY',
        html: `<p>Hi ${name.trim()},</p><p>You have been invited to the ATANY platform as <strong>${normalizedRole.replace(/_/g, ' ')}</strong>.</p><p><a href="${inviteUrl}">Accept your invitation</a></p><p>If you were not expecting this, you can ignore this email.</p>`,
      });
    } catch (mailErr) {
      console.warn('[admin/users:invite] invitation email failed (account still created):', mailErr?.message);
    }

    await audit(req.user.id, 'user_invited', userId, { email: cleanEmail, role: normalizedRole, branch_id: branch?.id || null });

    res.status(201).json({ ...rows[0], invited: true, branch_name: branch?.name || null });
  } catch (e) {
    console.error('[admin/users:invite]', e.message);
    res.status(500).json({ message: 'Failed to send the invitation' });
  }
};

/** Resend a pending invitation (cooldown protected). */
export const resendInvite = async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.id || ''))) return res.status(400).json({ message: 'Invalid user id' });
    const { rows: found } = await pool.query('SELECT id, name, email, role, status FROM users WHERE id = $1', [req.params.id]);
    const target = found[0];
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (target.status !== 'invited')
      return res.status(400).json({ message: 'Only pending invitations can be resent' });

    // Cooldown — the last invite/resend is recorded in the audit log.
    const { rows: recent } = await pool.query(
      `SELECT created_at FROM audit_logs
        WHERE entity_id = $1 AND action IN ('user_invited','user_invite_resent')
        ORDER BY created_at DESC LIMIT 1`,
      [req.params.id]
    );
    const last = recent[0]?.created_at ? new Date(recent[0].created_at).getTime() : 0;
    if (last && Date.now() - last < INVITE_COOLDOWN_MS) {
      const wait = Math.ceil((INVITE_COOLDOWN_MS - (Date.now() - last)) / 1000);
      return res.status(429).json({ message: `Please wait ${wait}s before resending the invitation.` });
    }

    let actionLink = null;
    try {
      const { data: link } = await supabase.auth.admin.generateLink({ type: 'invite', email: target.email });
      actionLink = link?.properties?.action_link || null;
      const inviteUrl = actionLink || `${process.env.FRONTEND_URL || ''}/login`;
      await sendNotificationEmail({
        to: target.email,
        subject: 'Your ATANY invitation (resent)',
        html: `<p>Hi ${target.name},</p><p>Here is your ATANY invitation again.</p><p><a href="${inviteUrl}">Accept your invitation</a></p>`,
      });
    } catch (mailErr) {
      console.warn('[admin/users:resend] invitation email failed:', mailErr?.message);
      return res.status(502).json({ message: 'Unable to resend the invitation right now' });
    }

    await audit(req.user.id, 'user_invite_resent', target.id, { email: target.email });
    res.json({ id: target.id, resent: true });
  } catch (e) {
    console.error('[admin/users:resend]', e.message);
    res.status(500).json({ message: 'Failed to resend the invitation' });
  }
};

/** Cancel a pending invitation — never deletes an active real account. */
export const cancelInvite = async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.id || ''))) return res.status(400).json({ message: 'Invalid user id' });
    const { rows: found } = await pool.query('SELECT id, name, email, role, status FROM users WHERE id = $1', [req.params.id]);
    const target = found[0];
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (target.status !== 'invited')
      return res.status(400).json({ message: 'Only pending invitations can be cancelled' });

    try {
      await supabase.auth.admin.deleteUser(target.id);
    } catch (authErr) {
      console.warn('[admin/users:cancel] auth delete failed:', authErr?.message);
    }
    await pool.query('DELETE FROM shops WHERE user_id = $1', [target.id]);
    await pool.query('DELETE FROM users WHERE id = $1', [target.id]);

    await audit(req.user.id, 'user_invite_cancelled', target.id, { email: target.email });
    res.json({ id: target.id, cancelled: true });
  } catch (e) {
    console.error('[admin/users:cancel]', e.message);
    res.status(500).json({ message: 'Failed to cancel the invitation' });
  }
};

export const createUser = async (req, res) => {
  const { name, email, role, status, password } = req.body;
  // Input validation
  if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ message: 'Name is required' });
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ message: 'Valid email is required' });
  if (!role) return res.status(400).json({ message: 'Role is required' });
  const normalizedRole = role.toLowerCase().replace(/\s+/g, '_');
  if (!VALID_ROLES.includes(normalizedRole)) return res.status(400).json({ message: `Role must be one of: ${VALID_ROLES.join(', ')}` });
  const normalizedStatus = status || 'active';
  if (!VALID_STATUSES.includes(normalizedStatus)) return res.status(400).json({ message: `Status must be one of: ${VALID_STATUSES.join(', ')}` });
  if (password && (typeof password !== 'string' || password.length < 6)) return res.status(400).json({ message: 'Password must be at least 6 characters' });
  // Require password — never use a hardcoded default. If not provided, generate a secure random one.
  const pwd = password || generateTempPassword();
  try {
    const { data, error } = await supabase.auth.admin.createUser({ email, password: pwd, email_confirm: true, user_metadata: { name: name.trim(), role: normalizedRole } });
    if (error) throw error;
    const userId = data.user.id;
    const { rows } = await pool.query(
      'INSERT INTO users (id, name, email, password_hash, role, status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, role=EXCLUDED.role, status=EXCLUDED.status RETURNING *',
      [userId, name.trim(), email, 'supabase_auth', normalizedRole, normalizedStatus]
    );
    res.status(201).json({ ...rows[0], tempPassword: password ? undefined : pwd });
  } catch (e) {
    try {
      const { rows } = await pool.query(
        'INSERT INTO users (name, email, password_hash, role, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [name.trim(), email, 'supabase_auth', normalizedRole, normalizedStatus]
      );
      res.status(201).json(rows[0]);
    } catch (inner) {
      console.error('[admin/users:create]', e.message);
      res.status(400).json({ message: 'Failed to create user' });
    }
  }
};
