// backend/src/tests/supportOfficial.test.js
// ─────────────────────────────────────────────────────────────────────────────
// The official ATANY support destination: goldjewelryauction@gmail.com
//
// Contract under test:
//  • ONE centralized configuration (ATANY_SUPPORT_EMAIL) owns the address.
//  • ONE shared service persists the request FIRST, then notifies the inbox.
//  • The database row survives an email-provider failure.
//  • Reply-To is the validated requester's address; the From is the
//    provider-authorized ATANY sender (never the requester).
//  • The requester's identity always comes from the authenticated session.
//  • A suspended account can still reach the support endpoint.
//  • Attachments obey the image/5 MB restriction.
//  • No credential is ever exposed to the frontend or an API response.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const poolQuery = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: vi.fn(), on: vi.fn() },
  isDirectPg: () => true,
}));

// The storage service builds a Supabase client at import time — mock it so
// this unit test never needs project credentials.
vi.mock('../services/storageService.js', () => ({
  createSupportAttachmentUploadUrl: vi.fn(async (filename) => ({
    signedUrl: 'https://upload.example/signed',
    path: `requests/${filename}`,
    expiresIn: 900,
  })),
  createSupportAttachmentSignedUrl: vi.fn(async () => 'https://download.example/signed'),
}));

const sendNotificationEmail = vi.fn(async () => ({ sent: true, providerId: 'mock-id' }));
vi.mock('../services/emailService.js', () => ({
  sendNotificationEmail: (...a) => sendNotificationEmail(...a),
  resolveFromEmail: () => 'ATANY <support@atany.ph>',
}));

const { sendSupportNotification, validateSupportRequest, supportReference, sanitizeMetadata } =
  await import('../services/supportService.js');
const { resolveSupportEmail, supportEmailSource, OFFICIAL_SUPPORT_EMAIL, SUPPORT_CATEGORIES } =
  await import('../config/support.js');
const { submitSupportRequest } = await import('../controllers/customer/support.controller.js');
const { submitAccountSupportRequest } = await import('../controllers/support.controller.js');

const SELLER = '00000000-0000-0000-0000-000000000002';
const CUSTOMER = '00000000-0000-0000-0000-000000000001';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

/** Pool mock: a users row + the support_requests insert. */
function setupPool({ account = null, insertId = '11111111-2222-3333-4444-555555555555' } = {}) {
  poolQuery.mockImplementation(async (sql) => {
    if (/FROM (public\.)?users WHERE id/.test(sql)) {
      return { rows: account ? [account] : [] };
    }
    if (/INSERT INTO support_requests/.test(sql)) {
      return { rows: [{ id: insertId, created_at: '2026-10-22T09:00:00.000Z', status: 'new' }] };
    }
    return { rows: [] };
  });
}

const SELLER_ROW = {
  id: SELLER,
  name: 'Golden Heritage',
  email: 'seller@goldenheritage.ph',
  role: 'shop_owner',
  status: 'active',
};

const CUSTOMER_ROW = {
  id: CUSTOMER,
  name: 'Maria Santos',
  email: 'maria.santos@email.com',
  role: 'customer',
  status: 'active',
};

beforeEach(() => {
  vi.clearAllMocks();
  sendNotificationEmail.mockResolvedValue({ sent: true, providerId: 'mock-id' });
});

afterEach(() => {
  vi.resetModules();
});

