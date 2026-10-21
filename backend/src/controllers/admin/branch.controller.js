// backend/src/controllers/admin/branch.controller.js
// Thin handlers — DB via pool. Public GET /branches (no auth) serves customer locator + shop pickers
//
// Query style follows the rest of the admin controllers: simple SELECTs
// (REST-fallback compatible), a FIXED number of queries — no N+1.
import { pool } from '../../db/pool.js';
import { effectiveStatus } from '../../services/auctionService.js';
import { getWatcherCounts } from '../../services/auctionPresence.js';

// Admin revenue rule (the one the Admin Reports page already uses): orders in
// a valid fulfilment state. 'expired' orders are not revenue.
const REVENUE_ORDER_STATUSES = ['completed', 'pending', 'ready_pickup'];

const inPlaceholders = (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(',');

export const listBranches = async (_req, res) => {
  try {
    const { rows: branches } = await pool.query('SELECT * FROM branches ORDER BY name');
    if (!branches.length) return res.json([]);

    // Branch-scoped listings come from the authoritative relationship
    //   listing (products) → shop (shops) → home_branch_id → branches
    const { rows: shops } = await pool.query('SELECT id, shop_name, user_id, home_branch_id FROM shops WHERE home_branch_id IS NOT NULL');
    const shopIds = [...new Set(shops.map((s) => s.id))];
    const branchByShop = new Map(shops.map((s) => [s.id, s.home_branch_id]));

    const lotCounts = {};
    const activeLotCounts = {};
    const productIds = [];
    const productShop = new Map();
    if (shopIds.length) {
      const { rows: products } = await pool.query(
        `SELECT id, shop_id FROM products WHERE shop_id IN (${inPlaceholders(shopIds.length)})`,
        shopIds
      );
      products.forEach((p) => { productIds.push(p.id); productShop.set(p.id, p.shop_id); });
      const { rows: auctions } = productIds.length
        ? await pool.query(
          `SELECT id, product_id, status, start_time, end_time, paused_at FROM auctions WHERE product_id IN (${inPlaceholders(productIds.length)})`,
          productIds
        )
        : { rows: [] };
      const auctionByProduct = new Map(auctions.map((a) => [a.product_id, a]));
      products.forEach((p) => {
        const branchId = branchByShop.get(p.shop_id);
        if (!branchId) return;
        lotCounts[branchId] = (lotCounts[branchId] || 0) + 1;
        const a = auctionByProduct.get(p.id);
        const st = a ? effectiveStatus(a.start_time, a.end_time, a.status) : null;
        if (st === 'live' || st === 'scheduled') {
          activeLotCounts[branchId] = (activeLotCounts[branchId] || 0) + 1;
        }
      });
    }

    // Lifetime branch revenue (valid order states only) — the same admin rule
    // the Reports page uses. The branch is resolved through the same
    // authoritative path: order → auction → listing → shop → home_branch_id.
    const revenueByBranch = {};
    if (productIds.length) {
      const { rows: branchAuctions } = await pool.query(
        `SELECT id, product_id FROM auctions WHERE product_id IN (${inPlaceholders(productIds.length)})`,
        productIds
      );
      const auctionIds = branchAuctions.map((a) => a.id);
      const auctionProduct = new Map(branchAuctions.map((a) => [a.id, a.product_id]));
      if (auctionIds.length) {
        const { rows: orders } = await pool.query(
          `SELECT id, auction_id, amount, status FROM orders WHERE auction_id IN (${inPlaceholders(auctionIds.length)})`,
          auctionIds
        );
        orders.forEach((o) => {
          if (!REVENUE_ORDER_STATUSES.includes(o.status)) return;
          const productId = auctionProduct.get(o.auction_id);
          if (!productId) return;
          const shopId = productShop.get(productId);
          if (!shopId) return;
          const branchId = branchByShop.get(shopId);
          if (!branchId) return;
          revenueByBranch[branchId] = (revenueByBranch[branchId] || 0) + Number(o.amount || 0);
        });
      }
    }

    // The branch "manager" is the owner of the shop anchored at that branch
    // (the branches table has no manager column — this is derived from the
    // same authoritative relationship, never invented).
    const ownerIds = [...new Set(shops.map((s) => s.user_id).filter(Boolean))];
    let ownerNames = {};
    if (ownerIds.length) {
      const { rows: owners } = await pool.query(
        `SELECT id, name FROM users WHERE id IN (${inPlaceholders(ownerIds.length)})`,
        ownerIds
      );
      ownerNames = Object.fromEntries(owners.map((u) => [u.id, u.name]));
    }
    const managerByBranch = {};
    shops.forEach((s) => {
      const name = ownerNames[s.user_id];
      if (!name) return;
      const current = managerByBranch[s.home_branch_id];
      if (!current) managerByBranch[s.home_branch_id] = name;
    });

    res.json(branches.map((b) => ({
      ...b,
      image_url: b.branch_image_url || b.image_url || null,
      lot_count: lotCounts[b.id] || 0,
      active_lot_count: activeLotCounts[b.id] || 0,
      revenue: revenueByBranch[b.id] || 0,
      manager_name: managerByBranch[b.id] || null,
    })));
  } catch (e) {
    console.error('[admin/branches:list]', e.message);
    res.status(500).json({ message: 'Failed to load branches' });
  }
};

/**
 * GET /admin/branches/:id/overview
 * Branch-centric monitoring read for the Admin Branches screen.
 *
 * Everything is scoped SERVER-SIDE through the authoritative relationship
 *   listing (products) → shop (shops) → home_branch_id → branches
 * so an admin can only ever receive records that belong to the selected branch.
 *
 * The records are the SAME listings / auctions / bids / orders the seller
 * created and the customer bid on — this endpoint only READS them.
 */
export const getBranchOverview = async (req, res) => {
  try {
    const branchId = req.params.id;
    const { rows: branchRows } = await pool.query('SELECT * FROM branches WHERE id=$1', [branchId]);
    const branch = branchRows[0];
    if (!branch) return res.status(404).json({ message: 'Branch not found' });

    // 1. shops anchored at this branch
    const { rows: shops } = await pool.query(
      'SELECT id, shop_name, user_id, home_branch_id FROM shops WHERE home_branch_id=$1',
      [branchId]
    );
    const shopIds = shops.map((s) => s.id);
    const shopMap = Object.fromEntries(shops.map((s) => [s.id, s]));

    // 2. branch-scoped listings
    let listings = [];
    if (shopIds.length) {
      const { rows: products } = await pool.query(
        `SELECT * FROM products WHERE shop_id IN (${inPlaceholders(shopIds.length)}) ORDER BY created_at DESC`,
        shopIds
      );
      listings = products;
    }

    // 3. branch-scoped auctions
    const productIds = listings.map((p) => p.id);
    let auctions = [];
    if (productIds.length) {
      const { rows: auctionRows } = await pool.query(
        `SELECT * FROM auctions WHERE product_id IN (${inPlaceholders(productIds.length)}) ORDER BY start_time DESC`,
        productIds
      );
      auctions = auctionRows;
    }
    const auctionIds = auctions.map((a) => a.id);
    const productMap = Object.fromEntries(listings.map((p) => [p.id, p]));

    // 4. bids on those auctions (counts + leader, computed with the same rule
    //    the auction closer uses: highest amount, earliest bid wins a tie,
    //    flagged bids excluded).
    const bidCounts = {};
    const leaders = {};
    if (auctionIds.length) {
      const { rows: bidRows } = await pool.query(
        `SELECT id, auction_id, user_id, amount, flagged, created_at FROM bids WHERE auction_id IN (${inPlaceholders(auctionIds.length)}) ORDER BY amount DESC, created_at ASC`,
        auctionIds
      );
      bidRows.forEach((b) => {
        bidCounts[b.auction_id] = (bidCounts[b.auction_id] || 0) + 1;
        const eligible = b.flagged === false || b.flagged === null || b.flagged === undefined;
        if (eligible && !leaders[b.auction_id]) leaders[b.auction_id] = b;
      });
    }

    // 5. orders = the authoritative result (winner / final price)
    const orders = {};
    if (auctionIds.length) {
      const { rows: orderRows } = await pool.query(
        `SELECT id, auction_id, buyer_id, amount, status, transaction_code, created_at,
                winner_confirmed_at, payment_deadline, winner_rank
           FROM orders WHERE auction_id IN (${inPlaceholders(auctionIds.length)})`,
        auctionIds
      );
      orderRows.forEach((o) => { orders[o.auction_id] = o; });
    }

    // 6. names for the seller / leader / winner
    const nameIds = [...new Set([
      ...shops.map((s) => s.user_id),
      ...Object.values(leaders).map((l) => l.user_id),
      ...Object.values(orders).map((o) => o.buyer_id),
    ].filter(Boolean))];
    let nameMap = {};
    if (nameIds.length) {
      const { rows: users } = await pool.query(
        `SELECT id, name FROM users WHERE id IN (${inPlaceholders(nameIds.length)})`,
        nameIds
      );
      nameMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
    }

    // 7. live watcher presence (unique authenticated customers viewing)
    const watchers = getWatcherCounts(auctionIds);

    const decorateAuction = (a) => {
      const product = productMap[a.product_id] || {};
      const shop = shopMap[product.shop_id] || {};
      const leader = leaders[a.id] || null;
      const order = orders[a.id] || null;
      return {
        id: a.id,
        product_id: a.product_id,
        auction_code: a.auction_code,
        status: effectiveStatus(a.start_time, a.end_time, a.status),
        stored_status: a.status,
        start_time: a.start_time,
        end_time: a.end_time,
        start_price: a.start_price,
        current_bid: a.current_bid,
        minimum_bid_increment: a.minimum_bid_increment,
        paused_at: a.paused_at,
        product: {
          id: product.id,
          name: product.name,
          category: product.category,
          image_url: product.image_url,
          karat_weight: product.karat_weight,
          description: product.description,
        },
        shop: { id: shop.id, name: shop.shop_name, owner_name: nameMap[shop.user_id] || null },
        branch: { id: branch.id, name: branch.name },
        total_bids: bidCounts[a.id] || 0,
        leader: leader ? { user_id: leader.user_id, name: nameMap[leader.user_id] || null, amount: leader.amount } : null,
        watchers: watchers[a.id] || 0,
        // The ORDER is the authority for the CURRENT payable winner (it can be
        // reassigned when a previous winner's payment window expires). The
        // auction's current_bid stays "highest bid ever placed".
        payable_amount: order ? Number(order.amount) || 0 : null,
        winner_rank: order ? (order.winner_rank ?? null) : null,
        order: order ? {
          id: order.id,
          transaction_code: order.transaction_code,
          buyer_id: order.buyer_id,
          winner_name: nameMap[order.buyer_id] || null,
          amount: order.amount,
          status: order.status,
          created_at: order.created_at,
          winner_confirmed_at: order.winner_confirmed_at,
          payment_deadline: order.payment_deadline,
          winner_rank: order.winner_rank,
        } : null,
      };
    };

    const decoratedAuctions = auctions.map(decorateAuction);
    const liveAuctions = decoratedAuctions.filter((a) => a.status === 'live' || a.status === 'paused');
    const recentResults = decoratedAuctions
      .filter((a) => a.status === 'ended')
      .sort((x, y) => new Date(y.end_time || 0) - new Date(x.end_time || 0))
      .slice(0, 6);

    const decoratedListings = listings.map((p) => {
      const shop = shopMap[p.shop_id] || {};
      const auction = decoratedAuctions.find((a) => a.product_id === p.id) || null;
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        image_url: p.image_url,
        karat_weight: p.karat_weight,
        description: p.description,
        price: p.price,
        listing_status: p.status,
        created_at: p.created_at,
        shop: { id: shop.id, name: shop.shop_name, owner_name: nameMap[shop.user_id] || null },
        branch: { id: branch.id, name: branch.name },
        // The authoritative result of a concluded auction (never recomputed).
        final_price: auction?.order?.amount ?? null,
        winner_name: auction?.order?.winner_name ?? null,
        auction: auction ? {
          id: auction.id,
          auction_code: auction.auction_code,
          status: auction.status,
          start_price: auction.start_price,
          current_bid: auction.current_bid,
          minimum_bid_increment: auction.minimum_bid_increment,
          start_time: auction.start_time,
          end_time: auction.end_time,
          total_bids: auction.total_bids,
          watchers: auction.watchers,
        } : null,
      };
    });

    // Revenue for this branch (valid order states, admin rule).
    let revenue = 0;
    if (auctionIds.length) {
      const { rows: orderRows } = await pool.query(
        `SELECT auction_id, amount, status FROM orders WHERE auction_id IN (${inPlaceholders(auctionIds.length)})`,
        auctionIds
      );
      revenue = orderRows
        .filter((o) => REVENUE_ORDER_STATUSES.includes(o.status))
        .reduce((sum, o) => sum + Number(o.amount || 0), 0);
    }

    const kpis = {
      total_jewelry: decoratedListings.length,
      live_auctions: decoratedAuctions.filter((a) => a.status === 'live').length,
      ended_auctions: decoratedAuctions.filter((a) => a.status === 'ended').length,
      scheduled_auctions: decoratedAuctions.filter((a) => a.status === 'scheduled').length,
      paused_auctions: decoratedAuctions.filter((a) => a.status === 'paused').length,
      total_bids: decoratedAuctions.reduce((sum, a) => sum + (a.total_bids || 0), 0),
      revenue,
      watchers: liveAuctions.reduce((sum, a) => sum + (a.watchers || 0), 0),
    };

    // The branch "manager" is the owner of the shop anchored at this branch
    // (the branches table stores no manager — it is derived from the same
    // authoritative relationship, never invented).
    const listingsPerShop = {};
    listings.forEach((l) => { listingsPerShop[l.shop_id] = (listingsPerShop[l.shop_id] || 0) + 1; });
    const primaryShop = [...shops].sort((a, b) => (listingsPerShop[b.id] || 0) - (listingsPerShop[a.id] || 0))[0] || null;

    res.json({
      branch: {
        ...branch,
        image_url: branch.branch_image_url || branch.image_url || null,
        manager_name: primaryShop ? (nameMap[primaryShop.user_id] || null) : null,
      },
      kpis,
      listings: decoratedListings,
      auctions: decoratedAuctions,
      live_auctions: liveAuctions,
      recent_results: recentResults,
    });
  } catch (e) {
    console.error('[admin/branches:overview]', e.message);
    res.status(500).json({ message: 'Failed to load branch overview' });
  }
};

