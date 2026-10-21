// backend/src/tests/adminSuspensionReason.test.js
// Suspension-reason contract (Admin → Users & Roles + Admin → Security Alerts).
//
//  • a manual suspension ALWAYS needs an admin-provided reason
//  • the reason is durable (public.users.suspension_reason) and survives
//    refresh / re-login (it travels with /auth/me)
//  • the reason is visible to the affected account owner, never to anyone else
//  • the audit trail keeps the history (even after a reactivation)
//  • reactivation clears the CURRENT reason
//  • BOTH entry points use the SAME suspension service
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

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'no session' } })) },
  })),
}));

const {
  setAccountStatus, validateSuspensionReason, SUSPENSION_REASON_MIN, SUSPENSION_REASON_MAX,
} = await import('../services/adminAccountStatus.js');
const { getMe } = await import('../controllers/auth.controller.js');
const { updateAlert } = await import('../controllers/admin/security.controller.js');
const { requireActiveAccount } = await import('../middleware/requireActiveAccount.js');

const ADMIN = '00000000-0000-0000-0000-000000000004';
const CUSTOMER = '11111111-1111-1111-1111-111111111111';
const SELLER = '22222222-2222-2222-2222-222222222222';
const ALERT_ID = '646ff462-6020-4467-a8e0-829345e3ea06';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
const req = (params = {}, body = {}, query = {}) => ({
  params, body, query, user: { id: ADMIN }, io: { to: vi.fn(() => ({ emit: vi.fn() })) },
});
const payload = (res) => res.json.mock.calls[0]?.[0];

/** Default pool: an active customer, a paid-order record and an audit table. */
function defaultPool({
  status = 'active',
  role = 'customer',
  reason = null,
  name = 'Maria Santos',
} = {}) {
  const user = { id: CUSTOMER, name, role, status, suspension_reason: reason };
  poolQuery.mockImplementation(async (sql, params = []) => {
    // The shared service: target lookup.
    if (/SELECT id, name, role, status, suspension_reason FROM users WHERE id = \$1/.test(sql)) {
      return { rows: [user] };
    }
    // The admin-continuity guard: role + status.
    if (/SELECT id, role, status FROM users WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: CUSTOMER, role, status }] };
    }
    // The account-status guard (suspended seller / customer).
    if (/SELECT status, suspension_reason FROM public\.users WHERE id = \$1/.test(sql)) {
      return { rows: [{ status, suspension_reason: reason }] };
    }
    // /auth/me
    if (/SELECT id, name, email, role, status, preferred_branch_id, suspension_reason FROM public\.users/.test(sql)) {
      return { rows: [{ id: CUSTOMER, name, email: 'maria@example.com', role, status, preferred_branch_id: null, suspension_reason: reason }] };
    }
    // The status update (status + the CURRENT reason).
    if (/UPDATE users\s+SET status = \$1,\s+suspension_reason = \$2/.test(sql)) {
      return { rows: [{ id: CUSTOMER, name, email: 'maria@example.com', role, status: params?.[0] || 'suspended', suspension_reason: params?.[1] ?? null }] };
    }
    if (/SELECT count\(\*\)::int AS c FROM users WHERE role = 'admin'/.test(sql)) return { rows: [{ c: 1 }] };
    if (/SELECT id, status, user_id FROM security_alerts/.test(sql)) {
      return { rows: [{ id: ALERT_ID, status: 'new', user_id: CUSTOMER }] };
    }
    if (/SELECT id, name, email, role, status FROM users WHERE id=\$1/.test(sql)) {
      return { rows: [{ id: CUSTOMER, name, email: 'maria@example.com', role, status }] };
    }
    if (/audit_logs/.test(sql)) return { rows: [] };
    return { rows: [] };
  });
}

beforeEach(() => {
  poolQuery.mockReset();
  defaultPool();
});

