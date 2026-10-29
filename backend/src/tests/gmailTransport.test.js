// backend/src/tests/gmailTransport.test.js
//
// GMAIL SMTP DELIVERY — transport, credentials and recipient contract.
//
// NO REAL EMAIL IS SENT from this suite: nodemailer is mocked. Real SMTP is only
// exercised during controlled manual QA.
//
// Guarantees locked here:
//   · EMAIL_PROVIDER=gmail selects Gmail SMTP; resend keeps working
//   · host/port/secure/user/pass come ONLY from the environment
//   · the App Password is never logged, never returned, never in an error
//   · the recipient stays the configured SUPPORT_RECIPIENT_EMAIL
//   · Reply-To is the enquirer's (guest / authenticated customer) address
//   · support_requests is persisted BEFORE the send, and survives an SMTP failure
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMail = vi.hoisted(() => vi.fn(async () => ({ accepted: ['goldjewelryauction@gmail.com'], rejected: [] })));
const verifyFn = vi.hoisted(() => vi.fn(async () => true));
const createTransport = vi.hoisted(() => vi.fn());
vi.mock('nodemailer', () => ({
  default: { createTransport: (...a) => createTransport(...a) },
}));

const poolQuery = vi.hoisted(() => vi.fn());
vi.mock('../db/pool.js', () => ({ pool: { query: poolQuery } }));

const signedUrl = vi.hoisted(() => vi.fn(async () => 'https://x.supabase.co/storage/v1/object/sign/atany-support/guest/a.png?token=T'));
vi.mock('../services/storageService.js', () => ({ createSupportSignedUrl: signedUrl }));

const ENV_KEYS = ['EMAIL_PROVIDER', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'NODE_ENV'];
const saved = {};
const setEnv = (k, v) => { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };

const load = async () => {
  vi.resetModules();
  return {
    transport: await import('../services/emailTransport.js'),
    service: await import('../services/emailService.js'),
    support: await import('../services/supportNotification.js'),
    config: await import('../config/contact.js'),
  };
};

beforeEach(() => {
  ENV_KEYS.forEach((k) => setEnv(k, undefined));
  setEnv('SMTP_HOST', 'smtp.gmail.com');
  setEnv('SMTP_PORT', '465');
  setEnv('SMTP_SECURE', 'true');
  setEnv('SMTP_USER', 'goldjewelryauction@gmail.com');
  setEnv('SMTP_PASS', 'abcd efgh ijkl mnop');
  setEnv('EMAIL_PROVIDER', 'gmail');
  setEnv('SMTP_FROM', undefined);
  sendMail.mockClear();
  verifyFn.mockClear();
  createTransport.mockReset();
  createTransport.mockReturnValue({ sendMail, verify: verifyFn });
  poolQuery.mockReset();
  signedUrl.mockClear();
});

afterEach(() => { ENV_KEYS.forEach((k) => setEnv(k, saved[k])); });

describe('1. provider configuration', () => {
  test('1. EMAIL_PROVIDER=gmail selects Gmail SMTP', async () => {
    const { transport } = await load();
    expect(transport.describeConfig().provider).toBe('gmail');
  });

  test('2. an unset provider keeps the existing Resend behaviour', async () => {
    setEnv('EMAIL_PROVIDER', undefined);
    const { transport } = await load();
    expect(transport.describeConfig().provider).toBe('resend');
  });

  test('3. SMTP defaults match Gmail (host/port/secure)', async () => {
    setEnv('SMTP_HOST', undefined); setEnv('SMTP_PORT', undefined); setEnv('SMTP_SECURE', undefined);
    const { transport } = await load();
    const cfg = transport.describeConfig();
    expect(cfg.host).toBe('smtp.gmail.com');
    expect(cfg.port).toBe('465');
    expect(cfg.secure).toBe(true);
  });

  test('4. missing SMTP variables are reported BY NAME, never by value', async () => {
    setEnv('SMTP_PASS', undefined);
    const { transport } = await load();
    const cfg = transport.describeConfig();
    expect(cfg.configured).toBe(false);
    expect(cfg.missing).toContain('SMTP_PASS');
    expect(cfg.missing).not.toContain('abcd efgh ijkl mnop');
  });

  test('5. an unconfigured provider refuses to build a transport', async () => {
    setEnv('SMTP_USER', undefined);
    const { transport } = await load();
    expect(() => transport.getSmtpTransport()).toThrow(/SMTP_USER/);
  });
});

describe('2. SMTP transport construction', () => {
  test('6. the transporter receives the configured host/port/secure', async () => {
    const { transport } = await load();
    transport.getSmtpTransport();
    const opts = createTransport.mock.calls[0][0];
    expect(opts.host).toBe('smtp.gmail.com');
    expect(opts.port).toBe(465);
    expect(opts.secure).toBe(true);
  });

  test('7. SMTP_USER and SMTP_PASS come only from the environment', async () => {
    const { transport } = await load();
    transport.getSmtpTransport();
    const opts = createTransport.mock.calls[0][0];
    expect(opts.auth.user).toBe('goldjewelryauction@gmail.com');
    expect(opts.auth.pass).toBe('abcd efgh ijkl mnop');
  });

  test('8. no credential is hardcoded in the transport source', async () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require('node:path').join(__dirname, '../services/emailTransport.js'), 'utf8');
    expect(src).not.toMatch(/abcd efgh/);
    expect(src).not.toMatch(/pass\s*[:=]\s*['"][^'"]+['"]/i);
    expect(src).toMatch(/process\.env\.SMTP_PASS/);
  });

  test('9. the transport is created lazily (not at import)', async () => {
    await load();
    expect(createTransport).not.toHaveBeenCalled();
  });
});

