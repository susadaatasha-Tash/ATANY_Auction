import { pool } from '../db/pool.js';
import { createClient } from '@supabase/supabase-js';
import {
  normalizeEmail,
  isValidEmail,
  normalizePhilippinePhone,
  isValidPhilippinePhone,
  validateEmail,
  validatePhilippinePhone,
  validatePassword,
} from '../validation/authValidation.js';
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

export const signup = async (req, res) => {
  // Admin-only signup — role is trusted only via requireRole admin wrapper
  let { email, password, name, role, phone } = req.body || {};
  // Never trust client role for public — but admin route is already gated; still validate
  if (!email || !password) return res.status(400).json({ code: 'VALIDATION_ERROR', errors: { email: !email ? 'Please enter a valid email address.' : undefined, password: !password ? 'Password is required.' : undefined } });
  const emailNorm = normalizeEmail(email);
  const emailErr = validateEmail(email);
  if (emailErr) return res.status(400).json({ code: 'INVALID_EMAIL', field: 'email', message: emailErr });
  // Extra domain structure check is inside validateEmail
  const pwdErr = validatePassword(password);
  if (pwdErr) return res.status(400).json({ code: 'WEAK_PASSWORD', field: 'password', message: pwdErr });
  // Phone optional for admin signup — if provided, validate
  let phoneNorm;
  if (phone) {
    const phoneErr = validatePhilippinePhone(phone);
    if (phoneErr) return res.status(400).json({ code: 'INVALID_PHONE', field: 'phone', message: phoneErr });
    phoneNorm = normalizePhilippinePhone(phone);
  }
  const normalizedRole = role ? String(role).toLowerCase().replace(/\s+/g, '_') : 'customer';
  const allowedRoles = ['customer', 'shop_owner', 'admin'];
  if (!allowedRoles.includes(normalizedRole)) return res.status(400).json({ code: 'INVALID_ROLE', field: 'role', message: 'Invalid role' });
  // Do not log password
  const { data, error } = await supabase.auth.admin.createUser({ email: emailNorm, password, email_confirm: true, user_metadata: { name, role: normalizedRole, phone: phoneNorm } });
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already registered')) {
      return res.status(400).json({ code: 'EMAIL_ALREADY_EXISTS', field: 'email', message: 'An account with this email already exists.' });
    }
    if (msg.includes('phone') && msg.includes('already')) {
      return res.status(400).json({ code: 'PHONE_ALREADY_EXISTS', field: 'phone', message: 'This mobile number is already associated with an account.' });
    }
    // Do not expose raw Supabase message for validation — map to generic
    if (msg.includes('invalid') && msg.includes('email')) {
      return res.status(400).json({ code: 'INVALID_EMAIL', field: 'email', message: 'Please enter a valid email address.' });
    }
    return res.status(400).json({ code: 'SIGNUP_FAILED', message: 'Signup failed' });
  }
  // Sync to public.users with same UUID (spec 3)
  try {
    await pool.query(
      'INSERT INTO public.users (id, name, email, password_hash, role, status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role',
      [data.user.id, name || data.user.email, emailNorm, 'supabase_auth', normalizedRole, 'active']
    );
  } catch (e) { console.warn('public.users sync failed:', e.message); }
  if (normalizedRole === 'shop_owner') await ensureShopRow(data.user.id, name || data.user.email);
  res.status(201).json(data.user);
};