export const createBranch = async (req, res) => {
  const { name, address, lat, lng, hours, phone, status } = req.body;
  // Input validation
  if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ message: 'Branch name is required' });
  if (name.length > 200) return res.status(400).json({ message: 'Branch name must be at most 200 characters' });
  if (address && typeof address === 'string' && address.length > 500) return res.status(400).json({ message: 'Address must be at most 500 characters' });
  if (lat !== undefined && lat !== null && lat !== '' && (Number(lat) < -90 || Number(lat) > 90)) return res.status(400).json({ message: 'Latitude must be between -90 and 90' });
  if (lng !== undefined && lng !== null && lng !== '' && (Number(lng) < -180 || Number(lng) > 180)) return res.status(400).json({ message: 'Longitude must be between -180 and 180' });
  const allowedStatus = ['Open', 'Temporarily Closed'];
  const branchStatus = status || 'Open';
  if (!allowedStatus.includes(branchStatus)) return res.status(400).json({ message: `Status must be one of: ${allowedStatus.join(', ')}` });
  try {
    const { rows } = await pool.query('INSERT INTO branches (name, address, lat, lng, hours, phone, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [name.trim(), address || null, lat || null, lng || null, hours || null, phone || null, branchStatus]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[admin/branches:create]', e.message);
    res.status(500).json({ message: 'Failed to create branch' });
  }
};
export const updateBranch = async (req, res) => {
  const { name, address, lat, lng, hours, phone, status } = req.body;
  // Input validation
  if (name !== undefined && (!name || typeof name !== 'string' || !name.trim())) return res.status(400).json({ message: 'Branch name cannot be empty' });
  if (name && name.length > 200) return res.status(400).json({ message: 'Branch name must be at most 200 characters' });
  if (address !== undefined && address && typeof address === 'string' && address.length > 500) return res.status(400).json({ message: 'Address must be at most 500 characters' });
  if (lat !== undefined && lat !== null && lat !== '' && (Number(lat) < -90 || Number(lat) > 90)) return res.status(400).json({ message: 'Latitude must be between -90 and 90' });
  if (lng !== undefined && lng !== null && lng !== '' && (Number(lng) < -180 || Number(lng) > 180)) return res.status(400).json({ message: 'Longitude must be between -180 and 180' });
  const allowedStatus = ['Open', 'Temporarily Closed'];
  if (status && !allowedStatus.includes(status)) return res.status(400).json({ message: `Status must be one of: ${allowedStatus.join(', ')}` });
  try {
    const { rows } = await pool.query('UPDATE branches SET name=$1, address=$2, lat=$3, lng=$4, hours=$5, phone=$6, status=$7 WHERE id=$8 RETURNING *', [name?.trim() || null, address || null, lat || null, lng || null, hours || null, phone || null, status || null, req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Branch not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[admin/branches:update]', e.message);
    res.status(500).json({ message: 'Failed to update branch' });
  }
};
export const deleteBranch = async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM branches WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Branch not found' });
    res.status(204).end();
  } catch (e) {
    console.error('[admin/branches:delete]', e.message);
    res.status(500).json({ message: 'Failed to delete branch' });
  }
};
