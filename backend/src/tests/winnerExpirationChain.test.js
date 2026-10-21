// backend/src/tests/winnerExpirationChain.test.js
// The full 7-day winner-expiration chain, proved end to end:
//
//   Maria ₱55,000 / ₱60,000 / ₱71,000
//   Britz ₱58,000 / ₱65,000
//   John  ₱57,000 / ₱58,000
//
//   Winner #1 Maria ₱71,000 (rank 1)  → expires
//   Winner #2 Britz ₱65,000 (rank 2)  → expires
//   Winner #3 John  ₱58,000 (rank 3)  → expires
//   No eligible bidders left → order 'expired', auction stays ended
//
// Everything runs against an in-memory pool mock — no database is touched.
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn(), on: () => {} },
  isDirectPg: () => true,
}));
vi.mock('../services/emailService.js', () => ({
  sendNotificationEmail: vi.fn(async () => ({ ok: true })),
}));

import { pool } from '../db/pool.js';
import { checkAndExpireWinners } from '../services/winnerExpiration.js';
import { closeSingleAuction } from '../services/auctionClosingService.js';
import { sendPaymentReminders } from '../services/paymentReminder.js';
import { createCheckout } from '../controllers/customer/payment.controller.js';
import { payOrder } from '../controllers/customer/order.controller.js';
import { assertPaymentStillPayable, markStalePayment } from '../services/paymentRaceGuard.js';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
const isoIn = (ms) => new Date(Date.now() + ms).toISOString();

const MARIA = '11111111-1111-1111-1111-111111111111';
const BRITZ = '22222222-2222-2222-2222-222222222222';
const JOHN = '33333333-3333-3333-3333-333333333333';
const SELLER = '44444444-4444-4444-4444-444444444444';
const AUCTION = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORDER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PRODUCT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SHOP = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const NAMES = {
  [MARIA]: 'Maria Santos',
  [BRITZ]: 'Britz Susada',
  [JOHN]: 'John Dela Cruz',
  [SELLER]: 'Golden Heritage',
};

/** The audit example: three bidders, distinct-user ranking must hold. */
const BIDS = [
  { user_id: MARIA, amount: 55000, created_at: isoAgo(9 * DAY) },
  { user_id: MARIA, amount: 71000, created_at: isoAgo(8 * DAY) },
  { user_id: MARIA, amount: 60000, created_at: isoAgo(7 * DAY) },
  { user_id: BRITZ, amount: 58000, created_at: isoAgo(6 * DAY) },
  { user_id: BRITZ, amount: 65000, created_at: isoAgo(5 * DAY) },
  { user_id: JOHN, amount: 57000, created_at: isoAgo(4 * DAY) },
  { user_id: JOHN, amount: 58000, created_at: isoAgo(3 * DAY) },
];

let state;

function makeState() {
  return {
    order: {
      id: ORDER,
      auction_id: AUCTION,
      buyer_id: MARIA,
      amount: 71000,
      status: 'pending',
      transaction_code: 'TXN-1234',
      created_at: isoAgo(8 * DAY),
      winner_confirmed_at: isoAgo(8 * DAY),
      payment_deadline: isoAgo(DAY),
      winner_rank: 1,
    },
    orderExists: true,
    bids: BIDS.map((b) => ({ ...b, flagged: false })),
    payments: [],
    notifications: [],
    auction: { id: AUCTION, status: 'ended', auction_code: 'AUC-00234', product_id: PRODUCT },
  };
}

/** Collapse whitespace + drop spaces around '=' so the rules stay simple. */
function norm(sql) {
  return String(sql).replace(/\s+/g, ' ').replace(/\s*=\s*/g, '=').trim().toLowerCase();
}

