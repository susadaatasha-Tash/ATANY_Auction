import { pool } from '../../db/pool.js';
import {
  REVENUE_RULE_ID, REVENUE_RULE_LABEL, pickDecidingPayment, isPaidPayment,
} from '../../services/revenueRule.js';
// Spec 4.7: real SQL aggregates — no hardcoded arrays.
// Supports per day / week / month / year bucketing via ?bucket= and an optional ?range= count.
// bucket/trunc/unit/label all come from this whitelist (never from raw input) → safe to interpolate.
const BUCKETS = {
  day:   { trunc: 'day',   unit: 'day',   label: `'Mon DD'`, defaultCount: 30 },
  week:  { trunc: 'week',  unit: 'week',  label: `'Mon DD'`, defaultCount: 12 },
  month: { trunc: 'month', unit: 'month', label: `'Mon'`,    defaultCount: 6  },
  year:  { trunc: 'year',  unit: 'year',  label: `'YYYY'`,   defaultCount: 5  },
};

const SAFE_UNITS = new Set(['day', 'week', 'month', 'year']);

// The old order-status allow-list ("completed / pending / ready_pickup") was
// removed after the revenue audit: it counted orders with NO payment at all
// (payment confirmation never updates orders.status) and missed every paid order
// in 'preparing'. Revenue is now defined solely by services/revenueRule.js —
// an order counts only when a payment reached 'paid'.

function resolveRange(query) {
  const cfg = BUCKETS[String(query.bucket || 'month').toLowerCase()] || BUCKETS.month;
  const count = Math.min(Math.max(1, Number(query.range) || cfg.defaultCount), 366);
  if (!SAFE_UNITS.has(cfg.unit)) throw new Error('Invalid bucket unit');
  return {
    cfg,
    count,
    intervalStr: `${count} ${cfg.unit}s`,
    prevIntervalStr: `${count * 2} ${cfg.unit}s`,
    bkt: (col) => `to_char(date_trunc('${cfg.trunc}', ${col}), ${cfg.label})`,
  };
}

/**
 * Simple, REST-safe payments read for the orders in scope. A 'paid' row always
 * wins for an order (see revenueRule.pickDecidingPayment).
 */
