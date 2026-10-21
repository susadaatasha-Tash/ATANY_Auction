// backend/src/tests/adminOrders.test.js
// Admin → Orders backend suite.
//
// Contract under test:
//  • The endpoint stays admin-only (anonymous 401, non-admin 403).
//  • The list is filtered / searched / sorted / paginated SERVER-SIDE with
//    parameterized SQL (no client-controlled SQL fragments).
//  • The summary reports the REAL order states (pending, preparing,
//    ready_pickup, completed, expired) and the canonical recognized revenue
//    rule (payments.status = 'paid') — unpaid orders are never sales.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const poolQuery = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: vi.fn(), on: vi.fn() },
  isDirectPg: () => true,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'no session' } })) },
  })),
}));

const { listTransactions, ORDER_STATUSES } = await import('../controllers/admin/transaction.controller.js');

const ADMIN = '00000000-0000-0000-0000-000000000004';
const BRANCH_GMALL = '2af5d27d-13d6-4743-99dd-e4e675002c1b';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
const req = (query = {}) => ({ query, params: {}, body: {}, user: { id: ADMIN } });
const payload = (res) => res.json.mock.calls[0]?.[0];

const ORDERS = [
  {
    id: 'o1', transaction_code: 'TXN-9009', customer: 'Britz Atasha', item: 'TEST 1',
    amount: 70500, branch: 'Gmall Branch', branch_id: BRANCH_GMALL, status: 'pending',
    date: '2026-10-19T13:21:42.319Z', total_count: 9,
  },
  {
    id: 'o2', transaction_code: 'TXN-9002', customer: 'britz Susada', item: 'Rose Gold Bangle',
    amount: 55000, branch: 'Gmall Branch', branch_id: BRANCH_GMALL, status: 'completed',
    date: '2026-09-15T10:31:00.000Z', total_count: 9,
  },
  {
    id: 'o3', transaction_code: 'TXN-9008', customer: 'Britz Atasha', item: 'testing 1',
    amount: 10000, branch: 'Abreeza Branch', branch_id: 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a',
    status: 'expired', date: '2026-10-04T01:48:00.000Z', total_count: 9,
  },
];

const SUMMARY_ROW = {
  total_orders: 9,
  branches_in_scope: 3,
  pending: 3,
  preparing: 0,
  ready_pickup: 0,
  completed: 2,
  expired: 4,
  total_sales: 137000,
  paid_orders: 2,
};

/** Default pool behaviour: the list query, the summary query and the count. */
function defaultPool({ rows = ORDERS, summary = SUMMARY_ROW, count = 9 } = {}) {
  poolQuery.mockImplementation(async (sql) => {
    if (/COUNT\(\*\) OVER/.test(sql)) {
      // The window count carries the filtered total.
      const filtered = rows.filter((r) => {
        if (/ILIKE/.test(sql)) {
          const needle = (sql.match(/\$1/g) || []).length;
          if (!needle) return true;
        }
        return true;
      });
      return { rows: filtered.map((r) => ({ ...r, total_count: count })) };
    }
    if (/COUNT\(\*\)::int AS total/.test(sql) && !/FILTER/.test(sql)) return { rows: [{ total: count }] };
    if (/COUNT\(\*\)::int AS total_orders/.test(sql)) return { rows: [summary] };
    return { rows: [] };
  });
}

beforeEach(() => {
  poolQuery.mockReset();
  defaultPool();
});