// ─────────────────────────────────────────────────────────────
// validation
// ─────────────────────────────────────────────────────────────
describe('suspension reason — validation', () => {
  it('rejects a missing reason', () => {
    const res = validateSuspensionReason(undefined);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/reason/i);
  });

  it('rejects a whitespace-only reason', () => {
    const res = validateSuspensionReason('     ');
    expect(res.ok).toBe(false);
  });

  it('rejects a reason below the minimum length', () => {
    const res = validateSuspensionReason('abc');
    expect(res.ok).toBe(false);
    expect(res.message).toContain(String(SUSPENSION_REASON_MIN));
  });

  it('rejects an over-long reason', () => {
    const res = validateSuspensionReason('x'.repeat(SUSPENSION_REASON_MAX + 1));
    expect(res.ok).toBe(false);
    expect(res.message).toContain(String(SUSPENSION_REASON_MAX));
  });

  it('accepts and trims a valid reason', () => {
    const res = validateSuspensionReason('  Repeated suspicious bidding activity.  ');
    expect(res.ok).toBe(true);
    expect(res.reason).toBe('Repeated suspicious bidding activity.');
  });
});

// ─────────────────────────────────────────────────────────────
// the shared service
// ─────────────────────────────────────────────────────────────
describe('suspension reason — the shared service', () => {
  it('refuses to suspend without a reason', async () => {
    const result = await setAccountStatus({ adminId: ADMIN, targetId: CUSTOMER, nextStatus: 'suspended' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(400);
    expect(result.message).toMatch(/reason/i);
  });

  it('refuses to suspend with a whitespace-only reason', async () => {
    const result = await setAccountStatus({ adminId: ADMIN, targetId: CUSTOMER, nextStatus: 'suspended', reason: '    ' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(400);
  });

  it('refuses an over-long reason', async () => {
    const result = await setAccountStatus({
      adminId: ADMIN, targetId: CUSTOMER, nextStatus: 'suspended', reason: 'x'.repeat(SUSPENSION_REASON_MAX + 1),
    });
    expect(result.ok).toBe(false);
  });

  it('persists the status and the reason', async () => {
    const result = await setAccountStatus({
      adminId: ADMIN, targetId: CUSTOMER, nextStatus: 'suspended', reason: 'Suspicious bidding activity.',
    });
    expect(result.ok).toBe(true);
    const update = poolQuery.mock.calls.find(([sql]) => /UPDATE users/.test(sql));
    expect(update).toBeTruthy();
    expect(update[1][0]).toBe('suspended');
    expect(update[1][1]).toBe('Suspicious bidding activity.');
    expect(result.user.suspension_reason).toBe('Suspicious bidding activity.');
  });

  it('writes the reason into the admin audit trail', async () => {
    await setAccountStatus({
      adminId: ADMIN, targetId: CUSTOMER, nextStatus: 'suspended', reason: 'Fraud investigation.',
    });
    const audit = poolQuery.mock.calls.find(([sql]) => /audit_logs/.test(sql));
    expect(audit).toBeTruthy();
    const details = JSON.parse(audit[1][4]);
    expect(details.reason).toBe('Fraud investigation.');
    expect(details.target_user_id).toBe(CUSTOMER);
    expect(details.target_role).toBe('customer');
    expect(details.new_status).toBe('suspended');
  });

  it('clears the current reason on reactivation but keeps the audit history', async () => {
    defaultPool({ status: 'suspended', reason: 'Old reason.' });
    const result = await setAccountStatus({ adminId: ADMIN, targetId: CUSTOMER, nextStatus: 'active' });
    expect(result.ok).toBe(true);
    const update = poolQuery.mock.calls.find(([sql]) => /UPDATE users/.test(sql));
    expect(update[1][0]).toBe('active');
    expect(update[1][1]).toBeNull(); // the CURRENT reason is cleared
    const audit = poolQuery.mock.calls.find(([sql]) => /audit_logs/.test(sql));
    expect(JSON.parse(audit[1][4]).reason).toBeNull();
  });

  it('a second suspension stores the newest reason', async () => {
    defaultPool({ status: 'suspended', reason: 'Old reason.' });
    const result = await setAccountStatus({
      adminId: ADMIN, targetId: CUSTOMER, nextStatus: 'suspended', reason: 'New reason.',
    });
    expect(result.ok).toBe(true);
    const update = poolQuery.mock.calls.find(([sql]) => /UPDATE users/.test(sql));
    expect(update[1][1]).toBe('New reason.');
  });

  it('keeps the self-suspension and last-admin protections', async () => {
    const self = await setAccountStatus({ adminId: CUSTOMER, targetId: CUSTOMER, nextStatus: 'suspended', reason: 'Because.' });
    expect(self.ok).toBe(false);
    expect(self.code).toBe(403);
  });

  it('emits account:status to the account with the reason', async () => {
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })) };
    await setAccountStatus({
      adminId: ADMIN, targetId: CUSTOMER, nextStatus: 'suspended', reason: 'Suspicious activity.', io,
    });
    expect(io.to).toHaveBeenCalledWith(`user:${CUSTOMER}`);
    expect(emit).toHaveBeenCalledWith('account:status', {
      status: 'suspended',
      reason: 'Suspicious activity.',
    });
  });

  it('never touches bids, orders, payments or listings', async () => {
    await setAccountStatus({ adminId: ADMIN, targetId: CUSTOMER, nextStatus: 'suspended', reason: 'Suspicious activity.' });
    const touched = poolQuery.mock.calls.map(([sql]) => String(sql));
    expect(touched.some((s) => /DELETE FROM bids|UPDATE bids|DELETE FROM orders|UPDATE orders|DELETE FROM products/i.test(s))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// /auth/me + the protected APIs
// ─────────────────────────────────────────────────────────────
describe('suspension reason — the account sees it', () => {
  it('/auth/me returns the current reason for a suspended account', async () => {
    defaultPool({ status: 'suspended', reason: 'Repeated suspicious bidding activity.' });
    const res = mockRes();
    await getMe({ user: { id: CUSTOMER } }, res);
    const body = payload(res);
    expect(body.status).toBe('suspended');
    expect(body.suspension_reason).toBe('Repeated suspicious bidding activity.');
  });

  it('/auth/me never returns a reason for an active account', async () => {
    defaultPool({ status: 'active', reason: 'Stale reason.' });
    const res = mockRes();
    await getMe({ user: { id: CUSTOMER } }, res);
    expect(payload(res).suspension_reason).toBeNull();
  });

  it('a suspended shop owner is blocked with ACCOUNT_SUSPENDED + the reason', async () => {
    defaultPool({ status: 'suspended', role: 'shop_owner', reason: 'Seller risk review.' });
    const res = mockRes();
    const next = vi.fn();
    await requireActiveAccount()({ user: { id: SELLER } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(payload(res).code).toBe('ACCOUNT_SUSPENDED');
    expect(payload(res).reason).toBe('Seller risk review.');
    expect(next).not.toHaveBeenCalled();
  });

  it('an active seller passes the guard', async () => {
    defaultPool({ status: 'active' });
    const res = mockRes();
    const next = vi.fn();
    await requireActiveAccount()({ user: { id: SELLER } }, res, next);
    expect(next).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// one shared pipeline
// ─────────────────────────────────────────────────────────────
describe('suspension reason — one shared pipeline', () => {
  it('the Security Alerts route uses the same service (reason required)', async () => {
    const res = mockRes();
    await updateAlert(req({ id: ALERT_ID }, { status: 'new', suspendUserId: CUSTOMER }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(payload(res).message).toMatch(/reason/i);
  });

  it('the Security Alerts route suspends with the admin reason', async () => {
    const res = mockRes();
    await updateAlert(req({ id: ALERT_ID }, {
      status: 'new', suspendUserId: CUSTOMER, reason: 'Suspicious Rapid High-Value Bidding activity.',
    }), res);
    expect(res.status).not.toHaveBeenCalledWith(400);
    const update = poolQuery.mock.calls.find(([sql]) => /UPDATE users/.test(sql));
    expect(update[1][1]).toBe('Suspicious Rapid High-Value Bidding activity.');
  });

  it('both entry points hit the same backend contract', () => {
    const adminRoutes = fs.readFileSync(path.join(__dirname, '../routes/admin.routes.js'), 'utf8');
    expect(adminRoutes).toMatch(/router\.patch\('\/users\/:id\/suspend',\s*suspendUser\)/);
    expect(adminRoutes).toMatch(/router\.patch\('\/security-alerts\/:id',\s*updateAlert\)/);
    const svc = fs.readFileSync(path.join(__dirname, '../services/adminAccountStatus.js'), 'utf8');
    expect(svc).toMatch(/suspension_reason/);
    expect(svc).toMatch(/account:status/);
  });
});