function routeSql(sql, params = []) {
  const s = norm(sql);
  const P = params;

  // ── transaction control ──
  if (/^(begin|commit|rollback)$/.test(s)) return { rows: [] };

  // ── the expiration candidate scan (deadline predicate) ──
  if (s.includes('from orders') && s.includes('coalesce')) {
    // A DB row is a snapshot — the rotation must not mutate the scanned row.
    return { rows: state.order.status === 'pending' ? [{ ...state.order }] : [] };
  }
  // ── the reminder candidate scan ──
  if (s.includes('from orders') && s.includes("status='pending'") && s.includes('limit')) {
    return { rows: state.order.status === 'pending' ? [{ ...state.order }] : [] };
  }

  // ── the atomic auction claim (closeSingleAuction) ──
  if (s.includes("update auctions set status='ended'")) {
    return { rows: [{ ...state.auction, status: 'ended' }], rowCount: 1 };
  }
  // ── order creation ──
  if (s.includes('insert into orders')) {
    state.orderExists = true;
    state.order = {
      id: ORDER,
      auction_id: P[0],
      buyer_id: P[1],
      amount: P[2],
      branch_id: P[3],
      status: 'pending',
      transaction_code: 'TXN-1234',
      created_at: new Date().toISOString(),
      winner_confirmed_at: P[4],
      payment_deadline: P[5],
      winner_rank: 1,
    };
    return { rows: [{ id: ORDER }] };
  }
  // ── the rotation UPDATE ──
  if (s.includes('update orders set buyer_id=')) {
    if (state.order.status !== 'pending' || String(state.order.buyer_id) !== String(P[7])) {
      return { rows: [], rowCount: 0 };
    }
    state.order.buyer_id = P[0];
    state.order.amount = P[1];
    state.order.created_at = P[2];
    state.order.winner_confirmed_at = P[3];
    state.order.payment_deadline = P[4];
    state.order.winner_rank = P[5];
    return { rows: [], rowCount: 1 };
  }
  if (s.includes("update orders set status='expired'")) {
    state.order.status = 'expired';
    return { rows: [], rowCount: 1 };
  }
  if (s.includes("update orders set status='ready_pickup'")) {
    state.order.status = 'ready_pickup';
    state.order.payment_method = P[0];
    return { rows: [{ ...state.order }] };
  }

  // ── order reads ──
  if (s.includes('select buyer_id from orders where id=')) return { rows: [{ buyer_id: state.order.buyer_id }] };
  if (s.includes('select id, transaction_code, amount, status from orders where id=')) {
    return { rows: [{ id: state.order.id, transaction_code: state.order.transaction_code, amount: state.order.amount, status: state.order.status }] };
  }
  if (s.includes('from orders where id=')) return { rows: [{ ...state.order }] };
  if (s.includes('from orders where auction_id=')) return { rows: state.orderExists ? [{ id: state.order.id }] : [] };

  // ── the payment truth ──
  if (s.includes("from payments where order_id=") && s.includes("status='paid'")) {
    return { rows: state.payments.filter((p) => p.order_id === P[0] && p.status === 'paid') };
  }
  if (s.includes('from payments where order_id=') && s.includes('order by')) {
    const rows = state.payments.filter((p) => p.order_id === P[0]);
    return { rows: rows.length ? [rows[rows.length - 1]] : [] };
  }
  if (s.includes('insert into payments')) {
    const row = { id: `pay-${state.payments.length + 1}`, order_id: P[0], status: 'pending', amount: P[3] };
    state.payments.push(row);
    return { rows: [row] };
  }
  if (s.includes('update payments set status=')) {
    const row = state.payments.find((x) => x.id === P[1]);
    if (row) row.status = String(P[0] || '').startsWith('{') ? 'cancelled' : P[0];
    return { rows: [], rowCount: 1 };
  }

  // ── the ranked bids (amount DESC, created_at ASC) ──
  if (s.includes('from bids where auction_id=')) {
    const rows = state.bids
      .filter((b) => b.flagged === false || b.flagged == null)
      .slice()
      .sort((a, b) => (Number(b.amount) - Number(a.amount)) || (new Date(a.created_at) - new Date(b.created_at)));
    return { rows };
  }

  // ── item context ──
  if (s.includes('select auction_code, product_id from auctions')) return { rows: [state.auction] };
  if (s.includes('from auctions where id=')) return { rows: [state.auction] };
  if (s.includes('select product_id from auctions')) return { rows: [{ product_id: PRODUCT }] };
  if (s.includes('select name, shop_id from products')) return { rows: [{ name: '18K Diamond Ring', shop_id: SHOP }] };
  if (s.includes('select name from products')) return { rows: [{ name: '18K Diamond Ring' }] };
  if (s.includes('select * from products')) return { rows: [{ id: PRODUCT, name: '18K Diamond Ring', shop_id: SHOP }] };
  if (s.includes('from products p join auctions')) return { rows: [{ name: '18K Diamond Ring' }] };
  if (s.includes('select user_id, shop_name, home_branch_id from shops')) {
    return { rows: [{ user_id: SELLER, shop_name: 'Golden Heritage', home_branch_id: 'br-1' }] };
  }
  if (s.includes('select name from branches')) return { rows: [{ name: 'Gmall Branch' }] };
  if (s.includes('select name, email from users')) {
    return { rows: [{ name: NAMES[P[0]] || 'A customer', email: `${String(P[0]).slice(0, 4)}@test.ph` }] };
  }
  if (s.includes('select email from users')) {
    return { rows: [{ email: `${String(P[0]).slice(0, 4)}@test.ph` }] };
  }
  if (s.includes('select id, name from users')) {
    return { rows: [{ id: P[0], name: NAMES[P[0]] || 'A customer' }] };
  }
  if (s.includes("select id from users where role='admin'")) return { rows: [{ id: 'admin-1' }] };
  if (s.includes("count(*)::int as c from users where role='admin'")) return { rows: [{ c: 2 }] };

  // ── notifications ──
  if (s.includes('from notifications where user_id=') && s.includes('message like')) {
    const patterns = P.slice(1).filter(Boolean).map((x) => String(x).replace(/%/g, ''));
    return {
      rows: state.notifications.filter((n) => n.user_id === P[0]
        && patterns.every((pat) => n.message.includes(pat))),
    };
  }
  if (s.includes('insert into notifications')) {
    state.notifications.push({ user_id: P[0], type: 'auction', message: P[1] });
    return { rows: [], rowCount: 1 };
  }
  if (s.includes('from notifications')) return { rows: state.notifications };

  return { rows: [] };
}

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  state = makeState();
  pool.query.mockImplementation(async (sql, params = []) => routeSql(sql, params));
  pool.connect.mockImplementation(async () => ({
    query: async (sql, params = []) => routeSql(sql, params),
    release: vi.fn(),
  }));
});

