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
const BUYER_C = '33333333-3333-3333-3333-333333333333';
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
      if (/FROM bids[\s\S]*auction_id/i.test(sql)) {
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

  // Shared fixture for the two rotation tests below.
  // Mirrors the required scenario: Maria 71k (rank 1), Britz 65k (rank 2),
  // John 58k (rank 3) — repeated bids collapsed to one rank per user.
  function rotationRouter(order) {
    return async (sql, params = []) => {
      const s = String(sql);
      // winnerExpiration refuses to run until the migrated schema is present.
      if (/information_schema\.columns/.test(s)) {
        return {
          rows: [
            { column_name: 'payment_deadline' },
            { column_name: 'winner_confirmed_at' },
            { column_name: 'winner_rank' },
          ],
          rowCount: 3,
        };
      }
      if (/FROM pg_enum/.test(s)) return { rows: [{ exists: 1 }], rowCount: 1 };
      if (/FROM notifications/i.test(s)) return { rows: [], rowCount: 0 };
      if (/FROM (public\.)?orders[\s\S]*status = 'pending'/i.test(s) && /payment_deadline/i.test(s)) {
        return { rows: [{ id: order.id }], rowCount: 1 };
      }
      if (/FROM public\.orders WHERE id = \$1 FOR UPDATE/i.test(s)) {
        return { rows: [{ ...order }], rowCount: 1 };
      }
      if (/FROM payments/i.test(s)) return { rows: [], rowCount: 0 };
      if (/FROM bids[\s\S]*auction_id/i.test(s)) {
        return {
          rows: [
            { user_id: BUYER_A, amount: 71000, created_at: isoAgo(9 * DAY) },
            { user_id: BUYER_B, amount: 65000, created_at: isoAgo(9 * DAY) },
            { user_id: BUYER_C, amount: 58000, created_at: isoAgo(9 * DAY) },
          ],
        };
      }
      if (/FROM auctions[\s\S]*LEFT JOIN products/i.test(s)) {
        return { rows: [{ product_id: 'p1', product_name: 'Rose Gold Bangle', shop_id: null, shop_name: null, seller_id: null }] };
      }
      if (/SELECT buyer_id, amount, status, winner_rank[\s\S]*FROM public\.orders WHERE id/i.test(s)) {
        return { rows: [{ ...order }], rowCount: 1 };
      }
      if (/UPDATE public\.orders[\s\S]*buyer_id/i.test(s)) {
        order.__rotated = {
          buyer_id: params[0], amount: params[1],
          confirmed: params[2], deadline: params[3], rank: params[4],
        };
        return { rowCount: 1, rows: [] };
      }
      if (/UPDATE public\.orders SET status = 'expired'/i.test(s)) return { rowCount: 1, rows: [] };
      if (/SELECT name FROM public\.users WHERE id/i.test(s)) return { rows: [{ name: 'Britz Susada' }], rowCount: 1 };
      if (/FROM public\.users WHERE role='admin'/i.test(s)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    };
  }

  test('5/6/7. expiration notifies the old winner and hands the item to the next eligible bidder', async () => {
    const order = {
      id: ORDER, auction_id: AUCTION, buyer_id: BUYER_A, amount: 71000,
      status: 'pending', transaction_code: 'TXN-9001',
      created_at: isoAgo(8 * DAY),
      winner_confirmed_at: isoAgo(8 * DAY),
      payment_deadline: isoAgo(1 * DAY),
      winner_rank: 1,
    };
    pool.query.mockImplementation(rotationRouter(order));
    // The verify step must observe the post-write row, like a real DB would.
    const base = pool.query.getMockImplementation();
    pool.query.mockImplementation(async (sql, params = []) => {
      if (/SELECT buyer_id, amount, status, winner_rank[\s\S]*FROM public\.orders WHERE id/i.test(String(sql))) {
        const r = order.__rotated;
        return {
          rows: [r
            ? {
              buyer_id: r.buyer_id, amount: Number(r.amount), status: 'pending',
              winner_rank: Number(r.rank), payment_deadline: r.deadline,
            }
            : { ...order }],
          rowCount: 1,
        };
      }
      return base(sql, params);
    });

    await checkAndExpireWinners();
    const inserts = captureInserts();

    // Old winner is told their eligibility lapsed (never that bids were deleted).
    const expiredNotice = inserts.filter((n) => n.user_id === BUYER_A && /has expired/.test(n.message));
    expect(expiredNotice.length).toBe(1);
    expect(expiredNotice[0].message).not.toMatch(/bids (were|have been) (deleted|removed)/i);

    // New winner is told they are the eligible winner, with amount + deadline.
    const newWinnerNotice = inserts.filter((n) => n.user_id === BUYER_B && /eligible winner/.test(n.message));
    expect(newWinnerNotice.length).toBe(1);
    expect(newWinnerNotice[0].message).toMatch(/₱65,000/);
    expect(newWinnerNotice[0].message).toMatch(/Pay by/i);
    // The old winner is never told they are the winner.
    expect(inserts.filter((n) => n.user_id === BUYER_A && /eligible winner/.test(n.message)).length).toBe(0);

    // Reassignment state: THEIR OWN highest bid, next rank, fresh stored deadline.
    expect(order.__rotated).toBeTruthy();
    expect(order.__rotated.buyer_id).toBe(BUYER_B);
    expect(Number(order.__rotated.amount)).toBe(65000);
    expect(Number(order.__rotated.rank)).toBe(2);
    const fresh = new Date(order.__rotated.deadline).getTime() - Date.now();
    expect(fresh).toBeGreaterThan(6.9 * DAY);
    expect(fresh).toBeLessThanOrEqual(7 * DAY);
    // orders.created_at is the auction-close stamp and must NOT be rewritten.
    expect(new Date(order.created_at).getTime()).toBeLessThan(Date.now() - 7 * DAY);
  });

  test('8. reassignment is a single UPDATE of the SAME order row (one order per auction)', async () => {
    const order = {
      id: ORDER, auction_id: AUCTION, buyer_id: BUYER_A, amount: 71000,
      status: 'pending', transaction_code: 'TXN-9001',
      created_at: isoAgo(8 * DAY),
      winner_confirmed_at: isoAgo(8 * DAY),
      payment_deadline: isoAgo(1 * DAY),
      winner_rank: 1,
    };
    pool.query.mockImplementation(rotationRouter(order));

    await checkAndExpireWinners();

    const mutations = pool.query.mock.calls
      .map(([sql]) => String(sql))
      .filter((s) => /^\s*UPDATE/i.test(s) && /orders/i.test(s));
    // Exactly one authoritative write: no INSERT of a second order, no retry.
    expect(mutations.length).toBe(1);
    expect(pool.query.mock.calls.some(([sql]) => /INSERT INTO orders/i.test(String(sql)))).toBe(false);
    // and it is the new-column form — the broken catch-and-retry is gone
    expect(mutations[0]).toMatch(/payment_deadline\s*=\s*\$4/);
    expect(mutations[0]).toMatch(/winner_rank\s*=\s*\$5/);
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
