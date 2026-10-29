// Admin users & roles — list enrichment, partial update, suspend/reactivate
// protections. Covers behaviour added while rebuilding /admin/users on the real
// data model (3 roles, 2 statuses, preferred_branch_id).
import { describe, test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const poolQuery = vi.hoisted(() => vi.fn());
vi.mock('../db/pool.js', () => ({ pool: { query: poolQuery } }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { admin: { createUser: vi.fn() } } }) }));

import { listUsers, updateUser, suspendUser } from '../controllers/admin/user.controller.js';

const ADMIN_1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const ADMIN_2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const CUSTOMER = 'cccccccc-0000-0000-0000-000000000003';
const SELLER = 'dddddddd-0000-0000-0000-000000000004';
const BRANCH_1 = 'br-1';

function mockRes() {
  const r = {};
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  return r;
}

const BASE_USERS = [
  { id: ADMIN_1, name: 'Admin User', email: 'admin@atany.ph', role: 'admin', status: 'active', preferred_branch_id: null, created_at: '2026-09-13T00:00:00Z' },
  { id: CUSTOMER, name: 'Klane Cruz', email: 'klane@gmail.com', role: 'customer', status: 'active', preferred_branch_id: BRANCH_1, created_at: '2026-10-07T00:00:00Z' },
  { id: SELLER, name: 'Golden Heritage', email: 'owner@goldenheritage.ph', role: 'shop_owner', status: 'suspended', preferred_branch_id: BRANCH_1, created_at: '2026-09-14T00:00:00Z' },
];

function seed({ users = BASE_USERS, branches = [{ id: BRANCH_1, name: 'Gmall' }], admins = 2 } = {}) {
  poolQuery.mockImplementation(async (sql, params) => {
    const s = String(sql);
    if (/FROM users ORDER BY created_at DESC/.test(s)) return { rows: users };
    if (/FROM bids WHERE user_id IN/.test(s)) return { rows: [{ user_id: CUSTOMER, __bids: 9 }] };
    if (/FROM branches WHERE id IN/.test(s)) return { rows: branches };
    if (/SELECT id, role, status FROM users WHERE id=\$1/.test(s)) {
      const found = users.find((u) => u.id === params[0]);
      return { rows: found ? [found] : [] };
    }
    if (/SELECT \* FROM orders WHERE id=\$1/.test(s)) return { rows: [] }; // untouched by suspension
    if (/SELECT id, name, email, role, status FROM users WHERE id=\$1/.test(s)) {
      const found = users.find((u) => u.id === params[0]);
      return { rows: found ? [found] : [] };
    }
    if (/role='admin' AND status='active'/.test(s)) return { rows: [{ cnt: admins }] };
    if (/^UPDATE users SET/.test(s)) {
      const id = params[params.length - 1];
      const found = users.find((u) => u.id === id);
      if (!found) return { rows: [] };
      const updated = { ...found };
      params.slice(0, -1).forEach((v, i) => {
        const col = s.match(new RegExp(`\\b(name|email|role|status)=\\$${i + 1}\\b`));
        if (col) updated[col[1]] = v;
      });
      return { rows: [updated] };
    }
    if (/INSERT INTO audit_logs/.test(s)) return { rows: [] };
    return { rows: [] };
  });
}

beforeEach(() => { poolQuery.mockReset(); });

describe('GET /admin/users — real data model', () => {
  test('returns every account with preferred branch resolved and bid counts', async () => {
    seed({});
    const res = mockRes();
    await listUsers({ user: { id: ADMIN_1 } }, res);
    const rows = res.json.mock.calls[0][0];
    expect(rows).toHaveLength(3);
    const customer = rows.find((u) => u.id === CUSTOMER);
    expect(customer).toMatchObject({ role: 'customer', status: 'active', preferred_branch_id: BRANCH_1, branch_name: 'Gmall' });
    const admin = rows.find((u) => u.id === ADMIN_1);
    expect(admin.branch_name).toBeNull(); // no branch → null (UI shows —)
    const seller = rows.find((u) => u.id === SELLER);
    expect(seller.role).toBe('shop_owner');
    expect(seller.status).toBe('suspended');
  });

  test('branches are resolved in ONE batched query (no per-user fetch)', async () => {
    seed({});
    const res = mockRes();
    await listUsers({ user: { id: ADMIN_1 } }, res);
    const branchQueries = poolQuery.mock.calls.filter(([sql]) => /FROM branches/.test(String(sql)));
    expect(branchQueries).toHaveLength(1);
  });

  test('no users → empty array, no further queries', async () => {
    seed({ users: [] });
    const res = mockRes();
    await listUsers({ user: { id: ADMIN_1 } }, res);
    expect(res.json).toHaveBeenCalledWith([]);
  });
});

