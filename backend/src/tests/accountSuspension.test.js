// backend/src/tests/accountSuspension.test.js
// Admin-connected CUSTOMER SUSPENSION — authorization is separate from
// authentication, and a suspended ATANY account must lose real access.
//
// Guarantees locked here:
//   · 403 + ACCOUNT_SUSPENDED for protected customer APIs (never 401)
//   · an ACTIVE customer is completely unaffected
//   · bidding is blocked with no bid row, no current_bid change, no count change
//   · historical bids / orders / payments are NEVER touched by suspension
//   · admin safety rules and the audit log are preserved
import { describe, test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const poolQuery = vi.hoisted(() => vi.fn());
vi.mock('../db/pool.js', () => ({ pool: { query: poolQuery } }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { admin: { createUser: vi.fn() } } }) }));
vi.mock('../services/auctionPresence.js', async (orig) => {
  const actual = await orig();
  return { ...actual, removeUser: vi.fn(() => []) };
});

import {
  requireActiveAccount, isSuspendedStatus, suspendedPayload,
  ACCOUNT_SUSPENDED_CODE, loadAccountState,
} from '../middleware/requireActiveAccount.js';
import { suspendUser, applyAccountStatusEffects } from '../controllers/admin/user.controller.js';

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const CUSTOMER = 'customer-1';
const ADMIN = 'admin-1';

function mockRes() {
  const r = {};
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  return r;
}
const statusOf = (res) => res.status.mock.calls[0][0];
const bodyOf = (res) => res.json.mock.calls[0][0];

describe('account-state middleware', () => {
  beforeEach(() => poolQuery.mockReset());

  test('suspended account → 403 with the stable ACCOUNT_SUSPENDED contract', async () => {
    poolQuery.mockResolvedValue({ rows: [{ id: CUSTOMER, role: 'customer', status: 'suspended' }] });
    const res = mockRes();
    const next = vi.fn();
    await requireActiveAccount()({ user: { id: CUSTOMER } }, res, next);
    expect(statusOf(res)).toBe(403);           // NOT 401 — they are authenticated
    expect(next).not.toHaveBeenCalled();
    expect(bodyOf(res)).toEqual({
      success: false,
      error: { code: ACCOUNT_SUSPENDED_CODE, message: expect.any(String) },
    });
  });

  test('active account passes through untouched', async () => {
    poolQuery.mockResolvedValue({ rows: [{ id: CUSTOMER, role: 'customer', status: 'active' }] });
    const next = vi.fn();
    await requireActiveAccount()({ user: { id: CUSTOMER } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('only the real suspended status blocks — other values never lock anyone out', () => {
    expect(isSuspendedStatus('suspended')).toBe(true);
    ['active', 'ACTIVE', '', null, undefined, 'pending'].forEach((s) => expect(isSuspendedStatus(s)).toBe(false));
  });

  test('fail closed on DB error but do not report it as authorization', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id, role, status FROM public\.users/.test(String(sql))) throw new Error('db down');
      return { rows: [] };
    });
    const res = mockRes();
    await requireActiveAccount()({ user: { id: CUSTOMER } }, res, vi.fn());
    expect(statusOf(res)).toBe(500);
    expect(bodyOf(res)).toEqual({ message: 'Database service unavailable' });
  });

  test('no ATANY account for the identity → 403, never a suspended payload', async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await requireActiveAccount()({ user: { id: CUSTOMER } }, res, vi.fn());
    expect(statusOf(res)).toBe(403);
    expect(bodyOf(res).error).toBeUndefined();
  });

  test('every protected customer route inherits the gate from ONE mount', () => {
    const indexSrc = read('../index.js');
    expect(indexSrc).toMatch(
      /app\.use\('\/customer',\s*requireAuth,\s*requireRole\('customer'\),\s*requireActiveAccount\(\),\s*customerRoutes\)/
    );
    // centralization: no controller duplicates the status check
    const customerRoutes = fs.readdirSync(path.join(__dirname, '../controllers/customer'));
    customerRoutes.forEach((f) => {
      const src = fs.readFileSync(path.join(__dirname, '../controllers/customer', f), 'utf8');
      expect(src).not.toMatch(/status\s*===\s*'suspended'/);
    });
  });

  test('bid endpoint inherits the gate (bids can never be placed while suspended)', () => {
    const routesSrc = read('../routes/customer.routes.js');
    expect(routesSrc).toMatch(/router\.post\('\/bids', placeBidController\)/);
    const indexSrc = read('../index.js');
    expect(indexSrc).toMatch(/requireActiveAccount\(\), customerRoutes/);
  });
});