// ─────────────────────────────────────────────────────────────
describe('winner expiration — the distinct-bidder chain', () => {
  test('the initial winner is the highest DISTINCT bidder (Maria ₱71,000, rank 1) with an explicit 7-day deadline', async () => {
    state.orderExists = false;
    state.order = { ...state.order, winner_confirmed_at: null, payment_deadline: null };
    await closeSingleAuction(AUCTION, {
      client: { query: async (sql, p = []) => routeSql(sql, p), release: vi.fn() },
    });
    expect(state.order.buyer_id).toBe(MARIA);
    expect(state.order.amount).toBe(71000);
    expect(state.order.winner_rank).toBe(1);
    expect(state.order.payment_deadline).toBeTruthy();
    const deadline = new Date(state.order.payment_deadline).getTime();
    const confirmed = new Date(state.order.winner_confirmed_at).getTime();
    expect(Math.round((deadline - confirmed) / DAY)).toBe(7);
  });

  test('Winner #1 expires → Winner #2 Britz ₱65,000 rank 2 with a FRESH 7-day deadline', async () => {
    const before = new Date().getTime();
    await checkAndExpireWinners();
    expect(state.order.buyer_id).toBe(BRITZ);
    expect(state.order.amount).toBe(65000); // NOT Maria's 71k, NOT Britz's 58k
    expect(state.order.winner_rank).toBe(2);
    expect(state.order.status).toBe('pending');
    const deadline = new Date(state.order.payment_deadline).getTime();
    expect(deadline - before).toBeGreaterThan(6.9 * DAY);
    expect(deadline - before).toBeLessThan(7.1 * DAY);
  });

  test('Maria can never re-enter the ranking through her ₱60,000 / ₱55,000 bids', async () => {
    await checkAndExpireWinners();
    expect(state.order.buyer_id).toBe(BRITZ);
    await checkAndExpireWinners(); // Britz's window is still open
    expect(state.order.buyer_id).toBe(BRITZ);
    expect(state.order.winner_rank).toBe(2);
  });

  test('Winner #2 expires → Winner #3 John ₱58,000 rank 3 with a fresh deadline', async () => {
    await checkAndExpireWinners(); // Maria → Britz
    state.order.payment_deadline = isoAgo(HOUR);
    state.order.winner_confirmed_at = isoAgo(DAY + HOUR);
    const before = new Date().getTime();
    await checkAndExpireWinners();
    expect(state.order.buyer_id).toBe(JOHN);
    expect(state.order.amount).toBe(58000);
    expect(state.order.winner_rank).toBe(3);
    const deadline = new Date(state.order.payment_deadline).getTime();
    expect(deadline - before).toBeGreaterThan(6.9 * DAY);
  });

  test('Britz is never selected twice (his ₱58,000 bid creates no second entry)', async () => {
    await checkAndExpireWinners();
    state.order.payment_deadline = isoAgo(HOUR);
    await checkAndExpireWinners();
    expect(state.order.buyer_id).toBe(JOHN);
    expect(state.order.winner_rank).toBe(3);
  });

  test('the final expiration marks the order expired, assigns nobody and keeps the auction ended', async () => {
    await checkAndExpireWinners();
    state.order.payment_deadline = isoAgo(HOUR);
    await checkAndExpireWinners();
    state.order.payment_deadline = isoAgo(HOUR);
    await checkAndExpireWinners();
    expect(state.order.status).toBe('expired');
    expect(state.order.buyer_id).toBe(JOHN); // nobody new was assigned
    expect(state.auction.status).toBe('ended'); // no automatic relist
    const sellerNotice = state.notifications.find((n) => n.user_id === SELLER && /no remaining eligible bidders/i.test(n.message));
    expect(sellerNotice).toBeTruthy();
    expect(sellerNotice.message).toMatch(/no remaining eligible bidders/i);
    expect(sellerNotice.message).toMatch(/TXN-1234/);
  });

  test('only ONE order row is used — the chain never creates a second order', async () => {
    await checkAndExpireWinners();
    state.order.payment_deadline = isoAgo(HOUR);
    await checkAndExpireWinners();
    expect(state.order.id).toBe(ORDER);
    const inserts = pool.query.mock.calls.filter(([sql]) => /INSERT INTO orders/i.test(sql));
    expect(inserts.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
describe('winner expiration — notifications', () => {
  test('the new winner is told the item, THEIR amount, their fresh deadline and 7 days', async () => {
    await checkAndExpireWinners();
    const notice = state.notifications.find((n) => n.user_id === BRITZ && /winning bidder/i.test(n.message));
    expect(notice).toBeTruthy();
    expect(notice.message).toMatch(/18K Diamond Ring/);
    expect(notice.message).toMatch(/₱65,000/);
    expect(notice.message).toMatch(/Payment deadline:/);
    expect(notice.message).toMatch(/7-day period|7 days/);
    expect(notice.message).toMatch(/TXN-1234/);
    expect(notice.message).toMatch(/View Order & Pay/i);
  });

  test('the expired winner is told the item, THEIR amount, the deadline and support guidance', async () => {
    await checkAndExpireWinners();
    const notice = state.notifications.find((n) => n.user_id === MARIA && /Payment Period Expired/i.test(n.message));
    expect(notice).toBeTruthy();
    expect(notice.message).toMatch(/18K Diamond Ring/);
    expect(notice.message).toMatch(/₱71,000/);
    expect(notice.message).toMatch(/Payment deadline:/);
    expect(notice.message).toMatch(/next eligible bidder/i);
    expect(notice.message).toMatch(/contact ATANY Support/i);
  });

  test('no customer notice ever names another bidder', async () => {
    await checkAndExpireWinners();
    const customerNotices = state.notifications.filter((n) => [MARIA, BRITZ, JOHN].includes(n.user_id));
    for (const n of customerNotices) {
      expect(n.message).not.toMatch(/Britz Susada/);
      expect(n.message).not.toMatch(/John Dela Cruz/);
      expect(n.message).not.toMatch(/Maria Santos/);
      expect(n.message).not.toContain(BRITZ);
      expect(n.message).not.toContain(JOHN);
    }
  });

  test('the terminal no-bidder notice does not claim the item moved to another bidder', async () => {
    await checkAndExpireWinners();
    state.order.payment_deadline = isoAgo(HOUR);
    await checkAndExpireWinners();
    state.order.payment_deadline = isoAgo(HOUR);
    await checkAndExpireWinners();
    const notice = state.notifications.find((n) => n.user_id === JOHN && /Payment Opportunity Ended/i.test(n.message));
    expect(notice).toBeTruthy();
    expect(notice.message).toMatch(/no more eligible bidders/i);
    expect(notice.message).not.toMatch(/offered to the next eligible bidder/i);
    expect(notice.message).toMatch(/contact ATANY Support/i);
  });

  test('a repeated cron run never duplicates the expiration / fallback notices', async () => {
    await checkAndExpireWinners();
    expect(state.notifications.filter((n) => n.user_id === MARIA && /Payment Period Expired/i.test(n.message))).toHaveLength(1);
    expect(state.notifications.filter((n) => n.user_id === BRITZ && /winning bidder/i.test(n.message))).toHaveLength(1);
    await checkAndExpireWinners();
    expect(state.notifications.filter((n) => n.user_id === MARIA && /Payment Period Expired/i.test(n.message))).toHaveLength(1);
    expect(state.notifications.filter((n) => n.user_id === BRITZ && /winning bidder/i.test(n.message))).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
describe('winner expiration — race + idempotency', () => {
  test('a PAID order is never reassigned (payment commits first)', async () => {
    state.payments.push({ id: 'pay-1', order_id: ORDER, status: 'paid' });
    await checkAndExpireWinners();
    expect(state.order.buyer_id).toBe(MARIA);
    expect(state.order.amount).toBe(71000);
    expect(state.order.winner_rank).toBe(1);
    expect(state.order.status).toBe('pending');
  });

  test('the previous winner cannot pay a reassigned order (stale payment)', async () => {
    await checkAndExpireWinners(); // the order now belongs to Britz
    const stale = { id: 'pay-old', order_id: ORDER, customer_id: MARIA, status: 'processing' };
    state.payments.push(stale);
    const check = await assertPaymentStillPayable(stale);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('BUYER_MISMATCH');
    await markStalePayment(stale);
    expect(state.payments.find((p) => p.id === 'pay-old')?.status).toBe('cancelled');
    expect(state.order.buyer_id).toBe(BRITZ);
  });

  test('the current winner CAN pay before the deadline', async () => {
    const check = await assertPaymentStillPayable({ id: 'pay-2', order_id: ORDER, customer_id: MARIA, status: 'processing' });
    expect(check.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe('checkout after the deadline', () => {
  test('a new PayMongo checkout is rejected once the deadline passed (cron not run yet)', async () => {
    const res = mockRes();
    await createCheckout({ params: { id: ORDER }, body: {}, user: { id: MARIA } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAYMENT_DEADLINE_EXPIRED' }));
    // No checkout session / payment row was created.
    expect(pool.query.mock.calls.some(([sql]) => /INSERT INTO payments/i.test(sql))).toBe(false);
  });

  test('a checkout before the deadline still works', async () => {
    state.order.payment_deadline = isoIn(2 * DAY);
    const res = mockRes();
    await createCheckout({ params: { id: ORDER }, body: {}, user: { id: MARIA } }, res);
    expect(res.status).not.toHaveBeenCalledWith(409);
  });
});

// ─────────────────────────────────────────────────────────────
describe('payment reminders', () => {
  test('the 3-day stage fires for the CURRENT winner against their own deadline', async () => {
    state.order.payment_deadline = isoIn(71.5 * HOUR);
    state.order.winner_confirmed_at = isoAgo(4 * DAY + 30 * 60 * 1000);
    await sendPaymentReminders();
    const msg = state.notifications.find((n) => n.user_id === MARIA && /due in 3 days/i.test(n.message))?.message || '';
    expect(msg).toMatch(/due in 3 days/i);
    expect(msg).toMatch(/₱71,000/);
    expect(msg).toMatch(/Payment deadline:/);
    expect(msg).toMatch(/TXN-1234/);
  });

  test('the fallback winner is reminded against THEIR new deadline and amount', async () => {
    await checkAndExpireWinners(); // Britz becomes the winner
    state.order.payment_deadline = isoIn(71.5 * HOUR);
    state.order.winner_confirmed_at = isoAgo(4.5 * DAY);
    await sendPaymentReminders();
    const msg = state.notifications.find((n) => n.user_id === BRITZ && /due in 3 days/i.test(n.message))?.message || '';
    expect(msg).toMatch(/due in 3 days/i);
    expect(msg).toMatch(/₱65,000/); // BRITZ's own amount
  });
});

// ─────────────────────────────────────────────────────────────
describe('counter payment', () => {
  test('a counter-paid order leaves pending (it can never be expired) and creates NO fake paid row', async () => {
    const res = mockRes();
    await payOrder({ params: { id: ORDER }, body: { payment_method: 'counter' }, user: { id: MARIA } }, res);
    expect(state.order.status).toBe('ready_pickup');
    expect(state.payments.filter((p) => p.status === 'paid')).toHaveLength(0);
    await checkAndExpireWinners();
    expect(state.order.buyer_id).toBe(MARIA);
    expect(state.order.status).toBe('ready_pickup');
  });
});
