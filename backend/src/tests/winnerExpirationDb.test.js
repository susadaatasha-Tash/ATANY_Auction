// backend/src/tests/winnerExpirationDb.test.js
//
// REAL-SCHEMA INTEGRATION TEST — no SQL mocking.
//
// This suite exists because the 7-day fallback shipped with a fully green mock
// suite while the running database physically could not execute the rotation
// (orders.payment_deadline / winner_confirmed_at / winner_rank absent, and
// order_status.'expired' absent). The first UPDATE raised 42703, Postgres
// aborted the transaction, the catch-based retry died with 25P02, and nothing
// ever committed.
//
// So this file talks to the ACTUAL PostgreSQL schema and runs the ACTUAL
// statements services/winnerExpiration.js issues, for the real business
// scenario:
//
//   Maria ₱55,000 / ₱60,000 / ₱71,000 -> rank 1
//   Britz ₱58,000 / ₱65,000            -> rank 2
//   John  ₱57,000 / ₱58,000            -> rank 3
//
// It is skipped (not failed) when no DATABASE_URL is configured, so the default
// unit-test run stays hermetic.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load backend/.env BEFORE importing the pool (it reads DATABASE_URL at import).
const envPath = path.join(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const k = line.slice(0, line.indexOf('=')).trim();
    const v = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;
const TAG = `QA_WINNER_${Date.now().toString(36).toUpperCase()}`;

let pool;
let closeSingleAuction;
let processOrderExpiry;
let expireSpecificOrder;
let isOrderPaid;

// Isolated fixtures — deleted in afterAll.
const ids = { branch: null, shop: null, product: null, auction: null, order: null };
// Real customer rows (bids.user_id has a FK to public.users).
let sellers = [];

async function seed() {
  const branch = await pool.query(
    `INSERT INTO public.branches (name, address, lat, lng) VALUES ($1, $2, 7.0, 125.0) RETURNING id`,
    [`${TAG} BRANCH`, 'QA branch']
  );
  ids.branch = branch.rows[0].id;

  sellers = (await pool.query(
    `SELECT id FROM public.users WHERE role='customer' AND status='active' ORDER BY id LIMIT 3`
  )).rows.map((r) => r.id);
  if (sellers.length < 3) throw new Error('QA needs 3 active customer accounts');

  const owner = await pool.query(`SELECT id FROM public.users WHERE role='shop_owner' LIMIT 1`);
  ids.shop = (await pool.query(
    `INSERT INTO public.shops (user_id, shop_name, home_branch_id) VALUES ($1,$2,$3) RETURNING id`,
    [owner.rows[0]?.id || sellers[0], `${TAG} SHOP`, ids.branch]
  )).rows[0].id;

  ids.product = (await pool.query(
    `INSERT INTO public.products (shop_id, name, category, price, stock, status)
     VALUES ($1,$2,'rings',100000,1,'approved') RETURNING id`,
    [ids.shop, `${TAG} RING`]
  )).rows[0].id;

  ids.auction = (await pool.query(
    `INSERT INTO public.auctions (product_id, start_price, current_bid, status, start_time, end_time, auction_code, minimum_bid_increment)
     VALUES ($1,55000,55000,'live', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', $2, 500) RETURNING id`,
    [ids.product, TAG]
  )).rows[0].id;

  // The exact bid pattern from the business rule (repeated bids included).
  const rows = [
    [sellers[0], 55000], [sellers[0], 60000], [sellers[0], 71000],
    [sellers[1], 58000], [sellers[1], 65000],
    [sellers[2], 57000], [sellers[2], 58000],
  ];
  for (const [userId, amount] of rows) {
    await pool.query(
      `INSERT INTO public.bids (auction_id, user_id, amount) VALUES ($1,$2,$3)`,
      [ids.auction, userId, amount]
    );
  }
}

async function cleanup() {
  if (ids.order) await pool.query(`DELETE FROM public.orders WHERE id=$1`, [ids.order]).catch(() => {});
  if (ids.auction) {
    await pool.query(`DELETE FROM public.bids WHERE auction_id=$1`, [ids.auction]).catch(() => {});
    await pool.query(`DELETE FROM public.auctions WHERE id=$1`, [ids.auction]).catch(() => {});
  }
  if (ids.product) await pool.query(`DELETE FROM public.products WHERE id=$1`, [ids.product]).catch(() => {});
  if (ids.shop) await pool.query(`DELETE FROM public.shops WHERE id=$1`, [ids.shop]).catch(() => {});
  if (ids.branch) await pool.query(`DELETE FROM public.branches WHERE id=$1`, [ids.branch]).catch(() => {});
  await pool.query(`DELETE FROM public.notifications WHERE message LIKE $1`, [`%${TAG}%`]).catch(() => {});
}

const orderRow = async () => (await pool.query(`SELECT * FROM public.orders WHERE id=$1`, [ids.order])).rows[0];
const setDeadline = (iso) => pool.query(`UPDATE public.orders SET payment_deadline=$1 WHERE id=$2`, [iso, ids.order]);

live('REAL SCHEMA — winner expiration executes against actual PostgreSQL', () => {
  beforeAll(async () => {
    if (!DATABASE_URL) return;
    ({ pool } = await import('../db/pool.js'));
    ({ closeSingleAuction } = await import('../services/auctionClosingService.js'));
    ({ processOrderExpiry, expireSpecificOrder, isOrderPaid } = await import('../services/winnerExpiration.js'));
    await seed();
  }, 120000);

  afterAll(async () => {
    if (!DATABASE_URL || !pool) return;
    await cleanup();
    try { await pool.end?.(); } catch { /* pool wrapper has no end() */ }
  }, 120000);

  test('A. the migrated schema really has the columns and the enum value', async () => {
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='orders'
          AND column_name IN ('payment_deadline','winner_confirmed_at','winner_rank')`
    );
    expect(cols.rows.map((r) => r.column_name).sort())
      .toEqual(['payment_deadline', 'winner_confirmed_at', 'winner_rank']);
    const en = await pool.query(
      `SELECT 1 FROM pg_enum WHERE enumlabel='expired' AND enumtypid='public.order_status'::regtype`
    );
    expect(en.rows.length).toBe(1);
  });

  test('B. the expiration candidate index exists', async () => {
    const idx = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='orders' AND indexname='idx_orders_pending_deadline'`
    );
    expect(idx.rows.length).toBe(1);
  });

  test('C. closing the auction stores Winner #1 with rank 1 and an explicit 7-day deadline', async () => {
    const res = await closeSingleAuction(ids.auction);
    expect(res.alreadyEnded).toBe(false);
    expect(res.winnerId).toBe(sellers[0]);          // Maria — highest DISTINCT bidder
    ids.order = res.orderId;

    const o = await orderRow();
    expect(o.buyer_id).toBe(sellers[0]);
    expect(Number(o.amount)).toBe(71000);           // her own highest bid
    expect(o.status).toBe('pending');
    expect(o.winner_rank).toBe(1);
    expect(o.winner_confirmed_at).toBeTruthy();
    const window = new Date(o.payment_deadline).getTime() - new Date(o.winner_confirmed_at).getTime();
    expect(Math.abs(window - 7 * DAY)).toBeLessThan(2000);
  }, 60000);

  test('D. one auction = one order', async () => {
    const rows = await pool.query(`SELECT count(*)::int n FROM public.orders WHERE auction_id=$1`, [ids.auction]);
    expect(rows.rows[0].n).toBe(1);
  });

  test('E. Winner #1 expiring reassigns to Winner #2 at THEIR own bid', async () => {
    // QA fixture: backdate the deadline instead of waiting 7 real days.
    await setDeadline(new Date(Date.now() - DAY).toISOString());
    const createdBefore = (await orderRow()).created_at;

    const result = await processOrderExpiry(ids.order);
    expect(result.action).toBe('reassigned');

    const o = await orderRow();
    expect(o.buyer_id).toBe(sellers[1]);            // Britz
    expect(Number(o.amount)).toBe(65000);           // HIS own highest bid, not 71000
    expect(o.status).toBe('pending');               // rotation never expires the order
    expect(o.winner_rank).toBe(2);                  // PERSISTED 1 -> 2
    const fresh = new Date(o.payment_deadline).getTime() - Date.now();
    expect(fresh).toBeGreaterThan(6.9 * DAY);
    expect(fresh).toBeLessThanOrEqual(7 * DAY);
    // reporting attribution is untouched
    expect(new Date(o.created_at).getTime()).toBe(new Date(createdBefore).getTime());
  }, 60000);

  test('F. repeated bids did not create extra fallback positions', async () => {
    const o = await orderRow();
    // Maria had 3 bids and Britz 2; the first fallback must be Britz, not a
    // phantom rank between them.
    expect(o.buyer_id).toBe(sellers[1]);
  });

  test('G. Winner #2 expiring reassigns to Winner #3', async () => {
    await setDeadline(new Date(Date.now() - DAY).toISOString());
    const result = await processOrderExpiry(ids.order);
    expect(result.action).toBe('reassigned');

    const o = await orderRow();
    expect(o.buyer_id).toBe(sellers[2]);            // John
    expect(Number(o.amount)).toBe(58000);           // his own highest bid
    expect(o.winner_rank).toBe(3);
    const fresh = new Date(o.payment_deadline).getTime() - Date.now();
    expect(fresh).toBeGreaterThan(6.9 * DAY);
  }, 60000);

  test('H. the new winner received the stored deadline in their notification', async () => {
    const o = await orderRow();
    const note = await pool.query(
      `SELECT message FROM public.notifications WHERE user_id=$1 AND message LIKE $2 ORDER BY created_at DESC LIMIT 1`,
      [o.buyer_id, '%eligible winner%']
    );
    expect(note.rows.length).toBe(1);
    expect(note.rows[0].message).toMatch(new RegExp(new Date(o.payment_deadline).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })));
  });

  test('I. the previous expired winner is not reselected', async () => {
    const o = await orderRow();
    expect(o.buyer_id).not.toBe(sellers[0]);
  });

  test('J. no eligible bidder left -> order.status = expired, auction stays ended', async () => {
    await setDeadline(new Date(Date.now() - DAY).toISOString());
    const result = await processOrderExpiry(ids.order);
    expect(result.action).toBe('expired');

    const o = await orderRow();
    expect(o.status).toBe('expired');
    const auc = await pool.query(`SELECT status FROM public.auctions WHERE id=$1`, [ids.auction]);
    expect(auc.rows[0].status).toBe('ended');      // never relisted automatically
    const orders = await pool.query(`SELECT count(*)::int n FROM public.orders WHERE auction_id=$1`, [ids.auction]);
    expect(orders.rows[0].n).toBe(1);               // still exactly one order
    const bids = await pool.query(`SELECT count(*)::int n FROM public.bids WHERE auction_id=$1`, [ids.auction]);
    expect(bids.rows[0].n).toBe(7);                 // all historical bids preserved
  }, 60000);

  test('K. an expired order is never processed again', async () => {
    const before = await orderRow();
    const again = await processOrderExpiry(ids.order);
    expect(['skipped', 'none']).toContain(again.action);
    const after = await orderRow();
    expect(after.status).toBe('expired');
    expect(after.buyer_id).toBe(before.buyer_id);
    expect(after.winner_rank).toBe(before.winner_rank);
  }, 60000);

  test('L. an unpaid order is never reported as paid', async () => {
    expect(await isOrderPaid(ids.order)).toBe(false);
  });

  test('M. duplicate invocation does not duplicate the winner notices', async () => {
    const rows = await pool.query(
      `SELECT user_id, count(*)::int n FROM public.notifications
        WHERE message LIKE $1 GROUP BY user_id HAVING count(*) > 1`,
      [`%${ids.auction}%`]
    );
    expect(rows.rows).toHaveLength(0);
  });

  test('N. the manual trigger path works on the real schema too', async () => {
    // force the order back into a due-but-unpaid state and use the tested helper
    await pool.query(
      `UPDATE public.orders SET status='pending', buyer_id=$1, amount=71000, winner_rank=1, payment_deadline=$2 WHERE id=$3`,
      [sellers[0], new Date(Date.now() - DAY).toISOString(), ids.order]
    );
    const result = await expireSpecificOrder(ids.order);
    expect(result.action).toBe('reassigned');
    const o = await orderRow();
    expect(o.buyer_id).toBe(sellers[1]);
    expect(o.winner_rank).toBe(2);
  }, 60000);

  test('O. payment truth: a real paid row stops rotation immediately', async () => {
    const { recordManualPayment } = await import('../services/manualPayment.js');
    const o = await orderRow();
    // pay INSIDE the window…
    await setDeadline(new Date(Date.now() + 2 * DAY).toISOString());
    const paid = await recordManualPayment({
      orderId: ids.order, actorId: o.buyer_id, expectedBuyerId: o.buyer_id, source: 'qa',
    });
    expect(paid.ok).toBe(true);
    // …then backdate the deadline: a paid winner is never rotated regardless
    expect(await isOrderPaid(ids.order)).toBe(true);
    await setDeadline(new Date(Date.now() - DAY).toISOString());
    const result = await processOrderExpiry(ids.order);
    expect(['skipped', 'none']).toContain(result.action);
    const after = await orderRow();
    expect(after.buyer_id).toBe(o.buyer_id);         // paid winners are never rotated
  }, 60000);

  test('P. a paid order rotates back to nothing after the window even when unpaid again', async () => {
    const { recordManualPayment } = await import('../services/manualPayment.js');
    const o = await orderRow();
    // remove the payment evidence and re-run: rotation resumes
    await pool.query(`UPDATE public.payments SET status='cancelled' WHERE order_id=$1`, [ids.order]);
    expect(await isOrderPaid(ids.order)).toBe(false);
    const result = await processOrderExpiry(ids.order);
    expect(result.action).toBe('reassigned');
    const after = await orderRow();
    expect(after.winner_rank).toBe(3);
    expect(recordManualPayment).toBeTruthy();
  }, 60000);
});

if (!DATABASE_URL) {
  describe('REAL SCHEMA — skipped without DATABASE_URL', () => {
    test('skipped', () => { expect(true).toBe(true); });
  });
}