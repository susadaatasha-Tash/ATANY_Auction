// backend/src/services/sellerSales.js
// Seller-scoped sales analytics for the Sales & Payouts dashboard.
// Single efficient fetch → summary + 12-month trend + categories + payout
// ledger, all derived from the SAME eligible set so every widget reconciles.
//
// Business rules (authoritative here, frontend only formats):
// - Shop resolved server-side; all queries scoped to the seller's shop.
// - A sale is ELIGIBLE when its latest payment is 'paid'. Failed, cancelled,
//   expired, pending or missing payments never count as revenue.
// - Gross = sum of eligible amounts; commission/payout via services/commission.
// - Pending payout = eligible but order not yet 'completed'.
// - Payout ledger is DERIVED from real orders (no payout-release table exists
//   in this system — rows are never fabricated):
//     order completed            → Paid
//     payment paid, order open   → Scheduled (release on completion)
//     payment processing         → Processing
//     payment failed (no paid)   → Failed
// - Method = seller's default payout account (type + last4, masked); '—' if none.
// - Month grouping uses Asia/Manila wall time (+08:00 fixed offset — no DST in
//   PH, no UTC-midnight misbucketing). All 12 months returned incl. zeros.
import { pool } from '../db/pool.js';
import { COMMISSION_RATE, calculateSellerPayout } from './commission.js';

const MANILA_OFFSET_MS = 8 * 3600 * 1000;

function manilaParts(iso) {
  const d = new Date(new Date(iso).getTime() + MANILA_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() };
}

