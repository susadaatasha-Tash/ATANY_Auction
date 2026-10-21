// backend/src/tests/customerBids.test.js
// Customer → My Bids backend suite.
//
// Contract under test:
//  • The list is scoped to the AUTHENTICATED customer (req.user.id only).
//  • One row per auction the customer has bid on (not one row per bid).
//  • Product / branch enrichment comes from the real joined tables.
//  • total_bids is the auction's bid count; your_bid is the customer's
//    effective (highest unflagged) bid; current_bid is auctions.current_bid.
//  • The winner state comes from the authoritative ORDER (buyer_id + status) —
//    never from comparing bid amounts, so a reassigned/expired win is correct.
//  • The query count is fixed (no N+1).
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

const { listBids } = await import('../controllers/customer/bid.controller.js');

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const A1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const A2 = 'aaaaaaaa-0000-0000-0000-000000000002';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
const req = (body = {}, userId = ME) => ({ body, query: {}, user: { id: userId } });

const AUCTIONS = [
  {
    id: A1, auction_code: 'A-1', status: 'live', start_time: '2026-10-01T00:00:00.000Z',
    end_time: '2026-12-01T00:00:00.000Z', current_bid: 63000, minimum_bid_increment: 1000,
    start_price: 50000, product_id: 'p1', item: 'Alpha test', category: 'Rings',
    karat_weight: '18K', img: 'https://img.test/a.jpg', branch_id: 'b1', branch_name: 'Gmall Branch',
  },
  {
    id: A2, auction_code: 'A-2', status: 'ended', start_time: '2026-09-01T00:00:00.000Z',
    end_time: '2026-09-10T00:00:00.000Z', current_bid: 82000, minimum_bid_increment: 1000,
    start_price: 60000, product_id: 'p2', item: 'Lost lot', category: 'Bracelets',
    karat_weight: '21K', img: null, branch_id: 'b2', branch_name: 'Abreeza Branch',
  },
];

/**
 * Pool mock. `mine` are the customer's own bid aggregates, `auctions` the
 * joined auction rows (including the order LATERAL), `stats` the combined
 * count + leader rows.
 */
function setupPool({ mine, auctions = AUCTIONS, stats = [] } = {}) {
  poolQuery.mockImplementation(async (sql) => {
    if (/MAX\(amount\) FILTER/.test(sql)) return { rows: mine };
    if (/FROM auctions a/.test(sql)) return { rows: auctions };
    if (/WITH counts AS/.test(sql)) return { rows: stats };
    return { rows: [] };
  });
}

/** Combined count + leader rows for the stats query. */
function statRows(entries) {
  return Object.entries(entries).map(([auction_id, v]) => ({
    auction_id,
    total_bids: v.total,
    leader_user_id: v.leader ?? null,
  }));
}

const MINE_TWO = [
  {
    auction_id: A1, best_bid: 62000, max_bid: 62000, my_bid_count: 3, any_flagged: false,
    last_bid_at: '2026-10-20T10:00:00.000Z',
  },
  {
    auction_id: A2, best_bid: 81000, max_bid: 81000, my_bid_count: 1, any_flagged: false,
    last_bid_at: '2026-09-05T10:00:00.000Z',
  },
];

beforeEach(() => {
  poolQuery.mockReset();
});

