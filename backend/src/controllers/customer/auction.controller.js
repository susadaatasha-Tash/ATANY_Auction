import { pool } from '../../db/pool.js';
import { listAuctions as listAuctionsService, effectiveStatus } from '../../services/auctionService.js';

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
  const { rows: bidCountRows } = await pool.query('SELECT COUNT(*)::int as cnt FROM bids WHERE auction_id=$1', [a.id]);
  const bids = bidCountRows[0]?.cnt || 0;
  const { rows: bidderRows } = await pool.query('SELECT b.amount, b.created_at, u.name FROM bids b LEFT JOIN users u ON u.id=b.user_id WHERE b.auction_id=$1 ORDER BY b.amount DESC LIMIT 10', [a.id]);
  const computedStatus = effectiveStatus(a.start_time, a.end_time);
  const endsInSec = Math.max(0, Math.floor((new Date(a.end_time) - new Date()) / 1000));
  res.json({
    id: a.id, auction_code: a.auction_code, productId: a.product_id, startPrice: a.start_price, currentBid: a.current_bid,
    bids, status: computedStatus, startTime: a.start_time, endTime: a.end_time,
    name: p.name, img: p.image_url, category: p.category, desc: p.description,
    branch_id: b.id, branch_name: b.name, branch_address: b.address,
    endsInSec, bidders: bidderRows,
  });
};