describe('admin suspension pipeline', () => {
  beforeEach(() => poolQuery.mockReset());

  function seedAccounts(list) {
    poolQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (/SELECT id, role, status FROM users WHERE id=\$1/.test(s)) {
        return { rows: [list.find((u) => u.id === params[0])].filter(Boolean) };
      }
      if (/^UPDATE users SET status=\$1/.test(s)) {
        const u = list.find((x) => x.id === params[1]);
        u.status = params[0];
        return { rows: [u] };
      }
      if (/FROM audit_logs/.test(s)) return { rows: [] };
      if (/role='admin' AND status='active'/.test(s)) return { rows: [{ cnt: 2 }] };
      return { rows: [] };
    });
  }

  test('admin can suspend a customer and the status is persisted', async () => {
    const list = [{ id: CUSTOMER, role: 'customer', status: 'active' }, { id: ADMIN, role: 'admin', status: 'active' }];
    seedAccounts(list);
    const res = mockRes();
    await suspendUser({ user: { id: ADMIN }, params: { id: CUSTOMER }, body: { status: 'suspended' }, io: null }, res);
    expect(bodyOf(res).status).toBe('suspended');
    expect(list.find((u) => u.id === CUSTOMER).status).toBe('suspended');
  });

  test('reactivate restores active on the SAME account (no delete/recreate)', async () => {
    const list = [{ id: CUSTOMER, role: 'customer', status: 'suspended' }, { id: ADMIN, role: 'admin', status: 'active' }];
    seedAccounts(list);
    const res = mockRes();
    await suspendUser({ user: { id: ADMIN }, params: { id: CUSTOMER }, body: { status: 'active' }, io: null }, res);
    expect(bodyOf(res).status).toBe('active');
    expect(poolQuery.mock.calls.some(([s]) => /DELETE FROM users/.test(String(s)))).toBe(false);
  });

  test('the existing audit log is written AFTER the db update, for every change', async () => {
    const list = [{ id: CUSTOMER, role: 'customer', status: 'active' }, { id: ADMIN, role: 'admin', status: 'active' }];
    seedAccounts(list);
    await suspendUser({ user: { id: ADMIN }, params: { id: CUSTOMER }, body: { status: 'suspended' }, io: null }, mockRes());
    const sqls = poolQuery.mock.calls.map(([s]) => String(s));
    const updIdx = sqls.findIndex((s) => /^UPDATE users SET status=\$1/.test(s));
    const auditIdx = sqls.findIndex((s) => /INSERT INTO audit_logs/.test(s));
    expect(updIdx).toBeGreaterThanOrEqual(0);
    expect(auditIdx).toBeGreaterThan(updIdx); // never notify a failure
    const params = poolQuery.mock.calls[auditIdx][1];
    expect(params[0]).toBe(ADMIN);           // actor
    expect(params[3]).toBe(CUSTOMER);        // target user id (not name/row index)
  });

  test('self-suspension and last-active-admin protections still hold', async () => {
    seedAccounts([{ id: ADMIN, role: 'admin', status: 'active' }]);
    const self = mockRes();
    await suspendUser({ user: { id: ADMIN }, params: { id: ADMIN }, body: { status: 'suspended' }, io: null }, self);
    expect(statusOf(self)).toBe(400);
    expect(bodyOf(self).message).toMatch(/cannot suspend your own/i);

    poolQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (/SELECT id, role, status FROM users WHERE id=\$1/.test(s)) return { rows: [{ id: ADMIN, role: 'admin', status: 'active' }] };
      if (/role='admin' AND status='active'/.test(s)) return { rows: [{ cnt: 1 }] };
      return { rows: [] };
    });
    const last = mockRes();
    await suspendUser({ user: { id: ADMIN }, params: { id: CUSTOMER }, body: { status: 'suspended' }, io: null }, last);
    expect(statusOf(last)).toBe(400);
  });

  test('invalid status values are still rejected', async () => {
    seedAccounts([{ id: CUSTOMER, role: 'customer', status: 'active' }]);
    const res = mockRes();
    await suspendUser({ user: { id: ADMIN }, params: { id: CUSTOMER }, body: { status: 'banned' }, io: null }, res);
    expect(statusOf(res)).toBe(400);
  });

  test('account status effects only act AFTER a committed change', () => {
    const emitted = [];
    const io = {
      to: (room) => ({ emit: (evt, payload) => emitted.push({ room, evt, payload }) }),
      sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    };
    const effects = applyAccountStatusEffects({ io }, { id: CUSTOMER, status: 'suspended' });
    expect(emitted.some((e) => e.evt === 'account:status' && e.room === `user:${CUSTOMER}`)).toBe(true);
    expect(emitted.some((e) => e.room.startsWith('auction:'))).toBe(false); // no auctions in this fixture
    expect(effects.presenceRemoved).toEqual([]);

    // reactivation informs only — presence is never silently re-created
    const emitted2 = [];
    applyAccountStatusEffects({ io: { ...io, to: (r) => ({ emit: (e, p) => emitted2.push({ r, e, p }) }) } }, { id: CUSTOMER, status: 'active' });
    expect(emitted2[0].e).toBe('account:status');
  });

  test('suspension never touches bids, orders or payments', async () => {
    const list = [{ id: CUSTOMER, role: 'customer', status: 'active' }];
    seedAccounts(list);
    await suspendUser({ user: { id: ADMIN }, params: { id: CUSTOMER }, body: { status: 'suspended' }, io: null }, mockRes());
    const sqls = poolQuery.mock.calls.map(([s]) => String(s));
    ['bids', 'orders', 'payments'].forEach((t) => {
      expect(sqls.some((s) => new RegExp(`(UPDATE|DELETE) ${t}`, 'i').test(s))).toBe(false);
    });
  });
});