describe('customer My Bids — list', () => {
  it('the route is authenticated and customer-scoped', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/customer.routes.js'), 'utf8');
    expect(routes).toMatch(/router\.get\('\/bids', listBids\)/);
    const index = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    expect(index).toMatch(/app\.use\('\/customer',\s*requireAuth,\s*requireRole\('customer'\)/);
  });

  it('returns one row per auction, not one row per bid', async () => {
    setupPool({ mine: MINE_TWO, stats: statRows({ [A1]: { total: 5, leader: ME }, [A2]: { total: 2, leader: ME } }) });
    const res = mockRes();
    await listBids(req(), res);
    const rows = res.json.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.auction_id)).toEqual([A1, A2]);
  });

  it('only ever queries the authenticated customer id', async () => {
    setupPool({ mine: MINE_TWO });
    const res = mockRes();
    await listBids(req({}, ME), res);
    const mineQuery = poolQuery.mock.calls.find(([sql]) => /MAX\(amount\) FILTER/.test(sql));
    expect(mineQuery[1]).toEqual([ME]);
    // a user_id in the body is never used
    await listBids(req({ user_id: OTHER }, ME), mockRes());
    const again = poolQuery.mock.calls.filter(([sql]) => /MAX\(amount\) FILTER/.test(sql));
    expect(again[again.length - 1][1]).toEqual([ME]);
  });

  it('cross-user access is impossible — another customer id is never used', async () => {
    setupPool({ mine: MINE_TWO });
    const res = mockRes();
    await listBids(req({}, OTHER), res);
    const mineQuery = poolQuery.mock.calls.find(([sql]) => /MAX\(amount\) FILTER/.test(sql));
    expect(mineQuery[1]).toEqual([OTHER]);
    expect(mineQuery[1]).not.toEqual([ME]);
  });

  it('enriches the row with the real product and branch data', async () => {
    setupPool({ mine: MINE_TWO, stats: statRows({ [A1]: { total: 5, leader: ME }, [A2]: { total: 2, leader: ME } }) });
    const res = mockRes();
    await listBids(req(), res);
    const rows = res.json.mock.calls[0][0];
    const first = rows.find((r) => r.auction_id === A1);
    expect(first).toMatchObject({
      item: 'Alpha test', category: 'Rings', karat_weight: '18K',
      img: 'https://img.test/a.jpg', branch_name: 'Gmall Branch', branch_id: 'b1',
      auction_code: 'A-1',
    });
  });

  it('uses the auction total bid count (not the customer bid count)', async () => {
    setupPool({ mine: MINE_TWO, stats: statRows({ [A1]: { total: 5, leader: ME }, [A2]: { total: 2, leader: ME } }) });
    const res = mockRes();
    await listBids(req(), res);
    const rows = res.json.mock.calls[0][0];
    const first = rows.find((r) => r.auction_id === A1);
    expect(first.total_bids).toBe(5);
    expect(first.bidsCount).toBe(5);
    expect(first.my_bid_count).toBe(3);
  });

  it('reports the customer effective bid and the authoritative current bid', async () => {
    setupPool({ mine: MINE_TWO, stats: statRows({ [A1]: { total: 5, leader: ME } }) });
    const res = mockRes();
    await listBids(req(), res);
    const rows = res.json.mock.calls[0][0];
    const first = rows.find((r) => r.auction_id === A1);
    expect(first.yourBid).toBe(62000);
    expect(first.currentBid).toBe(63000);
  });

  it('marks the customer as leading only when the leader query says so', async () => {
    setupPool({ mine: MINE_TWO, stats: statRows({ [A1]: { total: 5, leader: OTHER } }) });
    const res = mockRes();
    await listBids(req(), res);
    const rows = res.json.mock.calls[0][0];
    expect(rows.find((r) => r.auction_id === A1).is_leading).toBe(false);
    expect(rows.find((r) => r.auction_id === A1).status).toBe('outbid');
  });

  it('uses the authoritative order for the winner state', async () => {
    setupPool({
      mine: MINE_TWO,
      stats: statRows({ [A1]: { total: 5, leader: ME }, [A2]: { total: 2, leader: ME } }),
      auctions: AUCTIONS.map((a) => (a.id === A2
        ? { ...a, order_id: 'o-1', order_buyer_id: ME, order_status: 'pending', transaction_code: 'TX-1', winner_rank: 1 }
        : a)),
    });
    const res = mockRes();
    await listBids(req(), res);
    const rows = res.json.mock.calls[0][0];
    const ended = rows.find((r) => r.auction_id === A2);
    expect(ended.won).toBe(true);
    expect(ended.status).toBe('won');
    expect(ended.order_id).toBe('o-1');
    expect(ended.order_status).toBe('pending');
  });

  it('an expired order is NOT a win (the win passed to the next bidder)', async () => {
    setupPool({
      mine: MINE_TWO,
      stats: statRows({ [A2]: { total: 2, leader: ME } }),
      auctions: AUCTIONS.map((a) => (a.id === A2
        ? { ...a, order_id: 'o-2', order_buyer_id: ME, order_status: 'expired', transaction_code: 'TX-2', winner_rank: 1 }
        : a)),
    });
    const res = mockRes();
    await listBids(req(), res);
    const rows = res.json.mock.calls[0][0];
    const ended = rows.find((r) => r.auction_id === A2);
    expect(ended.won).toBe(false);
    expect(ended.status).toBe('lost');
  });

  it('an order held by another buyer is NOT a win', async () => {
    setupPool({
      mine: MINE_TWO,
      stats: statRows({ [A2]: { total: 2, leader: OTHER } }),
      auctions: AUCTIONS.map((a) => (a.id === A2
        ? { ...a, order_id: 'o-3', order_buyer_id: OTHER, order_status: 'pending', transaction_code: 'TX-3', winner_rank: 2 }
        : a)),
    });
    const res = mockRes();
    await listBids(req(), res);
    const rows = res.json.mock.calls[0][0];
    expect(rows.find((r) => r.auction_id === A2).won).toBe(false);
    expect(rows.find((r) => r.auction_id === A2).status).toBe('lost');
  });

  it('a live auction is never won/lost', async () => {
    setupPool({ mine: MINE_TWO, stats: statRows({ [A1]: { total: 5, leader: ME } }) });
    const res = mockRes();
    await listBids(req(), res);
    const rows = res.json.mock.calls[0][0];
    const live = rows.find((r) => r.auction_id === A1);
    expect(live.auction_status).toBe('live');
    expect(['winning', 'outbid']).toContain(live.status);
  });

  it('returns an empty list when the customer has never bid', async () => {
    setupPool({ mine: [] });
    const res = mockRes();
    await listBids(req(), res);
    expect(res.json).toHaveBeenCalledWith([]);
    expect(poolQuery.mock.calls.length).toBe(1);
  });

  it('runs a fixed number of queries — no N+1', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      auction_id: `a${i}`, best_bid: 1000, max_bid: 1000, my_bid_count: 1, any_flagged: false, last_bid_at: '2026-10-01T00:00:00.000Z',
    }));
    const auctions = many.map((m, i) => ({
      ...AUCTIONS[0], id: m.auction_id, auction_code: `A-${i}`, item: `Lot ${i}`,
    }));
    setupPool({
      mine: many,
      auctions,
      stats: statRows({ a0: { total: 3, leader: ME }, a1: { total: 4, leader: null } }),
    });
    const res = mockRes();
    await listBids(req(), res);
    // 3 fixed queries: own bids, auctions (+order join), counts + leaders
    expect(poolQuery.mock.calls.length).toBe(3);
    expect(res.json.mock.calls[0][0]).toHaveLength(12);
  });

  it('does not expose another customer bid data', async () => {
    setupPool({ mine: MINE_TWO, stats: statRows({ [A1]: { total: 5, leader: ME } }) });
    const res = mockRes();
    await listBids(req(), res);
    const rows = res.json.mock.calls[0][0];
    rows.forEach((r) => {
      expect(r).not.toHaveProperty('other_user_id');
      expect(r.yourBid).toBeGreaterThan(0);
    });
  });
});