async function loadPaymentsForOrders(orders) {
  const map = new Map();
  const ids = [...new Set((orders || []).map((o) => o.id).filter(Boolean))];
  if (!ids.length) return map;
  try {
    const { rows } = await pool.query(
      `SELECT order_id, status, paid_at, created_at FROM payments WHERE order_id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`,
      ids
    );
    rows.forEach((p) => {
      const key = String(p.order_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    });
  } catch {
    // A missing payments table must not silently inflate revenue: report none.
  }
  return map;
}

export const getAnalytics = async (req, res) => {
  const { cfg, count, intervalStr, prevIntervalStr, bkt } = resolveRange(req.query);
  const bucketName = cfg.unit;

  const now = new Date();
  const msForInterval = (str) => {
    const [num, unit] = str.split(' ');
    const n = Number(num);
    if (unit.startsWith('day')) return n * 86400000;
    if (unit.startsWith('week')) return n * 7 * 86400000;
    if (unit.startsWith('month')) return n * 30 * 86400000;
    if (unit.startsWith('year')) return n * 365 * 86400000;
    return n * 86400000;
  };
  const cutoff = new Date(now.getTime() - msForInterval(intervalStr));
  const prevCutoff = new Date(now.getTime() - msForInterval(prevIntervalStr));
  const cutoffPrevEnd = new Date(now.getTime() - msForInterval(intervalStr));

  // Fetch all data via simple queries (REST-compatible) — ORDER BY required for pool REST parser (FROM <table> needs trailing space)
  const { rows: allOrders } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
  const { rows: allProducts } = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
  const { rows: allAuctions } = await pool.query('SELECT * FROM auctions ORDER BY start_time DESC');
  const { rows: allUsers } = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
  const { rows: allBids } = await pool.query('SELECT * FROM bids ORDER BY created_at DESC');
  const { rows: allBranches } = await pool.query('SELECT * FROM branches ORDER BY name ASC');

  // Revenue recognition: ONE authoritative rule (services/revenueRule.js).
  // Money counts only when a payment reached 'paid'. Order status is a
  // fulfillment axis and is deliberately NOT consulted. Loaded as a simple
  // fan-out because pool.js cannot translate JOINs/EXISTS under REST.
  const orderPayments = await loadPaymentsForOrders(allOrders);
  const isRecognized = (o) => isPaidPayment(pickDecidingPayment(orderPayments.get(String(o.id))));

  const productMap = Object.fromEntries(allProducts.map(p => [p.id, p]));
  const auctionMap = Object.fromEntries(allAuctions.map(a => [a.id, a]));
  const branchMap = Object.fromEntries(allBranches.map(b => [b.id, b]));

  // Filter by interval (auctions has no created_at — use start_time)
  const ordersInRange = allOrders.filter(o => isRecognized(o) && new Date(o.created_at) > cutoff);
  const ordersPrevRange = allOrders.filter(o => isRecognized(o) && new Date(o.created_at) > prevCutoff && new Date(o.created_at) <= cutoffPrevEnd);
  const auctionsInRange = allAuctions.filter(a => new Date(a.start_time || a.end_time) > cutoff);
  const usersInRange = allUsers.filter(u => new Date(u.created_at) > cutoff);
  const bidsInRange = allBids.filter(b => new Date(b.created_at) > cutoff);

  // Helper to bucket by date
  const bucketKey = (d) => {
    const date = new Date(d);
    if (cfg.unit === 'day') return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (cfg.unit === 'week') {
      const jan1 = new Date(date.getFullYear(), 0, 1);
      const week = Math.ceil(((date - jan1) / 86400000 + jan1.getDay() + 1) / 7);
      return `W${week}`;
    }
    if (cfg.unit === 'month') return date.toLocaleDateString('en-US', { month: 'short' });
    return String(date.getFullYear());
  };
  const groupByBucket = (items, dateField) => {
    const map = {};
    items.forEach(item => {
      const key = bucketKey(item[dateField]);
      map[key] = (map[key] || 0) + (item.amount || 1);
    });
    return Object.entries(map).map(([month, value]) => ({ month, value }));
  };

  const revenueTrend = (() => {
    const map = {};
    ordersInRange.forEach(o => {
      const key = bucketKey(o.created_at);
      map[key] = (map[key] || 0) + Number(o.amount || 0);
    });
    return Object.entries(map).map(([month, value]) => ({ month, value }));
  })();

  const categoryMap = {};
  auctionsInRange.forEach(a => {
    const p = productMap[a.product_id];
    if (p) categoryMap[p.category] = (categoryMap[p.category] || 0) + 1;
  });
  let categoryData = Object.entries(categoryMap).map(([cat, count]) => ({ cat, count }));
  if (!categoryData.length) {
    const fallbackMap = {};
    allAuctions.forEach(a => {
      const p = productMap[a.product_id];
      if (p) fallbackMap[p.category] = (fallbackMap[p.category] || 0) + 1;
    });
    categoryData = Object.entries(fallbackMap).map(([cat, count]) => ({ cat, count }));
  }

  const branchMapRevenue = {};
  ordersInRange.forEach(o => {
    const b = branchMap[o.branch_id];
    const name = b ? b.name : 'Unknown';
    branchMapRevenue[name] = (branchMapRevenue[name] || 0) + Number(o.amount || 0);
  });
  let branchRevenue = Object.entries(branchMapRevenue).map(([branch, value]) => ({ branch, value }));
  if (!branchRevenue.length) {
    const fallback = {};
    allOrders.filter(isRecognized).forEach(o => {
      const b = branchMap[o.branch_id];
      const name = b ? b.name : 'Unknown';
      fallback[name] = (fallback[name] || 0) + Number(o.amount || 0);
    });
    branchRevenue = Object.entries(fallback).map(([branch, value]) => ({ branch, value }));
  }

  const topMap = {};
  ordersInRange.forEach(o => {
    const a = auctionMap[o.auction_id];
    const p = a ? productMap[a.product_id] : null;
    if (!p) return;
    const key = `${p.name}|${p.category}|${p.id}`;
    if (!topMap[key]) topMap[key] = { name: p.name, category: p.category, units: 0, revenue: 0 };
    topMap[key].units += 1;
    topMap[key].revenue += Number(o.amount || 0);
  });
  let topItems = Object.values(topMap).sort((a,b) => b.revenue - a.revenue).slice(0,5);
  if (!topItems.length) {
    const fallback = {};
    allOrders.filter(isRecognized).forEach(o => {
      const a = auctionMap[o.auction_id];
      const p = a ? productMap[a.product_id] : null;
      if (!p) return;
      const key = `${p.name}|${p.category}|${p.id}`;
      if (!fallback[key]) fallback[key] = { name: p.name, category: p.category, units: 0, revenue: 0 };
      fallback[key].units += 1;
      fallback[key].revenue += Number(o.amount || 0);
    });
    topItems = Object.values(fallback).sort((a,b) => b.revenue - a.revenue).slice(0,5);
  }

  const userGrowthTrend = (() => {
    const map = {};
    usersInRange.forEach(u => {
      const key = bucketKey(u.created_at);
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map).map(([month, value]) => ({ month, value }));
  })();

  const totalRevenue = ordersInRange.reduce((sum, o) => sum + Number(o.amount || 0), 0);
  const prevRevenue = ordersPrevRange.reduce((sum, o) => sum + Number(o.amount || 0), 0);
  const revenueDelta = totalRevenue && prevRevenue ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100) : (totalRevenue ? 100 : 0);
   const auctionsCompleted = allAuctions.filter(a => a.status === 'ended' && new Date(a.end_time || a.start_time) > cutoff).length;
  const bidsPlaced = bidsInRange.length;
  const newUsers = usersInRange.length;

  res.json({
    bucket: bucketName, range: count,
    revenueTrend, categoryData, branchRevenue, topItems,
    userGrowthTrend,
    revenueRule: { id: REVENUE_RULE_ID, label: REVENUE_RULE_LABEL },
    kpis: {
      totalRevenue,
      revenueDelta,
      auctionsCompleted,
      bidsPlaced,
      newUsers,
    }
  });
};

export const exportCsv = async (req, res) => {
  const data = await (async () => {
    const fakeReq = { query: req.query }; const chunks = [];
    const fakeRes = { json: (d) => chunks.push(d) };
    await getAnalytics(fakeReq, fakeRes);
    return chunks[0];
  })();
  const bucketName = data.bucket || 'month';
  const periodCol = bucketName.charAt(0).toUpperCase() + bucketName.slice(1);
  let csv = 'ATANY Analytics Report\n\n';
  csv += `${periodCol},Revenue (PHP)\n`;
  (data.revenueTrend || []).forEach(r => csv += `${r.month},${r.value}\n`);
  csv += `\nNew Users (per ${bucketName}),Sign-ups\n`;
  (data.userGrowthTrend || []).forEach(u => csv += `${u.month},${u.value}\n`);
  csv += '\nCategory,Auctions\n';
  (data.categoryData || []).forEach(c => csv += `${c.cat},${c.count}\n`);
  csv += '\nBranch,Revenue (PHP)\n';
  (data.branchRevenue || []).forEach(b => csv += `${b.branch},${b.value}\n`);
  csv += '\nTop Item,Category,Units Sold,Revenue (PHP),Commission (10%),Seller Payout (90%)\n';
  (data.topItems || []).forEach(t => csv += `${t.name},${t.category},${t.units},${t.revenue},${Math.round(t.revenue * 0.10)},${Math.round(t.revenue * 0.90)}\n`);
  if (data.kpis) {
    csv += `\nKPIs (Last ${data.range || ''} ${bucketName}s)\n`;
    csv += `Total Revenue,${data.kpis.totalRevenue}\n`;
    csv += `Platform Commission (10%),${Math.round((data.kpis.totalRevenue || 0) * 0.10)}\n`;
    csv += `Seller Payouts (90%),${Math.round((data.kpis.totalRevenue || 0) * 0.90)}\n`;
    csv += `Auctions Completed,${data.kpis.auctionsCompleted}\n`;
    csv += `Bids Placed,${data.kpis.bidsPlaced}\n`;
    csv += `New Users,${data.kpis.newUsers}\n`;
  }
  res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename=atany-analytics-report.csv');
  res.send(csv);
};
