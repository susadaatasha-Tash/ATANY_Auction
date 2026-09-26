import { describe, test, expect, vi } from 'vitest';
import { requireRole } from '../middleware/requireRole.js';

vi.mock('../db/pool.js', () => ({
  pool: {
    query: vi.fn().mockImplementation(async (sql, params) => {
      const id = params?.[0];
      // Map test user ids or direct id to role for testing
      // For tests that use user_metadata, fallback to that
      return { rows: [] };
    }),
    on: () => {},
  },
}));

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

// Helper to mock pool.query per test
async function mockPoolRole(role) {
  const { pool } = await import('../db/pool.js');
  pool.query.mockResolvedValueOnce({ rows: [{ role }] });
}

describe('requireRole middleware (spec 5.4 + role isolation)', () => {
  test('blocks customer hitting admin route', async () => {
    const { pool } = await import('../db/pool.js');
    pool.query.mockResolvedValueOnce({ rows: [{ role: 'customer' }] });
    const req = { user: { id: 'test-customer-id' } };
    const res = mockRes();
    const next = vi.fn();
    await requireRole('admin')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('blocks shop_owner hitting admin route', async () => {
    const { pool } = await import('../db/pool.js');
    pool.query.mockResolvedValueOnce({ rows: [{ role: 'shop_owner' }] });
    const req = { user: { id: 'test-shop-id' } };
    const res = mockRes();
    const next = vi.fn();
    await requireRole('admin')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows admin on admin route', async () => {
    const { pool } = await import('../db/pool.js');
    pool.query.mockResolvedValueOnce({ rows: [{ role: 'admin' }] });
    const req = { user: { id: 'test-admin-id' } };
    const res = mockRes();
    const next = vi.fn();
    await requireRole(['admin'])(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows shop_owner on shop-owner route', async () => {
    const { pool } = await import('../db/pool.js');
    pool.query.mockResolvedValueOnce({ rows: [{ role: 'shop_owner' }] });
    const req = { user: { id: 'test-shop-id' } };
    const res = mockRes();
    const next = vi.fn();
    await requireRole('shop_owner')(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
