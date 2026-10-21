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
    expect(block).toContain("role = 'customer'");
    expect(block).toContain("status = 'ended'");
    expect(block).toContain("status = 'Open'");
    expect(block).toContain('FROM products');
    // Forbidden: emails, revenue, payments, bidder identities
    expect(block).not.toMatch(/email/i);
    expect(block).not.toMatch(/revenue/i);
    expect(block).not.toMatch(/payment/i);
    expect(block).not.toMatch(/bidder/i);
  });

  it('POST /api/public/contact validates and is rate limited', () => {
    expect(indexSrc).toMatch(/app\.post\('\/api\/public\/contact'[^\n]*rateLimit\(/);
    const block = indexSrc.slice(
      indexSrc.indexOf(`app.post(${Q}/api/public/contact${Q}`),
      indexSrc.indexOf(`app.post(${Q}/chat${Q}`)
    );
    expect(block).toContain('INVALID_NAME');
    expect(block).toContain('INVALID_EMAIL');
    expect(block).toContain('INVALID_SUBJECT');
    expect(block).toContain('INVALID_MESSAGE');
    expect(block).toContain('INSERT INTO support_requests');
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
