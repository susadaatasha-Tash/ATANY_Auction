// backend/src/controllers/shop-owner/listing.controller.js
// Thin handlers — DB via pool. Spec 4.3: pending -> approved/rejected, resubmit rejected -> pending
// Listing DELETE rule: primary gate is BID COUNT (not auction status).
// Zero bids → delete allowed. One or more bids → delete forbidden (409).
import { pool } from '../../db/pool.js';
import { effectiveStatus } from '../../services/auctionService.js';
import { acquireTxClient, ServiceUnavailableError } from '../../db/dbGuard.js';
import { resolveDisplayImage } from '../../config/defaultProductImage.js';

const VALID_CATEGORIES = ['Rings', 'Necklaces', 'Bracelets', 'Earrings', 'Pendants', 'Chains', 'Watches', 'Other'];

export const listListings = async (req, res) => {
  let shop = (await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
  if (!shop) {
    try {
      const { rows: u } = await pool.query('SELECT name,email FROM users WHERE id=$1', [req.user.id]);
      const name = u[0]?.name || u[0]?.email || 'My Shop';
      await pool.query('INSERT INTO shops (user_id, shop_name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, name]);
      shop = (await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
    } catch {}
  }
  // REST-compatible: simple queries + JS compose (JOIN fails on REST fallback)
  const { rows: products } = await pool.query('SELECT * FROM products WHERE shop_id=$1 ORDER BY created_at DESC', [shop?.id]);
  const productIds = products.map(p => p.id);
  let auctionMap = {};
  if (productIds.length) {
    const { rows: auctions } = await pool.query(`SELECT id, product_id, start_time, end_time FROM auctions WHERE product_id IN (${productIds.map((_,i)=>`$${i+1}`).join(',')})`, productIds);
    auctionMap = Object.fromEntries(auctions.map(a => [a.product_id, a]));
  }
  // Batch bid counts for all auctions (avoid N+1)
  const auctionIds = Object.values(auctionMap).map(a => a.id).filter(Boolean);
  let bidCountMap = {};
  if (auctionIds.length) {
    const { rows: bidCounts } = await pool.query(
      `SELECT auction_id, COUNT(*)::int as cnt FROM bids WHERE auction_id IN (${auctionIds.map((_,i)=>`$${i+1}`).join(',')}) GROUP BY auction_id`,
      auctionIds
    );
    bidCountMap = Object.fromEntries(bidCounts.map(b => [b.auction_id, Number(b.cnt)]));
  }
  // Batch order counts for all auctions
  let orderCountMap = {};
  if (auctionIds.length) {
    const { rows: orderCounts } = await pool.query(
      `SELECT auction_id, COUNT(*)::int as cnt FROM orders WHERE auction_id IN (${auctionIds.map((_,i)=>`$${i+1}`).join(',')}) GROUP BY auction_id`,
      auctionIds
    );
    orderCountMap = Object.fromEntries(orderCounts.map(b => [b.auction_id, Number(b.cnt)]));
  }

  const rows = products.filter(p => p.status === 'pending' || auctionMap[p.id]).map(p => {
    const auction = auctionMap[p.id] || null;
    const auctionId = auction?.id || null;
    const bidCount = auctionId ? (bidCountMap[auctionId] || 0) : 0;
    const orderCount = auctionId ? (orderCountMap[auctionId] || 0) : 0;
    return {
      ...p,
      auction_start_time: auction?.start_time || null,
      auction_end_time: auction?.end_time || null,
      auction_id: auctionId,
      bid_count: bidCount,
      order_count: orderCount,
      can_delete: bidCount === 0 && orderCount === 0,
    };
  });
  // Compute effective status from auction timestamps when available
  const result = rows.map(p => {
    let computedStatus = p.status;
    if (p.auction_start_time && p.auction_end_time) {
      computedStatus = effectiveStatus(p.auction_start_time, p.auction_end_time);
    } else if (p.status === 'approved') {
      computedStatus = 'live';
    } else if (p.status === 'pending') {
      computedStatus = 'scheduled';
    } else if (p.status === 'rejected') {
      computedStatus = 'ended';
    }
    return {
      ...p,
      // The image the card/detail view must display. The seller's own upload
      // always wins; a product with no photo gets the ATANY default instead of
      // an empty placeholder. `image_url` stays the raw stored value so the
      // edit form never silently persists the fallback.
      display_image_url: resolveDisplayImage(p),
      computed_status: computedStatus,
    };
  });
  res.json(result);
};

export const createListing = async (req, res) => {
  const { name, category, karat, price, desc, image_url, auction_start_time, auction_end_time, proposed_start_time, proposed_end_time, duration_days, proposed_duration_days } = req.body;
  // Input validation
  if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ message: 'Item name is required' });
  if (name.length > 200) return res.status(400).json({ message: 'Item name must be at most 200 characters' });
  if (category && !VALID_CATEGORIES.includes(category)) return res.status(400).json({ message: `Category must be one of: ${VALID_CATEGORIES.join(', ')}` });
  if (price !== undefined && (isNaN(Number(price)) || Number(price) < 0)) return res.status(400).json({ message: 'Price must be a non-negative number' });
  if (desc && typeof desc === 'string' && desc.length > 2000) return res.status(400).json({ message: 'Description must be at most 2000 characters' });
  const startIso = auction_start_time || proposed_start_time || null;
  const endIso = auction_end_time || proposed_end_time || null;
  const duration = Number(duration_days || proposed_duration_days) || null;
  const shop = (await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
  if (!shop) return res.status(404).json({ message: 'Shop not found' });
  // Compute proposed times: if only duration given, derive end from start+duration
  let pStart = startIso ? new Date(startIso) : null;
  let pEnd = endIso ? new Date(endIso) : null;
  if (pStart && !pEnd && duration) pEnd = new Date(pStart.getTime() + duration * 86400000);
  if (!pStart && pEnd && duration) pStart = new Date(pEnd.getTime() - duration * 86400000);
  if (!pStart && !pEnd && duration) { pStart = new Date(Date.now() + 24*3600*1000); pEnd = new Date(pStart.getTime() + duration*86400000); }
  const { rows } = await pool.query(
    "INSERT INTO products (shop_id, name, category, karat_weight, price, description, image_url, status, proposed_start_time, proposed_end_time, proposed_duration_days) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10) RETURNING *",
    [shop.id, name, category, karat, price, desc, image_url, pStart, pEnd, duration]
  );
  // Audit log (best-effort — never blocks the response)
  try {
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'listing_created', 'product', rows[0].id, JSON.stringify({ name, category, price: Number(price) || null })]
    );
  } catch (logErr) {
    console.warn('[audit log] failed:', logErr.message);
  }
  res.status(201).json(rows[0]);
};

