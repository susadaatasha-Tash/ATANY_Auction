// backend/src/db/seedDemoUsers.js
// Run: node src/db/seedDemoUsers.js  (needs backend/.env with SUPABASE_URL + SERVICE_ROLE_KEY)
// Creates 4 demo accounts via Supabase Auth admin API — matches 002_seed_demo.sql emails
// Uses consistent UUIDs so auth.users and public.users stay in sync.
// Also inserts corresponding public.users rows to prevent login loop.
import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const demos = [
  { id: '00000000-0000-0000-0000-000000000001', email: 'maria.santos@email.com', password: 'Customer123!', user_metadata: { name: 'Maria Santos', role: 'customer' }, preferred_branch_id: '2af5d27d-13d6-4743-99dd-e4e675002c1b' },
  { id: '00000000-0000-0000-0000-000000000002', email: 'contact@goldenheritage.ph', password: 'ShopOwner123!', user_metadata: { name: 'Golden Heritage — Gmall', role: 'shop_owner' }, home_branch_id: '2af5d27d-13d6-4743-99dd-e4e675002c1b' },
  { id: '00000000-0000-0000-0000-000000000005', email: 'abreeza@goldenheritage.ph', password: 'ShopOwner123!', user_metadata: { name: 'Golden Heritage — Abreeza', role: 'shop_owner' }, home_branch_id: 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a' },
  { id: '00000000-0000-0000-0000-000000000006', email: 'smlanang@goldenheritage.ph', password: 'ShopOwner123!', user_metadata: { name: 'Golden Heritage — SM Lanang', role: 'shop_owner' }, home_branch_id: 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b' },
  { id: '00000000-0000-0000-0000-000000000004', email: 'admin@atany.ph', password: 'Admin123!', user_metadata: { name: 'Admin User', role: 'admin' } },
];

for (const u of demos) {
  // Create auth user with explicit UUID to match public.users
  const { data, error } = await supabase.auth.admin.createUser({
    id: u.id,
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: u.user_metadata,
  });
  if (error) {
    // If user already exists, that's fine — just log it
    if (error.message?.includes('already exists') || error.message?.includes('already registered')) {
      console.log(`✓ ${u.email} (${u.user_metadata.role}) — already exists in auth`);
    } else {
      console.error(`✗ ${u.email}:`, error.message);
    }
  } else {
    console.log(`✓ ${u.email} (${u.user_metadata.role}) — ${data.user.id}`);
  }

  // Also ensure public.users row exists
  try {
    await pool.query(
      'INSERT INTO public.users (id, name, email, password_hash, role, status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role',
      [u.id, u.user_metadata.name, u.email, 'supabase_auth', u.user_metadata.role, 'active']
    );
    console.log(`  ↳ public.users row synced`);
  } catch (e) {
    console.warn(`  ↳ public.users sync skipped:`, e.message);
  }

  // If shop_owner, ensure shops row exists with correct home_branch_id
  if (u.user_metadata.role === 'shop_owner') {
    try {
      // Try update first, then insert if no row exists
      const result = await pool.query(
        'UPDATE shops SET shop_name=$1, home_branch_id=$2 WHERE user_id=$3',
        [u.user_metadata.name, u.home_branch_id, u.id]
      );
      if (result.rowCount === 0) {
        await pool.query(
          'INSERT INTO shops (user_id, shop_name, home_branch_id) VALUES ($1,$2,$3)',
          [u.id, u.user_metadata.name, u.home_branch_id]
        );
      }
      console.log(`  ↳ shops row synced (branch: ${u.home_branch_id})`);
    } catch (e) {
      console.warn(`  ↳ shops sync skipped:`, e.message);
    }
  }

  // If customer, set preferred_branch_id
  if (u.user_metadata.role === 'customer' && u.preferred_branch_id) {
    try {
      await pool.query(
        'UPDATE users SET preferred_branch_id = $1 WHERE id = $2',
        [u.preferred_branch_id, u.id]
      );
      console.log(`  ↳ customer preferred branch set`);
    } catch (e) {
      console.warn(`  ↳ preferred branch sync skipped:`, e.message);
    }
  }
}

await pool.end();
console.log('\nDone. Demo accounts ready for login.');
console.log('Customer:    maria.santos@email.com / Customer123!');
console.log('Shop Owner:  contact@goldenheritage.ph / ShopOwner123! (Gmall Branch)');
console.log('Shop Owner:  abreeza@goldenheritage.ph / ShopOwner123! (Abreeza Branch)');
console.log('Shop Owner:  smlanang@goldenheritage.ph / ShopOwner123! (SM Lanang Branch)');
console.log('Admin:       admin@atany.ph / Admin123!');
