// backend/src/tests/adminSecurityAlerts.test.js
// Admin → Security Alerts backend suite.
//
// Contract under test:
//  • The endpoints stay admin-only (anonymous 401, non-admin 403).
//  • The list is filtered / searched / sorted / paginated SERVER-SIDE with
//    parameterized SQL and a whitelisted sort map.
//  • The summary reports the REAL enum states (severity low/medium/high,
//    status new/investigating/resolved/dismissed) and the real counts.
//  • "Resolved this month" uses the only real timestamp available
//    (created_at — the table has no resolved_at column).
//  • Review status transitions are validated backend-side.
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

const {
  listAlerts, getAlert, updateAlert, ALERT_SEVERITIES, ALERT_STATUSES, ALERT_TRANSITIONS,
} = await import('../controllers/admin/security.controller.js');

const ADMIN = '00000000-0000-0000-0000-000000000004';
const ALERT_ID = '646ff462-6020-4467-a8e0-829345e3ea06';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
const req = (query = {}, params = {}, body = {}) => ({ query, params, body, user: { id: ADMIN } });
const payload = (res) => res.json.mock.calls[0]?.[0];

const ALERTS = [
  {
    id: ALERT_ID, user_id: 'u1', type: 'Rapid High-Value Bidding', severity: 'high', status: 'new',
    detail: '4+ bids in 60s', activity_trail: ['16:12:01 — Bid ₱52,000 on Rose Gold Bangle'],
    created_at: '2026-10-16T08:12:01.298Z', customer: 'britz Susada', total_count: 27,
  },
  {
    id: '861cb577-1111-2222-3333-444455556666', user_id: 'u2', type: 'Rapid High-Value Bidding',
    severity: 'high', status: 'resolved', detail: '4+ bids in 60s', activity_trail: [],
    created_at: '2026-10-14T04:40:59.051Z', customer: 'Maria Santos', total_count: 27,
  },
];

const SUMMARY_ROW = {
  total: 27,
  open_alerts: 25,
  high_severity: 27,
  medium_severity: 0,
  low_severity: 0,
  status_new: 25,
  status_investigating: 0,
  status_resolved: 1,
  status_dismissed: 1,
  resolved_this_month: 1,
  created_this_month: 27,
  created_last_month: 0,
  open_this_month: 25,
  open_last_month: 0,
  high_this_month: 27,
  high_last_month: 0,
  resolved_last_month: 0,
};

