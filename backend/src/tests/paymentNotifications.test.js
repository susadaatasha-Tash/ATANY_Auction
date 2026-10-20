import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the pool with an in-memory router so no test touches a real database.
vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn(), on: () => {} },
  isDirectPg: () => true,
}));
vi.mock('../services/emailService.js', () => ({
  sendNotificationEmail: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../services/paymongoService.js', () => ({
  // Same module that controllers/customer/payment.controller.js imports.
  createPayMongoCheckout: vi.fn(async () => ({ checkoutId: 'cs_test', checkoutUrl: 'https://pay.test/cs' })),
  getCheckoutSession: vi.fn(async () => ({})),
  checkoutStatus: vi.fn(() => 'pending'),
  verifyWebhookSignature: vi.fn(() => true),
}));

import { pool } from '../db/pool.js';
import { closeExpiredAuctions } from '../services/auctionCloser.js';
import { sendPaymentReminders } from '../services/paymentReminder.js';
import { checkAndExpireWinners } from '../services/winnerExpiration.js';
import { createCheckout } from '../controllers/customer/payment.controller.js';

const DAY = 24 * 60 * 60 * 1000;
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();

const BUYER_A = '11111111-1111-1111-1111-111111111111';
const BUYER_B = '22222222-2222-2222-2222-222222222222';
const AUCTION = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORDER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

// In-memory notification store so duplicate-cron behaviour is observable.
let notifStore;
function notifRowsFor(userId) {
  return notifStore.filter((n) => n.user_id === userId);
}

