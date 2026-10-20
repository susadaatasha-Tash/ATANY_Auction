import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('SalesPayouts route contract', () => {
  it('fetches /shop-owner/sales/summary (analytics), not /shop-owner/sales (order table)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../SalesPayouts.jsx'), 'utf8');
    expect(src).toMatch(/apiFetch\('\/shop-owner\/sales\/summary'/);
    expect(src).not.toMatch(/apiFetch\('\/shop-owner\/sales'\)/);
  });

  it('uses Recharts for the trend chart', () => {
    const src = fs.readFileSync(path.join(__dirname, '../SalesPayouts.jsx'), 'utf8');
    expect(src).toMatch(/from 'recharts'/);
    expect(src).toMatch(/ResponsiveContainer/);
    expect(src).toMatch(/LineChart/);
  });

  it('does not hardcode reference values', () => {
    const src = fs.readFileSync(path.join(__dirname, '../SalesPayouts.jsx'), 'utf8');
    // Reference image values must not appear literally
    expect(src).not.toMatch(/164,000/);
    expect(src).not.toMatch(/141,200/);
    expect(src).not.toMatch(/62,400/);
    expect(src).not.toMatch(/PAY-2041/);
  });

  it('does not trust client shop_id', () => {
    const src = fs.readFileSync(path.join(__dirname, '../SalesPayouts.jsx'), 'utf8');
    expect(src).not.toMatch(/shop_id/);
    expect(src).not.toMatch(/seller_id/);
  });
});

describe('WonLotsOrders route contract', () => {
  it('fetches /shop-owner/sales (order table)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../WonLotsOrders.jsx'), 'utf8');
    expect(src).toMatch(/apiFetch\('\/shop-owner\/sales'/);
  });
});