export const resubmitListing = async (req, res) => {
  const shop = (await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
  if (!shop) return res.status(404).json({ message: 'Shop not found' });
  const { rows } = await pool.query("UPDATE products SET status='pending' WHERE id=$1 AND shop_id=$2 RETURNING *", [req.params.id, shop.id]);
  // Audit log (best-effort — never blocks the response)
  try {
    if (rows[0]) {
      await pool.query(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'listing_resubmitted', 'product', rows[0].id, JSON.stringify({ name: rows[0].name })]
      );
    }
  } catch (logErr) {
    console.warn('[audit log] failed:', logErr.message);
  }
  res.json(rows[0]);
};

export const updateListing = async (req, res) => {
  const { name, category, karat, price, desc, description, image_url, auction_start_time, auction_end_time, proposed_start_time, proposed_end_time, duration_days, proposed_duration_days } = req.body;
  // Input validation
  if (name !== undefined && (!name || typeof name !== 'string' || !name.trim())) return res.status(400).json({ message: 'Item name cannot be empty' });
  if (name && name.length > 200) return res.status(400).json({ message: 'Item name must be at most 200 characters' });
  if (category && !VALID_CATEGORIES.includes(category)) return res.status(400).json({ message: `Category must be one of: ${VALID_CATEGORIES.join(', ')}` });
  if (price !== undefined && (isNaN(Number(price)) || Number(price) < 0)) return res.status(400).json({ message: 'Price must be a non-negative number' });
  const descVal = desc !== undefined ? desc : description;
  if (descVal && typeof descVal === 'string' && descVal.length > 2000) return res.status(400).json({ message: 'Description must be at most 2000 characters' });
  // Verify ownership and that product is rejected (or at least belongs to shop)
  const shop = (await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
  if (!shop) return res.status(404).json({ message: 'Shop not found' });
  const existing = (await pool.query('SELECT * FROM products WHERE id=$1 AND shop_id=$2', [req.params.id, shop.id])).rows[0];
  if (!existing) return res.status(404).json({ message: 'Listing not found' });
  // Only allow editing rejected items (or any pending? spec says rejected -> pending)
  // But allow editing any for flexibility, but ensure we set status to pending on update
  const fields = [];
  const params = [];
  let idx = 1;
  if (name !== undefined) { fields.push(`name=$${idx++}`); params.push(name); }
  if (category !== undefined) { fields.push(`category=$${idx++}`); params.push(category); }
  // karat can be sent as karat or karat_weight
  if (karat !== undefined) { fields.push(`karat_weight=$${idx++}`); params.push(karat); }
  else if (req.body.karat_weight !== undefined) { fields.push(`karat_weight=$${idx++}`); params.push(req.body.karat_weight); }
  if (price !== undefined) { fields.push(`price=$${idx++}`); params.push(Number(price)); }
  if (descVal !== undefined) { fields.push(`description=$${idx++}`); params.push(descVal); }
  if (image_url !== undefined) { fields.push(`image_url=$${idx++}`); params.push(image_url); }
  // Handle schedule fields
  const startIso = auction_start_time || proposed_start_time || null;
  const endIso = auction_end_time || proposed_end_time || null;
  const duration = Number(duration_days || proposed_duration_days) || null;
  let pStart = startIso ? new Date(startIso) : null;
  let pEnd = endIso ? new Date(endIso) : null;
  if (pStart && !pEnd && duration) pEnd = new Date(pStart.getTime() + duration * 86400000);
  if (!pStart && pEnd && duration) pStart = new Date(pEnd.getTime() - duration * 86400000);
  if (pStart) { fields.push(`proposed_start_time=$${idx++}`); params.push(pStart); }
  if (pEnd) { fields.push(`proposed_end_time=$${idx++}`); params.push(pEnd); }
  if (duration) { fields.push(`proposed_duration_days=$${idx++}`); params.push(duration); }
  // Always set status to pending on edit & resubmit
  fields.push(`status='pending'`);
  if (fields.length === 0) return res.status(400).json({ message: 'No fields to update' });
  params.push(req.params.id);
  const { rows } = await pool.query(`UPDATE products SET ${fields.join(', ')} WHERE id=$${idx} RETURNING *`, params);
  // Audit log (best-effort — never blocks the response)
  try {
    if (rows[0]) {
      await pool.query(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'listing_updated', 'product', rows[0].id, JSON.stringify({ name: rows[0].name })]
      );
    }
  } catch (logErr) {
    console.warn('[audit log] failed:', logErr.message);
  }
  res.json(rows[0]);
};

