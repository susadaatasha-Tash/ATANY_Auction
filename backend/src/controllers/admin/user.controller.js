import { pool } from '../../db/pool.js';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { removeUser } from '../../services/auctionPresence.js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['customer', 'shop_owner', 'admin'];
const VALID_STATUSES = ['active', 'suspended'];

function generateTempPassword() {
  // 16 bytes = 32 hex chars, plus mandatory uppercase + digit + symbol = satisfies all Supabase requirements
  return 'A1!' + crypto.randomBytes(13).toString('hex');
}

export const listUsers = async (_req, res) => {
  // preferred_branch_id is the ONLY user→branch link in the schema (self-selected
  // by customers); there is no staff branch assignment. Resolved in one batched
  // query so the UI never needs a second request per user (no N+1).
  const { rows: users } = await pool.query(
    'SELECT id, name, email, role, status, preferred_branch_id, created_at FROM users ORDER BY created_at DESC'
  );
  if (!users.length) return res.json([]);
  const userIds = users.map(u => u.id);
  const { rows: bids } = await pool.query(`SELECT user_id FROM bids WHERE user_id IN (${userIds.map((_,i)=>`$${i+1}`).join(',')})`, userIds);
  const counts = {};
  bids.forEach(b => { counts[b.user_id] = (counts[b.user_id]||0)+1; });

  const branchIds = [...new Set(users.map(u => u.preferred_branch_id).filter(Boolean))];
  let branchMap = {};
  if (branchIds.length) {
    try {
      const { rows: branches } = await pool.query(
        `SELECT id, name FROM branches WHERE id IN (${branchIds.map((_, i) => `$${i + 1}`).join(',')})`,
        branchIds
      );
      branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));
    } catch { branchMap = {}; }
  }

  res.json(users.map(u => ({
    ...u,
    bids: counts[u.id] || 0,
    branch_name: u.preferred_branch_id ? branchMap[u.preferred_branch_id] || null : null,
  })));
};
export const updateUser = async (req, res) => {
  const { name, email, role, status } = req.body;
  // Input validation
  if (name !== undefined && (!name || typeof name !== 'string' || !name.trim())) return res.status(400).json({ message: 'Name cannot be empty' });
  if (email !== undefined && (!email || !EMAIL_RE.test(email))) return res.status(400).json({ message: 'Invalid email format' });
  const normalizedRole = role ? role.toLowerCase().replace(/\s+/g, '_') : role;
  if (role && !VALID_ROLES.includes(normalizedRole)) return res.status(400).json({ message: `Role must be one of: ${VALID_ROLES.join(', ')}` });
  if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ message: `Status must be one of: ${VALID_STATUSES.join(', ')}` });
  try {
    // Build SET clauses from the fields actually sent. The previous full
    // overwrite wrote NULL for omitted fields, which violates the NOT NULL
    // columns on `users` and turned every partial update into a 500.
    const sets = [];
    const params = [];
    const push = (col, val) => { params.push(val); sets.push(`${col}=$${params.length}`); };
    if (name !== undefined) push('name', name.trim());
    if (email !== undefined) push('email', email);
    if (normalizedRole !== undefined && normalizedRole !== null) push('role', normalizedRole);
    if (status !== undefined && status !== null) push('status', status);
    if (!sets.length) return res.status(400).json({ message: 'No fields to update' });

    // Never let an admin lock themselves out or remove the last admin.
    const { rows: currentRows } = await pool.query('SELECT id, role, status FROM users WHERE id=$1', [req.params.id]);
    const current = currentRows[0];
    if (!current) return res.status(404).json({ message: 'User not found' });
    const isSelf = String(current.id) === String(req.user.id);
    const losingAdmin = current.role === 'admin' && (normalizedRole && normalizedRole !== 'admin' || status === 'suspended');
    if (losingAdmin) {
      if (isSelf) return res.status(400).json({ message: 'You cannot change your own admin access' });
      const { rows: adminRows } = await pool.query("SELECT COUNT(*)::int AS cnt FROM users WHERE role='admin' AND status='active'");
      if (Number(adminRows[0]?.cnt || 0) <= 1) {
        return res.status(400).json({ message: 'At least one active admin must remain' });
      }
    }

    params.push(req.params.id);
    const { rows } = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING *`, params);
    if (!rows.length) return res.status(404).json({ message: 'User not found' });
    // Audit log
    try {
      await pool.query(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'user_updated', 'user', req.params.id, JSON.stringify({ name: name?.trim(), role: normalizedRole, status })]
      );
    } catch (_) {}
    res.json(rows[0]);
  } catch (e) {
    console.error('[admin/users:update]', e.message);
    res.status(500).json({ message: 'Failed to update user' });
  }
};
export const suspendUser = async (req, res) => {
  try {
    // Optional explicit target status; falls back to the historical toggle so
    // existing callers keep working. Both paths are admin-gated by the router.
    const requested = req.body?.status ? String(req.body.status).toLowerCase() : null;
    if (requested && !VALID_STATUSES.includes(requested)) {
      return res.status(400).json({ message: `Status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    let targetStatus = requested;
    const { rows: preRows } = await pool.query('SELECT id, role, status FROM users WHERE id=$1', [req.params.id]);
    const preAccount = preRows[0];
    if (!preAccount) return res.status(404).json({ message: 'User not found' });
    if (!targetStatus) targetStatus = preAccount.status === 'active' ? 'suspended' : 'active';

    if (targetStatus === 'suspended') {
      // Self-suspension / last-admin protection (see §59 of the rebuild spec).
      if (String(preAccount.id) === String(req.user.id)) {
        return res.status(400).json({ message: 'You cannot suspend your own account' });
      }
      if (preAccount.role === 'admin' && preAccount.status === 'active') {
        const { rows: admins } = await pool.query("SELECT COUNT(*)::int AS cnt FROM users WHERE role='admin' AND status='active'");
        if (Number(admins[0]?.cnt || 0) <= 1) {
          return res.status(400).json({ message: 'At least one active admin must remain' });
        }
      }
    }

    // STEP 1 — authoritative DB write (the only source of truth).
    const { rows } = await pool.query(
      'UPDATE users SET status=$1 WHERE id=$2 RETURNING *',
      [targetStatus, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'User not found' });
    const account = rows[0];

    // STEP 2 — existing audit log (unchanged shape, always written after commit).
    try {
      await pool.query(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'user_status_toggled', 'user', req.params.id, JSON.stringify({ new_status: account?.status })]
      );
    } catch (_) {}

    // STEP 3/4 — only AFTER the DB committed:
    //   · a suspended user must disappear from live-auction watcher presence
    //     (every tab, every auction) and the fresh counts are broadcast;
    //   · the affected account is told its authoritative status changed, and a
    //     suspended account's live sockets are force-disconnected so no stale
    //     session can keep streaming.
    const effects = applyAccountStatusEffects(req, account);

    // STEP 5 — success response (the admin UI refreshes its row from this).
    res.json({ ...account, ...effects });
  } catch (e) {
    console.error('[admin/users:suspend]', e.message);
    res.status(500).json({ message: 'Failed to update user status' });
  }
};