// ─────────────────────────────────────────────────────────────
// A. Centralized configuration
// ─────────────────────────────────────────────────────────────
describe('support configuration — one source of truth', () => {
  it('the official inbox is goldjewelryauction@gmail.com', () => {
    expect(OFFICIAL_SUPPORT_EMAIL).toBe('goldjewelryauction@gmail.com');
  });

  it('ATANY_SUPPORT_EMAIL is the deployment source of truth', () => {
    expect(resolveSupportEmail({ ATANY_SUPPORT_EMAIL: 'desk@atany.ph' })).toBe('desk@atany.ph');
    expect(supportEmailSource({ ATANY_SUPPORT_EMAIL: 'desk@atany.ph' })).toBe('env:ATANY_SUPPORT_EMAIL');
  });

  it('the legacy SUPPORT_EMAIL alias is honoured, ATANY_SUPPORT_EMAIL wins', () => {
    expect(resolveSupportEmail({ SUPPORT_EMAIL: 'legacy@atany.ph' })).toBe('legacy@atany.ph');
    expect(resolveSupportEmail({ ATANY_SUPPORT_EMAIL: 'new@atany.ph', SUPPORT_EMAIL: 'legacy@atany.ph' }))
      .toBe('new@atany.ph');
  });

  it('falls back to the official inbox when nothing is configured', () => {
    expect(resolveSupportEmail({})).toBe('goldjewelryauction@gmail.com');
    expect(supportEmailSource({})).toBe('default');
  });

  it('an invalid configured address falls back to the official inbox', () => {
    expect(resolveSupportEmail({ ATANY_SUPPORT_EMAIL: 'not-an-email' })).toBe('goldjewelryauction@gmail.com');
  });

  it('the address is declared in exactly ONE backend module', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // backend/src
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(js|jsx)$/.test(entry.name)) continue;
        if (full.includes(`${path.sep}tests${path.sep}`)) continue;
        if (full.endsWith(`${path.sep}config${path.sep}support.js`)) continue;
        const src = fs.readFileSync(full, 'utf8');
        if (src.includes('goldjewelryauction@gmail.com')) offenders.push(path.relative(root, full));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// B. Shared service — persistence + delivery
// ─────────────────────────────────────────────────────────────
describe('sendSupportNotification — the single support implementation', () => {
  it('persists the request and notifies the official inbox', async () => {
    setupPool();
    const result = await sendSupportNotification({
      source: 'Public Contact Form',
      requesterName: 'Maria Santos',
      requesterEmail: 'maria.santos@email.com',
      requesterRole: 'public',
      subject: 'General Inquiry',
      category: 'Bid Support',
      message: 'I was outbid.',
    });

    const insert = poolQuery.mock.calls.find(([sql]) => /INSERT INTO support_requests/.test(sql));
    expect(insert).toBeTruthy();
    expect(insert[1][0]).toBe('Maria Santos');
    expect(insert[1][1]).toBe('maria.santos@email.com');
    expect(insert[1][7]).toBe('Public Contact Form');

    expect(result.received).toBe(true);
    expect(result.reference).toBe('SUP-111111');
    expect(result.status).toBe('new');
    expect(result.emailNotification.sent).toBe(true);

    expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
    const mail = sendNotificationEmail.mock.calls[0][0];
    expect(mail.to).toBe('goldjewelryauction@gmail.com');
    expect(mail.subject).toContain('[ATANY Support]');
    expect(mail.subject).toContain('Bid Support');
  });

  it('Reply-To is the validated requester address (and never the From)', async () => {
    setupPool();
    await sendSupportNotification({
      source: 'Customer Portal',
      requesterName: 'Maria Santos',
      requesterEmail: 'maria.santos@email.com',
      requesterRole: 'customer',
      subject: 'Help',
      category: 'Account Issue',
      message: 'Please help.',
    });
    const mail = sendNotificationEmail.mock.calls[0][0];
    expect(mail.replyTo).toBe('maria.santos@email.com');
    // The requester is NEVER the From address — the provider owns the sender.
    expect(mail.from).toBeUndefined();
  });

  it('the request is stored even when the mail provider fails', async () => {
    setupPool();
    sendNotificationEmail.mockResolvedValue({ sent: false, reason: 'provider_rejected' });
    const result = await sendSupportNotification({
      source: 'Public Contact Form',
      requesterName: 'Maria Santos',
      requesterEmail: 'maria.santos@email.com',
      requesterRole: 'public',
      subject: 'Help',
      category: 'General Inquiry',
      message: 'Please help.',
    });
    // The row stands.
    expect(poolQuery.mock.calls.some(([sql]) => /INSERT INTO support_requests/.test(sql))).toBe(true);
    expect(result.received).toBe(true);
    expect(result.emailNotification.sent).toBe(false);
    expect(result.emailNotification.reason).toBe('provider_rejected');
  });

  it('the request is stored even when the provider throws', async () => {
    setupPool();
    sendNotificationEmail.mockRejectedValue(new Error('provider exploded'));
    const result = await sendSupportNotification({
      source: 'Public Contact Form',
      requesterName: 'Maria Santos',
      requesterEmail: 'maria.santos@email.com',
      requesterRole: 'public',
      subject: 'Help',
      category: 'General Inquiry',
      message: 'Please help.',
    });
    expect(poolQuery.mock.calls.some(([sql]) => /INSERT INTO support_requests/.test(sql))).toBe(true);
    expect(result.emailNotification.sent).toBe(false);
  });

  it('never exposes a credential in the API response', async () => {
    setupPool();
    const result = await sendSupportNotification({
      source: 'Public Contact Form',
      requesterName: 'Maria Santos',
      requesterEmail: 'maria.santos@email.com',
      requesterRole: 'public',
      subject: 'Help',
      category: 'General Inquiry',
      message: 'Please help.',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/re_[a-zA-Z0-9]/);
    expect(serialized).not.toMatch(/api[_-]?key/i);
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/secret/i);
  });

  it('the email body identifies the request, the reference and the source', async () => {
    setupPool();
    await sendSupportNotification({
      source: 'Public Contact Form',
      requesterName: 'Maria Santos',
      requesterEmail: 'maria.santos@email.com',
      requesterRole: 'public',
      subject: 'Where can I collect my lot?',
      category: 'General Inquiry',
      message: 'I won an auction.',
    });
    const mail = sendNotificationEmail.mock.calls[0][0];
    const body = `${mail.subject}\n${mail.text}\n${mail.html}`;
    expect(body).toContain('ATANY SUPPORT REQUEST');
    expect(body).toContain('Maria Santos');
    expect(body).toContain('maria.santos@email.com');
    expect(body).toContain('General Inquiry');
    expect(body).toContain('Where can I collect my lot?');
    expect(body).toContain('SUP-111111');
    expect(body).toContain('Public Contact Form');
    expect(body).toContain('I won an auction.');
  });
});

// ─────────────────────────────────────────────────────────────
// C. Validation
// ─────────────────────────────────────────────────────────────
describe('support validation', () => {
  const base = { name: 'Maria Santos', email: 'maria.santos@email.com', subject: 'Help', category: 'General Inquiry', message: 'Hello' };

  it('accepts a well-formed request', () => {
    expect(validateSupportRequest(base)).toBeNull();
  });

  it('requires a name', () => {
    expect(validateSupportRequest({ ...base, name: '' }).code).toBe('INVALID_NAME');
  });

  it('requires a valid email', () => {
    expect(validateSupportRequest({ ...base, email: 'nope' }).code).toBe('INVALID_EMAIL');
    expect(validateSupportRequest({ ...base, email: 'a@b' }).code).toBe('INVALID_EMAIL');
  });

  it('requires a whitelisted category', () => {
    expect(validateSupportRequest({ ...base, category: 'Hacked' }).code).toBe('INVALID_CATEGORY');
    for (const c of SUPPORT_CATEGORIES) {
      expect(validateSupportRequest({ ...base, category: c })).toBeNull();
    }
  });

  it('requires a trimmed message of at most 5000 characters', () => {
    expect(validateSupportRequest({ ...base, message: '   ' }).code).toBe('INVALID_MESSAGE');
    expect(validateSupportRequest({ ...base, message: 'x'.repeat(5001) }).code).toBe('INVALID_MESSAGE');
    expect(validateSupportRequest({ ...base, message: 'x'.repeat(5000) })).toBeNull();
  });

  it('rejects a non-image attachment and an oversized one', () => {
    expect(validateSupportRequest({ ...base, attachment: { path: 'requests/a.exe', filename: 'a.exe' } }).code)
      .toBe('INVALID_ATTACHMENT');
    expect(validateSupportRequest({
      ...base,
      attachment: { path: 'requests/a.png', filename: 'a.png', size: 6 * 1024 * 1024 },
    }).code).toBe('INVALID_ATTACHMENT');
    expect(validateSupportRequest({
      ...base,
      attachment: { path: 'requests/a.png', filename: 'a.png', size: 1024 },
    })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// D. Safe metadata
// ─────────────────────────────────────────────────────────────
describe('support metadata sanitising', () => {
  it('keeps whitelisted safe context', () => {
    const meta = sanitizeMetadata({ plan_name: 'Pro', payment_status: 'failed', reference_id: 'pay_123' });
    expect(meta).toEqual({ plan_name: 'Pro', payment_status: 'failed', reference_id: 'pay_123' });
  });

  it('drops anything credential-shaped', () => {
    const meta = sanitizeMetadata({
      plan_name: 'Pro',
      api_key: 'sk_live_secret',
      secret: 'x',
      paymongo_secret: 'y',
      card_number: '4242424242424242',
      webhook_signature: 'sig',
      authorization: 'Bearer abc',
    });
    expect(meta).toEqual({ plan_name: 'Pro' });
  });

  it('drops unknown keys entirely', () => {
    expect(sanitizeMetadata({ next_bidder: 'Britz', admin_notes: 'x' })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// E. Authenticated identity
// ─────────────────────────────────────────────────────────────
describe('authenticated support requests', () => {
  it('the customer identity comes from the session, not the body', async () => {
    setupPool({ account: CUSTOMER_ROW });
    const res = mockRes();
    await submitSupportRequest(
      {
        user: { id: CUSTOMER },
        body: {
          category: 'Account Issue',
          message: 'Please help.',
          user_id: 'attacker-id',
          email: 'attacker@evil.com',
          name: 'Someone Else',
        },
      },
      res
    );
    const insert = poolQuery.mock.calls.find(([sql]) => /INSERT INTO support_requests/.test(sql));
    expect(insert[1][0]).toBe('Maria Santos');
    expect(insert[1][1]).toBe('maria.santos@email.com');
    expect(insert[1][4]).toBe(CUSTOMER);
    expect(insert[1][5]).toBe('customer');
    expect(JSON.stringify(insert[1])).not.toContain('attacker');
    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.request.reference).toBe('SUP-111111');
    expect(body.email_notification.sent).toBe(true);
  });

  it('the shop owner identity comes from the session, not the body', async () => {
    setupPool({ account: SELLER_ROW });
    const res = mockRes();
    await submitAccountSupportRequest(
      {
        user: { id: SELLER },
        body: {
          category: 'Billing / Subscription',
          subject: 'Subscription Billing Support',
          message: 'My renewal failed.',
          user_id: 'attacker-id',
          email: 'attacker@evil.com',
          requester_role: 'admin',
          metadata: { plan_name: 'Pro', payment_status: 'failed', provider: 'PayMongo' },
        },
      },
      res
    );
    const insert = poolQuery.mock.calls.find(([sql]) => /INSERT INTO support_requests/.test(sql));
    expect(insert[1][0]).toBe('Golden Heritage');
    expect(insert[1][1]).toBe('seller@goldenheritage.ph');
    expect(insert[1][4]).toBe(SELLER);
    expect(insert[1][5]).toBe('shop_owner');
    expect(insert[1][7]).toBe('Shop Owner Portal');
    // The safe metadata is carried into the request.
    expect(insert[1][3]).toContain('My renewal failed.');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('a suspended account can still reach the support endpoint', async () => {
    setupPool({ account: { ...SELLER_ROW, status: 'suspended', suspension_reason: 'Payment review' } });
    const res = mockRes();
    await submitAccountSupportRequest(
      {
        user: { id: SELLER },
        body: { category: 'Account Issue', subject: 'Suspended Account Inquiry', message: 'Please help.' },
      },
      res
    );
    // No status gate — the row is written.
    expect(poolQuery.mock.calls.some(([sql]) => /INSERT INTO support_requests/.test(sql))).toBe(true);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects an unauthenticated request', async () => {
    const res = mockRes();
    await submitAccountSupportRequest({ body: { message: 'hi' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a request for an unknown account', async () => {
    setupPool({ account: null });
    const res = mockRes();
    await submitAccountSupportRequest({ user: { id: 'ghost' }, body: { message: 'hi' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────────────────────────
// F. Reference id
// ─────────────────────────────────────────────────────────────
describe('support reference', () => {
  it('is derived from the stored row id', () => {
    expect(supportReference('abc12345-6789-0000-0000-000000000000')).toBe('SUP-ABC123');
  });
});
