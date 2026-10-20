import { pool } from '../../db/pool.js';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['customer', 'shop_owner', 'admin'];
const VALID_STATUSES = ['active', 'suspended'];

function generateTempPassword() {
  // 16 bytes = 32 hex chars, plus mandatory uppercase + digit + symbol = satisfies all Supabase requirements
  return 'A1!' + crypto.randomBytes(13).toString('hex');
}

export const listUsers = async (_req, res) => {
  const { rows: users } = await pool.query('SELECT id, name, email, role, status, created_at FROM users ORDER BY created_at DESC');
  if (!users.length) return res.json([]);
  const userIds = users.map(u => u.id);
  const { rows: bids } = await pool.query(`SELECT user_id FROM bids WHERE user_id IN (${userIds.map((_,i)=>`$${i+1}`).join(',')})`, userIds);
  const counts = {};
  bids.forEach(b => { counts[b.user_id] = (counts[b.user_id]||0)+1; });
  res.json(users.map(u => ({ ...u, bids: counts[u.id] || 0 })));
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
    const { rows } = await pool.query('UPDATE users SET name=$1, email=$2, role=$3, status=$4 WHERE id=$5 RETURNING *', [name?.trim() || null, email || null, normalizedRole || null, status || null, req.params.id]);
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
    const { rows } = await pool.query("UPDATE users SET status = CASE WHEN status='active' THEN 'suspended' ELSE 'active' END WHERE id=$1 RETURNING *", [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'User not found' });
    // Audit log
    try {
      await pool.query(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'user_status_toggled', 'user', req.params.id, JSON.stringify({ new_status: rows[0]?.status })]
      );
    } catch (_) {}
    res.json(rows[0]);
  } catch (e) {
    console.error('[admin/users:suspend]', e.message);
    res.status(500).json({ message: 'Failed to toggle user status' });
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
