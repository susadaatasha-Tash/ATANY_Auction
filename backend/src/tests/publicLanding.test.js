// backend/src/tests/publicLanding.test.js
// Public landing data endpoints: /api/public/stats, GET /branches (public),
// POST /api/public/contact (validated + rate limited). Asserts no private data leaks.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

const Q = "'";

describe('public landing endpoints (source contract)', () => {
  it('GET /api/public/stats is registered as a public, rate limited route', () => {
    expect(indexSrc).toContain(`app.get(${Q}/api/public/stats${Q}`);
    expect(indexSrc).toMatch(/app\.get\('\/api\/public\/stats'[^\n]*rateLimit\(/);
  });

  it('GET /branches projects only safe public fields (never SELECT *)', () => {
    expect(indexSrc).toContain('PUBLIC_BRANCH_FIELDS');
    expect(indexSrc).toMatch(/const PUBLIC_BRANCH_FIELDS = 'id, name, address, lat, lng, hours, phone, status, branch_image_url'/);
    // The raw SELECT * must not be used for the public branches route.
    expect(indexSrc).not.toMatch(/pool\.query\('SELECT \* FROM branches'\)/);
  });

  it('public stats only counts safe aggregates (no identities/revenue/payments)', () => {
    const block = indexSrc.slice(
      indexSrc.indexOf(`app.get(${Q}/api/public/stats${Q}`),
      indexSrc.indexOf(`app.post(${Q}/api/public/contact${Q}`)
    );
    // The stats handler itself must not read identities or money.
    const handler = block.slice(0, block.indexOf('// Public contact form'));
    expect(handler).toContain("role = 'customer'");
    expect(handler).toContain("status = 'ended'");
    expect(handler).toContain("status = 'Open'");
    expect(handler).toContain('FROM products');
    // Forbidden: emails, revenue, payments, bidder identities
    expect(handler).not.toMatch(/email/i);
    expect(handler).not.toMatch(/revenue/i);
    expect(handler).not.toMatch(/payment/i);
    expect(handler).not.toMatch(/bidder/i);
  });

  it('POST /api/public/contact validates and is rate limited', () => {
    expect(indexSrc).toMatch(/app\.post\('\/api\/public\/contact'[^\n]*rateLimit\(/);
    const block = indexSrc.slice(
      indexSrc.indexOf(`app.post(${Q}/api/public/contact${Q}`),
      indexSrc.indexOf(`app.post(${Q}/chat${Q}`)
    );
    // The route delegates to the ONE shared support service (validate →
    // persist → notify). It must not implement its own email sending.
    expect(block).toContain('validateSupportRequest');
    expect(block).toContain('sendSupportNotification');
    expect(block).not.toMatch(/sendNotificationEmail/);
    expect(block).not.toMatch(/api\.resend\.com/);
    expect(block).not.toContain('INSERT INTO support_requests');
  });

  it('the shared support service owns validation, persistence and delivery', () => {
    const svc = fs.readFileSync(path.join(__dirname, '../services/supportService.js'), 'utf8');
    expect(svc).toContain('INVALID_NAME');
    expect(svc).toContain('INVALID_EMAIL');
    expect(svc).toContain('INVALID_CATEGORY');
    expect(svc).toContain('INVALID_MESSAGE');
    expect(svc).toContain('INVALID_ATTACHMENT');
    expect(svc).toContain('INSERT INTO support_requests');
    expect(svc).toContain('sendNotificationEmail');
    // The recipient always comes from the centralized config.
    expect(svc).toContain('resolveSupportEmail');
    expect(svc).not.toContain('support@atany.ph');
  });

  it('public branches route stays unauthenticated (no role guards)', () => {
    const idx = indexSrc.indexOf(`app.get(${Q}/branches${Q}`);
    expect(idx).toBeGreaterThan(-1);
    const line = indexSrc.slice(idx, indexSrc.indexOf('\n', idx));
    expect(line).not.toContain('requireAuth');
    expect(line).not.toContain('requireRole');
  });

  it('chat no longer trusts a client-declared userId', () => {
    const block = indexSrc.slice(
      indexSrc.indexOf(`app.post(${Q}/chat${Q}`),
      indexSrc.indexOf('app.use(reviewRoutes)')
    );
    expect(block).toContain('resolveOptionalUserId');
    // The client-provided userId must not be used for attribution.
    expect(block).not.toMatch(/userId: userId \|\|/);
    expect(block).not.toMatch(/const \{ query, message, history, mode, userId \}/);
  });
});
