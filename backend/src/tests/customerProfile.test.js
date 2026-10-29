// backend/src/tests/customerProfile.test.js
//
// CUSTOMER PROFILE — self-service account management.
//
// Guarantees locked here:
//   · the acting user is ALWAYS derived from the verified session (req.user.id),
//     never from a body-supplied id
//   · a Customer can update their own Full Name and Phone, and nothing else
//   · role, status, email and any unknown field are structurally unreachable
//   · Philippine phone formats normalise to one canonical stored value
//   · Email is not changeable through this endpoint (no verified flow exists)
//   · Preferred Branch stays on its own dedicated route and validates the branch
//   · POST /customer/support derives identity server-side and validates input
//   · NO password is ever written to, or returned by, the application database
import { describe, test, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.hoisted(() => vi.fn());
vi.mock('../db/pool.js', () => ({ pool: { query: poolQuery } }));
const sendNotificationEmail = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../services/emailService.js', () => ({ sendNotificationEmail }));

import {
  getAccount, updateAccount, getPreferredBranch, setPreferredBranch,
  normalizePhone, validateProfileUpdate, PHONE_INVALID_MESSAGE,
} from '../controllers/customer/account.controller.js';
import {
  createCustomerSupportRequest, validateSupportRequest,
} from '../controllers/customer/support.controller.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
const statusOf = (res) => res.status.mock.calls[0]?.[0];
const bodyOf = (res) => res.json.mock.calls[0]?.[0];
const sqls = () => poolQuery.mock.calls.map(([s]) => String(s).replace(/\s+/g, ' '));
const paramsOf = () => poolQuery.mock.calls.map(([, p]) => p);

const ME = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-0000000000ff';
const req = (body = {}, userId = ME) => ({ body, user: { id: userId, email: 'maria.santos@email.com' } });

const ACCOUNT_ROW = {
  id: ME, name: 'Maria Santos', email: 'maria.santos@email.com',
  phone: '+639171234567', preferred_branch_id: 'b2', created_at: '2026-09-12T23:16:42.754Z',
};

beforeEach(() => {
  poolQuery.mockReset();
  sendNotificationEmail.mockClear();
  sendNotificationEmail.mockResolvedValue({ ok: true });
});

/* ─────────────────────────── phone contract ─────────────────────────── */
describe('Philippine phone normalization contract', () => {
  // Every one of these is the SAME subscriber and must collapse to one value.
  const EQUIVALENT = [
    '09171234567',        // 09 + 9
    '0917 123 4567',      // spaced, local format
    '639171234567',       // country code, no plus
    '+639171234567',      // canonical
    '+63 917 123 4567',   // spaced, international
    '(0917) 123-4567',    // parentheses + dash
    '+63-917-123-4567',   // dashes
  ];

  test('1. every accepted PH format normalises to the same canonical value', () => {
    const results = EQUIVALENT.map((input) => normalizePhone(input));
    results.forEach((r) => expect(r.ok, `expected ${r.ok} for input`).toBe(true));
    const canonical = results.map((r) => r.value);
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe('+639171234567');
  });

  test('2. clearly invalid numbers are rejected', () => {
    ['', '12345', 'abcdefg', '+63917123456', '0917', '+1 415 555 0100', '091712345678901']
      .forEach((bad) => {
        const r = normalizePhone(bad);
        // '' is handled by the caller as "clear"; anything else must be invalid
        if (bad === '') return;
        expect(r.ok, `expected ${bad} to be rejected`).toBe(false);
      });
  });

  test('3. a different valid prefix keeps its digits (no leading-digit loss)', () => {
    expect(normalizePhone('09181234567').value).toBe('+639181234567');
  });

  test('4. leading-zero input is preserved through normalisation', () => {
    expect(normalizePhone('09171234567').value).toMatch(/^\+639/);
    expect(normalizePhone('09171234567').value.endsWith('9171234567')).toBe(true);
  });
});

describe('validateProfileUpdate — allow-list', () => {
  test('5. accepts name and phone only', () => {
    const { changes, error } = validateProfileUpdate({ name: '  Maria   Santos ', phone: '09171234567' });
    expect(error).toBeUndefined();
    expect(changes).toEqual({ name: 'Maria Santos', phone: '+639171234567' });
  });

  test('6. role and status are never carried into the change set', () => {
    const { changes } = validateProfileUpdate({
      name: 'Maria Santos', role: 'admin', status: 'active', is_super_admin: true,
      password: 'hacker', email: 'attacker@evil.com', id: OTHER,
    });
    expect(Object.keys(changes)).toEqual(['name']);
    ['role', 'status', 'is_super_admin', 'password', 'email', 'id'].forEach((k) => {
      expect(changes).not.toHaveProperty(k);
    });
  });

  test('7. an invalid phone is rejected with the safe shared message', () => {
    const { error } = validateProfileUpdate({ phone: '12345' });
    expect(error).toBe(PHONE_INVALID_MESSAGE);
    expect(PHONE_INVALID_MESSAGE).not.toMatch(/regex|\\d|\^/); // no internals leaked
  });

  test('8. an explicitly blank phone clears it', () => {
    expect(validateProfileUpdate({ phone: '' }).changes).toEqual({ phone: null });
    expect(validateProfileUpdate({ phone: '   ' }).changes).toEqual({ phone: null });
  });

  test('9. a too-short or too-long name is rejected', () => {
    expect(validateProfileUpdate({ name: 'A' }).error).toBeTruthy();
    expect(validateProfileUpdate({ name: 'x'.repeat(200) }).error).toBeTruthy();
  });
});

/* ─────────────────────────── GET /customer/account ─────────────────── */
describe('GET /customer/account', () => {
  beforeEach(() => {
    poolQuery.mockImplementation(async (sql, params) => {
      const s = String(sql);
      if (/FROM users WHERE id/.test(s)) return { rows: [ACCOUNT_ROW] };
      if (/FROM branches WHERE id/.test(s)) return { rows: [{ name: 'Gmall Branch' }] };
      return { rows: [] };
    });
  });

  test('10. returns the authoritative profile for the session user', async () => {
    const res = mockRes();
    await getAccount(req(), res);
    expect(bodyOf(res)).toMatchObject({
      id: ME, name: 'Maria Santos', email: 'maria.santos@email.com',
      phone: '+639171234567', preferred_branch_id: 'b2', preferred_branch_name: 'Gmall Branch',
    });
  });

  test('11. the query is bound to the session id, never a body id', async () => {
    const res = mockRes();
    await getAccount({ body: { id: OTHER }, user: { id: ME } }, res);
    expect(paramsOf()[0]).toEqual([ME]);
  });

  test('12. no password is ever returned', async () => {
    const res = mockRes();
    await getAccount(req(), res);
    const body = bodyOf(res);
    expect(body).not.toHaveProperty('password_hash');
    expect(body).not.toHaveProperty('password');
    expect(Object.keys(body).sort()).toEqual(
      ['created_at', 'email', 'id', 'name', 'phone', 'preferred_branch_id', 'preferred_branch_name']
    );
  });
});

/* ─────────────────────────── PUT /customer/account ─────────────────── */
describe('PUT /customer/account', () => {
  test('13. a Customer can update their own Full Name', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/UPDATE users SET/.test(String(sql))) return { rows: [{ ...ACCOUNT_ROW, name: 'Maria L. Santos' }] };
      return { rows: [{ name: 'Gmall Branch' }] };
    });
    const res = mockRes();
    await updateAccount(req({ name: 'Maria L. Santos' }), res);
    expect(sqls()[0]).toMatch(/UPDATE users SET name = \$1 WHERE id = \$2/);
    expect(paramsOf()[0]).toEqual(['Maria L. Santos', ME]);
    expect(bodyOf(res).profile.name).toBe('Maria L. Santos');
  });

  test('14. a Customer can update their own Phone, stored canonically', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/UPDATE users SET/.test(String(sql))) return { rows: [ACCOUNT_ROW] };
      return { rows: [{ name: 'Gmall Branch' }] };
    });
    const res = mockRes();
    await updateAccount(req({ phone: '0917 123 4567' }), res);
    expect(sqls()[0]).toMatch(/UPDATE users SET phone = \$1 WHERE id = \$2/);
    expect(paramsOf()[0]).toEqual(['+639171234567', ME]);
  });

  test('15. name and phone can be saved together', async () => {
    poolQuery.mockImplementation(async (sql) => (/UPDATE users SET/.test(String(sql))
      ? { rows: [ACCOUNT_ROW] } : { rows: [{ name: 'Gmall Branch' }] }));
    const res = mockRes();
    await updateAccount(req({ name: 'Maria Santos', phone: '+639171234567' }), res);
    const sql = sqls()[0];
    expect(sql).toMatch(/name = \$1/);
    expect(sql).toMatch(/phone = \$2/);
    expect(sql).toMatch(/WHERE id = \$3/);
  });

  test('16. role and status cannot be modified', async () => {
    poolQuery.mockImplementation(async (sql) => (/UPDATE users SET/.test(String(sql))
      ? { rows: [ACCOUNT_ROW] } : { rows: [{ name: 'Gmall Branch' }] }));
    const res = mockRes();
    await updateAccount(req({ name: 'Maria Santos', role: 'admin', status: 'active' }), res);
    const written = sqls()[0];
    expect(written).not.toMatch(/\brole\b/i);
    expect(written).not.toMatch(/\bstatus\b/i);
  });

  test('17. email cannot be changed through the profile endpoint', async () => {
    poolQuery.mockImplementation(async (sql) => (/UPDATE users SET/.test(String(sql))
      ? { rows: [ACCOUNT_ROW] } : { rows: [{ name: 'Gmall Branch' }] }));
    const res = mockRes();
    await updateAccount(req({ email: 'attacker@evil.com', name: 'Maria Santos' }), res);
    expect(sqls()[0]).not.toMatch(/email\s*=/i);
    expect(sqls()[0]).toMatch(/name = \$1/);
  });

  test('18. a body-supplied userId cannot redirect the update to another account', async () => {
    poolQuery.mockImplementation(async (sql) => (/UPDATE users SET/.test(String(sql))
      ? { rows: [ACCOUNT_ROW] } : { rows: [{ name: 'Gmall Branch' }] }));
    const res = mockRes();
    await updateAccount(req({ userId: OTHER, id: OTHER, name: 'Hijacked' }), res);
    // every statement stays bound to the SESSION id
    paramsOf().forEach((p) => expect(p).not.toContain(OTHER));
    expect(paramsOf()[0]).toEqual(['Hijacked', ME]);
  });

  test('19. an invalid phone is rejected with 400 and writes nothing', async () => {
    const res = mockRes();
    await updateAccount(req({ phone: 'nope' }), res);
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res).message).toBe(PHONE_INVALID_MESSAGE);
    expect(sqls().some((s) => /UPDATE/i.test(s))).toBe(false);
  });

  test('20. a DB failure returns a safe message, not internals', async () => {
    poolQuery.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:5432'));
    const res = mockRes();
    await updateAccount(req({ name: 'Maria Santos' }), res);
    expect(statusOf(res)).toBe(500);
    expect(bodyOf(res).message).toBe('Unable to update profile.');
    expect(JSON.stringify(bodyOf(res))).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
  });

  test('21. a no-op update (nothing recognised) still returns the profile', async () => {
    poolQuery.mockImplementation(async (sql) => (/FROM users WHERE id/.test(String(sql))
      ? { rows: [ACCOUNT_ROW] } : { rows: [{ name: 'Gmall Branch' }] }));
    const res = mockRes();
    await updateAccount(req({}), res);
    expect(sqls().some((s) => /UPDATE/i.test(s))).toBe(false);
    expect(bodyOf(res).profile.id).toBe(ME);
  });

  test('22. NO password column is ever written by the profile controller', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../controllers/customer/account.controller.js'), 'utf8');
    expect(src).not.toMatch(/SET[^`]*password/i);
    expect(src).not.toMatch(/password_hash/i);
    expect(src).not.toMatch(/INSERT INTO users[^`]*password/i);
  });
});

