import { describe, test, expect, vi } from 'vitest';
import { requireRole } from '../middleware/requireRole.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('requireRole middleware (spec 5.4 + role isolation)', () => {
  test('blocks customer hitting admin route', () => {
    const req = { user: { user_metadata: { role: 'customer' } } };
    const res = mockRes();
    const next = vi.fn();
    requireRole('admin')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('blocks shop_owner hitting admin route', () => {
    const req = { user: { user_metadata: { role: 'shop_owner' } } };
    const res = mockRes();
    const next = vi.fn();
    requireRole('admin')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows admin on admin route', () => {
    const req = { user: { user_metadata: { role: 'admin' } } };
    const res = mockRes();
    const next = vi.fn();
    requireRole(['admin'])(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows shop_owner on shop-owner route', () => {
    const req = { user: { user_metadata: { role: 'shop_owner' } } };
    const res = mockRes();
    const next = vi.fn();
    requireRole('shop_owner')(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
