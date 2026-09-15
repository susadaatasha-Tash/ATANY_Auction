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
  const { rows } = await pool.query(`
    SELECT a.id, a.auction_code, a.product_id as "productId", a.start_price as "startPrice", a.current_bid as "currentBid",
           (SELECT COUNT(*) FROM bids WHERE auction_id = a.id)::int as bids,
           a.status, a.start_time as "startTime", a.end_time as "endTime",
           p.name, p.image_url as img, p.category, p.description as desc,
           b.id as branch_id, b.name as branch_name, b.address as branch_address,
           EXTRACT(EPOCH FROM (a.end_time - NOW()))::int as "endsInSec"
    FROM auctions a
    JOIN products p ON p.id=a.product_id
    JOIN shops s ON s.id=p.shop_id
    JOIN branches b ON b.id=s.home_branch_id
    WHERE a.id=$1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Not found' });
  const auction = rows[0];
  const customerBranch = await resolveCustomerBranch(req, auction.branch_id);
  if (!customerBranch || auction.branch_id !== customerBranch) {
    return res.status(404).json({ message: 'Not found' });
  }
  const bidders = (await pool.query('SELECT u.name, b.amount, b.created_at FROM bids b JOIN users u ON u.id=b.user_id WHERE b.auction_id=$1 ORDER BY b.amount DESC LIMIT 10', [req.params.id])).rows;
  const computedStatus = effectiveStatus(rows[0].startTime, rows[0].endTime);
  res.json({ ...rows[0], status: computedStatus, bidders });
};