describe('3. credential secrecy', () => {
  test('10. a failed send never logs the App Password', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendMail.mockRejectedValueOnce(new Error('535 5.7.8 Username and Password not accepted. pass=abcd efgh ijkl mnop auth=failed'));
    const { transport } = await load();
    const r = await transport.sendViaGmailSmtp({ to: 'a@b.com', subject: 's', html: '<p>x</p>' });
    const logged = spy.mock.calls.map((c) => JSON.stringify(c)).join(' ');
    spy.mockRestore();
    expect(r.delivered).toBe(false);
    expect(logged).not.toContain('abcd efgh ijkl mnop');
    expect(logged).toContain('[redacted]');
  });

  test('11. the App Password is absent from the returned result', async () => {
    sendMail.mockRejectedValueOnce(new Error('boom'));
    const { transport } = await load();
    const r = await transport.sendViaGmailSmtp({ to: 'a@b.com', subject: 's', html: '<p>x</p>' });
    expect(JSON.stringify(r)).not.toContain('abcd efgh');
  });

  test('12. describeConfig() exposes no secret', async () => {
    const { transport } = await load();
    expect(JSON.stringify(transport.describeConfig())).not.toContain('abcd efgh');
  });

  test('13. verification reports success safely', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { transport } = await load();
    const r = await transport.verifySmtp();
    spy.mockRestore();
    expect(r.ok).toBe(true);
    expect(verifyFn).toHaveBeenCalled();
  });

  test('14. verification failure gives actionable, non-secret wording', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    verifyFn.mockRejectedValueOnce(new Error('Invalid credentials'));
    const { transport } = await load();
    const r = await transport.verifySmtp();
    const logged = spy.mock.calls.map((c) => JSON.stringify(c)).join(' ');
    spy.mockRestore();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/2-Step Verification and App Password/i);
    expect(logged).not.toContain('abcd efgh');
  });
});

describe('4. addressing', () => {
  test('15. FROM is ATANY Support <SMTP_USER> and TO is the recipient', async () => {
    const { service, config } = await load();
    await service.sendNotificationEmail({ to: config.SUPPORT_RECIPIENT_EMAIL, subject: 's', html: '<p>x</p>' });
    const msg = sendMail.mock.calls[0][0];
    expect(msg.from).toBe('ATANY Support <goldjewelryauction@gmail.com>');
    expect(msg.to).toBe('goldjewelryauction@gmail.com');
  });

  test('16. the recipient is still the configured SUPPORT_RECIPIENT_EMAIL', async () => {
    const { service, config } = await load();
    await service.sendNotificationEmail({ to: config.SUPPORT_RECIPIENT_EMAIL, subject: 's', html: '<p>x</p>' });
    expect(config.SUPPORT_RECIPIENT_EMAIL).toBe('goldjewelryauction@gmail.com');
    expect(sendMail.mock.calls[0][0].to).toBe('goldjewelryauction@gmail.com');
  });

  test('17. an explicit SMTP_FROM overrides the default', async () => {
    setEnv('SMTP_FROM', 'ATANY Enquiries <goldjewelryauction@gmail.com>');
    const { transport } = await load();
    expect(transport.describeConfig().from).toBe('ATANY Enquiries <goldjewelryauction@gmail.com>');
  });
});

describe('5. Reply-To', () => {
  test('18. the guest address becomes Reply-To (not the Gmail)', async () => {
    const { service } = await load();
    await service.sendNotificationEmail({ to: 'goldjewelryauction@gmail.com', subject: 's', html: '<p>x</p>', replyTo: 'juan@example.com' });
    expect(sendMail.mock.calls[0][0].replyTo).toBe('juan@example.com');
  });

  test('19. the authenticated customer address becomes Reply-To', async () => {
    poolQuery.mockImplementation(async (sql) => (/SELECT name, email/.test(String(sql))
      ? { rows: [{ name: 'Maria Santos', email: 'maria.santos@email.com' }] } : { rows: [{ id: 'sr-1' }] }));
    const { createCustomerSupportRequest } = await import('../controllers/customer/support.controller.js');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await createCustomerSupportRequest({ body: { subject: 'Account Issue', message: 'hi there' }, user: { id: 'u1' } }, res);
    expect(sendMail.mock.calls[0][0].replyTo).toBe('maria.santos@email.com');
  });

  test('20. a spoofed customer email in the body is never used', async () => {
    poolQuery.mockImplementation(async (sql) => (/SELECT name, email/.test(String(sql))
      ? { rows: [{ name: 'Maria Santos', email: 'maria.santos@email.com' }] } : { rows: [{ id: 'sr-1' }] }));
    const { createCustomerSupportRequest } = await import('../controllers/customer/support.controller.js');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await createCustomerSupportRequest({
      body: { subject: 'Account Issue', message: 'hi there', email: 'spoof@evil.com' }, user: { id: 'u1' },
    }, res);
    expect(sendMail.mock.calls[0][0].replyTo).toBe('maria.santos@email.com');
  });

  test('21. CR/LF header injection is stripped before reaching SMTP', async () => {
    const { service } = await load();
    await service.sendNotificationEmail({
      to: 'goldjewelryauction@gmail.com', subject: 's', html: '<p>x</p>',
      replyTo: 'ok@x.com\r\nBcc: victim@evil.com',
    });
    const msg = sendMail.mock.calls[0][0];
    expect(String(msg.replyTo)).not.toMatch(/[\r\n]/);
    expect(String(msg.replyTo)).not.toContain('victim@evil.com');
  });
});

