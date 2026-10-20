// backend/src/tests/pgClientCallbackRegression.test.js
// Regression: the direct-pg client wrapper must forward pg's callback argument.
// pg's Pool.query(text, values, callback) settles its promise AND releases the
// pooled client INSIDE that callback. A wrapper that drops the callback leaves
// pg's Pool.query promise permanently unsettled and the client never released,
// so every later pool.query() that reuses that client hangs (requests never
// respond, the DB looks idle, and the pool eventually exhausts).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const poolSrc = fs.readFileSync(path.join(__dirname, '../db/pool.js'), 'utf8');

const wrapperFn = () => poolSrc.slice(
  poolSrc.indexOf('async function acquireDirectClient'),
  poolSrc.indexOf('// Provide pool.connect() for transaction support')
);

describe('direct-pg client wrapper keeps pg callback semantics', () => {
  it('wrapper accepts and forwards a callback argument', () => {
    const fn = wrapperFn();
    expect(fn).toMatch(/client\.query = function \(sql, params = \[\], callback\)/);
    expect(fn).toContain("typeof callback === 'function'");
    expect(fn).toContain('callback(null, res)');
    expect(fn).toContain('callback(err)');
  });

  it('wrapper is installed at most once per pooled client (no double wrapping)', () => {
    expect(wrapperFn()).toContain('__atanyQueryWrapped');
  });

  it('every client.query assignment in pool.js supports a callback', () => {
    const assignments = poolSrc.match(/client\.query\s*=\s*(?:async\s+)?function\s*\([^)]*\)/g) || [];
    expect(assignments.length).toBeGreaterThan(0);
    for (const a of assignments) {
      expect(a).toMatch(/callback\)/);
    }
  });
});
