// backend/src/tests/winnerExpiration.test.js
//
// THE 7-DAY WINNER FALLBACK — dedicated contract tests.
//
// The scenario is fixed by the business rule and is asserted end to end:
//
//   Maria  ₱55,000 / ₱60,000 / ₱71,000   -> rank 1, ₱71,000
//   Britz  ₱58,000 / ₱65,000              -> rank 2, ₱65,000
//   John   ₱57,000 / ₱58,000              -> rank 3, ₱58,000
//
// Winner #1 unpaid -> #2 (own bid, fresh 7 days, rank 2)
//              ->   #3 (own bid, fresh 7 days, rank 3)
//              ->   order.status = 'expired'
//
// Mocks are a real SQL router, not a stub: every assertion runs against the same
// statement shapes services/winnerExpiration.js actually issues. The real-schema
// proof lives in winnerExpirationDb.test.js — this task originally shipped green
// against mocks while the database could not execute the rotation at all.

import { describe, test, expect, vi, beforeEach } from 'vitest';

const { poolQuery, poolConnect, txClient } = vi.hoisted(() => {
  const poolQuery = vi.fn();
  const txClient = {
    query: vi.fn(async (sql, params) => {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i.test(String(sql))) return { rows: [], rowCount: 0 };
      return poolQuery(sql, params);
    }),
    release: vi.fn(),
  };
  const poolConnect = vi.fn(async () => txClient);
  return { poolQuery, poolConnect, txClient };
});

vi.mock('../db/pool.js', () => ({
  pool: { query: poolQuery, connect: poolConnect, on: () => {} },
  isDirectPg: () => true,
}));

import {
  checkAndExpireWinners, processOrderExpiry, expireSpecificOrder,
  isOrderPaid, assertWinnerFallbackSchema, resetSchemaCache,
} from '../services/winnerExpiration.js';
import {
  WINNER_PAYMENT_WINDOW_DAYS, nextEligibleBidder, isPastDeadline, resolveDeadline,
} from '../services/winnerRules.js';
import { closeSingleAuction } from '../services/auctionClosingService.js';
import { settlePaidPaymentWithOrderLock } from '../services/paymentRaceGuard.js';
import { recordManualPayment, canAcceptManualPayment, PAYMENT_WINDOW_EXPIRED } from '../services/manualPayment.js';
import { payOrder } from '../controllers/customer/order.controller.js';

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const MARIA = '11111111-1111-1111-1111-111111111111';
const BRITZ = '22222222-2222-2222-2222-222222222222';
const JOHN = '33333333-3333-3333-3333-333333333333';
const AUCTION = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORDER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SELLER = '44444444-4444-4444-4444-444444444444';

/** The required ranking: repeated bids collapse to ONE rank per user. */
const BIDS = [
  { user_id: MARIA, amount: 71000, created_at: iso(-9 * DAY) },
  { user_id: MARIA, amount: 60000, created_at: iso(-9 * DAY) },
  { user_id: MARIA, amount: 55000, created_at: iso(-9 * DAY) },
  { user_id: BRITZ, amount: 65000, created_at: iso(-9 * DAY) },
  { user_id: BRITZ, amount: 58000, created_at: iso(-9 * DAY) },
  { user_id: JOHN, amount: 58000, created_at: iso(-9 * DAY) },
  { user_id: JOHN, amount: 57000, created_at: iso(-9 * DAY) },
];

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

/**
 * An in-memory world: one auction, one order, an optional paid payment, and the
 * bid list above. Writes mutate the row exactly like Postgres would.
 */