function manilaDayStart(ms) {
  const d = new Date(ms + MANILA_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - MANILA_OFFSET_MS;
}

export const SALES_RANGES = ['7d', 'month', 'year'];

export function isValidSalesRange(range) {
  return SALES_RANGES.includes(range);
}

// Manila-local range bounds [startMs, endMs]. 7d = today + previous 6 days;
// month = 1st → now; year = Jan 1 → now. End is always "now" (upper-bounded
// by data comparisons using <= where needed; callers use >= start).
export function salesRangeBounds(range, now = new Date()) {
  const nowMs = now.getTime();
  const mp = manilaParts(now.toISOString());
  if (range === '7d') {
    const startOfToday = manilaDayStart(nowMs);
    return { startMs: startOfToday - 6 * 86400000, endMs: nowMs };
  }
  if (range === 'month') {
    return { startMs: Date.UTC(mp.y, mp.m, 1) - MANILA_OFFSET_MS, endMs: nowMs };
  }
  // year (default)
  return { startMs: Date.UTC(mp.y, 0, 1) - MANILA_OFFSET_MS, endMs: nowMs };
}

export function rangeLabel(range, now = new Date()) {
  const fmt = (ms, withYear) => new Date(ms).toLocaleDateString('en-US', withYear
    ? { month: 'long', day: 'numeric', year: 'numeric' }
    : { month: 'long', day: 'numeric' });
  const { startMs, endMs } = salesRangeBounds(range, now);
  if (range === '7d') return { key: '7d', title: 'Last 7 days', period: `${fmt(startMs)}–${fmt(endMs, true)}` };
  if (range === 'month') {
    const mp = manilaParts(now.toISOString());
    const sameYear = manilaParts(new Date(startMs).toISOString()).y === mp.y;
    return { key: 'month', title: 'This month', period: `${fmt(startMs)}–${fmt(endMs, !sameYear)}` };
  }
  return { key: 'year', title: 'This year', period: `${fmt(startMs)}–${fmt(endMs, true)}` };
}

// Trend buckets per range: 7d → 7 daily points; month → daily points for
// elapsed days; year → 12 monthly points (zeros included).
export function trendBuckets(range, now = new Date()) {
  if (range === '7d') {
    const { startMs } = salesRangeBounds('7d', now);
    const out = [];
    for (let i = 0; i < 7; i++) {
      const dayStart = startMs + i * 86400000;
      const d = new Date(dayStart + MANILA_OFFSET_MS);
      out.push({
        key: `d${i}`,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        startMs: dayStart,
        endMs: dayStart + 86400000,
      });
    }
    return out;
  }
  if (range === 'month') {
    const { startMs, endMs } = salesRangeBounds('month', now);
    const out = [];
    for (let t = startMs; t <= endMs; t += 86400000) {
      const d = new Date(t + MANILA_OFFSET_MS);
      out.push({
        key: `d${d.getUTCDate()}`,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        startMs: t,
        endMs: t + 86400000,
      });
    }
    return out;
  }
  const months = last12Months(now);
  return months
    .filter(({ y }) => y === manilaParts(now.toISOString()).y)
    .map(({ y, m }) => ({
      key: `${y}-${m}`,
      label: MONTH_SHORT[m],
      startMs: Date.UTC(y, m, 1) - MANILA_OFFSET_MS,
      endMs: Date.UTC(y, m + 1, 1) - MANILA_OFFSET_MS,
    }));
}

function last12Months(now = new Date()) {
  const base = new Date(now.getTime() + MANILA_OFFSET_MS);
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    out.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  }
  return out;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Latest payment per order: 'paid' wins (unique index ⇒ at most one), else newest. */
function pickLatest(payments) {
  if (!payments.length) return null;
  const paid = payments.find((p) => p.status === 'paid');
  if (paid) return paid;
  return payments.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
}

export async function getSellerShopId(userId) {
  const { rows } = await pool.query('SELECT id FROM shops WHERE user_id=$1', [userId]);
  return rows[0]?.id || null;
}

/**
 * All seller orders with product/auction/payment context, batched (no N+1).
 * Returns null when the seller has no shop (caller returns empty dashboard).
 */
export async function getSellerOrders(shopId) {
  const { rows: products } = await pool.query(
    'SELECT id, name, category FROM products WHERE shop_id=$1',
    [shopId]
  );
  if (!products.length) return { orders: [], productMap: {} };
  const productIds = products.map((p) => p.id);
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const { rows: auctions } = await pool.query(
    `SELECT id, product_id FROM auctions WHERE product_id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`,
    productIds
  );
  if (!auctions.length) return { orders: [], productMap };
  const auctionIds = auctions.map((a) => a.id);
  const auctionProduct = Object.fromEntries(auctions.map((a) => [a.id, a.product_id]));
  const { rows: orders } = await pool.query(
    `SELECT id, auction_id, buyer_id, amount, status, created_at FROM orders WHERE auction_id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY created_at DESC`,
    auctionIds
  );
  if (!orders.length) return { orders: [], productMap };
  const orderIds = orders.map((o) => o.id);
  // Tolerate older databases without the payments table (migration 015):
  // no payments ⇒ no eligible sales ⇒ truthful empty dashboard, never 500.
  let payments = [];
  try {
    const { rows } = await pool.query(
      `SELECT order_id, status, payment_method, paid_at, created_at FROM payments WHERE order_id IN (${orderIds.map((_, i) => `$${i + 1}`).join(',')})`,
      orderIds
    );
    payments = rows;
  } catch {
    payments = [];
  }
  const paymentsByOrder = {};
  for (const p of payments) (paymentsByOrder[p.order_id] = paymentsByOrder[p.order_id] || []).push(p);
  const enriched = orders.map((o) => {
    const product = productMap[auctionProduct[o.auction_id]] || {};
    return {
      ...o,
      product_id: auctionProduct[o.auction_id] || null,
      product_name: product.name || 'Jewelry Item',
      category: product.category || 'Other',
      payment: pickLatest(paymentsByOrder[o.id] || []),
    };
  });
  return { orders: enriched, productMap };
}

export async function getSellerPayoutMethod(shopId) {
  try {
    const { rows: shopRows } = await pool.query('SELECT user_id FROM shops WHERE id=$1', [shopId]);
    const sellerId = shopRows[0]?.user_id;
    if (!sellerId) return null;
    const { rows } = await pool.query(
      `SELECT type, last4 FROM seller_payment_methods WHERE seller_id=$1 ORDER BY is_default DESC, created_at DESC LIMIT 1`,
      [sellerId]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

function maskMethod(method) {
  if (!method) return '—';
  const type = String(method.type || '').toLowerCase();
  const label = type === 'gcash' ? 'GCash' : type === 'card' ? (method.brand ? String(method.brand) : 'Card') : (method.type || 'Account');
  return method.last4 ? `${label} •••• ${method.last4}` : label;
}

function payoutStatusFor(order) {
  const pay = order.payment;
  if (String(order.status).toLowerCase() === 'completed') return 'paid';
  if (!pay) return null;
  if (pay.status === 'failed' || pay.status === 'cancelled' || pay.status === 'expired') return 'failed';
  if (pay.status === 'processing') return 'processing';
  if (pay.status === 'paid') return 'scheduled';
  return null;
}

export function isEligible(order) {
  return order.payment?.status === 'paid';
}

export async function getSellerSalesDashboard(userId, now = new Date(), range = 'month') {
  if (!isValidSalesRange(range)) range = 'month';
  let shopId = null;
  try {
    shopId = await getSellerShopId(userId);
  } catch {
    shopId = null;
  }
  if (!shopId) {
    return emptyDashboard(range, now);
  }
  const { orders } = await getSellerOrders(shopId);
  const method = await getSellerPayoutMethod(shopId);
  const methodLabel = maskMethod(method);
  const { startMs, endMs } = salesRangeBounds(range, now);
  const inRange = (iso) => {
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= startMs && t <= endMs;
  };

  const eligible = orders.filter(isEligible);
  const ranged = eligible.filter((o) => inRange(o.created_at));
  const gross = ranged.reduce((s, o) => s + Number(o.amount || 0), 0);
  const net = ranged.reduce((s, o) => s + calculateSellerPayout(o.amount), 0);
  // Pending payout is a CURRENT balance (all pending money regardless of sale
  // date) — deliberately NOT range-filtered, labeled accordingly downstream.
  const pendingPayout = eligible
    .filter((o) => String(o.status).toLowerCase() !== 'completed')
    .reduce((s, o) => s + calculateSellerPayout(o.amount), 0);

  const revenueTrend = trendBuckets(range, now).map((b) => {
    const g = ranged
      .filter((o) => {
        const t = new Date(o.created_at).getTime();
        return t >= b.startMs && t < b.endMs;
      })
      .reduce((s, o) => s + Number(o.amount || 0), 0);
    return { month: b.label, label: b.label, gross_sales: g, net_payout: Math.round(g * (1 - COMMISSION_RATE)) };
  });

  const byCat = {};
  for (const o of ranged) {
    const c = o.category || 'Other';
    byCat[c] = (byCat[c] || 0) + Number(o.amount || 0);
  }
  const catTotal = Object.values(byCat).reduce((s, v) => s + v, 0);
  const topCategories = Object.entries(byCat)
    .map(([name, revenue]) => ({
      name,
      revenue,
      percent: catTotal ? Math.round((revenue / catTotal) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Payout history is filtered by PAYOUT date (paid_at ?? created_at) — the
  // table represents releases, not sales.
  const payoutHistory = orders
    .map((o) => ({ order: o, payoutStatus: payoutStatusFor(o) }))
    .filter(({ payoutStatus }) => payoutStatus !== null)
    .map(({ order: o, payoutStatus }) => {
      const pay = o.payment;
      return {
        id: o.transaction_code || o.id,
        order_id: o.id,
        date: pay?.paid_at || o.created_at,
        amount: calculateSellerPayout(o.amount),
        gross_amount: Number(o.amount || 0),
        method: methodLabel,
        status: payoutStatus,
      };
    })
    .filter((r) => inRange(r.date))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    range,
    range_label: rangeLabel(range, now),
    summary: {
      gross_sales: gross,
      net_payout: net,
      pending_payout: pendingPayout,
      lots_sold: ranged.length,
      commission_rate: COMMISSION_RATE,
    },
    revenue_trend: revenueTrend,
    top_categories: topCategories,
    payout_history: payoutHistory,
  };
}

function emptyDashboard(range = 'month', now = new Date()) {
  const buckets = trendBuckets(range, now).map((b) => ({ month: b.label, label: b.label, gross_sales: 0, net_payout: 0 }));
  return {
    range,
    range_label: rangeLabel(range, now),
    summary: {
      gross_sales: 0, net_payout: 0, pending_payout: 0,
      lots_sold: 0, commission_rate: COMMISSION_RATE,
    },
    revenue_trend: buckets,
    top_categories: [],
    payout_history: [],
  };
}
