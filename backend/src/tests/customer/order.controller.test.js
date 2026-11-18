import { describe, test, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.hoisted(() => vi.fn());
const poolConnect = vi.hoisted(() => vi.fn());
vi.mock('../../db/pool.js', () => ({
  pool: { query: poolQuery, connect: poolConnect },
}));

import { cancelOrder } from '../../controllers/customer/order.controller.js';

const BUYER = 'buyer-1';
const OTHER_USER = 'user-other';

function mockRes() {
  const r = {};
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  return r;
}

function orderRow(over = {}) {
  return {
    id: 'o1', auction_id: 'a1', buyer_id: BUYER, amount: 71000, status: 'pending',
    branch_id: 'br1', payment_method: null, created_at: '2026-10-11T02:24:00Z',
    transaction_code: 'TXN-9009', ...over,
  };
}

let activeOperation;
function makeClient() {
  const query = vi.fn(async (sql, params = []) => {
    if (/INSERT INTO payment_operations/.test(sql)) { activeOperation=params[0]; return {rows:[]}; }
    if (/SELECT \* FROM payment_operations/.test(sql)) return {rows:[]};
    if (/SELECT id FROM payment_operations/.test(sql)) return {rows:[{id:activeOperation}]};
    if (/UPDATE payment_operations/.test(sql)) return {rows:[]};
    return poolQuery(sql,params);
  });
  const release = vi.fn();
  return { query, release };
}

function seed({ order = orderRow(), payments = [] } = {}) {
  let orderState = { ...order };
  let paymentRows = [...payments];
  poolQuery.mockImplementation(async (sql, params = []) => {
    const s = String(sql);
    if (/^\s*BEGIN/i.test(s)) return { rows: [], rowCount: 0 };
    if (/^\s*COMMIT/i.test(s)) return { rows: [], rowCount: 0 };
    if (/^\s*ROLLBACK/i.test(s)) return { rows: [], rowCount: 0 };
    if (/SELECT \* FROM orders WHERE id=\$1 FOR UPDATE/.test(s))
      return { rows: [{ ...orderState }] };
    if (/FROM payments WHERE order_id=\$1/.test(s))
      return { rows: paymentRows.filter((p) => p.status === 'paid' || p.status === 'processing') };
    if (/UPDATE\s+orders\s+SET\s+status='cancelled'/.test(s)) {
      orderState.status = 'cancelled';
      orderState.cancellation_reason = params[1];
      orderState.cancelled_at = new Date().toISOString();
      orderState.cancelled_by = BUYER;
      return { rows: [{ id: 'o1', status: 'cancelled', cancellation_reason: params[1], cancelled_at: orderState.cancelled_at, cancelled_by: BUYER }] };
    }
    if (/INSERT INTO audit_logs/.test(s)) return { rows: [] };
    return { rows: [] };
  });
  return { orderState, paymentRows };
}

beforeEach(() => {
  poolQuery.mockReset();
  poolConnect.mockReset();
  poolConnect.mockResolvedValue(makeClient());
});

describe('PATCH /customer/orders/:id/cancel — Customer cancellation', () => {
  test('successful cancellation of eligible pending order', async () => {
    seed({ order: orderRow({ status: 'pending' }), payments: [] });
    const res = mockRes();
    await cancelOrder({ user: { id: BUYER }, params: { id: 'o1' }, body: { reason: 'Changed my mind' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].status).toBe('cancelled');
    expect(res.json.mock.calls[0][0].cancellation_reason).toBe('Changed my mind');
    expect(res.json.mock.calls[0][0].cancelled_by).toBe(BUYER);
    const updateCall = poolQuery.mock.calls.find(([sql]) => /UPDATE\s+orders\s+SET\s+status='cancelled'/.test(String(sql)));
    expect(updateCall).toBeTruthy();
    expect(updateCall[0]).toMatch(/WHERE id=\$1/);
    expect(updateCall[1]).toEqual(['o1', 'Changed my mind', BUYER]);
  });

  test('empty cancellation reason rejected with 400', async () => {
    const res = mockRes();
    await cancelOrder({ user: { id: BUYER }, params: { id: 'o1' }, body: { reason: '' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('CANCELLATION_REASON_REQUIRED');
    expect(poolQuery.mock.calls.some(([sql]) => /cancellation_reason/.test(String(sql)))).toBe(false);
  });

  test('whitespace-only cancellation reason rejected with 400', async () => {
    const res = mockRes();
    await cancelOrder({ user: { id: BUYER }, params: { id: 'o1' }, body: { reason: '   ' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('CANCELLATION_REASON_REQUIRED');
  });

  test('paid payment blocks cancellation', async () => {
    poolQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (/^\s*BEGIN/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*COMMIT/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*ROLLBACK/i.test(s)) return { rows: [], rowCount: 0 };
      if (/SELECT \* FROM orders WHERE id=\$1 FOR UPDATE/.test(s))
        return { rows: [{ id: 'o1', auction_id: 'a1', buyer_id: BUYER, amount: 71000, status: 'pending', branch_id: 'br1', payment_method: null, created_at: '2026-10-11T02:24:00Z', transaction_code: 'TXN-9009' }] };
      if (/FROM payments WHERE order_id=\$1/.test(s))
        return { rows: [{ status: 'paid' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await cancelOrder({ user: { id: BUYER }, params: { id: 'o1' }, body: { reason: 'Changed my mind' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('PAYMENT_NOT_CANCELLABLE');
    expect(poolQuery.mock.calls.some(([sql]) => /cancellation_reason/.test(String(sql)))).toBe(false);
  });

  test('processing payment blocks cancellation', async () => {
    poolQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (/^\s*BEGIN/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*COMMIT/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*ROLLBACK/i.test(s)) return { rows: [], rowCount: 0 };
      if (/SELECT \* FROM orders WHERE id=\$1 FOR UPDATE/.test(s))
        return { rows: [{ id: 'o1', auction_id: 'a1', buyer_id: BUYER, amount: 71000, status: 'pending', branch_id: 'br1', payment_method: null, created_at: '2026-10-11T02:24:00Z', transaction_code: 'TXN-9009' }] };
      if (/FROM payments WHERE order_id=\$1/.test(s))
        return { rows: [{ status: 'processing' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await cancelOrder({ user: { id: BUYER }, params: { id: 'o1' }, body: { reason: 'Changed my mind' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('PAYMENT_NOT_CANCELLABLE');
    expect(poolQuery.mock.calls.some(([sql]) => /cancellation_reason/.test(String(sql)))).toBe(false);
  });

  test('non-pending order cannot be cancelled', async () => {
    poolQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (/^\s*BEGIN/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*COMMIT/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*ROLLBACK/i.test(s)) return { rows: [], rowCount: 0 };
      if (/SELECT \* FROM orders WHERE id=\$1 FOR UPDATE/.test(s))
        return { rows: [{ id: 'o1', auction_id: 'a1', buyer_id: BUYER, amount: 71000, status: 'completed', branch_id: 'br1', payment_method: null, created_at: '2026-10-11T02:24:00Z', transaction_code: 'TXN-9009' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await cancelOrder({ user: { id: BUYER }, params: { id: 'o1' }, body: { reason: 'Changed my mind' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('ORDER_NOT_CANCELLABLE');
    expect(poolQuery.mock.calls.some(([sql]) => /cancellation_reason/.test(String(sql)))).toBe(false);
  });

  test('already cancelled order rejected with 409', async () => {
    poolQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (/^\s*BEGIN/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*COMMIT/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*ROLLBACK/i.test(s)) return { rows: [], rowCount: 0 };
      if (/SELECT \* FROM orders WHERE id=\$1 FOR UPDATE/.test(s))
        return { rows: [{ id: 'o1', auction_id: 'a1', buyer_id: BUYER, amount: 71000, status: 'cancelled', branch_id: 'br1', payment_method: null, created_at: '2026-10-11T02:24:00Z', transaction_code: 'TXN-9009' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await cancelOrder({ user: { id: BUYER }, params: { id: 'o1' }, body: { reason: 'Duplicate' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('ALREADY_CANCELLED');
    expect(poolQuery.mock.calls.some(([sql]) => /cancellation_reason/.test(String(sql)))).toBe(false);
  });

  test('foreign customer order → 403 and no cancellation UPDATE', async () => {
    poolQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (/^\s*BEGIN/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*COMMIT/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*ROLLBACK/i.test(s)) return { rows: [], rowCount: 0 };
      if (/SELECT \* FROM orders WHERE id=\$1 FOR UPDATE/.test(s))
        return { rows: [{ id: 'o1', auction_id: 'a1', buyer_id: OTHER_USER, amount: 71000, status: 'pending', branch_id: 'br1', payment_method: null, created_at: '2026-10-11T02:24:00Z', transaction_code: 'TXN-9009' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await cancelOrder({ user: { id: BUYER }, params: { id: 'o1' }, body: { reason: 'Changed my mind' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('ORDER_NOT_FOUND');
    expect(poolQuery.mock.calls.some(([sql]) => /cancellation_reason/.test(String(sql)))).toBe(false);
  });

  test('transaction begins and commits on success', async () => {
    poolQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (/^\s*BEGIN/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*COMMIT/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*ROLLBACK/i.test(s)) return { rows: [], rowCount: 0 };
      if (/SELECT \* FROM orders WHERE id=\$1 FOR UPDATE/.test(s))
        return { rows: [{ id: 'o1', auction_id: 'a1', buyer_id: BUYER, amount: 71000, status: 'pending', branch_id: 'br1', payment_method: null, created_at: '2026-10-11T02:24:00Z', transaction_code: 'TXN-9009' }] };
      if (/FROM payments WHERE order_id=\$1/.test(s)) return { rows: [] };
      if (/UPDATE\s+orders\s+SET\s+status='cancelled'/.test(s))
        return { rows: [{ id: 'o1', status: 'cancelled', cancellation_reason: 'Changed my mind', cancelled_at: new Date().toISOString(), cancelled_by: BUYER }] };
      if (/INSERT INTO audit_logs/.test(s)) return { rows: [] };
      return { rows: [] };
    });
    const res = mockRes();
    await cancelOrder({ user: { id: BUYER }, params: { id: 'o1' }, body: { reason: 'Changed my mind' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const beginCalls = poolQuery.mock.calls.filter(([sql]) => /^\s*BEGIN/i.test(String(sql)));
    const commitCalls = poolQuery.mock.calls.filter(([sql]) => /^\s*COMMIT/i.test(String(sql)));
    expect(beginCalls).toHaveLength(2);
    expect(commitCalls).toHaveLength(2);
    const beginIdx = poolQuery.mock.calls.findIndex(([sql]) => /^\s*BEGIN/i.test(String(sql)));
    const updateIdx = poolQuery.mock.calls.findIndex(([sql]) => /UPDATE\s+orders\s+SET\s+status='cancelled'/.test(String(sql)));
    expect(beginIdx).toBeLessThan(updateIdx);
    const commitIdx = poolQuery.mock.calls.findLastIndex(([sql]) => /^\s*COMMIT/i.test(String(sql)));
    expect(commitIdx).toBeGreaterThan(updateIdx);
  });

  test('transaction rolls back on failure', async () => {
    poolQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (/^\s*BEGIN/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*COMMIT/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*ROLLBACK/i.test(s)) return { rows: [], rowCount: 0 };
      if (/SELECT \* FROM orders WHERE id=\$1 FOR UPDATE/.test(s))
        return { rows: [{ id: 'o1', auction_id: 'a1', buyer_id: BUYER, amount: 71000, status: 'pending', branch_id: 'br1', payment_method: null, created_at: '2026-10-11T02:24:00Z', transaction_code: 'TXN-9009' }] };
      if (/FROM payments WHERE order_id=\$1/.test(s)) return { rows: [] };
      if (/UPDATE\s+orders\s+SET\s+status='cancelled'/.test(s)) return { rows: [] };
      return { rows: [] };
    });
    const res = mockRes();
    await cancelOrder({ user: { id: BUYER }, params: { id: 'o1' }, body: { reason: 'Changed my mind' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    const beginCalls = poolQuery.mock.calls.filter(([sql]) => /^\s*BEGIN/i.test(String(sql)));
    const rollbackCalls = poolQuery.mock.calls.filter(([sql]) => /^\s*ROLLBACK/i.test(String(sql)));
    expect(beginCalls).toHaveLength(3);
    expect(rollbackCalls).toHaveLength(1);
  });

  test('database client released after completion', async () => {
    const mockClient = makeClient();
    poolConnect.mockResolvedValue(mockClient);
    seed({ order: orderRow({ status: 'pending' }), payments: [] });
    const res = mockRes();
    await cancelOrder({ user: { id: BUYER }, params: { id: 'o1' }, body: { reason: 'Changed my mind' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockClient.release).toHaveBeenCalledTimes(2);
  });

  test('sequential duplicate cancellation is rejected', async () => {
    let orderState = { id: 'o1', auction_id: 'a1', buyer_id: BUYER, amount: 71000, status: 'pending', branch_id: 'br1', payment_method: null, created_at: '2026-10-11T02:24:00Z', transaction_code: 'TXN-9009' };
    poolQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (/^\s*BEGIN/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*COMMIT/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^\s*ROLLBACK/i.test(s)) return { rows: [], rowCount: 0 };
      if (/SELECT \* FROM orders WHERE id=\$1 FOR UPDATE/.test(s)) return { rows: [{ ...orderState }] };
      if (/FROM payments WHERE order_id=\$1/.test(s)) return { rows: [] };
      if (/UPDATE\s+orders\s+SET\s+status='cancelled'/.test(s)) {
        orderState.status = 'cancelled';
        return { rows: [{ id: 'o1', status: 'cancelled', cancellation_reason: params[1], cancelled_at: new Date().toISOString(), cancelled_by: BUYER }] };
      }
      if (/INSERT INTO audit_logs/.test(s)) return { rows: [] };
      return { rows: [] };
    });
    const res1 = mockRes();
    const res2 = mockRes();
    await cancelOrder({ user: { id: BUYER }, params: { id: 'o1' }, body: { reason: 'First cancel' } }, res1);
    expect(res1.status).toHaveBeenCalledWith(200);
    await cancelOrder({ user: { id: BUYER }, params: { id: 'o1' }, body: { reason: 'Second cancel' } }, res2);
    expect(res2.status).toHaveBeenCalledWith(409);
    expect(res2.json.mock.calls[0][0].code).toBe('ALREADY_CANCELLED');
  });
});