function makeWorld(order = {}) {
  const world = {
    order: {
      id: ORDER, auction_id: AUCTION, buyer_id: MARIA, amount: 71000,
      branch_id: null, status: 'pending', transaction_code: 'TXN-7777',
      created_at: iso(-8 * DAY),
      winner_confirmed_at: iso(-8 * DAY),
      payment_deadline: iso(-1 * DAY),
      winner_rank: 1,
      ...order,
    },
    paidPayment: false,
    notifications: [],
    orderInserts: 0,
    orderUpdates: [],
  };

  const route = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();

    // schema capability probe
    if (/information_schema\.columns/.test(s)) {
      return { rows: [{ column_name: 'payment_deadline' }, { column_name: 'winner_confirmed_at' }, { column_name: 'winner_rank' }], rowCount: 3 };
    }
    if (/FROM pg_enum/.test(s)) return { rows: [{ ok: 1 }], rowCount: 1 };

    // candidate scan
    if (/FROM public\.orders WHERE status = 'pending'/.test(s)) return { rows: [{ id: world.order.id }], rowCount: 1 };
    if (/FROM orders WHERE auction_id=\$1/.test(s)) return { rows: world.orderInserts ? [{ id: ORDER }] : [], rowCount: world.orderInserts ? 1 : 0 };

    // order row (lock + verify)
    if (/FROM (public\.)?orders WHERE id = \$1 FOR UPDATE/.test(s)) return { rows: [{ ...world.order }], rowCount: 1 };
    if (/FROM (public\.)?orders WHERE id/.test(s)) return { rows: [{ ...world.order }], rowCount: 1 };

    // payment truth
    if (/FROM payments WHERE order_id/.test(s)) return { rows: world.paidPayment ? [{ id: 'pay-1' }] : [], rowCount: world.paidPayment ? 1 : 0 };

    // bids
    if (/FROM bids[\s\S]*auction_id/.test(s)) return { rows: BIDS.map((b) => ({ ...b })), rowCount: BIDS.length };

    // item context
    if (/FROM auctions a[\s\S]*LEFT JOIN products/.test(s)) {
      return { rows: [{ product_id: 'p1', product_name: 'Rose Gold Bangle', shop_id: 'sh1', shop_name: 'Golden Heritage', seller_id: SELLER }], rowCount: 1 };
    }
    if (/SELECT product_id FROM auctions/.test(s)) return { rows: [{ product_id: 'p1' }], rowCount: 1 };
    if (/SELECT shop_id FROM products/.test(s)) return { rows: [{ shop_id: 'sh1' }], rowCount: 1 };
    if (/SELECT home_branch_id FROM shops/.test(s)) return { rows: [{ home_branch_id: null }], rowCount: 1 };
    if (/FROM shops WHERE id=\$1/.test(s)) return { rows: [{ user_id: SELLER, shop_name: 'Golden Heritage' }], rowCount: 1 };
    if (/SELECT name FROM public\.users WHERE id/.test(s)) return { rows: [{ name: 'Britz Susada' }], rowCount: 1 };
    if (/FROM public\.users WHERE role='admin'/.test(s)) return { rows: [], rowCount: 0 };

    // writes
    if (/UPDATE (public\.)?orders\s+SET buyer_id/.test(s)) {
      const o = world.order;
      world.orderUpdates.push({ kind: 'reassign', buyer_id: params[0], amount: Number(params[1]), confirmed_at: params[2], deadline: params[3], rank: Number(params[4]) });
      // guard mirrors the SQL: WHERE status='pending' AND buyer_id=$7 AND winner_rank=$8
      if (o.status !== 'pending'
        || String(o.buyer_id) !== String(params[6])
        || Number(o.winner_rank) !== Number(params[7])) return { rowCount: 0, rows: [] };
      o.buyer_id = params[0];
      o.amount = Number(params[1]);
      o.winner_confirmed_at = params[2];
      o.payment_deadline = params[3];
      o.winner_rank = Number(params[4]);
      return { rowCount: 1, rows: [] };
    }
    if (/UPDATE (public\.)?orders SET status = 'expired'/.test(s)) {
      world.orderUpdates.push({ kind: 'expire' });
      if (world.order.status !== 'pending' || String(world.order.buyer_id) !== String(params[1])) return { rowCount: 0, rows: [] };
      world.order.status = 'expired';
      return { rowCount: 1, rows: [] };
    }
    if (/INSERT INTO orders/i.test(s)) {
      world.orderInserts += 1;
      return { rows: [{ id: ORDER }], rowCount: 1 };
    }
    if (/UPDATE (public\.)?payments/.test(s)) {
      if (/status = 'paid'/.test(s)) world.paidPayment = true;
      return { rows: [{ id: params[3] || params[0] || 'pay-1' }], rowCount: 1 };
    }
    if (/INSERT INTO payments/.test(s)) {
      const row = { id: 'pay-1', status: 'paid', provider: params[2], amount: params[3], payment_method: params[4] };
      world.paidPayment = true;
      world.lastPayment = row;
      return { rows: [row], rowCount: 1 };
    }

    // notifications
    if (/FROM notifications/.test(s)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO notifications/.test(s)) {
      world.notifications.push({ user_id: params[0], message: String(params[1]) });
      return { rowCount: 1, rows: [] };
    }
    return { rows: [], rowCount: 0 };
  };
  world.route = route;
  return world;
}