describe('6. attachments, persistence and failure handling', () => {
  test('22. the signed attachment link is included', async () => {
    poolQuery.mockImplementation(async () => ({ rows: [{ id: 'sr-1' }] }));
    const { postPublicContact } = await import('../controllers/public.controller.js');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await postPublicContact({
      body: { name: 'Juan Dela Cruz', email: 'j@e.com', subject: 'General Inquiry', message: 'hi there', attachment_path: 'guest/a.png' },
    }, res);
    expect(signedUrl).toHaveBeenCalledWith('guest/a.png');
    expect(sendMail.mock.calls[0][0].html).toContain('/object/sign/');
    expect(sendMail.mock.calls[0][0].html).not.toContain('/object/public/');
  });

  test('23. the support row is persisted BEFORE the SMTP call', async () => {
    const order = [];
    poolQuery.mockImplementation(async (sql) => {
      if (/INSERT INTO public\.support_requests/.test(String(sql))) order.push('insert');
      return { rows: [{ id: 'sr-1' }] };
    });
    sendMail.mockImplementation(async () => { order.push('smtp'); return { accepted: ['x'], rejected: [] }; });
    const { postPublicContact } = await import('../controllers/public.controller.js');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await postPublicContact({ body: { name: 'Juan', email: 'j@e.com', subject: 'General Inquiry', message: 'hi there' } }, res);
    expect(order.indexOf('insert')).toBeLessThan(order.indexOf('smtp'));
  });

  test('24. an SMTP outage does NOT lose the stored request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendMail.mockRejectedValueOnce(new Error('ECONNECTIONREFUSED 74.125.6.26:465'));
    poolQuery.mockImplementation(async (sql) => (/SELECT name, email/.test(String(sql))
      ? { rows: [{ name: 'Maria Santos', email: 'maria.santos@email.com' }] } : { rows: [{ id: 'sr-1' }] }));
    const { createCustomerSupportRequest } = await import('../controllers/customer/support.controller.js');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await createCustomerSupportRequest({ body: { subject: 'Account Issue', message: 'hi there' }, user: { id: 'u1' } }, res);
    // still 201 and the row was inserted
    expect(res.status.mock.calls[0][0]).toBe(201);
    expect(JSON.stringify(poolQuery.mock.calls.map(([s]) => s))).toMatch(/INSERT INTO public\.support_requests/);
    vi.restoreAllMocks();
  });

  test('25. an unconfigured provider reports not-configured without throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setEnv('SMTP_PASS', undefined);
    const { transport } = await load();
    const r = await transport.sendViaGmailSmtp({ to: 'a@b.com', subject: 's', html: '<p>x</p>' });
    vi.restoreAllMocks();
    expect(r.delivered).toBe(false);
    expect(r.error).toBe('smtp-not-configured');
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('26. no credential is exposed through an API-shaped response', async () => {
    poolQuery.mockImplementation(async () => ({ rows: [{ id: 'sr-1' }] }));
    const { postPublicContact } = await import('../controllers/public.controller.js');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await postPublicContact({ body: { name: 'Juan', email: 'j@e.com', subject: 'General Inquiry', message: 'hi there' } }, res);
    const payload = JSON.stringify(res.json.mock.calls);
    expect(payload).not.toContain('abcd efgh');
    expect(payload).not.toMatch(/smtp|smtp_pass|password/i);
  });
});

describe('7. resend path preserved', () => {
  test('27. EMAIL_PROVIDER=resend does not use nodemailer', async () => {
    setEnv('EMAIL_PROVIDER', 'resend');
    setEnv('RESEND_API_KEY', 're_test');
    setEnv('RESEND_FROM_EMAIL', 'ATANY <noreply@atany.ph>');
    const { service } = await load();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"id":"x"}', { status: 200 }));
    await service.sendNotificationEmail({ to: 'a@b.com', subject: 's', html: '<p>x</p>', replyTo: 'r@x.com' });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    fetchSpy.mockRestore();
    expect(sendMail).not.toHaveBeenCalled();
    expect(body.reply_to).toBe('r@x.com');
    expect(body.from).toBe('ATANY <noreply@atany.ph>');
  });
});
