// backend/src/tests/contactDelivery.test.js
//
// CONTACT DELIVERY — where Contact Us / Help & Support messages actually go.
//
// Guarantees locked here:
//   · the notification recipient is the configured destination, read from ONE
//     place (config/contact.js), never from a request body
//   · Reply-To is the person who asked for help, and is sanitised against
//     header injection
//   · the FROM address stays the existing verified sender — the destination
//     mailbox is a RECIPIENT only
//   · the stored support_requests row is authoritative: an email failure never
//     deletes or invalidates it
//   · image attachments accept only jpg/png/webp under 5 MB, are stored in a
//     PRIVATE bucket, and are surfaced as time-limited SIGNED links
//   · no raw bytes/base64 and no permanent public URL are ever produced
import { describe, test, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.hoisted(() => vi.fn());
vi.mock('../db/pool.js', () => ({ pool: { query: poolQuery } }));

const sendNotificationEmail = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../services/emailService.js', () => ({ sendNotificationEmail }));

const createSupportSignedUrl = vi.hoisted(() => vi.fn(async () => 'https://example.supabase.co/storage/v1/object/sign/atany-support/guest/x.png?token=SECRET'));
vi.mock('../services/storageService.js', () => ({
  createSupportSignedUrl,
  validateSupportImage: (o) => {
    const MIME = ['image/jpeg', 'image/png', 'image/webp'];
    const EXT = ['.jpg', '.jpeg', '.png', '.webp'];
    const type = String(o.contentType || '').toLowerCase();
    if (!MIME.includes(type)) return 'Only JPG, PNG, and WebP images are allowed.';
    const lower = String(o.filename || '').toLowerCase();
    if (!lower || !EXT.some((e) => lower.endsWith(e))) return 'Only JPG, PNG, and WebP images are allowed.';
    if (!(Number(o.size) > 0)) return 'Only JPG, PNG, and WebP images are allowed.';
    if (Number(o.size) > 5 * 1024 * 1024) return 'Image must be 5 MB or smaller.';
    return null;
  },
  SUPPORT_BUCKET: 'atany-support',
  SUPPORT_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
  // Mirrors the real service: validate first, then mint a signed URL.
  createSupportUploadUrl: vi.fn(async ({ filename, contentType, size, scope = 'guest' }) => {
    const MIME = ['image/jpeg', 'image/png', 'image/webp'];
    const EXT = ['.jpg', '.jpeg', '.png', '.webp'];
    const type = String(contentType || '').toLowerCase();
    const lower = String(filename || '').toLowerCase();
    if (!MIME.includes(type) || !lower || !EXT.some((e) => lower.endsWith(e)) || !(Number(size) > 0)) {
      throw new Error('Only JPG, PNG, and WebP images are allowed.');
    }
    if (Number(size) > 5 * 1024 * 1024) throw new Error('Image must be 5 MB or smaller.');
    return { signedUrl: 'https://example.supabase.co/upload?token=SECRET', path: `${scope}/${Date.now()}-${filename}` };
  }),
}));

import { SUPPORT_RECIPIENT_EMAIL, sanitizeReplyTo } from '../config/contact.js';
import { sendSupportNotification, buildSupportEmail } from '../services/supportNotification.js';
import { postPublicContact } from '../controllers/public.controller.js';
import { createCustomerSupportRequest } from '../controllers/customer/support.controller.js';
import { createPublicContactUpload } from '../controllers/contactUpload.controller.js';

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
const sentEmail = () => sendNotificationEmail.mock.calls[0][0];

beforeEach(() => {
  poolQuery.mockReset();
  sendNotificationEmail.mockClear();
  sendNotificationEmail.mockResolvedValue(undefined);
  createSupportSignedUrl.mockClear();
  createSupportSignedUrl.mockResolvedValue('https://example.supabase.co/storage/v1/object/sign/atany-support/guest/x.png?token=SECRET');
});

describe('recipient configuration', () => {
  test('1. the recipient is the configured destination mailbox', () => {
    expect(SUPPORT_RECIPIENT_EMAIL).toBe('goldjewelryauction@gmail.com');
  });

  test('2. both flows notify that recipient', async () => {
    poolQuery.mockImplementation(async (sql) => {
      const s = String(sql);
      if (/SELECT name, email FROM users/.test(s)) return { rows: [{ name: 'Maria Santos', email: 'maria.santos@email.com' }] };
      return { rows: [{ id: 'sr-1' }] };
    });
    await postPublicContact({ body: { name: 'Juan Dela Cruz', email: 'j@e.com', subject: 'General Inquiry', message: 'hello there' } }, mockRes());
    expect(sentEmail().to).toBe('goldjewelryauction@gmail.com');

    sendNotificationEmail.mockClear();
    await createCustomerSupportRequest({ body: { subject: 'Account Issue', message: 'hello there' }, user: { id: 'u1' } }, mockRes());
    expect(sentEmail().to).toBe('goldjewelryauction@gmail.com');
  });

  test('3. the request body can never redirect the mail', async () => {
    poolQuery.mockImplementation(async (sql) => (/SELECT name, email/.test(String(sql))
      ? { rows: [{ name: 'Maria Santos', email: 'maria.santos@email.com' }] } : { rows: [{ id: 'sr-1' }] }));
    await postPublicContact({
      body: {
        name: 'Juan Dela Cruz', email: 'j@e.com', subject: 'General Inquiry', message: 'hi there',
        to: 'attacker@evil.com', recipient: 'attacker@evil.com',
      },
    }, mockRes());
    expect(sentEmail().to).toBe('goldjewelryauction@gmail.com');
  });

  test('4. the sender stays the existing verified ATANY address, not the Gmail', async () => {
    poolQuery.mockImplementation(async () => ({ rows: [{ id: 'sr-1' }] }));
    await postPublicContact({ body: { name: 'Juan Dela Cruz', email: 'j@e.com', subject: 'General Inquiry', message: 'hi there' } }, mockRes());
    const { sendNotificationEmail: real } = await import('../services/emailService.js');
    // the service resolves FROM itself; assert the notifier never passes a from
    expect(sentEmail().from).toBeUndefined();
    expect(real).toBeDefined();
  });
});

describe('Reply-To', () => {
  test('5. the guest email becomes Reply-To', async () => {
    poolQuery.mockImplementation(async () => ({ rows: [{ id: 'sr-1' }] }));
    await postPublicContact({ body: { name: 'Juan', email: 'juan@example.com', subject: 'General Inquiry', message: 'hi there' } }, mockRes());
    expect(sentEmail().replyTo).toBe('juan@example.com');
  });

  test('6. the authenticated customer email becomes Reply-To', async () => {
    poolQuery.mockImplementation(async (sql) => (/SELECT name, email/.test(String(sql))
      ? { rows: [{ name: 'Maria Santos', email: 'maria.santos@email.com' }] } : { rows: [{ id: 'sr-1' }] }));
    await createCustomerSupportRequest({ body: { subject: 'Account Issue', message: 'hi there' }, user: { id: 'u1' } }, mockRes());
    expect(sentEmail().replyTo).toBe('maria.santos@email.com');
  });

  test('7. a spoofed customer email in the body is never used as Reply-To', async () => {
    poolQuery.mockImplementation(async (sql) => (/SELECT name, email/.test(String(sql))
      ? { rows: [{ name: 'Maria Santos', email: 'maria.santos@email.com' }] } : { rows: [{ id: 'sr-1' }] }));
    await createCustomerSupportRequest({
      body: { subject: 'Account Issue', message: 'hi there', email: 'spoof@evil.com', name: 'Spoofed' },
      user: { id: 'u1' },
    }, mockRes());
    expect(sentEmail().replyTo).toBe('maria.santos@email.com');
  });

  test('8. header-injection attempts are stripped from Reply-To', () => {
    expect(sanitizeReplyTo('a@b.co\r\nBcc: victim@x.com')).toBeNull();
    expect(sanitizeReplyTo('x <y@z.com>')).toBeNull();
    expect(sanitizeReplyTo('two@one.com,three@two.com')).toBeNull();
    expect(sanitizeReplyTo('ok.person@mail.co')).toBe('ok.person@mail.co');
    expect(sanitizeReplyTo('')).toBeNull();
    expect(sanitizeReplyTo(null)).toBeNull();
  });
});

describe('email content', () => {
  test('9. the guest email carries sender, email, subject, message and attachment note', () => {
    const html = buildSupportEmail({
      kind: 'guest', name: 'Juan Dela Cruz', email: 'juan@example.com',
      subject: 'General Inquiry', message: 'Hello there',
      attachmentUrl: null,
    });
    expect(html).toContain('ATANY Guest Contact');
    expect(html).toContain('Juan Dela Cruz');
    expect(html).toContain('juan@example.com');
    expect(html).toContain('General Inquiry');
    expect(html).toContain('Hello there');
    expect(html).toContain('No image was attached');
  });

  test('10. the customer email is labelled distinctly', () => {
    const html = buildSupportEmail({
      kind: 'customer', name: 'Maria Santos', email: 'maria.santos@email.com',
      subject: 'Account Issue', message: 'Help please', attachmentUrl: null,
    });
    expect(html).toContain('ATANY Customer Support Request');
    expect(html).toContain('Maria Santos');
  });

  test('11. user-supplied HTML is escaped, not injected', () => {
    const html = buildSupportEmail({
      kind: 'guest', name: '<script>alert(1)</script>', email: 'j@e.com',
      subject: '<img onerror=x>', message: '<b>bold</b>', attachmentUrl: null,
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img onerror');
    expect(html).not.toContain('<b>bold</b>');
  });

  test('12. no credentials or tokens ever appear in the email', () => {
    const html = buildSupportEmail({
      kind: 'customer', name: 'Maria Santos', email: 'maria.santos@email.com',
      subject: 'Account Issue', message: 'help', attachmentUrl: null,
    });
    expect(html).not.toMatch(/RESEND_|api[_-]?key|Bearer |password|eyJ[A-Za-z0-9]/i);
  });
});

describe('best-effort delivery never loses the request', () => {
  test('13. an email failure does not delete or fail the stored request', async () => {
    sendNotificationEmail.mockRejectedValueOnce(new Error('provider down'));
    poolQuery.mockImplementation(async (sql) => (/SELECT name, email/.test(String(sql))
      ? { rows: [{ name: 'Maria Santos', email: 'maria.santos@email.com' }] } : { rows: [{ id: 'sr-1' }] }));
    const res = mockRes();
    await createCustomerSupportRequest({ body: { subject: 'Account Issue', message: 'hi there' }, user: { id: 'u1' } }, res);
    // still 201: the support request exists
    expect(statusOf(res)).toBe(201);
    expect(bodyOf(res).ok).toBe(true);
    expect(sqls().some((s) => /INSERT INTO public\.support_requests/.test(s))).toBe(true);
  });

  test('14. a DB failure returns a safe 503 and never claims success', async () => {
    poolQuery.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = mockRes();
    await postPublicContact({ body: { name: 'Juan Dela Cruz', email: 'j@e.com', subject: 'General Inquiry', message: 'hi there' } }, res);
    expect(statusOf(res)).toBe(503);
    expect(bodyOf(res).ok).toBeUndefined();
    expect(JSON.stringify(bodyOf(res))).not.toMatch(/ECONNREFUSED/);
  });
});

describe('image attachments', () => {
  test('15. JPG, PNG and WebP are accepted', async () => {
    const cases = [['a.jpg', 'image/jpeg', 1000], ['a.png', 'image/png', 1000], ['a.webp', 'image/webp', 1000]];
    for (const [filename, content_type, size] of cases) {
      const res = mockRes();
      await createPublicContactUpload({ body: { filename, content_type, size } }, res);
      expect(res.status).not.toHaveBeenCalled();
      expect(bodyOf(res).path.startsWith('guest/')).toBe(true);
    }
  });

  test('16. unsupported types are rejected with a friendly message', async () => {
    for (const [filename, content_type] of [['a.pdf', 'application/pdf'], ['a.svg', 'image/svg+xml'], ['a.gif', 'image/gif'], ['a.txt', 'text/plain']]) {
      const res = mockRes();
      await createPublicContactUpload({ body: { filename, content_type, size: 100 } }, res);
      expect(statusOf(res)).toBe(400);
      expect(bodyOf(res).message).toBe('Only JPG, PNG, and WebP images are allowed.');
    }
  });

  test('17. an oversized image is rejected', async () => {
    const res = mockRes();
    await createPublicContactUpload({ body: { filename: 'big.png', content_type: 'image/png', size: 6 * 1024 * 1024 } }, res);
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res).message).toBe('Image must be 5 MB or smaller.');
  });

  test('18. a disguised extension is rejected (type AND extension both checked)', async () => {
    const res = mockRes();
    await createPublicContactUpload({ body: { filename: 'evil.png.exe', content_type: 'image/png', size: 100 } }, res);
    expect(statusOf(res)).toBe(400);
  });

  test('19. the attachment path is stored, never raw bytes or base64', async () => {
    poolQuery.mockImplementation(async () => ({ rows: [{ id: 'sr-1' }] }));
    await postPublicContact({
      body: { name: 'Juan Dela Cruz', email: 'j@e.com', subject: 'General Inquiry', message: 'hi there', attachment_path: 'guest/a.png' },
    }, mockRes());
    const insert = poolQuery.mock.calls.find(([s]) => /INSERT INTO public\.support_requests/.test(String(s)));
    expect(insert[0]).toMatch(/attachment_path/);
    expect(insert[1][4]).toBe('guest/a.png');
    expect(JSON.stringify(insert[1])).not.toMatch(/data:image|base64/i);
  });

  test('20. the email carries a SIGNED link, not a permanent public URL', async () => {
    poolQuery.mockImplementation(async () => ({ rows: [{ id: 'sr-1' }] }));
    await postPublicContact({
      body: { name: 'Juan Dela Cruz', email: 'j@e.com', subject: 'General Inquiry', message: 'hi there', attachment_path: 'guest/a.png' },
    }, mockRes());
    const html = sentEmail().html;
    expect(html).toContain('/object/sign/');
    expect(html).not.toContain('/object/public/');
    expect(createSupportSignedUrl).toHaveBeenCalledWith('guest/a.png');
  });

  test('21. a request with no attachment still works and says so', async () => {
    poolQuery.mockImplementation(async () => ({ rows: [{ id: 'sr-1' }] }));
    const res = mockRes();
    await postPublicContact({ body: { name: 'Juan Dela Cruz', email: 'j@e.com', subject: 'General Inquiry', message: 'hi there' } }, res);
    expect(statusOf(res)).toBe(201);
    expect(sentEmail().html).toContain('No image was attached');
    expect(createSupportSignedUrl).not.toHaveBeenCalled();
  });

  test('22. the support bucket is private and size/type limited by config', async () => {
    const svc = await import('../services/storageService.js');
    expect(svc.SUPPORT_BUCKET).toBe('atany-support');
    expect(svc.SUPPORT_IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../services/storageService.js'), 'utf8');
    expect(src).toMatch(/public:\s*false/);
    expect(src).toMatch(/allowedMimeTypes:\s*SUPPORT_MIME/);
  });
});

describe('persistence + rate limits', () => {
  test('23. both flows persist to support_requests before emailing', async () => {
    const order = [];
    poolQuery.mockImplementation(async (sql) => {
      const s = String(sql);
      if (/INSERT INTO public\.support_requests/.test(s)) order.push('insert');
      if (/SELECT name, email/.test(s)) order.push('select');
      return { rows: [{ id: 'sr-1' }] };
    });
    sendNotificationEmail.mockImplementation(async () => { order.push('email'); });
    await postPublicContact({ body: { name: 'Juan Dela Cruz', email: 'j@e.com', subject: 'General Inquiry', message: 'hi there' } }, mockRes());
    expect(order.indexOf('insert')).toBeLessThan(order.indexOf('email'));
  });

  test('24. rate limits remain on every contact/upload route', () => {
    const index = require('node:fs').readFileSync(require('node:path').join(__dirname, '../index.js'), 'utf8');
    const cust = require('node:fs').readFileSync(require('node:path').join(__dirname, '../routes/customer.routes.js'), 'utf8');
    expect(index).toMatch(/app\.post\('\/api\/public\/contact', rateLimit\(\{ name: 'public-contact', windowMs: 600_000, max: 5 \}\)/);
    expect(index).toMatch(/app\.post\('\/api\/public\/contact\/attachment', rateLimit\(\{ name: 'public-contact-upload', windowMs: 600_000, max: 10 \}\)/);
    expect(cust).toMatch(/router\.post\('\/support', rateLimit\(\{ name: 'customer-support', windowMs: 600_000, max: 5 \}\)/);
    expect(cust).toMatch(/router\.post\('\/support\/attachment', rateLimit\(\{ name: 'customer-support-upload', windowMs: 600_000, max: 10 \}\)/);
  });

  test('25. customer identity still comes from the session only', async () => {
    poolQuery.mockImplementation(async (sql) => (/SELECT name, email/.test(String(sql))
      ? { rows: [{ name: 'Maria Santos', email: 'maria.santos@email.com' }] } : { rows: [{ id: 'sr-1' }] }));
    await createCustomerSupportRequest({
      body: { subject: 'Account Issue', message: 'hi there', user_id: 'other', email: 'spoof@evil.com', role: 'admin' },
      user: { id: 'u1' },
    }, mockRes());
    expect(sqls().join(' ')).toMatch(/SELECT name, email FROM users WHERE id = \$1/);
    expect(paramsOf()[0]).toEqual(['u1']);
  });
});
