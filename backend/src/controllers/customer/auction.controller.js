import { pool } from '../../db/pool.js';
import { listAuctions as listAuctionsService, effectiveStatus } from '../../services/auctionService.js';
import { watcherCount as liveWatcherCount } from '../../services/auctionPresence.js';

async function resolveCustomerBranch(req, requestedBranchId) {
  const { rows } = await pool.query(
    'SELECT preferred_branch_id FROM users WHERE id = $1',
    [req.user.id]
  );
  const preferredBranchId = rows[0]?.preferred_branch_id;
  if (!preferredBranchId) {
    return null;
  }
  if (requestedBranchId && requestedBranchId !== preferredBranchId) {
    return preferredBranchId;
  }
  return preferredBranchId;
}

export const listAuctions = async (req, res) => {
  const { branch_id, status } = req.query;
  const resolvedBranchId = await resolveCustomerBranch(req, branch_id);
  if (!resolvedBranchId) {
    return res.json([]);
  }
  const rows = await listAuctionsService({ branchId: resolvedBranchId, status });
  res.json(rows);
};
export const listLiveAuctions = async (req, res) => {
  req.query.status = req.query.status || 'live';
  return listAuctions(req, res);
};
export const getAuction = async (req, res) => {
  const { rows: auctionRows } = await pool.query('SELECT * FROM auctions WHERE id=$1', [req.params.id]);
  if (!auctionRows.length) return res.status(404).json({ message: 'Not found' });
  const a = auctionRows[0];
  const { rows: productRows } = await pool.query('SELECT * FROM products WHERE id=$1', [a.product_id]);
  const p = productRows[0];
  if (!p) return res.status(404).json({ message: 'Not found' });
  const { rows: shopRows } = await pool.query('SELECT * FROM shops WHERE id=$1', [p.shop_id]);
  const s = shopRows[0];
  if (!s || !s.home_branch_id) return res.status(404).json({ message: 'Not found' });
  const { rows: branchRows } = await pool.query('SELECT * FROM branches WHERE id=$1', [s.home_branch_id]);
  const b = branchRows[0];
  if (!b) return res.status(404).json({ message: 'Not found' });
  const customerBranch = await resolveCustomerBranch(req, b.id);
  if (!customerBranch || b.id !== customerBranch) {
    return res.status(404).json({ message: 'Not found' });
  }
  // REST-compatible: avoid COUNT/JOIN which fail under Supabase REST fallback
  const { rows: bidCountRaw } = await pool.query('SELECT id FROM bids WHERE auction_id=$1', [a.id]);
  const bids = bidCountRaw.length;
  const { rows: bidsRaw } = await pool.query('SELECT * FROM bids WHERE auction_id=$1 ORDER BY amount DESC LIMIT 10', [a.id]);
  const userIds = [...new Set(bidsRaw.map(b => b.user_id).filter(Boolean))];
  let userMap = {};
  if (userIds.length) {
    const { rows: users } = await pool.query(
      `SELECT id, name FROM users WHERE id IN (${userIds.map((_, i) => `$${i + 1}`).join(',')})`,
      userIds
    );
    userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
  }
  const bidderRows = bidsRaw.map(b => ({
    amount: b.amount,
    created_at: b.created_at,
    time: b.created_at,
    name: userMap[b.user_id] || 'Unknown',
    user_id: b.user_id,
    id: b.id,
  }));
  const computedStatus = effectiveStatus(a.start_time, a.end_time);
  const now = new Date();
  const startsInSec = Math.max(0, Math.floor((new Date(a.start_time) - now) / 1000));
  const endsInSec = Math.max(0, Math.floor((new Date(a.end_time) - now) / 1000));
  let watcher_count = 0;
  try { watcher_count = liveWatcherCount(a.id); } catch {}
  res.json({
    id: a.id, auction_code: a.auction_code, productId: a.product_id, startPrice: a.start_price, currentBid: a.current_bid,
    minimum_bid_increment: Number(a.minimum_bid_increment) > 0 ? Number(a.minimum_bid_increment) : 1000,
    watcher_count, watchers: watcher_count,
    bids, status: computedStatus, startTime: a.start_time, endTime: a.end_time,
    name: p.name, img: p.image_url, category: p.category, desc: p.description,
    branch_id: b.id, branch_name: b.name, branch_address: b.address,
    startsInSec, endsInSec, bidders: bidderRows,
  });
};
