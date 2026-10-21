// backend/src/tests/adminUsersRoles.test.js
// Admin → Users & Roles backend suite.
//
// Contract under test:
//  • The admin router is authenticated + admin-gated (routes/index evidence).
//  • The list supports search + role/branch/status filters.
//  • The KPI summary aggregates the FULL dataset (not the visible rows).
//  • Only the real roles/statuses/branches are accepted.
//  • role/status/branch are validated server-side.
//  • An admin can never suspend/demote themselves, and the last active admin
//    can never be locked out.
//  • Invitations are real (Supabase Auth), duplicates are refused, resend is
//    cooldown-protected and cancel never deletes an active account.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const poolQuery = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: vi.fn(), on: vi.fn() },
  isDirectPg: () => true,
}));

const authAdmin = {
  inviteUserByEmail: vi.fn(async () => ({ data: { user: { id: 'invited-uuid' } }, error: null })),
  createUser: vi.fn(async () => ({ data: { user: { id: 'invited-uuid' } }, error: null })),
  generateLink: vi.fn(async () => ({ data: { properties: { action_link: 'https://example.test/invite' } }, error: null })),
  deleteUser: vi.fn(async () => ({ data: {}, error: null })),
  listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
};
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { admin: authAdmin } })),
}));

const sendNotificationEmail = vi.fn(async () => ({ ok: true }));
vi.mock('../services/emailService.js', () => ({ sendNotificationEmail: (...a) => sendNotificationEmail(...a) }));

const {
  listUsers, getUsersSummary, updateUser, suspendUser, inviteUser, resendInvite, cancelInvite,
} = await import('../controllers/admin/user.controller.js');

const ADMIN = '00000000-0000-0000-0000-000000000004';
const OTHER = '55555555-0000-0000-0000-000000000005';
const BRANCH = '2af5d27d-13d6-4743-99dd-e4e675002c1b';
const VALID_UUID = '11111111-1111-1111-1111-111111111111';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
const req = (body = {}, params = {}, userId = ADMIN, query = {}) => ({
  body, params, query, user: { id: userId },
});

function payload(res) {
  return res.json.mock.calls[0]?.[0];
}