function defaultPool({ rows = ALERTS, summary = SUMMARY_ROW, count = 27, alertStatus = 'new' } = {}) {
  poolQuery.mockImplementation(async (sql, params = []) => {
    if (/COUNT\(\*\) OVER/.test(sql)) return { rows: rows.map((r) => ({ ...r, total_count: count })) };
    if (/COUNT\(\*\)::int AS total\b/.test(sql) && !/AS total,/.test(sql)) return { rows: [{ total: count }] };
    if (/AS total,/.test(sql)) return { rows: [summary] };
    if (/SELECT id, status, user_id FROM security_alerts/.test(sql)) {
      return { rows: [{ id: ALERT_ID, status: alertStatus, user_id: '11111111-1111-1111-1111-111111111111' }] };
    }
    if (/UPDATE security_alerts SET status/.test(sql)) {
      const status = params?.[0] || 'new';
      return { rows: [{ id: ALERT_ID, user_id: 'u1', type: 'Rapid High-Value Bidding', severity: 'high', status, detail: 'd', activity_trail: [], created_at: '2026-10-16T08:12:01.298Z' }] };
    }
    if (/SELECT id, name, email, role, status FROM users/.test(sql)) {
      return { rows: [{ id: 'u1', name: 'britz Susada', email: 'b@e.com', role: 'customer', status: 'active' }] };
    }
    // ── shared account-status service (suspension) ──
    if (/SELECT id, role, status FROM users WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: 'u1', role: 'customer', status: 'active' }] };
    }
    if (/SELECT count\(\*\)::int AS c FROM users WHERE role = 'admin'/.test(sql)) return { rows: [{ c: 1 }] };
    if (/UPDATE users SET status = \$1 WHERE id = \$2/.test(sql)) {
      return { rows: [{ id: 'u1', name: 'Maria Santos', email: 'm@e.com', role: 'customer', status: 'suspended' }] };
    }
    if (/audit_logs/.test(sql)) return { rows: [] };
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
describe('admin security alerts — authorization', () => {
  it('the admin router stays behind requireAuth + requireRole(admin)', () => {
    const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    expect(indexSrc).toMatch(/app\.use\('\/admin',\s*requireAuth,\s*requireRole\(\['admin'\]\)/);
  });

  it('the security alert endpoints stay mounted on the admin router', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/admin.routes.js'), 'utf8');
    expect(routes).toMatch(/router\.get\('\/security-alerts',\s*listAlerts\)/);
    expect(routes).toMatch(/router\.patch\('\/security-alerts\/:id',\s*updateAlert\)/);
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
// list
// ─────────────────────────────────────────────────────────────
describe('admin security alerts — list', () => {
  it('returns the real alert rows with pagination metadata', async () => {
    const res = mockRes();
    await listAlerts(req(), res);
    const body = payload(res);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      id: ALERT_ID,
      type: 'Rapid High-Value Bidding',
      severity: 'high',
      status: 'new',
      customer: 'britz Susada',
    });
    expect(body.pagination).toEqual({ page: 1, limit: 10, total: 27, total_pages: 3 });
  });

  it('paginates server-side', async () => {
    const res = mockRes();
    await listAlerts(req({ page: '2', limit: '25' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).toMatch(/LIMIT \$\d+ OFFSET \$\d+/);
    expect(listCall[1]).toContain(25);
  });

  it('searches by alert id, customer name and alert type', async () => {
    const res = mockRes();
    await listAlerts(req({ search: '  646ff462 ' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).toMatch(/a\.id::text ILIKE \$\d+ OR u\.name ILIKE \$\d+ OR a\.type ILIKE \$\d+/);
    expect(listCall[1]).toContain('%646ff462%');
    expect(payload(res).filters.search).toBe('646ff462');
  });

  it('filters by severity', async () => {
    const res = mockRes();
    await listAlerts(req({ severity: 'high' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).toMatch(/a\.severity = \$\d+/);
    expect(listCall[1]).toContain('high');
  });

  it('filters by status', async () => {
    const res = mockRes();
    await listAlerts(req({ status: 'investigating' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).toMatch(/a\.status = \$\d+/);
    expect(listCall[1]).toContain('investigating');
  });

  it('ignores an unsupported severity or status value', async () => {
    const res = mockRes();
    await listAlerts(req({ severity: 'critical', status: 'cancelled' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).not.toMatch(/a\.severity = /);
    expect(listCall[0]).not.toMatch(/a\.status = /);
  });

  it('filters by the alert detected timestamp', async () => {
    const res = mockRes();
    await listAlerts(req({ date_from: '2026-10-01T00:00:00.000Z', date_to: '2026-10-31T23:59:59.999Z' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).toMatch(/a\.created_at >= \$\d+/);
    expect(listCall[0]).toMatch(/a\.created_at <= \$\d+/);
  });

  it('sorts only by whitelisted columns', async () => {
    const res = mockRes();
    await listAlerts(req({ sort: 'detected', order: 'asc' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).toMatch(/ORDER BY a\.created_at ASC/);
  });

  it('never interpolates an untrusted sort field into SQL', async () => {
    const res = mockRes();
    await listAlerts(req({ sort: 'created_at; DROP TABLE security_alerts;--', order: 'asc; DELETE FROM security_alerts' }), res);
    const listCall = poolQuery.mock.calls.find(([sql]) => /COUNT\(\*\) OVER/.test(sql));
    expect(listCall[0]).not.toMatch(/DROP TABLE/);
    expect(listCall[0]).not.toMatch(/DELETE FROM/);
    expect(payload(res).filters.sort).toBe('detected');
  });
});

// ─────────────────────────────────────────────────────────────
// summary
// ─────────────────────────────────────────────────────────────
describe('admin security alerts — summary', () => {
  it('reports the real KPI + breakdown counts', async () => {
    const res = mockRes();
    await listAlerts(req(), res);
    const summary = payload(res).summary;
    expect(summary.total).toBe(27);
    expect(summary.open).toBe(25);
    expect(summary.high).toBe(27);
    expect(summary.medium).toBe(0);
    expect(summary.low).toBe(0);
    expect(summary.resolved_this_month).toBe(1);
    expect(summary.severity_counts).toMatchObject({ all: 27, high: 27, medium: 0, low: 0 });
    expect(summary.status_counts).toMatchObject({ all: 27, new: 25, investigating: 0, resolved: 1, dismissed: 1 });
  });

  it('counts resolved-this-month from the real created_at timestamp', async () => {
    const res = mockRes();
    await listAlerts(req(), res);
    const summaryCall = poolQuery.mock.calls.find(([sql]) => /resolved_this_month/.test(sql));
    expect(summaryCall[0]).toMatch(/date_trunc\('month', NOW\(\)\)/);
    expect(summaryCall[0]).toMatch(/a\.status = 'resolved'/);
  });

  it('keeps the severity + status breakdown independent of those filters', async () => {
    const res = mockRes();
    await listAlerts(req({ severity: 'high', status: 'new' }), res);
    const summaryCall = poolQuery.mock.calls.find(([sql]) => /resolved_this_month/.test(sql));
    expect(summaryCall[0]).not.toMatch(/a\.severity = \$\d+/);
    expect(summaryCall[0]).not.toMatch(/a\.status = \$\d+/);
    expect(payload(res).summary.total).toBe(27);
  });

  it('omits a month-over-month percentage when there is no comparable base', async () => {
    const res = mockRes();
    await listAlerts(req(), res);
    const trends = payload(res).summary.trends;
    // No alerts in the previous month → no honest percentage.
    expect(trends.total).toBeNull();
    expect(trends.open).toBeNull();
  });

  it('computes a real month-over-month percentage when a base exists', async () => {
    defaultPool({
      summary: { ...SUMMARY_ROW, created_last_month: 20, created_this_month: 27 },
    });
    const res = mockRes();
    await listAlerts(req(), res);
    expect(payload(res).summary.trends.total).toMatchObject({ pct: 35, direction: 'up' });
  });

  it('supports exactly the real enum values', () => {
    expect(ALERT_SEVERITIES).toEqual(['low', 'medium', 'high']);
    expect(ALERT_STATUSES).toEqual(['new', 'investigating', 'resolved', 'dismissed']);
    expect(ALERT_STATUSES).not.toContain('under_review');
  });
});

// ─────────────────────────────────────────────────────────────
// alert detail (review dialog)
// ─────────────────────────────────────────────────────────────
describe('admin security alerts — detail', () => {
  const DETAIL_ROW = {
    id: ALERT_ID,
    user_id: 'u1',
    type: 'Rapid High-Value Bidding',
    severity: 'high',
    status: 'new',
    detail: '4+ bids in 60s',
    activity_trail: ['12:38:29 — Bid ₱24,000 on QA Multi-Role Diamond Ring'],
    created_at: '2026-10-14T04:38:29.000Z',
    customer_name: 'Maria Santos',
    customer_email: 'maria.santos@example.com',
    customer_role: 'customer',
    customer_status: 'active',
  };

  const RELATED_ROW = {
    bid_id: 'bid-1',
    amount: 24000,
    bid_created_at: '2026-10-14T04:38:29.000Z',
    flag_reason: 'rapid bidding activity',
    auction_id: 'auction-1',
    auction_code: 'AUC-00234',
    current_bid: 24000,
    product_id: 'product-1',
    product_name: 'QA Multi-Role Diamond Ring',
    image_url: 'https://cdn.test/ring.png',
    category: 'Rings',
    branch_id: 'branch-1',
    branch_name: 'QA Branch',
  };

  const ACTIVITY_ROWS = [
    { created_at: '2026-10-14T04:38:29.000Z', amount: 24000, flagged: true, product_name: 'QA Multi-Role Diamond Ring' },
    { created_at: '2026-10-14T04:38:27.000Z', amount: 23000, flagged: false, product_name: 'QA Multi-Role Diamond Ring' },
  ];

  function detailPool({ detail = DETAIL_ROW, related = RELATED_ROW, activity = ACTIVITY_ROWS } = {}) {
    poolQuery.mockImplementation(async (sql, params = []) => {
      if (/FROM security_alerts a\s+LEFT JOIN users/.test(sql)) return { rows: detail ? [detail] : [] };
      if (/ORDER BY b\.flagged DESC/.test(sql)) return { rows: related ? [related] : [] };
      if (/FROM bids b/.test(sql) && /JOIN products p/.test(sql)) return { rows: activity };
      if (/SELECT id, status, user_id FROM security_alerts/.test(sql)) {
        return { rows: [{ id: ALERT_ID, status: 'new', user_id: 'u1' }] };
      }
      if (/UPDATE security_alerts SET status/.test(sql)) {
        return { rows: [{ ...detail, status: params?.[0] || 'new' }] };
      }
      if (/SELECT id, name, email, role, status FROM users/.test(sql)) {
        return { rows: [{ id: 'u1', name: 'Maria Santos', email: 'maria.santos@example.com', role: 'customer', status: 'active' }] };
      }
      return { rows: [] };
    });
  }

  it('returns the alert with the real customer, related item and activity', async () => {
    detailPool();
    const res = mockRes();
    await getAlert(req({}, { id: ALERT_ID }), res);
    const body = payload(res);
    expect(body.id).toBe(ALERT_ID);
    expect(body.type).toBe('Rapid High-Value Bidding');
    expect(body.severity).toBe('high');
    expect(body.status).toBe('new');
    expect(body.detail).toBe('4+ bids in 60s');
    expect(body.customer).toMatchObject({ id: 'u1', name: 'Maria Santos', email: 'maria.santos@example.com', role: 'customer' });
    expect(body.related).toMatchObject({
      auction_code: 'AUC-00234',
      product_name: 'QA Multi-Role Diamond Ring',
      branch_name: 'QA Branch',
    });
    expect(body.activity_count).toBe(1);
    // The activity comes from the alert's OWN evidence (the fraud engine trail).
    expect(body.activity[0]).toMatchObject({ time: '12:38:29', action: 'Bid', amount: 24000, item: 'QA Multi-Role Diamond Ring' });
  });

  it('falls back to the real bids of the related auction when the alert has no trail', async () => {
    detailPool({ detail: { ...DETAIL_ROW, activity_trail: [] } });
    const res = mockRes();
    await getAlert(req({}, { id: ALERT_ID }), res);
    const body = payload(res);
    expect(body.activity_count).toBe(2);
    expect(body.activity[0]).toMatchObject({ action: 'Bid', amount: 24000, item: 'QA Multi-Role Diamond Ring', flagged: true });
  });

  it('joins the customer, auction, product and branch in set-based queries (no N+1)', async () => {
    detailPool();
    const res = mockRes();
    await getAlert(req({}, { id: ALERT_ID }), res);
    const detailCall = poolQuery.mock.calls.find(([sql]) => /FROM security_alerts a/.test(sql));
    expect(detailCall[0]).toMatch(/LEFT JOIN users u ON u\.id = a\.user_id/);
    const relatedCall = poolQuery.mock.calls.find(([sql]) => /ORDER BY b\.flagged DESC/.test(sql));
    expect(relatedCall[0]).toMatch(/JOIN auctions au ON au\.id = b\.auction_id/);
    expect(relatedCall[0]).toMatch(/JOIN products p ON p\.id = au\.product_id/);
    expect(relatedCall[0]).toMatch(/LEFT JOIN branches br ON br\.id = s\.home_branch_id/);
    // One detail query + one related query + one activity query (fixed count).
    expect(poolQuery.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('404s an unknown alert', async () => {
    detailPool({ detail: null });
    const res = mockRes();
    await getAlert(req({}, { id: 'missing' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('falls back to the alert activity metadata when there is no related bid', async () => {
    detailPool({ related: null, activity: [] });
    const res = mockRes();
    await getAlert(req({}, { id: ALERT_ID }), res);
    const body = payload(res);
    expect(body.related).toBeNull();
    expect(body.activity_count).toBe(1);
    expect(body.activity[0]).toMatchObject({ time: '12:38:29', action: 'Bid', amount: 24000, item: 'QA Multi-Role Diamond Ring' });
  });
});

// ─────────────────────────────────────────────────────────────
// review / status transitions
// ─────────────────────────────────────────────────────────────
describe('admin security alerts — review', () => {
  it('allows a valid transition (new → investigating)', async () => {
    const res = mockRes();
    await updateAlert(req({}, { id: ALERT_ID }, { status: 'investigating' }), res);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(payload(res).status).toBe('investigating');
  });

  it('allows the documented transitions', () => {
    expect(ALERT_TRANSITIONS.new).toEqual(expect.arrayContaining(['investigating', 'resolved', 'dismissed']));
    expect(ALERT_TRANSITIONS.investigating).toEqual(expect.arrayContaining(['resolved', 'dismissed']));
    expect(ALERT_TRANSITIONS.resolved).not.toContain('dismissed');
  });

  it('rejects an unsupported status value', async () => {
    const res = mockRes();
    await updateAlert(req({}, { id: ALERT_ID }, { status: 'banished' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects an invalid transition', async () => {
    defaultPool({ alertStatus: 'resolved' });
    const res = mockRes();
    await updateAlert(req({}, { id: ALERT_ID }, { status: 'dismissed' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(payload(res).message).toMatch(/Invalid transition/);
  });

  it('404s an unknown alert', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/SELECT id, status, user_id FROM security_alerts/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const res = mockRes();
    await updateAlert(req({}, { id: 'missing' }, { status: 'resolved' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rejects an invalid suspendUserId', async () => {
    const res = mockRes();
    await updateAlert(req({}, { id: ALERT_ID }, { status: 'new', suspendUserId: 'not-a-uuid' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(payload(res).message).toMatch(/does not match this alert/i);
  });

  it('refuses to suspend a user that is not the alert customer', async () => {
    const res = mockRes();
    await updateAlert(req({}, { id: ALERT_ID }, { status: 'new', suspendUserId: '22222222-2222-2222-2222-222222222222' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(payload(res).message).toMatch(/does not match this alert/i);
  });

  it('suspends the customer through the shared account-status service', async () => {
    const res = mockRes();
    await updateAlert(req({}, { id: ALERT_ID }, { status: 'new', suspendUserId: '11111111-1111-1111-1111-111111111111' }), res);
    expect(res.status).not.toHaveBeenCalledWith(400);
    // The suspension runs through the shared users UPDATE (not a private one).
    expect(poolQuery.mock.calls.some(([sql]) => /UPDATE users SET status = \$1 WHERE id = \$2/.test(sql))).toBe(true);
    // …and it is audited.
    expect(poolQuery.mock.calls.some(([sql]) => /audit_logs/.test(sql))).toBe(true);
    expect(payload(res).suspended_user).toMatchObject({ status: 'suspended' });
  });

  it('does not change the alert status when only a suspension is requested', async () => {
    const res = mockRes();
    await updateAlert(req({}, { id: ALERT_ID }, { status: 'new', suspendUserId: '11111111-1111-1111-1111-111111111111' }), res);
    expect(payload(res).status).toBe('new');
  });

  it('audits the alert status transition', async () => {
    const res = mockRes();
    await updateAlert(req({}, { id: ALERT_ID }, { status: 'investigating' }), res);
    const auditCall = poolQuery.mock.calls.find(([sql]) => /audit_logs/.test(sql));
    expect(auditCall).toBeTruthy();
    expect(auditCall[1]).toEqual(expect.arrayContaining(['security_alert_investigating', 'security_alert', ALERT_ID]));
  });
});
