import { pool } from '../../db/pool.js';
import { effectiveStatus } from '../../services/auctionService.js';
const VALID_CATEGORIES = ['Rings', 'Necklaces', 'Bracelets', 'Earrings', 'Pendants', 'Chains', 'Watches', 'Other'];
const VALID_PRODUCT_STATUSES = ['pending', 'approved', 'rejected'];
export const crud = {
  list: async (_req, res) => {
    try {
      const { rows: products } = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
      if (!products.length) return res.json([]);

      const shopIds = [...new Set(products.map(p => p.shop_id).filter(Boolean))];
      let shopMap = {};
      if (shopIds.length) {
        const { rows: shops } = await pool.query(
          `SELECT * FROM shops WHERE id IN (${shopIds.map((_, i) => `$${i + 1}`).join(',')})`,
          shopIds
        );
        shopMap = Object.fromEntries(shops.map(s => [s.id, s]));
      }

      const branchIds = [...new Set(Object.values(shopMap).map(s => s.home_branch_id).filter(Boolean))];
      let branchMap = {};
      if (branchIds.length) {
        const { rows: branches } = await pool.query(
          `SELECT * FROM branches WHERE id IN (${branchIds.map((_, i) => `$${i + 1}`).join(',')})`,
          branchIds
        );
        branchMap = Object.fromEntries(branches.map(b => [b.id, b]));
      }

      const userIds = [...new Set(Object.values(shopMap).map(s => s.user_id).filter(Boolean))];
      let userMap = {};
      if (userIds.length) {
        const { rows: users } = await pool.query(
          `SELECT id, name, email FROM users WHERE id IN (${userIds.map((_, i) => `$${i + 1}`).join(',')})`,
          userIds
        );
        userMap = Object.fromEntries(users.map(u => [u.id, u]));
      }

      const productIds = products.map(p => p.id);
      let auctionMap = {};
      if (productIds.length) {
        const { rows: auctions } = await pool.query(
          `SELECT * FROM auctions WHERE product_id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`,
          productIds
        );
        auctionMap = Object.fromEntries(auctions.map(a => [a.product_id, a]));
      }

      const enriched = products.map(p => {
        const shop = shopMap[p.shop_id] || {};
        const branch = branchMap[shop.home_branch_id] || {};
        const seller = userMap[shop.user_id] || {};
        const auction = auctionMap[p.id] || null;
        let computed_status = p.status;
        if (auction) {
          computed_status = effectiveStatus(auction.start_time, auction.end_time);
        }
        return {
          ...p,
          shop_name: shop.shop_name || null,
          seller_name: seller.name || null,
          seller_email: seller.email || null,
          branch_id: branch.id || null,
          branch_name: branch.name || null,
          branch_address: branch.address || null,
          auction_id: auction?.id || null,
          auction_code: auction?.auction_code || null,
          auction_status: auction ? effectiveStatus(auction.start_time, auction.end_time) : null,
          computed_status,
        };
      });
      res.json(enriched);
    } catch (e) {
      console.error('[admin/products:list]', e.message);
      res.status(500).json({ message: 'Failed to load products' });
    }
  },
  get: async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: products } = await pool.query('SELECT * FROM products WHERE id=$1', [id]);
      if (!products.length) return res.status(404).json({ message: 'Product not found' });
      const product = products[0];

      const { rows: shops } = product.shop_id
        ? await pool.query('SELECT * FROM shops WHERE id=$1', [product.shop_id])
        : { rows: [] };
      const shop = shops[0] || {};

      const { rows: branches } = shop.home_branch_id
        ? await pool.query('SELECT * FROM branches WHERE id=$1', [shop.home_branch_id])
        : { rows: [] };
      const branch = branches[0] || {};

      const { rows: userRows } = shop.user_id
        ? await pool.query('SELECT id, name, email FROM users WHERE id=$1', [shop.user_id])
        : { rows: [] };
      const user = userRows[0] || {};

      const { rows: auctions } = await pool.query('SELECT * FROM auctions WHERE product_id=$1', [id]);
      const auction = auctions[0] || null;
      let auctionInfo = null;
      if (auction) {
        const now = new Date();
        const { rows: bidRows } = await pool.query('SELECT * FROM bids WHERE auction_id=$1 ORDER BY amount DESC', [auction.id]);
        const bidderIds = [...new Set(bidRows.map(b => b.user_id).filter(Boolean))];
        let bidderMap = {};
        if (bidderIds.length) {
          const { rows: bidders } = await pool.query(`SELECT id, name FROM users WHERE id IN (${bidderIds.map((_,i)=>`$${i+1}`).join(',')})`, bidderIds);
          bidderMap = Object.fromEntries(bidders.map(u => [u.id, u.name]));
        }
        const bids = bidRows.map(b => ({ ...b, bidder_name: bidderMap[b.user_id] || null }));
        const uniqueBidders = new Set(bids.map(b => b.user_id)).size;
        auctionInfo = {
          id: auction.id,
          auction_code: auction.auction_code,
          start_price: auction.start_price,
          current_bid: auction.current_bid,
          status: effectiveStatus(auction.start_time, auction.end_time),
          start_time: auction.start_time,
          end_time: auction.end_time,
          endsInSec: Math.max(0, Math.floor((new Date(auction.end_time) - now) / 1000)),
          total_bids: bids.length,
          participants: uniqueBidders,
          bids: bids.map((b, i) => ({
            rank: i + 1,
            amount: b.amount,
            bidder_name: b.bidder_name || 'Anonymous',
            created_at: b.created_at,
          })),
        };
      }

      let orderInfo = null;
      if (auction) {
        const { rows: orders } = await pool.query('SELECT * FROM orders WHERE auction_id=$1', [auction.id]);
        const order = orders[0] || null;
        if (order) {
          const { rows: buyerRows } = order.buyer_id
            ? await pool.query('SELECT id, name, email FROM users WHERE id=$1', [order.buyer_id])
            : { rows: [] };
          orderInfo = {
            id: order.id,
            transaction_code: order.transaction_code,
            amount: order.amount,
            status: order.status,
            payment_method: order.payment_method,
            created_at: order.created_at,
            buyer: buyerRows[0] || null,
          };
        }
      }

      res.json({
        ...product,
        shop: { id: shop.id, name: shop.shop_name, owner_name: user.name, owner_email: user.email },
        branch: { id: branch.id, name: branch.name, address: branch.address },
        auction: auctionInfo,
        order: orderInfo,
      });
    } catch (e) {
      console.error('[admin/products:get]', e.message);
      res.status(500).json({ message: 'Failed to load product' });
    }
  },
  create: async (req, res) => {
    const { name, category, karat_weight, price, stock, description, image_url } = req.body;
    // Input validation
    if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ message: 'Product name is required' });
    if (name.length > 200) return res.status(400).json({ message: 'Product name must be at most 200 characters' });
    if (category && !VALID_CATEGORIES.includes(category)) return res.status(400).json({ message: `Category must be one of: ${VALID_CATEGORIES.join(', ')}` });
    if (price !== undefined && (isNaN(Number(price)) || Number(price) < 0)) return res.status(400).json({ message: 'Price must be a non-negative number' });
    if (stock !== undefined && (isNaN(Number(stock)) || Number(stock) < 0)) return res.status(400).json({ message: 'Stock must be a non-negative number' });
    if (description && typeof description === 'string' && description.length > 2000) return res.status(400).json({ message: 'Description must be at most 2000 characters' });
    try {
      const { rows } = await pool.query('INSERT INTO products (shop_id, name, category, karat_weight, price, stock, description, image_url, status) VALUES ((SELECT id FROM shops LIMIT 1), $1,$2,$3,$4,$5,$6,$7, $8) RETURNING *', [name.trim(), category || null, karat_weight || null, Number(price) || 0, Number(stock) || 0, description || null, image_url || null, 'approved']);
      res.status(201).json(rows[0]);
    } catch (e) {
      console.error('[admin/products:create]', e.message);
      res.status(500).json({ message: 'Failed to create product' });
    }
  },
  bulk: async (req, res) => {
    const { rows } = req.body; // [{ name, category, karat_weight, price, stock }]
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ message: 'rows required' });
    if (rows.length > 100) return res.status(400).json({ message: 'Maximum 100 items per bulk import' });
    let inserted = 0;
    for (const r of rows) {
      if (!r.name || !r.category || !r.price) continue;
      if (!VALID_CATEGORIES.includes(r.category)) continue;
      if (isNaN(Number(r.price)) || Number(r.price) < 0) continue;
      await pool.query('INSERT INTO products (shop_id, name, category, karat_weight, price, stock, status) VALUES ((SELECT id FROM shops LIMIT 1), $1,$2,$3,$4,$5,$6)', [String(r.name).slice(0, 200), r.category, r.karat_weight || null, Number(r.price), Number(r.stock || 0), 'pending']);
      inserted++;
    }
    res.json({ inserted });
  },
  update: async (req, res) => {
    const { name, category, karat_weight, price, stock, status } = req.body;
    // Input validation
    if (name !== undefined && (!name || typeof name !== 'string' || !name.trim())) return res.status(400).json({ message: 'Product name cannot be empty' });
    if (name && name.length > 200) return res.status(400).json({ message: 'Product name must be at most 200 characters' });
    if (category && !VALID_CATEGORIES.includes(category)) return res.status(400).json({ message: `Category must be one of: ${VALID_CATEGORIES.join(', ')}` });
    if (price !== undefined && (isNaN(Number(price)) || Number(price) < 0)) return res.status(400).json({ message: 'Price must be a non-negative number' });
    if (stock !== undefined && (isNaN(Number(stock)) || Number(stock) < 0)) return res.status(400).json({ message: 'Stock must be a non-negative number' });
    if (status && !VALID_PRODUCT_STATUSES.includes(status)) return res.status(400).json({ message: `Status must be one of: ${VALID_PRODUCT_STATUSES.join(', ')}` });
    const fields = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name=$${idx++}`); params.push(name); }
    if (category !== undefined) { fields.push(`category=$${idx++}`); params.push(category); }
    if (karat_weight !== undefined) { fields.push(`karat_weight=$${idx++}`); params.push(karat_weight); }
    if (price !== undefined) { fields.push(`price=$${idx++}`); params.push(price); }
    if (stock !== undefined) { fields.push(`stock=$${idx++}`); params.push(stock); }
    if (status !== undefined) { fields.push(`status=$${idx++}`); params.push(status); }
    if (fields.length === 0) return res.status(400).json({ message: 'No fields to update' });
    params.push(req.params.id);
    const { rows } = await pool.query(`UPDATE products SET ${fields.join(', ')} WHERE id=$${idx} RETURNING *`, params);
    if (!rows.length) return res.status(404).json({ message: 'Product not found' });
    const product = rows[0];
    // Fix: approving a product must automatically create an auction so it appears on Live Auctions.
    // Previously PUT /admin/products/:id only flipped products.status to 'approved' and never inserted into auctions,
    // so the customer query (a.status IN ('live','scheduled') JOIN products) had nothing to show — step 2 break.
    if (status === 'approved') {
      try {
        const existing = await pool.query('SELECT id FROM auctions WHERE product_id=$1', [product.id]);
        if (!existing.rows.length) {
          const startPrice = Number(product.price) || 0;
          // Use schedule from admin request, or seller's proposed schedule, or fallback to 7 days
          let startTime = req.body.auction_start_time || req.body.proposed_start_time || req.body.start_time || product.proposed_start_time;
          let endTime = req.body.auction_end_time || req.body.proposed_end_time || req.body.end_time || product.proposed_end_time;
          const duration = Number(req.body.duration_days || req.body.proposed_duration_days || product.proposed_duration_days) || null;
          if (startTime && !endTime && duration) endTime = new Date(new Date(startTime).getTime() + duration * 86400000).toISOString();
          if (!startTime && endTime && duration) startTime = new Date(new Date(endTime).getTime() - duration * 86400000).toISOString();
          if (!startTime && !endTime && duration) { startTime = new Date(Date.now() + 24*3600*1000).toISOString(); endTime = new Date(new Date(startTime).getTime() + duration*86400000).toISOString(); }
          // Fallback to hardcoded 7 days only if no schedule was ever provided (shared bug fix)
          const startVal = startTime ? new Date(startTime) : new Date();
          const endVal = endTime ? new Date(endTime) : new Date(Date.now() + 7*86400000);
          const auctionStatus = startVal <= new Date() ? 'live' : 'scheduled';
          await pool.query(
            `INSERT INTO auctions (product_id, start_price, current_bid, status, start_time, end_time)
             VALUES ($1,$2,$2,$3,$4,$5)`,
            [product.id, startPrice, auctionStatus, startVal, endVal]
          );
        }
      } catch (e) {
        console.error('[admin/products] auto-create auction failed for', product.id, e.message);
        // Do not fail the approval — product is still approved
      }
    }
    res.json(product);
  },
  remove: async (req, res) => { await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]); res.status(204).end(); }
};
