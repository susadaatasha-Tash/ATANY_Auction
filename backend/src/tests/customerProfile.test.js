// backend/src/tests/customerProfile.test.js
// Customer Profile backend suite — self-service profile update, preferred
// branch, and the authenticated support request.
//
// Contract under test:
//  • The acting user comes from req.user.id only (a body userId is ignored).
//  • Only `name` and `phone` are writable — role/status/email/id are never
//    accepted from a customer request.
//  • Phone is validated + normalised with the shared PH validators.
//  • A suspended account cannot edit its profile.
//  • POST /customer/support derives the sender identity from the session.
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

vi.mock('../services/emailService.js', () => ({
  sendNotificationEmail: vi.fn(async () => ({ ok: true })),
}));

const { getAccount, updateAccount, setPreferredBranch, getPreferredBranch } =
  await import('../controllers/customer/account.controller.js');
const { submitSupportRequest } = await import('../controllers/customer/support.controller.js');

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const BRANCH = '33333333-3333-3333-3333-333333333333';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function req(body = {}, userId = ME) {
  return { body, user: { id: userId, email: 'maria.santos@email.com' } };
}

beforeEach(() => {
  poolQuery.mockReset();
});

/** Wire the pool mock for the standard updateAccount flow. */
function setupAccountMocks({ status = 'active', updated = {}, branches = [] } = {}) {
  poolQuery.mockImplementation(async (sql) => {
    if (/SELECT status(, suspension_reason)? FROM users/.test(sql)) return { rows: [{ status, suspension_reason: null }] };
    if (/^UPDATE users SET/.test(sql)) {
      return {
        rows: [
          {
            id: ME,
            name: 'Maria Santos',
            email: 'maria.santos@email.com',
            role: 'customer',
            status: 'active',
            phone: null,
            preferred_branch_id: BRANCH,
            ...updated,
          },
        ],
      };
    }
    if (/FROM branches/.test(sql)) return { rows: branches };
    return { rows: [] };
  });
}