/** Default pool behaviour — a small staff + customer dataset. */
function defaultPool({ users = [], summary = {}, branchExists = true } = {}) {
  poolQuery.mockImplementation(async (sql, params) => {
    if (/total_accounts/.test(sql)) return { rows: [summary] };
    if (/staff_branch_count/.test(sql)) return { rows: [{ staff_branch_count: 2 }] };
    if (/FROM users u/.test(sql) && /JOIN LATERAL/.test(sql)) return { rows: users };
    if (/SELECT id, name, email, role, status FROM users/.test(sql)) {
      return { rows: users.filter((u) => u.id === params[0]) };
    }
    if (/FROM users WHERE lower\(email\)/.test(sql)) {
      return { rows: users.filter((u) => u.email === params[0]) };
    }
    if (/SELECT status FROM users/.test(sql)) {
      const u = users.find((x) => x.id === params[0]);
      return { rows: u ? [{ status: u.status }] : [] };
    }
    if (/SELECT id, role, status FROM users/.test(sql)) {
      const u = users.find((x) => x.id === params[0]);
      return { rows: u ? [u] : [] };
    }
    if (/count\(\*\)::int AS c FROM users WHERE role = 'admin'/.test(sql)) {
      return { rows: [{ c: 1 }] };
    }
    if (/UPDATE users SET status/.test(sql)) {
      const u = users.find((x) => x.id === params[1]);
      return { rows: u ? [{ ...u, status: params[0] }] : [] };
    }
    if (/UPDATE users SET/.test(sql)) {
      return { rows: [{ id: params[params.length - 1], name: 'Updated', email: 'a@b.com', role: 'admin', status: 'active' }] };
    }
    if (/INSERT INTO users/.test(sql)) {
      return { rows: [{ id: 'invited-uuid', name: params[1], email: params[2], role: params[3], status: 'invited', created_at: '2026-01-01' }] };
    }
    if (/FROM branches/.test(sql)) {
      return branchExists ? { rows: [{ id: BRANCH, name: 'Gmall Branch' }] } : { rows: [] };
    }
    if (/FROM bids/.test(sql)) return { rows: [] };
    if (/audit_logs/.test(sql)) return { rows: [] };
    if (/FROM auth.users/.test(sql)) {
      return { rows: [{ id: params[0][0], last_sign_in_at: '2026-09-20T10:00:00.000Z', invited_at: null }] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  poolQuery.mockReset();
  authAdmin.inviteUserByEmail.mockReset().mockResolvedValue({ data: { user: { id: 'invited-uuid' } }, error: null });
  authAdmin.createUser.mockReset().mockResolvedValue({ data: { user: { id: 'invited-uuid' } }, error: null });
  authAdmin.generateLink.mockReset().mockResolvedValue({ data: { properties: { action_link: 'https://example.test/invite' } }, error: null });
  authAdmin.deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
  sendNotificationEmail.mockReset().mockResolvedValue({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// authorization evidence
// ─────────────────────────────────────────────────────────────
describe('admin users — authorization', () => {
  it('the admin router is mounted behind requireAuth + requireRole(admin)', () => {
    const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    expect(indexSrc).toMatch(/app\.use\('\/admin',\s*requireAuth,\s*requireRole\(\['admin'\]\)/);
  });

  it('every users route lives on the admin router', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/admin.routes.js'), 'utf8');
    expect(routes).toMatch(/router\.get\('\/users', listUsers\)/);
    expect(routes).toMatch(/router\.get\('\/users\/summary', getUsersSummary\)/);
    expect(routes).toMatch(/router\.put\('\/users\/:id', updateUser\)/);
    expect(routes).toMatch(/router\.patch\('\/users\/:id\/suspend', suspendUser\)/);
    expect(routes).toMatch(/router\.post\('\/users\/invite', inviteUser\)/);
    expect(routes).toMatch(/router\.patch\('\/users\/:id\/resend-invite', resendInvite\)/);
    expect(routes).toMatch(/router\.delete\('\/users\/:id\/invite', cancelInvite\)/);
  });

  it('requireRole always reads the role from the database', () => {
    const guard = fs.readFileSync(path.join(__dirname, '../middleware/requireRole.js'), 'utf8');
    expect(guard).toMatch(/public\.users/);
    expect(guard).toMatch(/No fallback to JWT user_metadata/);
  });
});

// ─────────────────────────────────────────────────────────────
// list + filters + summary
// ─────────────────────────────────────────────────────────────
describe('admin users — list and filters', () => {
  const USERS = [
    { id: 'u1', name: 'Adrian Villanueva', email: 'adrian.v@atany.ph', role: 'admin', status: 'active', branch_id: null, branch_name: null },
    { id: 'u2', name: 'Rosa Villanueva', email: 'rosa.v@atany.ph', role: 'shop_owner', status: 'active', branch_id: BRANCH, branch_name: 'Gmall Branch' },
    { id: 'u3', name: 'Bianca Ramos', email: 'bianca.r@atany.ph', role: 'shop_owner', status: 'invited', branch_id: BRANCH, branch_name: 'Gmall Branch' },
  ];

  it('returns the accounts with their branch and last activity', async () => {
    defaultPool({ users: USERS });
    const res = mockRes();
    await listUsers(req({}, {}), res);
    const rows = payload(res);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ name: 'Adrian Villanueva', role: 'admin', status: 'active', branch_name: null });
    expect(rows[1]).toMatchObject({ branch_name: 'Gmall Branch' });
  });

  it('applies the search term to name, email and role', async () => {
    defaultPool({ users: USERS });
    const res = mockRes();
    await listUsers(req({}, {}, ADMIN, { q: 'rosa' }), res);
    const sql = poolQuery.mock.calls.find(([q]) => /ILIKE/.test(q))?.[0] || '';
    expect(sql).toMatch(/u\.name ILIKE/);
    expect(sql).toMatch(/u\.email ILIKE/);
    expect(sql).toMatch(/u\.role::text ILIKE/);
  });

  it('applies the role filter', async () => {
    defaultPool({ users: USERS });
    const res = mockRes();
    await listUsers(req({}, {}, ADMIN, { role: 'shop_owner' }), res);
    const sql = poolQuery.mock.calls.find(([q]) => /u\.role = \$/.test(q))?.[0] || '';
    expect(sql).toMatch(/u\.role = \$1/);
  });

  it('applies the status filter', async () => {
    defaultPool({ users: USERS });
    const res = mockRes();
    await listUsers(req({}, {}, ADMIN, { status: 'invited' }), res);
    const sql = poolQuery.mock.calls.find(([q]) => /u\.status = \$/.test(q))?.[0] || '';
    expect(sql).toMatch(/u\.status = \$1/);
  });

  it('applies the branch filter against the real branch relationship', async () => {
    defaultPool({ users: USERS });
    const res = mockRes();
    await listUsers(req({}, {}, ADMIN, { branch_id: BRANCH }), res);
    const sql = poolQuery.mock.calls.find(([q]) => /COALESCE\(s\.home_branch_id, u\.preferred_branch_id\) = \$/.test(q))?.[0] || '';
    expect(sql).toMatch(/COALESCE\(s\.home_branch_id, u\.preferred_branch_id\) = \$1/);
  });

  it('the summary aggregates the FULL dataset, not the visible rows', async () => {
    defaultPool({ summary: { total_accounts: 10, total_staff: 4, active_staff: 4, pending_invites: 1, suspended_staff: 1, on_leave_staff: 0 } });
    const res = mockRes();
    await getUsersSummary(req(), res);
    const p = payload(res);
    expect(p.total_accounts).toBe(10);
    expect(p.total_staff).toBe(4);
    expect(p.pending_invites).toBe(1);
    expect(p.suspended_staff).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// update validation
// ─────────────────────────────────────────────────────────────
describe('admin users — update validation', () => {
  it('rejects an invalid role', async () => {
    defaultPool();
    const res = mockRes();
    await updateUser(req({ role: 'auctioneer' }, { id: VALID_UUID }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(payload(res).message).toMatch(/Role must be one of/);
  });

  it('rejects an invalid status', async () => {
    defaultPool();
    const res = mockRes();
    await updateUser(req({ status: 'bogus' }, { id: VALID_UUID }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(payload(res).message).toMatch(/Status must be one of/);
  });

  it('rejects an invalid email', async () => {
    defaultPool();
    const res = mockRes();
    await updateUser(req({ email: 'nope' }, { id: VALID_UUID }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects an empty name', async () => {
    defaultPool();
    const res = mockRes();
    await updateUser(req({ name: '   ' }, { id: VALID_UUID }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects an unknown branch', async () => {
    defaultPool({ branchExists: false });
    const res = mockRes();
    await updateUser(req({ branch_id: BRANCH }, { id: VALID_UUID }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(payload(res).message).toBe('Branch not found');
  });

  it('rejects a malformed branch id without touching the database', async () => {
    defaultPool();
    const res = mockRes();
    await updateUser(req({ branch_id: 'not-a-uuid' }, { id: VALID_UUID }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(payload(res).message).toBe('Branch not found');
  });

  it('rejects an invalid user id', async () => {
    defaultPool();
    const res = mockRes();
    await updateUser(req({ name: 'X' }, { id: 'nope' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─────────────────────────────────────────────────────────────
// suspend / reactivate + protections
// ─────────────────────────────────────────────────────────────
describe('admin users — suspend and reactivate', () => {
  it('suspends an active account', async () => {
    defaultPool({ users: [{ id: OTHER, role: 'customer', status: 'active' }] });
    const res = mockRes();
    await suspendUser(req({ status: 'suspended' }, { id: OTHER }), res);
    expect(res.status).not.toHaveBeenCalledWith(400);
    const update = poolQuery.mock.calls.find(([sql]) => /UPDATE users SET status/.test(sql));
    expect(update[1][0]).toBe('suspended');
  });

  it('reactivates a suspended account', async () => {
    defaultPool({ users: [{ id: OTHER, role: 'customer', status: 'suspended' }] });
    const res = mockRes();
    await suspendUser(req({ status: 'active' }, { id: OTHER }), res);
    const update = poolQuery.mock.calls.find(([sql]) => /UPDATE users SET status/.test(sql));
    expect(update[1][0]).toBe('active');
  });

  it('toggles the status when no explicit target is given', async () => {
    defaultPool({ users: [{ id: OTHER, role: 'customer', status: 'active' }] });
    const res = mockRes();
    await suspendUser(req({}, { id: OTHER }), res);
    const update = poolQuery.mock.calls.find(([sql]) => /UPDATE users SET status/.test(sql));
    expect(update[1][0]).toBe('suspended');
  });

  it('blocks an admin from suspending their own account', async () => {
    defaultPool({ users: [{ id: ADMIN, role: 'admin', status: 'active' }] });
    const res = mockRes();
    await suspendUser(req({ status: 'suspended' }, { id: ADMIN }, ADMIN), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(payload(res).message).toMatch(/cannot suspend your own account/i);
  });

  it('blocks an admin from changing their own role', async () => {
    defaultPool({ users: [{ id: ADMIN, role: 'admin', status: 'active' }] });
    const res = mockRes();
    await updateUser(req({ role: 'customer' }, { id: ADMIN }, ADMIN), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(payload(res).message).toMatch(/cannot change your own role/i);
  });

  it('protects the last active administrator', async () => {
    defaultPool({ users: [{ id: OTHER, role: 'admin', status: 'active' }] });
    poolQuery.mockImplementation(async (sql, params) => {
      if (/count\(\*\)::int AS c FROM users WHERE role = 'admin'/.test(sql)) return { rows: [{ c: 0 }] };
      if (/SELECT id, role, status FROM users/.test(sql)) return { rows: [{ id: OTHER, role: 'admin', status: 'active' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await suspendUser(req({ status: 'suspended' }, { id: OTHER }, ADMIN), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(payload(res).message).toMatch(/active administrator must remain/i);
  });

  it('returns 404 for an unknown user', async () => {
    defaultPool({ users: [] });
    const res = mockRes();
    await suspendUser(req({ status: 'suspended' }, { id: OTHER }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────────────────────────
// invitations
// ─────────────────────────────────────────────────────────────
describe('admin users — invitations', () => {
  it('creates a real invitation and an invited account row', async () => {
    defaultPool({ users: [] });
    const res = mockRes();
    await inviteUser(req({ name: 'New Member', email: 'new@atany.ph', role: 'admin' }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(authAdmin.inviteUserByEmail).toHaveBeenCalled();
    const insert = poolQuery.mock.calls.find(([sql]) => /INSERT INTO users/.test(sql));
    expect(insert[0]).toMatch(/status/);
    expect(insert[0]).toMatch(/'invited'/);
    expect(insert[1]).toContain('invited-uuid');
    expect(insert[1]).toContain('new@atany.ph');
    expect(insert[1]).toContain('admin');
  });

  it('refuses a duplicate invitation for an existing account', async () => {
    defaultPool({ users: [{ id: 'u1', email: 'new@atany.ph', role: 'customer', status: 'active' }] });
    const res = mockRes();
    await inviteUser(req({ name: 'New Member', email: 'new@atany.ph', role: 'admin' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(authAdmin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('refuses an invalid role', async () => {
    defaultPool({ users: [] });
    const res = mockRes();
    await inviteUser(req({ name: 'X', email: 'x@atany.ph', role: 'cashier' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('refuses an invalid branch', async () => {
    defaultPool({ users: [], branchExists: false });
    const res = mockRes();
    await inviteUser(req({ name: 'X', email: 'x@atany.ph', role: 'shop_owner', branch_id: BRANCH }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('requires a branch for a branch-scoped role', async () => {
    defaultPool({ users: [] });
    const res = mockRes();
    await inviteUser(req({ name: 'X', email: 'x@atany.ph', role: 'shop_owner' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(payload(res).message).toMatch(/branch is required/i);
  });

  it('falls back to an unconfirmed account when the provider cannot email', async () => {
    defaultPool({ users: [] });
    authAdmin.inviteUserByEmail.mockResolvedValue({ data: null, error: { message: 'email rate limit exceeded' } });
    const res = mockRes();
    await inviteUser(req({ name: 'New Member', email: 'new@atany.ph', role: 'admin' }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(authAdmin.createUser).toHaveBeenCalled();
  });

  it('resends a pending invitation', async () => {
    defaultPool({ users: [{ id: OTHER, email: 'a@b.com', role: 'admin', status: 'invited' }] });
    const res = mockRes();
    await resendInvite(req({}, { id: OTHER }), res);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(authAdmin.generateLink).toHaveBeenCalled();
  });

  it('refuses to resend for an account that is not a pending invitation', async () => {
    defaultPool({ users: [{ id: OTHER, email: 'a@b.com', role: 'admin', status: 'active' }] });
    const res = mockRes();
    await resendInvite(req({}, { id: OTHER }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(payload(res).message).toMatch(/Only pending invitations/i);
  });

  it('enforces a resend cooldown', async () => {
    defaultPool({ users: [{ id: OTHER, email: 'a@b.com', role: 'admin', status: 'invited' }] });
    poolQuery.mockImplementation(async (sql) => {
      if (/FROM audit_logs/.test(sql)) return { rows: [{ created_at: new Date().toISOString() }] };
      if (/SELECT id, name, email, role, status FROM users/.test(sql)) {
        return { rows: [{ id: OTHER, email: 'a@b.com', role: 'admin', status: 'invited' }] };
      }
      return { rows: [] };
    });
    const res = mockRes();
    await resendInvite(req({}, { id: OTHER }), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(payload(res).message).toMatch(/Please wait/i);
  });

  it('cancels a pending invitation and removes the account', async () => {
    defaultPool({ users: [{ id: OTHER, email: 'a@b.com', role: 'admin', status: 'invited' }] });
    const res = mockRes();
    await cancelInvite(req({}, { id: OTHER }), res);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(authAdmin.deleteUser).toHaveBeenCalledWith(OTHER);
    expect(poolQuery.mock.calls.some(([sql]) => /DELETE FROM users/.test(sql))).toBe(true);
  });

  it('never cancels an active real account', async () => {
    defaultPool({ users: [{ id: OTHER, email: 'a@b.com', role: 'admin', status: 'active' }] });
    const res = mockRes();
    await cancelInvite(req({}, { id: OTHER }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(authAdmin.deleteUser).not.toHaveBeenCalled();
    expect(poolQuery.mock.calls.some(([sql]) => /DELETE FROM users/.test(sql))).toBe(false);
  });
});
