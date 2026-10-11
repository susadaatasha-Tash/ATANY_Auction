import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatOpensIn } from '../useAuctionCountdown';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const customerCard = fs.readFileSync(
  path.join(__dirname, '../../../roles/customer/components/AuctionCard.jsx'),
  'utf8'
);
const sellerPage = fs.readFileSync(
  path.join(__dirname, '../../../roles/shop-owner/pages/MyAuctions.jsx'),
  'utf8'
);

describe('formatOpensIn — shared scheduled countdown', () => {
  it('1m16s → "Opens in 1m 16s"', () => {
    expect(formatOpensIn(76_000)).toBe('Opens in 1m 16s');
  });

  it('1h2m3s → "Opens in 1h 2m 03s"', () => {
    expect(formatOpensIn((1 * 3600 + 2 * 60 + 3) * 1000)).toBe('Opens in 1h 2m 03s');
  });

  it('8s → "Opens in 08s"', () => {
    expect(formatOpensIn(8_000)).toBe('Opens in 08s');
  });

  it('zero and negative → "Opens now" (no negative countdown)', () => {
    expect(formatOpensIn(0)).toBe('Opens now');
    expect(formatOpensIn(-5_000)).toBe('Opens now');
    expect(formatOpensIn(NaN)).toBe('Opens now');
  });

  it('>= 1 day → "Opens in 2d 4h 12m" (no 0h/0m units)', () => {
    expect(formatOpensIn((2 * 86400 + 4 * 3600 + 12 * 60) * 1000)).toBe('Opens in 2d 4h 12m');
  });

  it('>= 1 hour → "Opens in 1h 12m 08s"', () => {
    expect(formatOpensIn((1 * 3600 + 12 * 60 + 8) * 1000)).toBe('Opens in 1h 12m 08s');
  });

  it('customer and seller call the same shared helper (no duplicate formatter)', () => {
    expect(customerCard).toContain('formatOpensIn');
    expect(sellerPage).toContain('formatOpensIn');
    expect(customerCard).not.toMatch(/Starts in \$\{/);
    expect(sellerPage).not.toContain('function opensInLabel');
    expect(sellerPage).not.toContain('function formatTimer');
  });

  it('same start_time produces same remaining time within 1s on both pages', () => {
    const startTime = new Date(Date.now() + 76_400).toISOString();
    // Customer path: seconds derived from start_time, then back to ms
    const customerSec = Math.max(0, Math.floor((new Date(startTime) - new Date()) / 1000));
    const customerText = formatOpensIn(customerSec * 1000);
    // Seller path: ms diff straight from the same start_time
    const sellerText = formatOpensIn(new Date(startTime) - Date.now());
    const toSec = (t) => {
      const m = t.match(/(?:(\d+)h )?(\d+)m (\d+)s/);
      if (m) return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
      const s = t.match(/Opens in (\d+)s/);
      return s ? Number(s[1]) : 0;
    };
    expect(customerText).toMatch(/^Opens in /);
    expect(sellerText).toMatch(/^Opens in /);
    expect(Math.abs(toSec(customerText) - toSec(sellerText))).toBeLessThanOrEqual(1);
  });
});
