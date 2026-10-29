// backend/src/tests/publicLanding.test.js
//
// PUBLIC LANDING READS — the endpoints the marketing page depends on.
//
// Guarantees locked here:
//   · GET /api/public/stats returns REAL database aggregates
//   · it never exposes identities, revenue, payments or private account state
//   · GET /branches stays public and publishes ONLY safe locator fields
//   · POST /api/public/contact validates, stores a real support_requests row and
//     never fails the form because an email could not be sent
//   · the public auction feed is unchanged by this work
import { describe, test, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.hoisted(() => vi.fn());
vi.mock('../db/pool.js', () => ({ pool: { query: poolQuery } }));
const sendNotificationEmail = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../services/emailService.js', () => ({ sendNotificationEmail }));

import { getPublicStats, getPublicBranches, postPublicContact, __test } from '../controllers/public.controller.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
const statusOf = (res) => res.status.mock.calls[0]?.[0];
const bodyOf = (res) => res.json.mock.calls[0]?.[0];
const sqls = () => poolQuery.mock.calls.map(([s]) => String(s).replace(/\s+/g, ' '));

beforeEach(() => {
  poolQuery.mockReset();
  sendNotificationEmail.mockClear();
  sendNotificationEmail.mockResolvedValue({ ok: true });
});

describe('GET /api/public/stats — real aggregates', () => {
  test('1. returns counts computed from actual tables', async () => {
    poolQuery.mockImplementation(async (sql) => {
      const s = String(sql);
      if (/role = 'customer'/.test(s)) return { rows: [{ n: 7 }] };
      if (/FROM products/.test(s)) return { rows: [{ n: 31 }] };
      if (/auctions WHERE status = 'ended'/.test(s)) return { rows: [{ n: 12 }] };
      if (/FROM branches WHERE status = 'Open'/.test(s)) return { rows: [{ n: 4 }] };
      return { rows: [{ n: 0 }] };
    });
    const res = mockRes();
    await getPublicStats({}, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(bodyOf(res)).toMatchObject({
      registeredCustomers: 7, jewelryPieces: 31, completedAuctions: 12, branches: 4, source: 'database',
    });
  });

  test('2. uses real table/enum values (no invented statuses or "satisfaction")', async () => {
    poolQuery.mockImplementation(async () => ({ rows: [{ n: 1 }] }));
    await getPublicStats({}, mockRes());
    const q = sqls().join(' | ');
    expect(q).toMatch(/FROM users WHERE role = 'customer'/);
    expect(q).toMatch(/FROM products/);
    expect(q).toMatch(/FROM auctions WHERE status = 'ended'/);
    expect(q).toMatch(/FROM branches WHERE status = 'Open'/);
    expect(q).not.toMatch(/satisfaction/i);
  });

  test('3. never returns identities, money or private account fields', async () => {
    poolQuery.mockImplementation(async () => ({ rows: [{ n: 3 }] }));
    const res = mockRes();
    await getPublicStats({}, res);
    const body = JSON.stringify(bodyOf(res));
    ['email', 'name', 'user_id', 'amount', 'revenue', 'payment', 'phone'].forEach((k) => {
      expect(body).not.toMatch(new RegExp(`"${k}"`, 'i'));
    });
    expect(Object.keys(bodyOf(res)).sort()).toEqual(
      ['branches', 'completedAuctions', 'generatedAt', 'jewelryPieces', 'registeredCustomers', 'source']
    );
  });

  test('4. a DB failure reports honestly instead of inventing numbers', async () => {
    poolQuery.mockImplementation(async () => { throw new Error('db down'); });
    const res = mockRes();
    await getPublicStats({}, res);
    expect(statusOf(res)).toBe(503);
    expect(bodyOf(res)).not.toHaveProperty('registeredCustomers');
  });
});

describe('GET /branches — public, field-scoped', () => {
  test('5. selects only the published locator fields', async () => {
    poolQuery.mockImplementation(async () => ({ rows: [{ id: 'b1', name: 'Gmall Branch' }] }));
    const res = mockRes();
    await getPublicBranches({}, res);
    const select = sqls()[0];
    expect(select).toMatch(/SELECT id, name, address, lat, lng, hours, phone, status, branch_image_url FROM branches/);
    expect(select).not.toMatch(/SELECT \*/);
  });

  test('6. returns the real branch rows and stays public (no auth in the handler)', async () => {
    poolQuery.mockImplementation(async () => ({
      rows: [{ id: 'b1', name: 'Gmall Branch', address: 'J.P. Laurel Ave', lat: 7.07, lng: 125.61, hours: 'Mon–Sat', phone: '(082)', status: 'Open', branch_image_url: null }],
    }));
    const res = mockRes();
    await getPublicBranches({}, res);
    // success path responds directly with the rows (no explicit 200 needed)
    expect(res.status).not.toHaveBeenCalled();
    expect(bodyOf(res)).toHaveLength(1);
    expect(bodyOf(res)[0].name).toBe('Gmall Branch');
  });

  test('7. a failure returns an error, not a silent empty list', async () => {
    poolQuery.mockImplementation(async () => { throw new Error('boom'); });
    const res = mockRes();
    await getPublicBranches({}, res);
    expect(statusOf(res)).toBe(503);
  });
});

describe('POST /api/public/contact', () => {
  const valid = { name: 'Maria Santos', email: 'maria@example.com', subject: 'Bid Support', message: 'A question about a bid.' };

  test('8. stores a real support_requests row', async () => {
    poolQuery.mockImplementation(async () => ({ rows: [{ id: 'sr-1', created_at: new Date() }] }));
    const res = mockRes();
    await postPublicContact({ body: valid }, res);
    expect(statusOf(res)).toBe(201);
    const insert = sqls().find((s) => /INSERT INTO public\.support_requests/.test(s));
    expect(insert).toBeTruthy();
    // Column list now includes the optional attachment_path.
    expect(insert).toMatch(/\(name, email, subject, message, status, attachment_path\)/);
    expect(insert).toMatch(/VALUES \(\$1, \$2, \$3, \$4, 'new', \$5\)/);
  });

  test('9. rejects invalid name / email / message before touching the database', async () => {
    const res = mockRes();
    await postPublicContact({ body: { name: 'A', email: 'nope', message: 'hi' } }, res);
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res).errors).toHaveProperty('name');
    expect(bodyOf(res).errors).toHaveProperty('email');
    expect(bodyOf(res).errors).toHaveProperty('message');
    expect(sqls().some((s) => /INSERT/i.test(s))).toBe(false);
  });

  test('10. a valid but very long message is rejected (bounded storage)', () => {
    const { errors } = __test.validateContact({ ...valid, message: 'x'.repeat(5000) });
    expect(errors.message).toBeTruthy();
  });

  test('11. a DB failure surfaces as 503 and never claims success', async () => {
    poolQuery.mockImplementation(async () => { throw new Error('insert failed'); });
    const res = mockRes();
    await postPublicContact({ body: valid }, res);
    expect(statusOf(res)).toBe(503);
    expect(bodyOf(res).ok).toBeUndefined();
  });

  test('12. email failure NEVER blocks the stored request', async () => {
    poolQuery.mockImplementation(async () => ({ rows: [{ id: 'sr-1' }] }));
    sendNotificationEmail.mockRejectedValueOnce(new Error('resend down'));
    const res = mockRes();
    await postPublicContact({ body: valid }, res);
    expect(statusOf(res)).toBe(201);
    expect(sqls().some((s) => /INSERT/i.test(s))).toBe(true);
  });

  test('13. a successful store attempts a support notification', async () => {
    poolQuery.mockImplementation(async () => ({ rows: [{ id: 'sr-1' }] }));
    await postPublicContact({ body: valid }, mockRes());
    expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(sendNotificationEmail.mock.calls[0][0].to).toMatch(/@/);
  });

  test('14. the contact payload is sanitised, not passed through raw', () => {
    const { value } = __test.validateContact({ name: '  Maria  ', email: '  MARIA@Example.COM ', subject: 'Account Issue', message: ' hello ' });
    expect(value).toEqual({ name: 'Maria', email: 'maria@example.com', subject: 'Account Issue', message: 'hello' });
  });
});

describe('public auction feed is unchanged', () => {
  test('15. the landing auction route is untouched by this work', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../index.js'), 'utf8'
    );
    expect(src).toMatch(/app\.get\('\/api\/auctions\/live', rateLimit\(\{ name: 'auctions-live'[^)]*\)/);
    expect(src).toMatch(/app\.get\('\/api\/auctions', rateLimit\(\{ name: 'auctions'/);
  });

  test('16. chatbot route is unchanged and still public + rate-limited', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../index.js'), 'utf8'
    );
    expect(src).toMatch(/app\.post\('\/chat', rateLimit\(\{ name: 'chat', windowMs: 60_000, max: 20 \}\), optionalAuth/);
  });
});

describe('chatbot identity hardening', () => {
  test('17. optionalAuth never rejects and never trusts a client-declared id', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '../middleware/optionalAuth.js'), 'utf8');
    expect(src).toMatch(/return next\(\)/);
    expect(src).toMatch(/getUser\(token\)/);
    // the chat route attributes logs to req.user only, never to body.userId
    const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    expect(indexSrc).toMatch(/const verifiedUserId = req\.user\?\.id \|\| null/);
    expect(indexSrc).toMatch(/logChatTurn\(\{ userId: verifiedUserId/);
  });
});