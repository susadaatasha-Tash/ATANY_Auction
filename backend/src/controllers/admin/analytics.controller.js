import { pool } from '../../db/pool.js';
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

export const getAnalytics = async (req, res) => {
  const { cfg, count, intervalStr, prevIntervalStr, bkt } = resolveRange(req.query);
  const bucketName = cfg.unit;

  const statusList = ['completed', 'pending', 'ready_pickup'];

  const revenueTrend = (await pool.query(`SELECT ${bkt('created_at')} as month, SUM(amount)::int as value FROM orders WHERE status = ANY($1) AND created_at > NOW() - $2::interval GROUP BY 1 ORDER BY MIN(created_at)`, [statusList, intervalStr])).rows;

  const categoryData = (await pool.query(`SELECT p.category as cat, COUNT(*)::int as count FROM auctions a JOIN products p ON p.id=a.product_id WHERE p.created_at > NOW() - $1::interval GROUP BY p.category`, [intervalStr])).rows;
  const categoryDataFallback = categoryData.length ? categoryData : (await pool.query(`SELECT p.category as cat, COUNT(*)::int as count FROM auctions a JOIN products p ON p.id=a.product_id GROUP BY p.category`)).rows;

  const branchRevenue = (await pool.query(`SELECT b.name as branch, SUM(o.amount)::int as value FROM orders o JOIN branches b ON b.id=o.branch_id WHERE o.status = ANY($1) AND o.created_at > NOW() - $2::interval GROUP BY b.name`, [statusList, intervalStr])).rows;
  const branchRevenueFallback = branchRevenue.length ? branchRevenue : (await pool.query(`SELECT b.name as branch, SUM(o.amount)::int as value FROM orders o JOIN branches b ON b.id=o.branch_id WHERE o.status = ANY($1) GROUP BY b.name`, [statusList])).rows;

  const topItems = (await pool.query(`SELECT p.name, p.category, COUNT(*)::int as units, SUM(o.amount)::int as revenue FROM orders o JOIN auctions a ON a.id=o.auction_id JOIN products p ON p.id=a.product_id WHERE o.status = ANY($1) AND o.created_at > NOW() - $2::interval GROUP BY p.name, p.category, p.id ORDER BY revenue DESC LIMIT 5`, [statusList, intervalStr])).rows;
  const topItemsFallback = topItems.length ? topItems : (await pool.query(`SELECT p.name, p.category, COUNT(*)::int as units, SUM(o.amount)::int as revenue FROM orders o JOIN auctions a ON a.id=o.auction_id JOIN products p ON p.id=a.product_id WHERE o.status = ANY($1) GROUP BY p.name, p.category, p.id ORDER BY revenue DESC LIMIT 5`, [statusList])).rows;

  const userGrowthTrend = (await pool.query(`SELECT ${bkt('created_at')} as month, COUNT(*)::int as value FROM users WHERE created_at > NOW() - $1::interval GROUP BY 1 ORDER BY MIN(created_at)`, [intervalStr])).rows;

  const totalRevenueRow = (await pool.query(`SELECT COALESCE(SUM(amount),0)::int as total FROM orders WHERE status = ANY($1) AND created_at > NOW() - $2::interval`, [statusList, intervalStr])).rows[0];
  const auctionsCompletedRow = (await pool.query(`SELECT COUNT(*)::int as cnt FROM auctions WHERE status='ended' AND end_time > NOW() - $1::interval`, [intervalStr])).rows[0];
  const bidsPlacedRow = (await pool.query(`SELECT COUNT(*)::int as cnt FROM bids WHERE created_at > NOW() - $1::interval`, [intervalStr])).rows[0];
  const newUsersRow = (await pool.query(`SELECT COUNT(*)::int as cnt FROM users WHERE created_at > NOW() - $1::interval`, [intervalStr])).rows[0];

  const prevRevenueRow = (await pool.query(`SELECT COALESCE(SUM(amount),0)::int as total FROM orders WHERE status = ANY($1) AND created_at > NOW() - $2::interval AND created_at <= NOW() - $3::interval`, [statusList, prevIntervalStr, intervalStr])).rows[0];
  const revenueDelta = totalRevenueRow.total && prevRevenueRow.total ? Math.round(((totalRevenueRow.total - prevRevenueRow.total) / prevRevenueRow.total) * 100) : (totalRevenueRow.total ? 100 : 0);

  res.json({
    bucket: bucketName, range: count,
    revenueTrend, categoryData: categoryDataFallback, branchRevenue: branchRevenueFallback, topItems: topItemsFallback,
    userGrowthTrend,
    kpis: {
      totalRevenue: totalRevenueRow.total,
      revenueDelta,
      auctionsCompleted: auctionsCompletedRow.cnt,
      bidsPlaced: bidsPlacedRow.cnt,
      newUsers: newUsersRow.cnt,
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
  csv += '\nTop Item,Category,Units Sold,Revenue (PHP)\n';
  (data.topItems || []).forEach(t => csv += `${t.name},${t.category},${t.units},${t.revenue}\n`);
  if (data.kpis) {
    csv += `\nKPIs (Last ${data.range || ''} ${bucketName}s)\n`;
    csv += `Total Revenue,${data.kpis.totalRevenue}\n`;
    csv += `Auctions Completed,${data.kpis.auctionsCompleted}\n`;
    csv += `Bids Placed,${data.kpis.bidsPlaced}\n`;
    csv += `New Users,${data.kpis.newUsers}\n`;
  }
  res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename=atany-analytics-report.csv');
  res.send(csv);
};