describe('PUT /admin/users/:id — partial update + protections', () => {
  test('partial update only touches provided fields (no NULL overwrite)', async () => {
    seed({});
    const res = mockRes();
    await updateUser({ user: { id: ADMIN_1 }, params: { id: CUSTOMER }, body: { name: 'Klane Cruz Jr' } }, res);
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET/.test(String(sql)));
    expect(update[0]).toMatch(/^UPDATE users SET name=\$1 WHERE id=\$2/);
    expect(update[0]).not.toMatch(/role=/);
    expect(update[1]).toEqual(['Klane Cruz Jr', CUSTOMER]);
    expect(res.json).toHaveBeenCalled();
  });

  test('invalid role rejected', async () => {
    seed({});
    const res = mockRes();
    await updateUser({ user: { id: ADMIN_1 }, params: { id: CUSTOMER }, body: { role: 'branch_manager' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Role must be one of/);
  });

  test('invalid status rejected', async () => {
    seed({});
    const res = mockRes();
    await updateUser({ user: { id: ADMIN_1 }, params: { id: CUSTOMER }, body: { status: 'on_leave' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('admin cannot demote their own account', async () => {
    seed({});
    const res = mockRes();
    await updateUser({ user: { id: ADMIN_1 }, params: { id: ADMIN_1 }, body: { role: 'customer' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/your own admin access/i);
  });

  test('last active admin cannot be demoted', async () => {
    seed({ admins: 1 });
    const res = mockRes();
    await updateUser({ user: { id: ADMIN_2 }, params: { id: ADMIN_1 }, body: { status: 'suspended' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/active admin must remain/i);
  });

  test('another admin can be suspended when a second active admin exists', async () => {
    seed({ admins: 2 });
    const res = mockRes();
    await updateUser({ user: { id: ADMIN_2 }, params: { id: ADMIN_1 }, body: { status: 'suspended' } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].status).toBe('suspended');
  });

  test('unknown user → 404', async () => {
    seed({ users: [] });
    const res = mockRes();
    await updateUser({ user: { id: ADMIN_1 }, params: { id: 'nope' }, body: { name: 'X' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('PATCH /admin/users/:id/suspend — explicit status + protections', () => {
  test('suspend writes status suspended for the selected id', async () => {
    seed({});
    const res = mockRes();
    await suspendUser({ user: { id: ADMIN_1 }, params: { id: SELLER }, body: { status: 'suspended' } }, res);
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET status=\$1/.test(String(sql)));
    expect(update[1]).toEqual(['suspended', SELLER]);
    expect(res.json.mock.calls[0][0].status).toBe('suspended');
  });

  test('reactivate writes status active', async () => {
    seed({});
    const res = mockRes();
    await suspendUser({ user: { id: ADMIN_1 }, params: { id: SELLER }, body: { status: 'active' } }, res);
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET status=\$1/.test(String(sql)));
    expect(update[1]).toEqual(['active', SELLER]);
  });

  test('self-suspension blocked', async () => {
    seed({});
    const res = mockRes();
    await suspendUser({ user: { id: ADMIN_1 }, params: { id: ADMIN_1 }, body: { status: 'suspended' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/cannot suspend your own account/i);
    expect(poolQuery.mock.calls.some(([sql]) => /^UPDATE users SET/.test(String(sql)))).toBe(false);
  });

  test('last active admin cannot be suspended', async () => {
    seed({ admins: 1 });
    const res = mockRes();
    await suspendUser({ user: { id: ADMIN_2 }, params: { id: ADMIN_1 }, body: { status: 'suspended' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/active admin must remain/i);
  });

  test('unknown status rejected', async () => {
    seed({});
    const res = mockRes();
    await suspendUser({ user: { id: ADMIN_1 }, params: { id: SELLER }, body: { status: 'invited' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('legacy toggle (no body) resolves the target from authoritative state', async () => {
    seed({});
    const res = mockRes();
    await suspendUser({ user: { id: ADMIN_1 }, params: { id: CUSTOMER } }, res);
    // the target is resolved by the controller from the pre-flight read and then
    // written explicitly (deterministic, no DB-side CASE toggle)
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET status=\$1/.test(String(sql)));
    expect(update).toBeTruthy();
    expect(update[1][0]).toBe('suspended'); // customer was active
    expect(res.json).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].status).toBe('suspended');
  });

  test('legacy toggle reactivates a suspended account', async () => {
    seed();
    const suspended = { id: CUSTOMER, name: 'Klane Cruz', email: 'klane@gmail.com', role: 'customer', status: 'suspended' };
    poolQuery.mockImplementation(async (sql, params = []) => {
      if (/SELECT id, role, status FROM users WHERE id=\$1/.test(String(sql))) {
        return { rows: params[0] === CUSTOMER ? [suspended] : [] };
      }
      if (/^UPDATE users SET/.test(String(sql))) {
        return { rows: [{ ...suspended, status: params[0] }] };
      }
      return { rows: [] };
    });
    const res = mockRes();
    await suspendUser({ user: { id: ADMIN_1 }, params: { id: CUSTOMER } }, res);
    expect(res.json.mock.calls[0][0].status).toBe('active');
  });
});

describe('preferred_branch_id is customer-owned, not admin-assignable', () => {
  test('admin update never writes preferred_branch_id, even if a caller sends it', async () => {
    seed({});
    const res = mockRes();
    await updateUser({ user: { id: ADMIN_1 }, params: { id: CUSTOMER }, body: { name: 'Klane Cruz', preferred_branch_id: BRANCH_1 } }, res);
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET/.test(String(sql)));
    expect(update[0]).not.toMatch(/preferred_branch_id/);
    expect(update[0]).not.toMatch(/branch/);
    expect(update[1]).toEqual(['Klane Cruz', CUSTOMER]);
  });

  test('omitting the field leaves the stored preferred branch untouched (partial-safe)', async () => {
    seed({});
    const res = mockRes();
    await updateUser({ user: { id: ADMIN_1 }, params: { id: CUSTOMER }, body: { status: 'suspended' } }, res);
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET/.test(String(sql)));
    expect(update[0]).toMatch(/^UPDATE users SET status=\$1 WHERE id=\$2/);
    expect(update[0]).not.toMatch(/preferred_branch_id/);
  });

  test('the controller exposes no branch write path for admins', () => {
    const ctrlSrc = fs.readFileSync(path.join(__dirname, '../controllers/admin/user.controller.js'), 'utf8');
    // the column may only ever be SELECTed (read) or rendered, never SET/INSERTed by an admin handler
    expect(ctrlSrc).not.toMatch(/SET[^`]*preferred_branch_id\s*=/);
    expect(ctrlSrc).not.toMatch(/INSERT INTO users[^`]*preferred_branch_id/);
    expect(ctrlSrc).not.toMatch(/preferred_branch_id\s*=\s*\$\d/);
  });

  test('the customer self-service route remains the only writer', () => {
    const ctrlSrc = fs.readFileSync(path.join(__dirname, '../controllers/customer/account.controller.js'), 'utf8');
    expect(ctrlSrc).toMatch(/UPDATE users SET preferred_branch_id = \$1 WHERE id = \$2/);
  });
});

describe('users & roles security contract', () => {
  const routesSrc = fs.readFileSync(path.join(__dirname, '../routes/admin.routes.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  const ctrlSrc = fs.readFileSync(path.join(__dirname, '../controllers/admin/user.controller.js'), 'utf8');

  test('all user routes stay behind admin auth (no new public routes)', () => {
    expect(indexSrc).toMatch(/app\.use\('\/admin',\s*requireAuth,\s*requireRole\(\['admin'\]\),\s*adminRoutes\)/);
    expect(routesSrc).toMatch(/router\.get\('\/users', listUsers\)/);
    expect(routesSrc).toMatch(/router\.put\('\/users\/:id', updateUser\)/);
    expect(routesSrc).toMatch(/router\.patch\('\/users\/:id\/suspend', suspendUser\)/);
  });

  test('no invitation architecture was added', () => {
    const all = routesSrc + ctrlSrc;
    expect(all).not.toMatch(/invite/i);
    expect(all).not.toMatch(/invited/i);
  });

  test('role/status allow-lists stay exactly the real schema values', () => {
    expect(ctrlSrc).toMatch(/const VALID_ROLES = \['customer', 'shop_owner', 'admin'\]/);
    expect(ctrlSrc).toMatch(/const VALID_STATUSES = \['active', 'suspended'\]/);
  });
});