/* ───────────────────── preferred branch (dedicated route) ─────────── */
describe('Preferred branch — dedicated route, not part of profile update', () => {
  beforeEach(() => {
    poolQuery.mockImplementation(async (sql) => {
      const s = String(sql);
      if (/FROM branches WHERE id/.test(s)) return { rows: [{ id: 'b1', name: 'Abreeza Branch' }] };
      if (/SELECT preferred_branch_id/.test(s)) return { rows: [{ preferred_branch_id: 'b1' }] };
      return { rows: [] };
    });
  });

  test('23. a Customer can set their own preferred branch', async () => {
    const res = mockRes();
    await setPreferredBranch(req({ branch_id: 'b1' }), res);
    expect(sqls()[0]).toMatch(/SELECT id, name FROM branches WHERE id = \$1/);
    expect(sqls()[1]).toMatch(/UPDATE users SET preferred_branch_id = \$1 WHERE id = \$2/);
    expect(paramsOf()[1]).toEqual(['b1', ME]);
    expect(bodyOf(res)).toMatchObject({ preferred_branch_id: 'b1', branch_name: 'Abreeza Branch' });
  });

  test('24. an unknown branch is rejected and nothing is written', async () => {
    poolQuery.mockImplementation(async (sql) => (/FROM branches WHERE id/.test(String(sql))
      ? { rows: [] } : { rows: [] }));
    const res = mockRes();
    await setPreferredBranch(req({ branch_id: 'does-not-exist' }), res);
    expect(statusOf(res)).toBe(404);
    expect(bodyOf(res).message).toBe('Branch not found');
    expect(sqls().some((s) => /UPDATE/i.test(s))).toBe(false);
  });

  test('25. a missing branch_id is rejected', async () => {
    const res = mockRes();
    await setPreferredBranch(req({}), res);
    expect(statusOf(res)).toBe(400);
  });

  test('26. another Customer branch cannot be changed (session id is the only target)', async () => {
    const res = mockRes();
    await setPreferredBranch(req({ branch_id: 'b1' }, ME), res);
    expect(paramsOf()[1]).toEqual(['b1', ME]);
    expect(paramsOf().flat()).not.toContain(OTHER);
  });

  test('27. changing branch does not touch role or status', async () => {
    const res = mockRes();
    await setPreferredBranch(req({ branch_id: 'b1' }), res);
    expect(sqls().join(' ')).not.toMatch(/role|status/i);
  });

  test('28. preferred branch is NOT writable through the profile update route', async () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../controllers/customer/account.controller.js'), 'utf8');
    // The dedicated route owns this column; the profile allow-list excludes it.
    const { changes } = validateProfileUpdate({ preferred_branch_id: 'b1', home_branch_id: 'b1' });
    expect(changes).toEqual({});
    expect(src).toMatch(/UPDATE users SET preferred_branch_id = \$1 WHERE id = \$2/);
  });

  test('29. the customer branch route stays behind auth + role + active-account middleware', () => {
    const indexSrc = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../index.js'), 'utf8');
    expect(indexSrc).toMatch(/app\.use\('\/customer', requireAuth, requireRole\('customer'\), requireActiveAccount\(\), customerRoutes\)/);
  });

  test('30. Admin Users & Roles stays read-only for preferred branch', () => {
    const adminSrc = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../controllers/admin/user.controller.js'), 'utf8');
    expect(adminSrc).not.toMatch(/SET[^`]*preferred_branch_id\s*=/);
    expect(adminSrc).not.toMatch(/preferred_branch_id\s*=\s*\$\d/);
  });
});

/* ─────────────────────────── POST /customer/support ────────────────── */
describe('POST /customer/support', () => {
  const VALID = { subject: 'Account Issue', message: 'Please help me with my account.' };

  beforeEach(() => {
    poolQuery.mockImplementation(async (sql) => {
      const s = String(sql);
      if (/SELECT name, email FROM users/.test(s)) {
        return { rows: [{ name: 'Maria Santos', email: 'maria.santos@email.com' }] };
      }
      if (/INSERT INTO public\.support_requests/.test(s)) {
        return { rows: [{ id: 'sr-1', created_at: '2026-10-16T00:00:00Z' }] };
      }
      return { rows: [] };
    });
  });

  test('31. stores a real support_requests row for the session user', async () => {
    const res = mockRes();
    await createCustomerSupportRequest(req(VALID), res);
    expect(statusOf(res)).toBe(201);
    expect(bodyOf(res)).toMatchObject({ ok: true, id: 'sr-1' });
    expect(sqls().some((s) => /INSERT INTO public\.support_requests/.test(s))).toBe(true);
  });

  test('32. identity is derived from the session, not the payload', async () => {
    const res = mockRes();
    await createCustomerSupportRequest({
      body: { ...VALID, user_id: OTHER, email: 'attacker@evil.com', name: 'Someone Else' },
      user: { id: ME, email: 'maria.santos@email.com' },
    }, res);
    const insert = poolQuery.mock.calls.find(([s]) => /INSERT INTO public\.support_requests/.test(String(s)));
    const params = insert[1];
    expect(params[0]).toBe('Maria Santos');          // from the DB row
    expect(params[1]).toBe('maria.santos@email.com');
    expect(JSON.stringify(params)).not.toMatch(/attacker@evil\.com|Someone Else/);
  });

  test('33. a spoofed client user id cannot impersonate another account', async () => {
    const res = mockRes();
    await createCustomerSupportRequest({ body: { ...VALID, userId: OTHER }, user: { id: ME } }, res);
    const insert = poolQuery.mock.calls.find(([s]) => /INSERT INTO public\.support_requests/.test(String(s)));
    expect(JSON.stringify(insert[1])).not.toContain(OTHER);
  });

  test('34. a missing subject is rejected with 400 and writes nothing', async () => {
    const res = mockRes();
    await createCustomerSupportRequest({ body: { message: 'hello there' } }, res);
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res).errors.subject).toBeTruthy();
    expect(sqls().some((s) => /INSERT/i.test(s))).toBe(false);
  });

  test('35. a too-short message is rejected', async () => {
    const res = mockRes();
    await createCustomerSupportRequest({ body: { subject: 'General Inquiry', message: 'hi' } }, res);
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res).errors.message).toBeTruthy();
  });

  test('36. length limits are enforced', () => {
    expect(validateSupportRequest({ subject: 'x'.repeat(200), message: 'valid message' }).errors.subject).toBeTruthy();
    expect(validateSupportRequest({ subject: 'General Inquiry', message: 'x'.repeat(5000) }).errors.message).toBeTruthy();
  });

  test('37. a DB failure returns a safe message and never claims success', async () => {
    poolQuery.mockRejectedValue(new Error('deadlock detected'));
    const res = mockRes();
    await createCustomerSupportRequest(req(VALID), res);
    expect(statusOf(res)).toBe(503);
    expect(bodyOf(res).ok).toBeUndefined();
    expect(JSON.stringify(bodyOf(res))).not.toMatch(/deadlock/i);
  });

  test('38. the success response exposes no private data', async () => {
    const res = mockRes();
    await createCustomerSupportRequest(req(VALID), res);
    expect(Object.keys(bodyOf(res)).sort()).toEqual(['id', 'ok']);
  });

  test('39. a notification failure never blocks the stored request', async () => {
    sendNotificationEmail.mockRejectedValueOnce(new Error('resend down'));
    const res = mockRes();
    await createCustomerSupportRequest(req(VALID), res);
    expect(statusOf(res)).toBe(201);
    expect(sqls().some((s) => /INSERT INTO public\.support_requests/.test(s))).toBe(true);
  });

  test('40. the support route is rate limited', () => {
    const routes = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../routes/customer.routes.js'), 'utf8');
    expect(routes).toMatch(/router\.post\('\/support', rateLimit\(\{ name: 'customer-support', windowMs: 600_000, max: 5 \}\)/);
  });
});

/* ─────────────────── password storage invariants ─────────────────── */
describe('password storage invariants', () => {
  test('41. public.users carries no password column beyond the legacy hash marker', () => {
    const migration = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../db/migrations/035_customer_profile_phone.sql'), 'utf8');
    expect(migration).not.toMatch(/ADD COLUMN[^;]*password/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS phone text/);
  });

  test('42. the account controller exposes no password write path at all', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../controllers/customer/account.controller.js'), 'utf8');
    expect(src).not.toMatch(/bcrypt|argon|scrypt|createHash/);
    expect(src).not.toMatch(/INSERT INTO users/i);
  });
});
