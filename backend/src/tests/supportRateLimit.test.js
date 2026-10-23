// backend/src/tests/supportRateLimit.test.js
// The support endpoints must resist spam without blocking legitimate use.
//
//  • POST /api/public/contact  → 5 requests / 10 minutes per IP
//  • POST /support/account     → 10 requests / 10 minutes per IP
//
// The authenticated route is ALSO guarded so a hijacked session cannot be used
// to flood the ATANY inbox.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

const { rateLimit, resetRateLimitBuckets } = await import('../middleware/rateLimit.js');

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn();
  return res;
}
import { vi } from 'vitest';

beforeEach(() => {
  resetRateLimitBuckets();
});

describe('support rate limiting', () => {
  it('the public contact route is rate limited', () => {
    expect(indexSrc).toMatch(/app\.post\('\/api\/public\/contact'[^\n]*rateLimit\(\{ name: 'public-contact'/);
  });

  it('the authenticated support route is rate limited', () => {
    expect(indexSrc).toMatch(/app\.use\(\s*'\/support'[\s\S]*rateLimit\(\{ name: 'account-support'/);
  });

  it('the limiter rejects the 6th public contact attempt with 429', () => {
    const mw = rateLimit({ name: 'public-contact', windowMs: 600_000, max: 5 });
    for (let i = 0; i < 5; i++) {
      const res = mockRes();
      mw({ ip: '1.2.3.4' }, res, () => {});
      expect(res.status).not.toHaveBeenCalledWith(429);
    }
    const res = mockRes();
    mw({ ip: '1.2.3.4' }, res, () => {});
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('the limiter allows 10 authenticated support attempts and blocks the 11th', () => {
    const mw = rateLimit({ name: 'account-support', windowMs: 600_000, max: 10 });
    for (let i = 0; i < 10; i++) {
      const res = mockRes();
      mw({ ip: '5.6.7.8' }, res, () => {});
      expect(res.status).not.toHaveBeenCalledWith(429);
    }
    const res = mockRes();
    mw({ ip: '5.6.7.8' }, res, () => {});
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('one noisy IP does not block another', () => {
    const mw = rateLimit({ name: 'public-contact', windowMs: 600_000, max: 2 });
    for (let i = 0; i < 3; i++) {
      const res = mockRes();
      mw({ ip: '9.9.9.9' }, res, () => {});
    }
    const other = mockRes();
    let passed = false;
    mw({ ip: '8.8.8.8' }, other, () => { passed = true; });
    expect(passed).toBe(true);
  });
});
