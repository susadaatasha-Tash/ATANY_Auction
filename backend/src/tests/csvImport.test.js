import { describe, test, expect } from 'vitest';

function parseCsv(text) {
  const [headerLine, ...rows] = text.trim().split('\n');
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
  return rows.map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const obj = {};
    headers.forEach((h, i) => (obj[h] = cells[i]));
    return obj;
  });
}

describe('CSV import (extension d)', () => {
  test('parses template', () => {
    const csv = 'name,category,karat_weight,price,stock\nSolitaire Ring,Rings,18K · 3.1g,68000,4';
    const rows = parseCsv(csv);
    expect(rows[0].name).toBe('Solitaire Ring');
    expect(rows[0].price).toBe('68000');
  });
  test('rejects missing required', () => {
    const csv = 'name,category,price\n,Rings,68000';
    const rows = parseCsv(csv);
    const invalid = rows.filter((r) => !r.name || !r.category || !r.price);
    expect(invalid.length).toBe(1);
  });
});
