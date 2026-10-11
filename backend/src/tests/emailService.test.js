import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('emailService sender configuration', () => {
  let originalEnv;
  let originalFetch;
  let consoleErrorSpy;
  let consoleWarnSpy;

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalFetch = global.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    if (consoleErrorSpy) consoleErrorSpy.mockRestore();
    if (consoleWarnSpy) consoleWarnSpy.mockRestore();
    vi.resetModules();
  });

  it('configured sender is used (RESEND_FROM_EMAIL)', async () => {
    process.env.RESEND_API_KEY = 're_test_key_123';
    process.env.RESEND_FROM_EMAIL = 'ATANY <custom@verified.example>';
    process.env.NODE_ENV = 'development';
    vi.resetModules();
    const { sendNotificationEmail } = await import('../services/emailService.js');
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }));
    global.fetch = fetchMock;
    await sendNotificationEmail({ to: 'to@example.com', subject: 'Hi', html: '<p>hi</p>' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe('ATANY <custom@verified.example>');
    expect(body.from).not.toBe('ATANY Test <onboarding@resend.dev>');
  });

  it('development fallback to onboarding@resend.dev when RESEND_FROM_EMAIL missing', async () => {
    process.env.RESEND_API_KEY = 're_test_key_123';
    delete process.env.RESEND_FROM_EMAIL;
    process.env.NODE_ENV = 'development';
    vi.resetModules();
    const { sendNotificationEmail } = await import('../services/emailService.js');
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }));
    global.fetch = fetchMock;
    await sendNotificationEmail({ to: 'to@example.com', subject: 'Hi', html: '<p>hi</p>' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe('ATANY Test <onboarding@resend.dev>');
  });

  it('production missing sender is rejected (no fetch, clear error)', async () => {
    process.env.RESEND_API_KEY = 're_test_key_123';
    delete process.env.RESEND_FROM_EMAIL;
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { sendNotificationEmail } = await import('../services/emailService.js');
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }));
    global.fetch = fetchMock;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await sendNotificationEmail({ to: 'to@example.com', subject: 'Hi', html: '<p>hi</p>' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('RESEND_FROM_EMAIL missing'), expect.anything());
  });

  it('does not hardcode production sender (noreply@atany.ph)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/emailService.js'), 'utf8');
    // Should not contain hardcoded noreply@atany.ph outside of comments referencing example
    // The only allowed occurrence would be in a comment about example env, not in code string
    const codeLines = src.split('\n').filter(l => !l.trim().startsWith('//'));
    const code = codeLines.join('\n');
    expect(code).not.toContain('noreply@atany.ph');
    expect(code).toContain('RESEND_FROM_EMAIL');
    expect(code).toContain('onboarding@resend.dev');
  });

  it('API key is never exposed in logs or responses', async () => {
    process.env.RESEND_API_KEY = 're_secret_999_xyz';
    process.env.RESEND_FROM_EMAIL = 'ATANY <sender@verified.example>';
    process.env.NODE_ENV = 'development';
    vi.resetModules();
    const { sendNotificationEmail } = await import('../services/emailService.js');
    // Simulate Resend error
    const fetchMock = vi.fn(async () => ({ ok: false, text: async () => 'Invalid API key' }));
    global.fetch = fetchMock;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sendNotificationEmail({ to: 'to@example.com', subject: 'Hi', html: '<p>hi</p>' });
    // Ensure console.error was called with Resend error but not key
    expect(consoleErrorSpy).toHaveBeenCalledWith('Resend error', expect.any(String));
    const logged = consoleErrorSpy.mock.calls.flat().join(' ') + consoleWarnSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('re_secret_999_xyz');
    // Ensure fetch was called with Authorization header containing key but not logged
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toContain('re_secret_999_xyz');
    // But logs should not contain it
    expect(logged).not.toContain('re_secret_999_xyz');
  });

  it('resolveFromEmail helper respects env', async () => {
    process.env.RESEND_FROM_EMAIL = 'ATANY <hello@verified.example>';
    vi.resetModules();
    const { resolveFromEmail } = await import('../services/emailService.js');
    expect(resolveFromEmail()).toBe('ATANY <hello@verified.example>');
    delete process.env.RESEND_FROM_EMAIL;
    process.env.NODE_ENV = 'development';
    vi.resetModules();
    const mod2 = await import('../services/emailService.js');
    expect(mod2.resolveFromEmail()).toBe('ATANY Test <onboarding@resend.dev>');
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const mod3 = await import('../services/emailService.js');
    expect(mod3.resolveFromEmail()).toBeNull();
  });
});