beforeEach(() => {
  vi.clearAllMocks();
  notifStore = [];
  const client = {
    query: (...args) => pool.query(...args),
    release: vi.fn(),
  };
  pool.connect.mockImplementation(async () => client);
  pool.query.mockImplementation(async (sql, params = []) => {
    // Notification reads answer from the in-memory store (idempotency checks).
    if (/FROM notifications/i.test(sql)) {
      const rows = notifStore.filter((n) => {
        if (params[0] && n.user_id !== params[0]) return false;
        return true;
      });
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function captureInserts() {
  // Params follow $N placeholders: $1=user_id, then message, then optional
  // auction_id ('auction'/'payout' are inline SQL literals, not params).
  return pool.query.mock.calls
    .filter(([sql]) => /^INSERT INTO notifications/i.test(sql.trim()))
    .map(([sql, params = []]) => {
      const typeM = sql.match(/'(auction|payout|chatbot|seller_application|promotion)'/i);
      const rest = params.slice(1);
      return {
        user_id: params[0],
        type: typeM ? typeM[1] : null,
        message: rest.find((p) => typeof p === 'string' && !UUID_RE.test(p)) ?? '',
        auction_id: rest.find((p) => typeof p === 'string' && UUID_RE.test(p)) ?? null,
      };
    });
}

async function persistCapturedInserts() {
  // Mirror inserts into the store so a second cron run sees them (duplicate test).
  for (const n of captureInserts()) {
    if (!notifStore.some((s) => s.user_id === n.user_id && s.message === n.message)) {
      notifStore.push({ ...n, created_at: new Date().toISOString() });
    }
  }
}

describe('customer payment notifications (7-day lifecycle)', () => {
  test('1. initial winner notification includes 7-day deadline + correct refs', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      if (/FROM notifications/i.test(sql)) return { rows: [], rowCount: 0 };
      // H2 atomic auction close claim
      if (/UPDATE auctions SET status = 'ended'/i.test(sql)) {
        return { rows: [{ id: params[0] }], rowCount: 1 };
      }
      if (/BEGIN|COMMIT|ROLLBACK/i.test(sql.trim())) return { rows: [], rowCount: 0 };
      if (/FROM auctions WHERE status/i.test(sql)) {
        return { rows: [{ id: AUCTION }] };
      }
      if (/FROM bids WHERE auction_id/i.test(sql)) {
        return { rows: [{ user_id: BUYER_A, amount: 20000, created_at: isoAgo(2 * DAY) }] };
      }
      if (/FROM orders WHERE auction_id/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO orders/i.test(sql)) {
        return { rows: [{ id: ORDER }] };
      }
      if (/FROM orders WHERE id/i.test(sql)) {
        return {
          rows: [{
            id: ORDER, auction_id: AUCTION, buyer_id: BUYER_A, amount: 20000,
            branch_id: null, status: 'pending', transaction_code: 'TXN-9001',
            created_at: isoAgo(DAY),
          }],
        };
      }
      if (/FROM users WHERE id/i.test(sql)) return { rows: [{ email: 'a@test.ph', name: 'Winner A' }] };
      if (/FROM auctions WHERE id/i.test(sql)) return { rows: [{ auction_code: 'A-1', product_id: 'p1' }] };
      if (/FROM products WHERE id/i.test(sql)) return { rows: [{ name: 'Gold Ring', image_url: null }] };
      if (/FROM shops WHERE id/i.test(sql)) return { rows: [{ user_id: 'shop-1', shop_name: 'Shop' }] };
      if (/SELECT shop_id FROM products/i.test(sql)) return { rows: [{ shop_id: 'shop-1' }] };
      if (/FROM users WHERE role/i.test(sql)) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    await closeExpiredAuctions();
    const inserts = captureInserts().filter((n) => n.user_id === BUYER_A && /You won/.test(n.message));
    expect(inserts.length).toBe(1);
    expect(inserts[0].message).toMatch(/7 days/);
    expect(inserts[0].message).toMatch(/TXN-9001/);
    expect(inserts[0].auction_id).toBe(AUCTION);
    expect(inserts[0].type).toBe('auction');
  });

  test('2/3/4. 3-day, 1-day and 6-hour reminders fire with markers', async () => {
    const mkOrder = (ageMs, id) => ({
      id, auction_id: AUCTION, buyer_id: BUYER_A, amount: 20000,
      status: 'pending', transaction_code: 'TXN-9001', created_at: isoAgo(ageMs),
    });
    // Ages chosen so msLeft lands INSIDE each 60-min stage window.
    const orders = [
      mkOrder(4 * DAY + 30 * 60 * 1000, 'o3d'),
      mkOrder(6 * DAY + 30 * 60 * 1000, 'o1d'),
      mkOrder(7 * DAY - 5.5 * 60 * 60 * 1000, 'o6h'),
    ];
    pool.query.mockImplementation(async (sql, params = []) => {
      if (/FROM notifications/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM orders WHERE status/i.test(sql)) return { rows: orders };
      if (/FROM payments/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM auctions WHERE id/i.test(sql)) return { rows: [{ product_id: 'p1' }] };
      if (/FROM products WHERE id/i.test(sql)) return { rows: [{ name: 'Gold Ring' }] };
      return { rows: [], rowCount: 0 };
    });
    await sendPaymentReminders();
    const msgs = captureInserts().map((n) => n.message);
    expect(msgs.some((m) => /due in 3 days/.test(m))).toBe(true);
    expect(msgs.some((m) => /due tomorrow/.test(m))).toBe(true);
    expect(msgs.some((m) => /about 6 hours/.test(m))).toBe(true);
    expect(captureInserts().every((n) => n.user_id === BUYER_A && n.auction_id === AUCTION)).toBe(true);
  });

  test('5/6/7. expiration notifies old winner; new winner gets notice + fresh deadline; old winner gets no new-winner notice', async () => {
    const order = {
      id: ORDER, auction_id: AUCTION, buyer_id: BUYER_A, amount: 20000,
      status: 'pending', transaction_code: 'TXN-9001', created_at: isoAgo(8 * DAY),
    };
    pool.query.mockImplementation(async (sql, params = []) => {
      if (/FROM notifications/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM orders WHERE status/i.test(sql)) return { rows: [order] };
      if (/FROM payments/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM bids WHERE auction_id/i.test(sql)) {
        return {
          rows: [
            { user_id: BUYER_A, amount: 20000, created_at: isoAgo(9 * DAY) },
            { user_id: BUYER_B, amount: 19000, created_at: isoAgo(9 * DAY) },
          ],
        };
      }
      // Simulate the rotation UPDATE mutating the DB row (not the service's held
      // copy) so the verify re-read passes while later reads see the new buyer.
      if (/UPDATE orders SET buyer_id/i.test(sql)) {
        order._rotatedTo = params[0];
        order.created_at = new Date().toISOString();
        return { rows: [], rowCount: 1 };
      }
      if (/FROM orders WHERE id/i.test(sql)) {
        return { rows: [{ ...order, buyer_id: order._rotatedTo || order.buyer_id }] };
      }
      if (/FROM users WHERE id/i.test(sql)) return { rows: [{ name: 'Winner B' }] };
      if (/FROM auctions WHERE id/i.test(sql)) return { rows: [{ product_id: 'p1' }] };
      if (/FROM products WHERE id/i.test(sql)) return { rows: [{ name: 'Gold Ring', shop_id: null }] };
      if (/FROM users WHERE role/i.test(sql)) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });
    await checkAndExpireWinners();
    const inserts = captureInserts();
    const expiredNotice = inserts.filter((n) => n.user_id === BUYER_A && /expired/.test(n.message));
    expect(expiredNotice.length).toBe(1);
    const newWinnerNotice = inserts.filter((n) => n.user_id === BUYER_B && /eligible winner/.test(n.message));
    expect(newWinnerNotice.length).toBe(1);
    expect(newWinnerNotice[0].message).toMatch(/7 days/);
    // Old winner must NOT receive the new-winner notification.
    expect(inserts.filter((n) => n.user_id === BUYER_A && /eligible winner/.test(n.message)).length).toBe(0);
  });

  test('8. reassignment gives a fresh 7-day deadline (rotation update issued)', async () => {
    const order = {
      id: ORDER, auction_id: AUCTION, buyer_id: BUYER_A, amount: 20000,
      status: 'pending', transaction_code: 'TXN-9001', created_at: isoAgo(8 * DAY),
    };
    let rotationUpdate = null;
    pool.query.mockImplementation(async (sql, params = []) => {
      if (/FROM notifications/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM orders WHERE status/i.test(sql)) return { rows: [order] };
      if (/FROM payments/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM bids WHERE auction_id/i.test(sql)) {
        return { rows: [{ user_id: BUYER_B, amount: 19000, created_at: isoAgo(9 * DAY) }] };
      }
      if (/FROM orders WHERE id/i.test(sql)) return { rows: [{ ...order }] };
      if (/UPDATE orders SET buyer_id/i.test(sql)) {
        rotationUpdate = { sql, params };
        order.buyer_id = params[0];
        order.created_at = new Date().toISOString();
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT buyer_id FROM orders/i.test(sql)) return { rows: [{ buyer_id: order.buyer_id }] };
      if (/FROM users WHERE id/i.test(sql)) return { rows: [{ name: 'Winner B' }] };
      if (/FROM auctions WHERE id/i.test(sql)) return { rows: [{ product_id: 'p1' }] };
      if (/FROM products WHERE id/i.test(sql)) return { rows: [{ name: 'Gold Ring', shop_id: null }] };
      if (/FROM users WHERE role/i.test(sql)) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });
    await checkAndExpireWinners();
    expect(rotationUpdate).not.toBeNull();
    expect(rotationUpdate.params[0]).toBe(BUYER_B);
    // Buyer rotated to B with a fresh timestamp, so the next deadline is ~7 days out.
    expect(order.buyer_id).toBe(BUYER_B);
    expect(Date.now() - new Date(order.created_at).getTime()).toBeLessThan(5 * 60 * 1000);
  });

  test('9. paid order receives no future reminders', async () => {
    const order = {
      id: ORDER, auction_id: AUCTION, buyer_id: BUYER_A, amount: 20000,
      status: 'pending', transaction_code: 'TXN-9001', created_at: isoAgo(4 * DAY + 30 * 60 * 1000),
    };
    pool.query.mockImplementation(async (sql) => {
      if (/FROM notifications/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM orders WHERE status/i.test(sql)) return { rows: [order] };
      if (/FROM payments/i.test(sql)) return { rows: [{ id: 'pay-1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await sendPaymentReminders();
    expect(captureInserts().length).toBe(0);
  });

  test('10. duplicate cron execution does not duplicate reminders', async () => {
    const order = {
      id: ORDER, auction_id: AUCTION, buyer_id: BUYER_A, amount: 20000,
      status: 'pending', transaction_code: 'TXN-9001', created_at: isoAgo(4 * DAY + 30 * 60 * 1000),
    };
    pool.query.mockImplementation(async (sql) => {
      if (/FROM notifications/i.test(sql)) {
        return { rows: notifStore, rowCount: notifStore.length };
      }
      if (/FROM orders WHERE status/i.test(sql)) return { rows: [order] };
      if (/FROM payments/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM auctions WHERE id/i.test(sql)) return { rows: [{ product_id: 'p1' }] };
      if (/FROM products WHERE id/i.test(sql)) return { rows: [{ name: 'Gold Ring' }] };
      return { rows: [], rowCount: 0 };
    });
    await sendPaymentReminders();
    await persistCapturedInserts();
    const first = captureInserts().length;
    expect(first).toBe(1);
    pool.query.mockClear();
    await sendPaymentReminders();
    expect(captureInserts().length).toBe(0);
  });

  test('11. expired (non-pending) order cannot initiate payment', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/FROM orders WHERE id/i.test(sql)) {
        return { rows: [{ id: ORDER, buyer_id: BUYER_A, amount: 20000, status: 'expired', auction_id: AUCTION }] };
      }
      if (/FROM auctions WHERE id/i.test(sql)) return { rows: [{ product_id: 'p1' }] };
      if (/FROM products WHERE id/i.test(sql)) return { rows: [{ name: 'Gold Ring' }] };
      return { rows: [], rowCount: 0 };
    });
    const res = mockRes();
    await createCheckout({ params: { id: ORDER }, body: {}, user: { id: BUYER_A } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Order is not payable' });
  });

  test('12. previous winner cannot pay after reassignment (404, buyer mismatch)', async () => {
    pool.query.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    const res = mockRes();
    // Order now belongs to B; A tries to pay.
    await createCheckout({ params: { id: ORDER }, body: {}, user: { id: BUYER_A } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('13. current winner can pay before deadline (checkout created)', async () => {
    const { createPayMongoCheckout } = await import('../services/paymongoService.js');
    pool.query.mockImplementation(async (sql) => {
      if (/FROM orders WHERE id/i.test(sql)) {
        return {
          rows: [{
            id: ORDER, buyer_id: BUYER_B, amount: 19000, status: 'pending',
            auction_id: AUCTION, transaction_code: 'TXN-9001', created_at: isoAgo(DAY),
          }],
        };
      }
      if (/FROM auctions WHERE id/i.test(sql)) return { rows: [{ product_id: 'p1' }] };
      if (/FROM products WHERE id/i.test(sql)) return { rows: [{ name: 'Gold Ring' }] };
      if (/FROM payments/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO payments/i.test(sql)) return { rows: [{ id: 'pay-1' }] };
      return { rows: [], rowCount: 0 };
    });
    const res = mockRes();
    await createCheckout({ params: { id: ORDER }, body: { payment_method: 'gcash' }, user: { id: BUYER_B } }, res);
    expect(createPayMongoCheckout).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ checkout_url: 'https://pay.test/cs' })
    );
  });

  test('14. notifications carry correct customer/order/auction refs', async () => {
    const order = {
      id: ORDER, auction_id: AUCTION, buyer_id: BUYER_A, amount: 20000,
      status: 'pending', transaction_code: 'TXN-9001', created_at: isoAgo(4 * DAY + 30 * 60 * 1000),
    };
    pool.query.mockImplementation(async (sql) => {
      if (/FROM notifications/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM orders WHERE status/i.test(sql)) return { rows: [order] };
      if (/FROM payments/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM auctions WHERE id/i.test(sql)) return { rows: [{ product_id: 'p1' }] };
      if (/FROM products WHERE id/i.test(sql)) return { rows: [{ name: 'Gold Ring' }] };
      return { rows: [], rowCount: 0 };
    });
    await sendPaymentReminders();
    const inserts = captureInserts();
    expect(inserts.length).toBe(1);
    expect(inserts[0].user_id).toBe(BUYER_A);
    expect(inserts[0].type).toBe('payout');
    expect(inserts[0].message).toContain('TXN-9001');
    expect(inserts[0].auction_id).toBe(AUCTION);
  });
});
