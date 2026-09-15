import { pool } from '../db/pool.js';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
// Every shop-owner account needs a matching row in `shops`, or every shop-owner
// action that does `SELECT id FROM shops WHERE user_id=$1` (create auction, create
// listing, view shop profile, etc.) silently finds nothing and fails as if no data
// was ever saved. Safe to call repeatedly — it's a no-op once the row exists.
async function ensureShopRow(userId, name) {
  try {
    // shops.user_id has no unique constraint, so ON CONFLICT isn't available here —
    // check first to avoid creating a duplicate shop on repeat syncs.
    const { rows } = await pool.query('SELECT id FROM shops WHERE user_id=$1', [userId]);
    if (rows[0]) return;
    await pool.query(
      'INSERT INTO shops (user_id, shop_name) VALUES ($1,$2)',
      [userId, name ? `${name}'s Shop` : 'My Shop']
    );
  } catch (e) { console.warn('shops row creation failed:', e.message); }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const signup = async (req, res) => {
  const { email, password, name, role } = req.body;
  // Input validation
  if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Invalid email format' });
  if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
  const normalizedRole = role ? role.toLowerCase().replace(/\s+/g, '_') : 'customer';
  const allowedRoles = ['customer', 'shop_owner', 'admin'];
  if (!allowedRoles.includes(normalizedRole)) return res.status(400).json({ message: 'Invalid role' });
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name, role: normalizedRole } });
  if (error) return res.status(400).json({ message: error.message });
  // Sync to public.users with same UUID (spec 3)
  try {
    await pool.query(
      'INSERT INTO public.users (id, name, email, password_hash, role, status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role',
      [data.user.id, name || data.user.email, email, 'supabase_auth', normalizedRole, 'active']
    );
  } catch (e) { console.warn('public.users sync failed:', e.message); }
  if (normalizedRole === 'shop_owner') await ensureShopRow(data.user.id, name || data.user.email);
  res.status(201).json(data.user);
};

export const syncUser = async (req, res) => {
  const { id, name, email, role } = req.body;
  if (!id || !email) return res.status(400).json({ message: 'id and email required' });
  // Reject privilege escalation — unauthenticated callers can only create customer/shop_owner accounts.
  // Admin accounts must be created via the admin-only POST /auth/signup endpoint.
  const allowedRoles = ['customer', 'shop_owner'];
  const normalizedRole = (role || 'customer').toLowerCase().replace(/\s+/g, '_');
  if (!allowedRoles.includes(normalizedRole)) {
    return res.status(403).json({ message: 'Cannot create accounts with this role via sync-user' });
  }
  try {
    // SECURITY: On conflict, only update name — never update role.
    // Role changes must go through authorized backend logic (admin seller application approval).
    // This prevents an unauthenticated caller from escalating customer → shop_owner.
    await pool.query(
      'INSERT INTO public.users (id, name, email, password_hash, role, status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name',
      [id, name || email, email, 'supabase_auth', normalizedRole, 'active']
    );
    if (normalizedRole === 'shop_owner') await ensureShopRow(id, name || email);
    res.json({ ok: true });
  } catch (e) {
    console.error('syncUser failed:', e.message);
    res.status(500).json({ message: 'Sync failed' });
  }
};
export const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Invalid email format' });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ message: 'Invalid credentials' });
  res.json(data);
};
export const logout = async (_req, res) => { await supabase.auth.signOut(); res.json({ message: 'Signed out' }); };

// Returns the user's role from the trusted DB source (not JWT metadata).
// Used by the frontend to populate the auth context with a verified role.
// AUTO-SYNC: If the user exists in auth.users but not in public.users,
// automatically create the public.users row to prevent login loops.
export const getMe = async (req, res) => {
  try {
    let { rows } = await pool.query('SELECT id, name, email, role, status FROM public.users WHERE id = $1', [req.user.id]);
    if (!rows[0]) {
      // User exists in auth.users (requireAuth verified the token) but not in public.users.
      // Auto-sync: create the public.users row from auth user metadata.
      const authUser = req.user;
      const name = authUser.user_metadata?.name || authUser.email || 'User';
      const email = authUser.email || '';
      const rawRole = authUser.user_metadata?.role;
      const allowedRoles = ['customer', 'shop_owner', 'admin'];
      const role = allowedRoles.includes(rawRole) ? rawRole : 'customer';
      try {
        await pool.query(
          'INSERT INTO public.users (id, name, email, password_hash, role, status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
          [authUser.id, name, email, 'supabase_auth', role, 'active']
        );
        // If shop_owner, ensure a shops row exists
        if (role === 'shop_owner') {
          const { rows: shopRows } = await pool.query('SELECT id FROM shops WHERE user_id=$1', [authUser.id]);
          if (!shopRows[0]) {
            await pool.query('INSERT INTO shops (user_id, shop_name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [authUser.id, name]);
          }
        }
        ({ rows } = await pool.query('SELECT id, name, email, role, status FROM public.users WHERE id = $1', [authUser.id]));
      } catch (syncErr) {
        console.error('getMe auto-sync failed:', syncErr.message);
      }
    }
    if (!rows[0]) return res.status(404).json({ message: 'User not found in database' });
    res.json(rows[0]);
  } catch (e) {
    console.error('getMe failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch user profile' });
  }
};