// ─────────────────────────────────────────────────────────────
// 1. unauthenticated profile update rejected
// ─────────────────────────────────────────────────────────────
describe('customer profile — authentication', () => {
  it('the customer router mounts /account behind requireAuth + requireRole(customer)', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/customer.routes.js'), 'utf8');
    expect(routes).toMatch(/router\.get\('\/account', getAccount\)/);
    expect(routes).toMatch(/router\.put\('\/account', updateAccount\)/);
    expect(routes).toMatch(/router\.post\('\/support', submitSupportRequest\)/);
  });

  it('index mounts the customer router behind requireAuth and requireRole', () => {
    const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    expect(indexSrc).toMatch(/app\.use\('\/customer',\s*requireAuth,\s*requireRole\('customer'\)/);
  });

  it('a request without a verified user is rejected (no row is written)', async () => {
    const res = mockRes();
    await updateAccount({ body: { name: 'Hacker' }, user: undefined }, res);
    // The controller dereferences req.user.id — without a verified subject the
    // request cannot reach the database layer.
    expect(poolQuery).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(200);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. Customer updates own name
// ─────────────────────────────────────────────────────────────
describe('customer profile — own account update', () => {
  it('updates the customer name and returns the updated profile', async () => {
    setupAccountMocks({ updated: { name: 'Maria L. Santos' } });
    const res = mockRes();
    await updateAccount(req({ name: 'Maria L. Santos' }), res);

    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET/.test(sql));
    expect(update).toBeTruthy();
    expect(update[1]).toEqual(['Maria L. Santos', ME]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ name: 'Maria L. Santos', updated: true }));
  });

  it('trims the name before saving', async () => {
    setupAccountMocks();
    const res = mockRes();
    await updateAccount(req({ name: '   Maria Santos  ' }), res);
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET/.test(sql));
    expect(update[1][0]).toBe('Maria Santos');
  });

  it('rejects an empty name', async () => {
    setupAccountMocks();
    const res = mockRes();
    await updateAccount(req({ name: '   ' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_NAME' }));
    expect(poolQuery.mock.calls.some(([sql]) => /^UPDATE users SET/.test(sql))).toBe(false);
  });

  it('rejects a name longer than the maximum length', async () => {
    setupAccountMocks();
    const res = mockRes();
    await updateAccount(req({ name: 'x'.repeat(121) }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_NAME' }));
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Customer updates own phone
// ─────────────────────────────────────────────────────────────
describe('customer profile — phone save', () => {
  it('saves a valid 09XXXXXXXXX mobile number (normalised)', async () => {
    setupAccountMocks({ updated: { phone: '+639171234567' } });
    const res = mockRes();
    await updateAccount(req({ phone: '09171234567' }), res);

    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET/.test(sql));
    expect(update[1]).toEqual(['+639171234567', ME]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ phone: '+639171234567' }));
  });

  it('saves a valid +639XXXXXXXXX mobile number', async () => {
    setupAccountMocks({ updated: { phone: '+639171234567' } });
    const res = mockRes();
    await updateAccount(req({ phone: '+639171234567' }), res);
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET/.test(sql));
    expect(update[1][0]).toBe('+639171234567');
  });

  it('persists to the real users.phone column', async () => {
    setupAccountMocks();
    const res = mockRes();
    await updateAccount(req({ phone: '09171234567' }), res);
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET/.test(sql));
    expect(update[0]).toMatch(/phone=\$1/);
    expect(update[0]).not.toMatch(/phone_number|mobile_number/);
  });

  it('allows clearing the phone (nullable column)', async () => {
    setupAccountMocks({ updated: { phone: null } });
    const res = mockRes();
    await updateAccount(req({ phone: '' }), res);
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET/.test(sql));
    expect(update[1][0]).toBeNull();
    expect(res.status).not.toHaveBeenCalledWith(400);
  });
});

// ─────────────────────────────────────────────────────────────
// 4. invalid phone rejected
// ─────────────────────────────────────────────────────────────
describe('customer profile — phone validation', () => {
  const invalid = ['0917123456', '09171234567890', '0917ABC4567', 'abcdefghijk', '0917123456a'];
  it.each(invalid)('rejects invalid phone %s', async (value) => {
    setupAccountMocks();
    const res = mockRes();
    await updateAccount(req({ phone: value }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_PHONE' }));
    expect(poolQuery.mock.calls.some(([sql]) => /^UPDATE users SET/.test(sql))).toBe(false);
  });

  it('returns a user-friendly message without exposing internals', async () => {
    setupAccountMocks();
    const res = mockRes();
    await updateAccount(req({ phone: '0917ABC4567' }), res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.message).toBe('Enter a valid Philippine mobile number.');
    expect(payload.message).not.toMatch(/regex|\\\\d|pattern/i);
  });
});

// ─────────────────────────────────────────────────────────────
// 5 + 6. role and status cannot be modified by a customer
// ─────────────────────────────────────────────────────────────
describe('customer profile — privileged fields are not writable', () => {
  it('ignores role in the request body', async () => {
    setupAccountMocks();
    const res = mockRes();
    await updateAccount(req({ name: 'Maria Santos', role: 'admin' }), res);
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET/.test(sql));
    expect(update[0]).not.toMatch(/role\s*=/);
    expect(update[1]).toEqual(['Maria Santos', ME]);
  });

  it('ignores status in the request body', async () => {
    setupAccountMocks();
    const res = mockRes();
    await updateAccount(req({ name: 'Maria Santos', status: 'active' }), res);
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET/.test(sql));
    expect(update[0]).not.toMatch(/status\s*=/);
  });

  it('never writes email, id, subscription or shop ownership fields', async () => {
    setupAccountMocks();
    const res = mockRes();
    await updateAccount(
      req({
        name: 'Maria Santos',
        email: 'attacker@evil.com',
        id: OTHER,
        userId: OTHER,
        role: 'admin',
        status: 'suspended',
        subscription: 'pro',
        home_branch_id: BRANCH,
      }),
      res
    );
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET/.test(sql));
    const setClause = update[0].split('RETURNING')[0];
    expect(setClause).toMatch(/^UPDATE users SET name=\$1 WHERE id=\$2/);
    expect(setClause).not.toMatch(/email|subscription|shops|role|status|preferred_branch_id/i);
    expect(update[1]).toEqual(['Maria Santos', ME]);
  });

  it('rejects a request with no writable field at all', async () => {
    setupAccountMocks();
    const res = mockRes();
    await updateAccount(req({ role: 'admin' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_CHANGES' }));
  });
});

// ─────────────────────────────────────────────────────────────
// 7. another user's data cannot be modified
// ─────────────────────────────────────────────────────────────
describe('customer profile — cross-account isolation', () => {
  it('a body userId is ignored — the session user is always the target', async () => {
    setupAccountMocks();
    const res = mockRes();
    await updateAccount(req({ name: 'Maria Santos', userId: OTHER, id: OTHER }), res);
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET/.test(sql));
    expect(update[1]).toEqual(['Maria Santos', ME]);
    expect(update[1]).not.toContain(OTHER);
  });

  it('a body user_id is ignored too', async () => {
    setupAccountMocks();
    const res = mockRes();
    await updateAccount(req({ name: 'Maria Santos', user_id: OTHER }), res);
    const update = poolQuery.mock.calls.find(([sql]) => /^UPDATE users SET/.test(sql));
    expect(update[1]).toEqual(['Maria Santos', ME]);
  });

  it('the status lookup is scoped to the session user', async () => {
    setupAccountMocks();
    const res = mockRes();
    await updateAccount(req({ name: 'Maria Santos' }), res);
    const statusQuery = poolQuery.mock.calls.find(([sql]) => /SELECT status(, suspension_reason)? FROM users/.test(sql));
    expect(statusQuery[1]).toEqual([ME]);
  });
});

// ─────────────────────────────────────────────────────────────
// 8 + 9. preferred branch stays a customer-owned flow
// ─────────────────────────────────────────────────────────────
describe('customer profile — preferred branch', () => {
  it('sets the preferred branch of the session user only', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/FROM branches WHERE id = \$1/.test(sql)) return { rows: [{ id: BRANCH, name: 'Gmall Branch' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await setPreferredBranch(req({ branch_id: BRANCH }), res);

    const update = poolQuery.mock.calls.find(([sql]) => /UPDATE users SET preferred_branch_id/.test(sql));
    expect(update[1]).toEqual([BRANCH, ME]);
    expect(res.json).toHaveBeenCalledWith({ preferred_branch_id: BRANCH, branch_name: 'Gmall Branch' });
  });

  it('rejects an unknown branch', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/FROM branches WHERE id = \$1/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const res = mockRes();
    await setPreferredBranch(req({ branch_id: 'does-not-exist' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(poolQuery.mock.calls.some(([sql]) => /UPDATE users SET preferred_branch_id/.test(sql))).toBe(false);
  });

  it('rejects a missing branch id', async () => {
    const res = mockRes();
    await setPreferredBranch(req({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('reads the preferred branch of the session user only', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT preferred_branch_id FROM users/.test(sql)) return { rows: [{ preferred_branch_id: BRANCH }] };
      if (/FROM branches/.test(sql)) return { rows: [{ id: BRANCH, name: 'Gmall Branch', address: 'Juna' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await getPreferredBranch(req(), res);
    const query = poolQuery.mock.calls.find(([sql]) => /SELECT preferred_branch_id FROM users/.test(sql));
    expect(query[1]).toEqual([ME]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ preferred_branch_id: BRANCH }));
  });
});

// ─────────────────────────────────────────────────────────────
// 10. updated values returned safely
// ─────────────────────────────────────────────────────────────
describe('customer profile — response payload', () => {
  it('returns the updated profile fields', async () => {
    setupAccountMocks({ updated: { name: 'Maria Santos', phone: '+639171234567' }, branches: [{ name: 'Gmall Branch' }] });
    const res = mockRes();
    await updateAccount(req({ name: 'Maria Santos', phone: '09171234567' }), res);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({
      id: ME,
      name: 'Maria Santos',
      email: 'maria.santos@email.com',
      role: 'customer',
      status: 'active',
      phone: '+639171234567',
      preferred_branch_id: BRANCH,
      preferred_branch_name: 'Gmall Branch',
      updated: true,
    });
  });

  it('never echoes a password hash or secret back to the client', async () => {
    setupAccountMocks({ updated: { password_hash: 'super-secret-hash' } });
    const res = mockRes();
    await updateAccount(req({ name: 'Maria Santos' }), res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.password_hash).toBeUndefined();
    expect(payload.totp_secret).toBeUndefined();
    expect(JSON.stringify(payload)).not.toMatch(/password_hash|totp_secret/);
  });

  it('GET /customer/account returns id, name, email, phone and preferred branch', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT \* FROM users/.test(sql)) {
        return {
          rows: [
            {
              id: ME,
              name: 'Maria Santos',
              email: 'maria.santos@email.com',
              role: 'customer',
              status: 'active',
              phone: '+639171234567',
              preferred_branch_id: BRANCH,
              created_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }
      if (/FROM branches/.test(sql)) return { rows: [{ name: 'Gmall Branch' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await getAccount(req(), res);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({
      id: ME,
      name: 'Maria Santos',
      email: 'maria.santos@email.com',
      phone: '+639171234567',
      preferred_branch_id: BRANCH,
      preferred_branch_name: 'Gmall Branch',
    });
  });
});

// ─────────────────────────────────────────────────────────────
// suspended customer is blocked from profile editing
// ─────────────────────────────────────────────────────────────
describe('customer profile — suspended account', () => {
  it('blocks profile updates for a suspended account', async () => {
    setupAccountMocks({ status: 'suspended' });
    const res = mockRes();
    await updateAccount(req({ name: 'Maria Santos' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCOUNT_SUSPENDED' }));
    expect(poolQuery.mock.calls.some(([sql]) => /^UPDATE users SET/.test(sql))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// authenticated support request
// ─────────────────────────────────────────────────────────────
describe('customer profile — support request', () => {
  it('derives name and email from the session, not the body', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id, name, email, role FROM users/.test(sql)) {
        return { rows: [{ id: ME, name: 'Maria Santos', email: 'maria.santos@email.com', role: 'customer' }] };
      }
      if (/INSERT INTO support_requests/.test(sql)) {
        return { rows: [{ id: 'sr-1', created_at: '2026-01-01T00:00:00.000Z', status: 'new' }] };
      }
      return { rows: [] };
    });

    const res = mockRes();
    await submitSupportRequest(
      {
        user: { id: ME },
        body: {
          subject: 'General Inquiry',
          message: 'Where can I collect my lot?',
          name: 'Someone Else',
          email: 'spoof@evil.com',
        },
      },
      res
    );

    const insert = poolQuery.mock.calls.find(([sql]) => /INSERT INTO support_requests/.test(sql));
    expect(insert[1][0]).toBe('Maria Santos');
    expect(insert[1][1]).toBe('maria.santos@email.com');
    expect(insert[1]).not.toContain('spoof@evil.com');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects an empty message', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id, name, email, role FROM users/.test(sql)) {
        return { rows: [{ id: ME, name: 'Maria Santos', email: 'maria.santos@email.com', role: 'customer' }] };
      }
      return { rows: [] };
    });
    const res = mockRes();
    await submitSupportRequest({ user: { id: ME }, body: { subject: 'General Inquiry', message: '  ' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_MESSAGE' }));
  });

  it('rejects an unknown category', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id, name, email, role FROM users/.test(sql)) {
        return { rows: [{ id: ME, name: 'Maria Santos', email: 'maria.santos@email.com', role: 'customer' }] };
      }
      return { rows: [] };
    });
    const res = mockRes();
    await submitSupportRequest({ user: { id: ME }, body: { category: 'Hacked', message: 'hi' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_CATEGORY' }));
  });

  it('writes to the real support_requests table', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id, name, email, role FROM users/.test(sql)) {
        return { rows: [{ id: ME, name: 'Maria Santos', email: 'maria.santos@email.com', role: 'customer' }] };
      }
      if (/INSERT INTO support_requests/.test(sql)) return { rows: [{ id: 'sr-2', created_at: '2026-01-01T00:00:00.000Z', status: 'new' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await submitSupportRequest(
      { user: { id: ME }, body: { subject: 'Bid Support', message: 'I was outbid — please check.' } },
      res
    );
    const insert = poolQuery.mock.calls.find(([sql]) => /INSERT INTO support_requests/.test(sql));
    expect(insert[0]).toMatch(/INSERT INTO support_requests/);
    expect(insert[0]).toMatch(/name, email, subject, message, status, user_id, requester_role, category, source/);
    expect(insert[1][2]).toBe('Bid Support');
    expect(insert[1][3]).toBe('I was outbid — please check.');
    // 'status' is the literal 'new' in the SQL; the params are
    // name, email, subject, message, user_id, requester_role, category, source.
    expect(insert[1][4]).toBe(ME);
    expect(insert[1][5]).toBe('customer');
    expect(insert[1][6]).toBe('Bid Support');
    expect(insert[1][7]).toBe('Customer Portal');
    expect(insert[0]).toMatch(/'new'/);
  });
});

// ─────────────────────────────────────────────────────────────
// password handling contracts
// ─────────────────────────────────────────────────────────────
describe('customer profile — password storage contracts', () => {
  it('the profile update path never writes a password column', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/customer/account.controller.js'), 'utf8');
    expect(src).not.toMatch(/password_hash\s*=/);
    expect(src).not.toMatch(/SET[^;]*password/i);
  });

  it('the backend exposes no endpoint that stores or logs a plaintext password', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/customer.routes.js'), 'utf8');
    expect(routes).not.toMatch(/password/i);
    const controller = fs.readFileSync(path.join(__dirname, '../controllers/customer/account.controller.js'), 'utf8');
    expect(controller).not.toMatch(/console\.(log|error|warn)\([^)]*password/i);
  });

  it('the customer account table has no password column added by this feature', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    const setup = fs.readFileSync(path.join(__dirname, '../db/setup_complete.sql'), 'utf8');
    // password_hash stays as the legacy placeholder column (never used for auth)
    expect(schema).toMatch(/password_hash TEXT NOT NULL/);
    expect(setup).toMatch(/password_hash TEXT NOT NULL/);
    // the real phone field is declared exactly once on the users table
    const usersBlock = schema.slice(schema.indexOf('CREATE TABLE users'), schema.indexOf('CREATE TABLE shops'));
    expect(usersBlock.match(/phone TEXT/g) || []).toHaveLength(1);
  });
});