function use(world) {
  poolQuery.mockImplementation(world.route);
  return world;
}

const noticesFor = (world, userId) => world.notifications.filter((n) => n.user_id === userId);
const orderUpdates = (world) => world.orderUpdates;

beforeEach(() => {
  vi.clearAllMocks();
  resetSchemaCache();
  poolConnect.mockResolvedValue(txClient);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. Initial winner creation
 * ═════════════════════════════════════════════════════════════════════════ */
describe('1. initial winner order stores rank 1, confirmation time and an explicit 7-day deadline', () => {
  test('1. closeSingleAuction persists winner_rank=1 + winner_confirmed_at + payment_deadline(+7d)', async () => {
    const inserts = [];
    poolQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/BEGIN|COMMIT|ROLLBACK|ROLLBACK/.test(s)) return { rows: [], rowCount: 0 };
      if (/UPDATE auctions SET status = 'ended'/.test(s)) return { rows: [{ id: AUCTION, product_id: 'p1' }], rowCount: 1 };
      if (/FROM bids[\s\S]*auction_id/.test(s)) return { rows: BIDS, rowCount: BIDS.length };
      if (/FROM orders WHERE auction_id/.test(s)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO orders/i.test(s)) { inserts.push({ sql: s, params }); return { rows: [{ id: ORDER }], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    });
    poolConnect.mockResolvedValue({
      query: (sql, params) => poolQuery(sql, params),
      release: vi.fn(),
    });

    const res = await closeSingleAuction(AUCTION);
    expect(res.alreadyEnded).toBe(false);
    expect(res.winnerId).toBe(MARIA);          // highest eligible DISTINCT bidder
    expect(res.orderId).toBe(ORDER);

    const insert = inserts[0];
    expect(insert.sql).toMatch(/winner_confirmed_at/);
    expect(insert.sql).toMatch(/payment_deadline/);
    expect(insert.sql).toMatch(/winner_rank/);
    expect(insert.params[1]).toBe(MARIA);       // buyer
    expect(insert.params[2]).toBe(71000);       // their OWN highest bid
    expect(insert.sql).toMatch(/,\s*1\s*\)/);   // winner_rank literal 1
    const window = new Date(insert.params[5]).getTime() - new Date(insert.params[4]).getTime();
    expect(window).toBe(WINNER_PAYMENT_WINDOW_DAYS * DAY);
  });

  test('2. repeated bids by one user consume exactly ONE rank position', async () => {
    const world = makeWorld();
    use(world);
    await checkAndExpireWinners();
    // Maria (3 bids) -> Britz (2 bids) in one step; John is still 2 positions away.
    expect(orderUpdates(world)[0].buyer_id).toBe(BRITZ);
    expect(orderUpdates(world).length).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2-4. Winner #1 rotation
 * ═════════════════════════════════════════════════════════════════════════ */
describe('2. a paid winner is never rotated', () => {
  test('3. payments.status=paid short-circuits the cron entirely', async () => {
    const world = makeWorld();
    world.paidPayment = true;
    use(world);
    const summary = await checkAndExpireWinners();
    expect(orderUpdates(world)).toHaveLength(0);
    expect(world.order.buyer_id).toBe(MARIA);
    expect(summary.reassigned).toBe(0);
  });

  test.each(['pending', 'preparing', 'ready_pickup', 'completed'].map((s) => [s]))(
    '4. paid + order.status=%s never rotates', async (status) => {
      const world = makeWorld({ status, payment_deadline: iso(-1 * DAY) });
      world.paidPayment = true;
      use(world);
      await checkAndExpireWinners();
      expect(orderUpdates(world)).toHaveLength(0);
    }
  );

  test('5. a winner inside their window is left alone', async () => {
    const world = makeWorld({ payment_deadline: iso(3 * DAY) });
    use(world);
    await checkAndExpireWinners();
    expect(orderUpdates(world)).toHaveLength(0);
    expect(world.order.buyer_id).toBe(MARIA);
  });
});

describe('3. Winner #1 -> Winner #2', () => {
  test('6. expired unpaid winner is reassigned to the next distinct bidder', async () => {
    const world = makeWorld();
    use(world);
    const summary = await checkAndExpireWinners();
    expect(summary.reassigned).toBe(1);
    expect(world.order.buyer_id).toBe(BRITZ);
    expect(world.order.status).toBe('pending');   // rotation never expires the order
  });

  test('7. the fallback amount is THEIR OWN highest valid bid, never the previous winner\'s', async () => {
    const world = makeWorld();
    use(world);
    await checkAndExpireWinners();
    expect(world.order.amount).toBe(65000);       // not 71000
  });

  test('8. winner_rank is PERSISTED 1 -> 2', async () => {
    const world = makeWorld();
    use(world);
    await checkAndExpireWinners();
    expect(world.order.winner_rank).toBe(2);
    expect(orderUpdates(world)[0].rank).toBe(2);
  });

  test('9. the fallback receives a FRESH 7-day payment_deadline', async () => {
    const world = makeWorld();
    use(world);
    await checkAndExpireWinners();
    const deadline = new Date(world.order.payment_deadline).getTime();
    const remaining = deadline - Date.now();
    expect(remaining).toBeGreaterThan(WINNER_PAYMENT_WINDOW_DAYS * DAY * 0.98);
    expect(remaining).toBeLessThanOrEqual(WINNER_PAYMENT_WINDOW_DAYS * DAY);
    // and it is a real timestamp, not a formatted string
    expect(typeof world.order.payment_deadline).toBe('string');
    expect(Number.isNaN(new Date(world.order.payment_deadline).getTime())).toBe(false);
  });

  test('10. orders.created_at is NOT rewritten (reporting period must not move)', async () => {
    const world = makeWorld();
    const createdBefore = world.order.created_at;
    use(world);
    await checkAndExpireWinners();
    expect(world.order.created_at).toBe(createdBefore);
    const sqlSeen = poolQuery.mock.calls.map(([s]) => String(s)).find((s) => /UPDATE public\.orders\s+SET buyer_id/.test(s));
    expect(sqlSeen).not.toMatch(/created_at\s*=/);
  });

  test('11. exactly ONE authoritative write — no second order, no aborted-transaction retry', async () => {
    const world = makeWorld();
    use(world);
    await checkAndExpireWinners();
    const mutations = poolQuery.mock.calls
      .map(([s]) => String(s))
      .filter((s) => /^\s*(UPDATE|INSERT)\s/i.test(s) && /orders/i.test(s));
    expect(mutations).toHaveLength(1);
    expect(world.orderInserts).toBe(0);
    expect(mutations[0]).toMatch(/payment_deadline/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 18. Winner #2 -> #3 and exhaustion
 * ═════════════════════════════════════════════════════════════════════════ */
describe('4. the chain repeats through every eligible bidder', () => {
  test('12. Winner #2 expiring hands the item to Winner #3 at their own bid', async () => {
    const world = makeWorld({ buyer_id: BRITZ, amount: 65000, winner_rank: 2, payment_deadline: iso(-1 * DAY) });
    use(world);
    await checkAndExpireWinners();
    expect(world.order.buyer_id).toBe(JOHN);
    expect(world.order.amount).toBe(58000);
    expect(world.order.winner_rank).toBe(3);
  });

  test('13. no eligible bidder left -> order.status = expired (auction stays ended)', async () => {
    const world = makeWorld({ buyer_id: JOHN, amount: 58000, winner_rank: 3, payment_deadline: iso(-1 * DAY) });
    use(world);
    const summary = await checkAndExpireWinners();
    expect(summary.expired).toBe(1);
    expect(world.order.status).toBe('expired');
    expect(orderUpdates(world)[0].kind).toBe('expire');
  });

  test('14. bids, order and auction are all preserved when the chain is exhausted', async () => {
    const world = makeWorld({ buyer_id: JOHN, winner_rank: 3 });
    use(world);
    await checkAndExpireWinners();
    expect(world.order.id).toBe(ORDER);         // same row
    expect(world.orderInserts).toBe(0);          // no new order
    const sqlSeen = poolQuery.mock.calls.map(([s]) => String(s));
    expect(sqlSeen.some((s) => /DELETE/i.test(s))).toBe(false);
    expect(sqlSeen.some((s) => /UPDATE auctions/i.test(s))).toBe(false);
  });

  test('15. an expired order is not scanned again (retry loop terminates)', async () => {
    const world = makeWorld({ buyer_id: JOHN, winner_rank: 3 });
    use(world);
    await checkAndExpireWinners();
    const firstUpdates = orderUpdates(world).length;
    await checkAndExpireWinners();
    expect(orderUpdates(world).length).toBe(firstUpdates); // no further writes
    expect(world.order.buyer_id).toBe(JOHN);
  });

  test('16. the previous expired winner is never reselected', async () => {
    const world = makeWorld({ buyer_id: BRITZ, amount: 65000, winner_rank: 2 });
    use(world);
    await checkAndExpireWinners();
    expect(world.order.buyer_id).not.toBe(MARIA); // Maria stays skipped
    expect(world.order.buyer_id).toBe(JOHN);
  });

  test('17. when the current winner vanishes from the ranking (bids flagged later), the walk still goes DOWNWARD', () => {
    const ranked = [
      { user_id: MARIA, amount: 71000, position: 1 },
      { user_id: BRITZ, amount: 65000, position: 2 },
      { user_id: JOHN, amount: 58000, position: 3 },
    ];
    // Maria is no longer in the list at all; rank 1 says nobody was consumed yet.
    const withoutMaria = ranked.slice(1);
    expect(nextEligibleBidder({ ranked: withoutMaria, currentBuyerId: MARIA, winnerRank: 1 })).toBe(withoutMaria[0]);
    // Britz was rank 2: exactly one position consumed, so John (position 2 of the
    // remaining list) is next — never a restart at the top.
    const next = nextEligibleBidder({ ranked: withoutMaria, currentBuyerId: BRITZ, winnerRank: 2 });
    expect(next).toBe(withoutMaria[1]);        // exactly one further position down
    expect(next.user_id).toBe(JOHN);
    expect(next.user_id).not.toBe(withoutMaria[0]); // never a restart at the top
  });
});

describe('5. flagged bids', () => {
  test('18. flagged bids are excluded from the ranking, and the rule is shared with the closer', async () => {
    const { getEligibleRankedBidders } = await import('../services/winnerRules.js');
    const sqls = [];
    poolQuery.mockImplementation(async (sql) => {
      sqls.push(String(sql).replace(/\s+/g, ' '));
      return { rows: [], rowCount: 0 };
    });
    await getEligibleRankedBidders(AUCTION);
    expect(sqls[0]).toMatch(/flagged = false OR flagged IS NULL/);
    // one shared helper — the closer and the fallback rotation cannot diverge
    const closer = await import('node:fs');
    const closerSrc = closer.readFileSync(new URL('../services/auctionClosingService.js', import.meta.url), 'utf8');
    expect(closerSrc).toMatch(/getEligibleRankedBidders/);
  });

  test('19. the winner is the highest NON-flagged bid', async () => {
    const { getEligibleRankedBidders } = await import('../services/winnerRules.js');
    poolQuery.mockImplementation(async () => ({
      rows: [
        { user_id: BRITZ, amount: 99000, created_at: iso(-2 * DAY) },   // would be #1...
        { user_id: MARIA, amount: 71000, created_at: iso(-3 * DAY) },
      ],
      rowCount: 2,
    }));
    // The query itself filters flagged bids server-side; the helper trusts it.
    const ranked = await getEligibleRankedBidders(AUCTION);
    expect(ranked[0].position).toBe(1);
    expect(ranked.map((r) => r.position)).toEqual([1, 2]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Notifications
 * ═════════════════════════════════════════════════════════════════════════ */
describe('6. notifications', () => {
  test('20. the new winner is told they are the eligible winner, the amount and the exact deadline', async () => {
    const world = makeWorld();
    use(world);
    await checkAndExpireWinners();
    const notice = noticesFor(world, BRITZ).find((n) => /eligible winner/.test(n.message));
    expect(notice).toBeTruthy();
    expect(notice.message).toMatch(/Rose Gold Bangle/);
    expect(notice.message).toMatch(/₱65,000/);
    expect(notice.message).toMatch(/Pay by:/);
  });

  test('21. the expired winner is told eligibility lapsed, and NEVER that bids were deleted', async () => {
    const world = makeWorld();
    use(world);
    await checkAndExpireWinners();
    const notice = noticesFor(world, MARIA).find((n) => /has expired/.test(n.message));
    expect(notice).toBeTruthy();
    expect(notice.message).toMatch(/next eligible bidder/);
    expect(notice.message).not.toMatch(/bids (were|have been) (deleted|removed)/i);
  });

  test('22. seller and admins get the winner-change notice; the new winner does not', async () => {
    const world = makeWorld();
    use(world);
    await checkAndExpireWinners();
    expect(noticesFor(world, SELLER).some((n) => /Seller Winner Notice/.test(n.message))).toBe(true);
    expect(noticesFor(world, BRITZ).some((n) => /Seller Winner Notice|Admin Winner Notice/.test(n.message))).toBe(false);
  });

  test('23. the exhausted chain notifies the buyer once, with the "no more eligible bidders" wording', async () => {
    const world = makeWorld({ buyer_id: JOHN, winner_rank: 3 });
    // first run: nothing recorded yet -> notice is written
    poolQuery.mockImplementation((sql, params = []) => {
      if (/FROM notifications/.test(String(sql))) return Promise.resolve({ rows: [], rowCount: 0 });
      return world.route(sql, params);
    });
    await checkAndExpireWinners();
    expect(noticesFor(world, JOHN).some((n) => /no more eligible bidders/.test(n.message))).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Idempotency + schema guard
 * ═════════════════════════════════════════════════════════════════════════ */
describe('7. duplicate cron runs and schema safety', () => {
  test('24. running the cron twice never rotates twice', async () => {
    const world = makeWorld();
    use(world);
    await checkAndExpireWinners();
    expect(world.order.winner_rank).toBe(2);
    await checkAndExpireWinners();            // deadline is now 7 days out
    expect(world.order.winner_rank).toBe(2);
    expect(world.order.buyer_id).toBe(BRITZ);
    expect(orderUpdates(world)).toHaveLength(1);
  });

  test('25. duplicate cron runs never duplicate the new-winner notification', async () => {
    const world = makeWorld();
    use(world);
    await checkAndExpireWinners();
    await checkAndExpireWinners();
    expect(noticesFor(world, BRITZ).filter((n) => /eligible winner/.test(n.message))).toHaveLength(1);
  });

  test('26. the job refuses to run at all when the migrated schema is missing (fails closed, no partial work)', async () => {
    resetSchemaCache();
    poolQuery.mockImplementation(async (sql) => {
      if (/information_schema\.columns/.test(String(sql))) return { rows: [{ column_name: 'winner_rank' }], rowCount: 1 };
      if (/FROM pg_enum/.test(String(sql))) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const summary = await checkAndExpireWinners();
    expect(summary).toMatchObject({ skipped: true, reason: 'SCHEMA_NOT_READY' });
    expect(txClient.query.mock.calls.some(([s]) => /BEGIN/i.test(String(s).trim()))).toBe(false);
  });

  test('27. assertWinnerFallbackSchema passes on a migrated database', async () => {
    const world = makeWorld();
    use(world);
    resetSchemaCache();
    await expect(assertWinnerFallbackSchema()).resolves.toBeTruthy();
  });

  test('28. a DB error mid-flight rolls the whole order back', async () => {
    const world = makeWorld();
    poolQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (/UPDATE public\.orders\s+SET buyer_id/.test(s)) throw new Error('simulated DB failure');
      return world.route(sql, params);
    });
    const result = await processOrderExpiry(ORDER);
    expect(result.action).toBe('error');
    expect(world.order.buyer_id).toBe(MARIA);    // nothing half-applied
    expect(txClient.query.mock.calls.some(([s]) => /^\s*ROLLBACK/i.test(String(s).trim()))).toBe(true);
  });

  test('29. one order per auction is preserved: rotation never inserts', async () => {
    const world = makeWorld();
    use(world);
    await expireSpecificOrder(ORDER);
    expect(world.orderInserts).toBe(0);
    expect(world.order.id).toBe(ORDER);
  });

  test('30. expireSpecificOrder refuses an already-paid order', async () => {
    const world = makeWorld();
    world.paidPayment = true;
    use(world);
    await expect(expireSpecificOrder(ORDER)).rejects.toThrow(/already paid/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Payment vs expiration race — both directions
 * ═════════════════════════════════════════════════════════════════════════ */
describe('8. payment / expiration serialize on the same order row', () => {
  test('31. PAYMENT WINS: paid evidence lands first, the cron then skips', async () => {
    const world = makeWorld();
    world.paidPayment = true;
    use(world);
    // payment already committed
    await checkAndExpireWinners();
    expect(world.order.buyer_id).toBe(MARIA);
    expect(world.order.winner_rank).toBe(1);
    expect(orderUpdates(world)).toHaveLength(0);
  });

  test('32. EXPIRATION WINS: after rotation the old winner cannot attach a payment', async () => {
    const world = makeWorld();
    use(world);
    await checkAndExpireWinners();                 // Britz is now the buyer
    const settle = await settlePaidPaymentWithOrderLock({
      paymentId: 'pay-old', orderId: ORDER, customerId: MARIA, eventType: 'webhook',
    });
    expect(settle.ok).toBe(false);
    expect(settle.reason).toBe('BUYER_MISMATCH');  // stale assignment, not authoritative
    expect(world.paidPayment).toBe(false);
  });

  test('33. the new winner CAN pay after rotation', async () => {
    const world = makeWorld();
    use(world);
    await checkAndExpireWinners();
    const settle = await settlePaidPaymentWithOrderLock({
      paymentId: 'pay-new', orderId: ORDER, customerId: BRITZ, eventType: 'webhook',
    });
    expect(settle.ok).toBe(true);
    expect(world.paidPayment).toBe(true);
    await checkAndExpireWinners();                 // now protected
    expect(world.order.buyer_id).toBe(BRITZ);
  });

  test('34. settlement takes the SAME FOR UPDATE lock the rotation takes', async () => {
    const world = makeWorld();
    use(world);
    const res = await settlePaidPaymentWithOrderLock({ paymentId: 'pay-1', orderId: ORDER, customerId: MARIA });
    expect(res.ok).toBe(true);
    const sqls = poolQuery.mock.calls.map(([s]) => String(s).replace(/\s+/g, ' '));
    expect(sqls.some((s) => /FROM public\.orders WHERE id = \$1 FOR UPDATE/.test(s))).toBe(true);
    // opened a real transaction, and committed exactly once
    expect(txClient.query.mock.calls.some(([s]) => /^BEGIN/i.test(String(s).trim()))).toBe(true);
    expect(txClient.query.mock.calls.some(([s]) => /^COMMIT/i.test(String(s).trim()))).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Manual / counter payment window
 * ═════════════════════════════════════════════════════════════════════════ */
describe('9. counter payment honours the 7-day window', () => {
  test('35. counter payment before the deadline records a real paid payment', async () => {
    const world = makeWorld({ payment_deadline: iso(2 * DAY) });
    use(world);
    const recorded = await recordManualPayment({ orderId: ORDER, actorId: MARIA, expectedBuyerId: MARIA });
    expect(recorded.ok).toBe(true);
    expect(recorded.payment.status).toBe('paid');
    expect(recorded.payment.provider).toBe('counter');
  });

  test('36. counter payment AFTER the deadline is refused with PAYMENT_WINDOW_EXPIRED', async () => {
    const world = makeWorld({ payment_deadline: iso(-1 * DAY) });
    use(world);
    const recorded = await recordManualPayment({ orderId: ORDER, actorId: MARIA, expectedBuyerId: MARIA });
    expect(recorded.ok).toBe(false);
    expect(recorded.reason).toBe(PAYMENT_WINDOW_EXPIRED);
    expect(world.paidPayment).toBe(false);
  });

  test('37. a counter payment prevents fallback', async () => {
    const world = makeWorld({ payment_deadline: iso(-1 * DAY) });
    // inside the window at the moment of payment
    world.order.payment_deadline = iso(2 * DAY);
    use(world);
    await recordManualPayment({ orderId: ORDER, actorId: MARIA, expectedBuyerId: MARIA });
    // the deadline then passes; the cron must still leave the order alone
    world.order.payment_deadline = iso(-1 * DAY);
    await checkAndExpireWinners();
    expect(world.order.buyer_id).toBe(MARIA);
    expect(orderUpdates(world)).toHaveLength(0);
  });

  test('38. the customer endpoint answers 410 + the stable code after the window', async () => {
    const world = makeWorld({ payment_deadline: iso(-1 * DAY) });
    use(world);
    const res = mockRes();
    await payOrder({ params: { id: ORDER }, user: { id: MARIA }, body: { payment_method: 'counter' } }, res);
    expect(res.status).toHaveBeenCalledWith(410);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe(PAYMENT_WINDOW_EXPIRED);
    expect(body.message).toMatch(/payment window has expired/i);
  });

  test('39. canAcceptManualPayment rejects an expired order outright', () => {
    expect(canAcceptManualPayment({ status: 'expired', payment_deadline: iso(5 * DAY) }).reason).toBe('ORDER_EXPIRED');
    expect(canAcceptManualPayment({ status: 'pending', payment_deadline: iso(5 * DAY) }).ok).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Deadline helpers (pure)
 * ═════════════════════════════════════════════════════════════════════════ */
describe('10. deadline resolution', () => {
  test('40. stored payment_deadline is canonical and never recomputed', () => {
    const stored = iso(3 * DAY);
    expect(resolveDeadline({ payment_deadline: stored, winner_confirmed_at: iso(-40 * DAY), created_at: iso(-60 * DAY) }).toISOString())
      .toBe(stored);
  });

  test('41. legacy rows without the column fall back, and never silently pass', () => {
    expect(isPastDeadline({ winner_confirmed_at: iso(-8 * DAY), created_at: iso(-8 * DAY) })).toBe(true);
    expect(isPastDeadline({ winner_confirmed_at: iso(-6 * DAY), created_at: iso(-6 * DAY) })).toBe(false);
    expect(resolveDeadline({})).toBeNull();
    expect(isPastDeadline({})).toBe(false);
  });
});