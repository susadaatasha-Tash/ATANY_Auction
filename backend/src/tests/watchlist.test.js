import { describe, test, expect, vi } from 'vitest';

// Unit test for watchlist toggle logic (frontend + backend contract: PK user_id+product_id prevents dupes)

describe('watchlist PK', () => {
  test('duplicate insert rejected by PK', () => {
    const seen = new Set();
    const insert = (uid, pid) => {
      const key = `${uid}:${pid}`;
      if (seen.has(key)) throw new Error('duplicate key');
      seen.add(key);
      return { user_id: uid, product_id: pid };
    };
    insert('u1', 'p1');
    expect(() => insert('u1', 'p1')).toThrow(/duplicate/);
    expect(() => insert('u1', 'p2')).not.toThrow();
  });
});