// ── GET /shop-owner/listings/:id — listing detail for modal ─────────────────────
export const getListingDetail = async (req, res) => {
  try {
    // Resolve seller's shop server-side — never trust client shop_id
    const shop = (await pool.query('SELECT id, home_branch_id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
    if (!shop) return res.status(404).json({ message: 'Shop not found' });

    // Ownership enforced: product must belong to caller's shop
    const product = (await pool.query('SELECT * FROM products WHERE id=$1 AND shop_id=$2', [req.params.id, shop.id])).rows[0];
    if (!product) return res.status(404).json({ message: 'Listing not found' });

    // Most relevant auction for this product (latest by start_time)
    const auction = (await pool.query('SELECT * FROM auctions WHERE product_id=$1 ORDER BY start_time DESC', [product.id])).rows[0] || null;

    // Branch from shop's home_branch_id
    let branch = null;
    if (shop.home_branch_id) {
      const { rows: branches } = await pool.query('SELECT id, name, address FROM branches WHERE id=$1', [shop.home_branch_id]);
      branch = branches[0] || null;
    }

    // Bid count for the attached auction (authoritative, direct from DB)
    let bidCount = 0;
    let orderCount = 0;
    if (auction) {
      const bidResult = await pool.query('SELECT COUNT(*)::int as cnt FROM bids WHERE auction_id=$1', [auction.id]);
      bidCount = bidResult.rows[0]?.cnt || 0;
      const orderResult = await pool.query('SELECT COUNT(*)::int as cnt FROM orders WHERE auction_id=$1', [auction.id]);
      orderCount = orderResult.rows[0]?.cnt || 0;
    }

    const can_delete = bidCount === 0 && orderCount === 0;

    const computedStatus = auction
      ? effectiveStatus(auction.start_time, auction.end_time, auction.status)
      : (product.status === 'approved' ? 'live' : product.status === 'pending' ? 'scheduled' : 'ended');

    res.json({
      listing: {
        ...product,
        // Same resolved display image as the card — a photo-less listing still
        // shows the ATANY default instead of an empty placeholder.
        display_image_url: resolveDisplayImage(product),
        computed_status: computedStatus,
        bid_count: bidCount,
        order_count: orderCount,
        can_delete,
      },
      auction: auction ? {
        id: auction.id,
        status: effectiveStatus(auction.start_time, auction.end_time, auction.status),
        bid_count: bidCount,
        start_price: auction.start_price,
        current_bid: auction.current_bid,
        start_time: auction.start_time,
        end_time: auction.end_time,
      } : null,
      branch: branch ? { id: branch.id, name: branch.name, address: branch.address } : null,
    });
  } catch (e) {
    console.error('[shop-owner/getListingDetail]', e.message);
    res.status(500).json({ message: 'Failed to load listing details' });
  }
};

// ── DELETE /shop-owner/listings/:id — delete own listing with restrictions ─────
// Primary gate: BID COUNT (not auction status).
// 0 bids → delete allowed. 1+ bids → delete forbidden (409 LISTING_HAS_BIDS).
// Transactional: re-checks bid count inside a locked transaction to prevent
// race conditions (bid placed between frontend check and delete commit).
export const deleteListing = async (req, res) => {
  let tx;
  try {
    // Acquire a real direct-pg transaction client (fails closed on REST fallback).
    tx = await acquireTxClient('deleteListing');
    const client = tx.client;
    await client.query('BEGIN');

    // 1. Authenticate seller — already done by requireAuth middleware (req.user.id)

    // 2. Resolve seller's own shop server-side — never trust client shop_id
    const shop = (await client.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
    if (!shop) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Shop not found' });
    }

    // 3. Verify listing belongs to seller — lock the product row
    const product = (await client.query('SELECT * FROM products WHERE id=$1 AND shop_id=$2 FOR UPDATE', [req.params.id, shop.id])).rows[0];
    if (!product) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Listing not found' });
    }

    // 4. Find attached auction if any — lock the auction row
    const auction = (await client.query('SELECT id FROM auctions WHERE product_id=$1 FOR UPDATE', [product.id])).rows[0] || null;
    const auctionId = auction?.id || null;

    // 5. Count bids directly from DB inside the transaction (authoritative)
    let bidCount = 0;
    if (auctionId) {
      const bidResult = await client.query('SELECT COUNT(*)::int as cnt FROM bids WHERE auction_id=$1', [auctionId]);
      bidCount = bidResult.rows[0]?.cnt || 0;
    }

    // 6. If bid count > 0 → 409 LISTING_HAS_BIDS (do not delete anything)
    if (bidCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'LISTING_HAS_BIDS',
        message: 'This listing cannot be deleted because it already has bids.',
      });
    }

    // 7. Check for protected order relationships → separate conflict code
    let orderCount = 0;
    if (auctionId) {
      const orderResult = await client.query('SELECT COUNT(*)::int as cnt FROM orders WHERE auction_id=$1', [auctionId]);
      orderCount = orderResult.rows[0]?.cnt || 0;
    }
    if (orderCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'LISTING_HAS_ORDER',
        message: 'This listing cannot be deleted because it is linked to an order.',
      });
    }

    // 8. Atomic deletion: auction first (if any), then the product
    if (auctionId) {
      await client.query('DELETE FROM auctions WHERE id=$1', [auctionId]);
    }
    await client.query('DELETE FROM products WHERE id=$1', [product.id]);

    await client.query('COMMIT');

    // Audit log (best-effort — never blocks the response)
    try {
      await pool.query(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'listing_deleted', 'product', product.id, JSON.stringify({ name: product.name })]
      );
    } catch (logErr) {
      console.warn('[audit log] failed:', logErr.message);
    }

    res.json({ success: true, id: product.id });
  } catch (e) {
    // Always attempt rollback on any error to avoid partial deletes
    if (tx) {
      try { await tx.client.query('ROLLBACK'); } catch { /* already rolled back or dead */ }
    }
    if (e instanceof ServiceUnavailableError) {
      return res.status(503).json({ message: 'Listing deletion temporarily unavailable' });
    }
    console.error('[shop-owner/deleteListing]', e.message);
    res.status(500).json({ message: 'Failed to delete listing' });
  } finally {
    if (tx) {
      tx.release();
    }
  }
};