/**
 * Real-world side effects of an account status change. Extracted so it is
 * testable in isolation and impossible to run before the DB write.
 */
export function applyAccountStatusEffects(req, account) {
  const userId = account?.id;
  const status = account?.status;
  const io = req?.io;
  const result = { presenceRemoved: [], socketsDisconnected: 0 };

  // Watcher presence is removed only when an account stops being active.
  if (status === 'suspended' && userId) {
    result.presenceRemoved = removeUser(userId);
    if (io) {
      // Broadcast the corrected watcher count to every affected auction room.
      for (const { auctionId, count } of result.presenceRemoved) {
        try { io.to(`auction:${auctionId}`).emit('auction:watchers', { auctionId, watcherCount: count }); } catch {}
      }
      // Private user room: status event + hard disconnect so nothing stale runs.
      try {
        io.to(`user:${userId}`).emit('account:status', { userId, status });
      } catch {}
      try {
        const room = io.sockets.adapter?.rooms?.get(`user:${userId}`);
        for (const sockId of room || []) {
          const sock = io.sockets.sockets.get(sockId);
          if (sock) { sock.emit('account:status', { userId, status }); sock.disconnect(true); result.socketsDisconnected += 1; }
        }
      } catch {}
    }
  } else if (io && userId) {
    // Reactivation: inform only. Presence is NOT re-created — the customer must
    // deliberately reopen an auction to become a watcher again.
    try { io.to(`user:${userId}`).emit('account:status', { userId, status }); } catch {}
  }
  return result;
}

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