export const syncUser = async (req, res) => {
  // Priority 1 / C3: public sync-user cannot create privileged accounts.
  // Identity comes from the verified JWT only — never from request body id/role.
  // Role is hard-coded to customer. shop_owner/admin require admin-controlled flows.
  if (!req.user?.id) return res.status(401).json({ message: 'Authentication required' });
  const id = req.user.id;
  const rawEmail = req.user.email || '';
  const emailNorm = normalizeEmail(rawEmail);
  if (!emailNorm || !isValidEmail(emailNorm)) {
    return res.status(400).json({ code: 'INVALID_EMAIL', field: 'email', message: 'Please enter a valid email address.' });
  }
  const name =
    req.body?.name ||
    req.user.user_metadata?.name ||
    req.user.user_metadata?.fullName ||
    rawEmail ||
    'User';
  // Phone handling — optional, but if provided validate and normalize
  const rawPhone = req.body?.phone || req.user.user_metadata?.phone;
  let phoneNorm;
  if (rawPhone) {
    const phoneErr = validatePhilippinePhone(rawPhone);
    if (phoneErr) {
      return res.status(400).json({ code: 'INVALID_PHONE', field: 'phone', message: phoneErr });
    }
    phoneNorm = normalizePhilippinePhone(rawPhone);
    // If phone column exists, we would store canonical form; currently users table has no phone column in base schema,
    // so we keep phone in Supabase metadata only — validation still enforced.
  }
  // Enforce that client cannot send role — ignore any body role
  // Even if body contains role, we ignore it
  const normalizedRole = 'customer';
  try {
    // Check duplicate email before insert — if another user has same email with different id
    const { rows: existingEmail } = await pool.query('SELECT id FROM public.users WHERE email=$1 AND id != $2', [emailNorm, id]);
    if (existingEmail.length) {
      return res.status(400).json({ code: 'EMAIL_ALREADY_EXISTS', field: 'email', message: 'An account with this email already exists.' });
    }
    // If phone column existed and had UNIQUE, we would check duplicate phone here
    // Since no column, skip PHONE_ALREADY_EXISTS check to avoid inventing validation
    // On conflict, only update name — never role/status/email.
    // Role changes go only through admin Users & Roles management.
    await pool.query(
      'INSERT INTO public.users (id, name, email, password_hash, role, status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name',
      [id, name, emailNorm, 'supabase_auth', normalizedRole, 'active']
    );
    res.json({ ok: true, role: normalizedRole });
  } catch (e) {
    // Handle unique violation on email
    const msg = (e.message || '').toLowerCase();
    if (msg.includes('duplicate') && msg.includes('email')) {
      return res.status(400).json({ code: 'EMAIL_ALREADY_EXISTS', field: 'email', message: 'An account with this email already exists.' });
    }
    if (msg.includes('duplicate') && msg.includes('phone')) {
      return res.status(400).json({ code: 'PHONE_ALREADY_EXISTS', field: 'phone', message: 'This mobile number is already associated with an account.' });
    }
    console.error('syncUser failed:', e.message);
    // Never include password in logs
    res.status(500).json({ message: 'Sync failed' });
  }
};
export const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
  const emailNorm = normalizeEmail(email);
  if (!isValidEmail(emailNorm)) return res.status(400).json({ code: 'INVALID_EMAIL', field: 'email', message: 'Please enter a valid email address.' });
  const { data, error } = await supabase.auth.signInWithPassword({ email: emailNorm, password });
  if (error) return res.status(401).json({ message: 'Invalid credentials' });
  res.json(data);
};
export const logout = async (_req, res) => { await supabase.auth.signOut(); res.json({ message: 'Signed out' }); };

// Returns the user's role from the trusted DB source (not JWT metadata).
// Used by the frontend to populate the auth context with a verified role.
// AUTO-SYNC: If the user exists in auth.users but not in public.users,
// automatically create the public.users row. Priority 1 / C2: role is ALWAYS
// 'customer' — user_metadata.role must NEVER grant authorization.
export const getMe = async (req, res) => {
  try {
    let { rows } = await pool.query('SELECT id, name, email, role, status, preferred_branch_id FROM public.users WHERE id = $1', [req.user.id]);
    if (!rows[0]) {
      // User exists in auth.users (requireAuth verified the token) but not in public.users.
      // Auto-sync creates a customer row only. Admin/shop_owner creation is server/admin-only.
      const authUser = req.user;
      const name = authUser.user_metadata?.name || authUser.email || 'User';
      const email = normalizeEmail(authUser.email || '');
      const role = 'customer';
      if (!isValidEmail(email)) {
        return res.status(400).json({ code: 'INVALID_EMAIL', field: 'email', message: 'Please enter a valid email address.' });
      }
      try {
        await pool.query(
          'INSERT INTO public.users (id, name, email, password_hash, role, status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
          [authUser.id, name, email, 'supabase_auth', role, 'active']
        );
        ({ rows } = await pool.query('SELECT id, name, email, role, status, preferred_branch_id FROM public.users WHERE id = $1', [authUser.id]));
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