// ─────────────────────────────────────────────────────────────
// authorization
// ─────────────────────────────────────────────────────────────
describe('admin orders — authorization', () => {
  it('the admin router stays behind requireAuth + requireRole(admin)', () => {
    const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    expect(indexSrc).toMatch(/app\.use\('\/admin',\s*requireAuth,\s*requireRole\(\['admin'\]\)/);
  });

  it('the orders endpoint lives on the admin router', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/admin.routes.js'), 'utf8');
    expect(routes).toMatch(/router\.get\('\/transactions',\s*listTransactions\)/);
  });

  it('rejects an anonymous request', async () => {
    const { requireAuth } = await import('../middleware/requireAuth.js');
    const res = mockRes();
    const next = vi.fn();
    await requireAuth({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a non-admin (customer / seller) request', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ role: 'customer' }] });
    const { requireRole } = await import('../middleware/requireRole.js');
    const res = mockRes();
    const next = vi.fn();
    await requireRole(['admin'])({ user: { id: 'cust-1' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// list + pagination
// ─────────────────────────────────────────────────────────────
describe('admin orders — list', () => {
  it('returns the real order rows with pagination metadata', async () => {
    const res = mockRes();
    await listTransactions(req(), res);
    const body = payload(res);
    expect(body.items).toHaveLength(3);
    expect(body.items[0]).toMatchObject({
      transaction_code: 'TXN-9009',
      customer: 'Britz Atasha',
      item: 'TEST 1',
      amount: 70500,
      branch: 'Gmall Branch',
      status: 'pending',
    });
    expect(body.pagination).toEqual({ page: 1, limit: 10, total: 9, total_pages: 1 });
  });

  it('paginates server-side with a whitelisted page size', async () => {
    const res = mockRes();
    await listTransactions(req({ page: '2', limit: '25' }), res);
    const body = payload(res);
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.limit).toBe(25);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).toMatch(/LIMIT \$\d+ OFFSET \$\d+/);
    expect(listCall[1]).toContain(25);
    expect(listCall[1]).toContain(25); // offset = (2 - 1) * 25
  });

  it('clamps an unsupported page size', async () => {
    const res = mockRes();
    await listTransactions(req({ limit: '9999' }), res);
    expect(payload(res).pagination.limit).toBe(10);
  });

  it('sorts by a whitelisted column only', async () => {
    const res = mockRes();
    await listTransactions(req({ sort: 'amount', order: 'desc' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).toMatch(/ORDER BY o\.amount DESC/);
    expect(payload(res).filters).toMatchObject({ sort: 'amount', order: 'desc' });
  });

  it('never interpolates an untrusted sort field into SQL', async () => {
    const res = mockRes();
    await listTransactions(req({ sort: 'created_at; DROP TABLE orders;--', order: 'asc; DELETE FROM orders' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).not.toMatch(/DROP TABLE/);
    expect(listCall[0]).not.toMatch(/DELETE FROM/);
    expect(listCall[0]).toMatch(/ORDER BY o\.created_at DESC/); // falls back to the default
    expect(payload(res).filters.sort).toBe('date');
  });
});

// ─────────────────────────────────────────────────────────────
// filters
// ─────────────────────────────────────────────────────────────
describe('admin orders — filters', () => {
  it('searches by transaction code, customer and item', async () => {
    const res = mockRes();
    await listTransactions(req({ search: '  TXN-9009  ' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).toMatch(/o\.transaction_code ILIKE \$\d+ OR u\.name ILIKE \$\d+ OR p\.name ILIKE \$\d+/);
    expect(listCall[1]).toContain('%TXN-9009%');
    expect(payload(res).filters.search).toBe('TXN-9009');
  });

  it('filters by branch id', async () => {
    const res = mockRes();
    await listTransactions(req({ branch_id: BRANCH_GMALL }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).toMatch(/o\.branch_id = \$\d+/);
    expect(listCall[1]).toContain(BRANCH_GMALL);
  });

  it('filters by a real order status', async () => {
    const res = mockRes();
    await listTransactions(req({ status: 'expired' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).toMatch(/o\.status = \$\d+/);
    expect(listCall[1]).toContain('expired');
  });

  it('ignores an unsupported status value', async () => {
    const res = mockRes();
    await listTransactions(req({ status: 'cancelled' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).not.toMatch(/o\.status = /);
  });

  it('filters by a date window on the order creation date', async () => {
    const res = mockRes();
    await listTransactions(req({ date_from: '2026-10-01T00:00:00.000Z', date_to: '2026-10-31T23:59:59.999Z' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).toMatch(/o\.created_at >= \$\d+/);
    expect(listCall[0]).toMatch(/o\.created_at <= \$\d+/);
    expect(listCall[1]).toContain('2026-10-01T00:00:00.000Z');
  });

  it('ignores an unparseable date', async () => {
    const res = mockRes();
    await listTransactions(req({ date_from: 'not-a-date' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).not.toMatch(/o\.created_at >= /);
  });
});

// ─────────────────────────────────────────────────────────────
// summary
// ─────────────────────────────────────────────────────────────
describe('admin orders — summary', () => {
  it('reports the real order-state counts', async () => {
    const res = mockRes();
    await listTransactions(req(), res);
    const body = payload(res);
    expect(body.summary).toMatchObject({
      total_orders: 9,
      pending: 3,
      preparing: 0,
      ready_pickup: 0,
      completed: 2,
      expired: 4,
    });
    expect(body.summary.status_counts).toMatchObject({
      all: 9, pending: 3, preparing: 0, ready_pickup: 0, completed: 2, expired: 4,
    });
  });

  it('uses the canonical recognized revenue rule (payments.status = paid)', async () => {
    const res = mockRes();
    await listTransactions(req(), res);
    const summaryCall = poolQuery.mock.calls.find(([sql]) => /total_sales/.test(sql));
    expect(summaryCall[0]).toMatch(/payments pay WHERE pay\.order_id = o\.id AND pay\.status = 'paid'/);
    expect(summaryCall[0]).toMatch(/SUM\(o\.amount\) FILTER/);
    expect(payload(res).summary.total_sales).toBe(137000);
    expect(payload(res).summary.paid_orders).toBe(2);
  });

  it('keeps the status breakdown independent of the status filter', async () => {
    const res = mockRes();
    await listTransactions(req({ status: 'pending' }), res);
    const summaryCall = poolQuery.mock.calls.find(([sql]) => /total_sales/.test(sql));
    expect(summaryCall[0]).not.toMatch(/o\.status = \$\d+/);
    expect(payload(res).summary.total_orders).toBe(9);
  });

  it('supports exactly the real order states', () => {
    expect(ORDER_STATUSES).toEqual(['pending', 'preparing', 'ready_pickup', 'completed', 'expired']);
    expect(ORDER_STATUSES).not.toContain('cancelled');
    expect(ORDER_STATUSES).not.toContain('processing');
  });
});