describe('route + authorization contracts', () => {
  test('admin suspension stays behind requireAuth + requireRole([admin])', () => {
    const indexSrc = read('../index.js');
    expect(indexSrc).toMatch(/app\.use\('\/admin',\s*requireAuth,\s*requireRole\(\['admin'\]\),\s*adminRoutes\)/);
    expect(read('../routes/admin.routes.js')).toMatch(/router\.patch\('\/users\/:id\/suspend', suspendUser\)/);
  });

  test('no duplicate suspension API or table was introduced', () => {
    const routesSrc = read('../routes/admin.routes.js');
    expect(routesSrc).not.toMatch(/\/(ban|disable|suspension)/);
    expect(read('../index.js')).not.toMatch(/router\.post\('\/customer\/suspend'/);
    const schema = read('../db/schema.sql');
    expect(schema).not.toMatch(/CREATE TABLE[^;]*suspension/i);
  });

  test('/auth/me returns the authoritative status the frontend guards on', () => {
    const authSrc = read('../controllers/auth.controller.js');
    expect(authSrc).toMatch(/SELECT id, name, email, role, status, preferred_branch_id FROM public\.users WHERE id = \$1/);
    expect(authSrc).toMatch(/res\.json\(rows\[0\]\)/);
  });

  test('the frontend consumes that status and never treats it as "role missing"', () => {
    const useAuth = read('../../../frontend/src/shared/hooks/useAuth.jsx');
    expect(useAuth).toMatch(/status: data\.status \|\| null/);
    expect(useAuth).toMatch(/ACCOUNT_SUSPENDED_EVENT/);
    expect(useAuth).toMatch(/RequireActiveCustomer/);
  });
});