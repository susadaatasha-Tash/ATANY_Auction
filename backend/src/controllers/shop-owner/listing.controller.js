// backend/src/controllers/shop-owner/listing.controller.js
// Thin handlers — DB via pool. Spec 4.3: pending -> approved/rejected, resubmit rejected -> pending
import { pool } from '../../db/pool.js';
import { acquireTxClient } from '../../db/dbGuard.js';
import { effectiveStatus } from '../../services/auctionService.js';

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
  // REST-compatible: simple queries + JS compose (JOIN fails on REST fallback).
  // One auction per product is NOT assumed: relists create several auction rows
  // for the same product, so pick the most relevant (live > paused > scheduled
  // > most recently ended). All batch queries — no N+1 per listing.
  const { rows: products } = await pool.query('SELECT * FROM products WHERE shop_id=$1 ORDER BY created_at DESC', [shop?.id]);
  const productIds = products.map(p => p.id);
  let auctionMap = {};
  let bidCountByAuction = {};
  let bidCountByProduct = {};
  let watcherCountByProduct = {};
  if (productIds.length) {
    const { rows: auctions } = await pool.query(
      `SELECT id, product_id, status, start_time, end_time, start_price, current_bid FROM auctions WHERE product_id IN (${productIds.map((_,i)=>`$${i+1}`).join(',')})`,
      productIds
    );
    // Most relevant auction per product: live > paused > scheduled > latest ended.
    const rank = (s) => (s === 'live' ? 0 : s === 'paused' ? 1 : s === 'scheduled' ? 2 : 3);
    for (const a of auctions) {
      const cur = auctionMap[a.product_id];
      if (!cur) { auctionMap[a.product_id] = a; continue; }
      const rCur = rank(String(cur.status).toLowerCase());
      const rNew = rank(String(a.status).toLowerCase());
      if (rNew < rCur) { auctionMap[a.product_id] = a; continue; }
      if (rNew === rCur && rNew === 3 && new Date(a.end_time) > new Date(cur.end_time)) {
        auctionMap[a.product_id] = a;
      }
    }
    // Bid counts are needed for EVERY auction of each product, not just the one
    // shown on the card: deleteListing blocks on the SUM across all auctions,
    // so can_delete must use the same total or the grid would advertise a
    // deletable listing that DELETE then rejects with LISTING_HAS_BIDS.
    const allAuctionIds = auctions.map(a => a.id);
    if (allAuctionIds.length) {
      try {
        const { rows: bidRows } = await pool.query(
          `SELECT auction_id, user_id FROM bids WHERE auction_id IN (${allAuctionIds.map((_,i)=>`$${i+1}`).join(',')})`,
          allAuctionIds
        );
        for (const b of bidRows) {
          bidCountByAuction[b.auction_id] = (bidCountByAuction[b.auction_id] || 0) + 1;
          const productId = auctions.find((a) => a.id === b.auction_id)?.product_id;
          if (productId) bidCountByProduct[productId] = (bidCountByProduct[productId] || 0) + 1;
        }
      } catch {}
    }
    try {
      const { rows: watchRows } = await pool.query(
        `SELECT user_id, product_id FROM watchlists WHERE product_id IN (${productIds.map((_,i)=>`$${i+1}`).join(',')})`,
        productIds
      );
      const seen = new Set();
      for (const w of watchRows) {
        const k = `${w.product_id}:${w.user_id}`;
        if (!seen.has(k)) { seen.add(k); watcherCountByProduct[w.product_id] = (watcherCountByProduct[w.product_id] || 0) + 1; }
      }
    } catch {}
  }
  // Branch is shop-level (shops.home_branch_id) — two queries total, not per row.
  let branchName = null;
  try {
    const sRow = (await pool.query('SELECT home_branch_id FROM shops WHERE id=$1', [shop?.id])).rows[0];
    if (sRow?.home_branch_id) {
      branchName = (await pool.query('SELECT name FROM branches WHERE id=$1', [sRow.home_branch_id])).rows[0]?.name || null;
    }
  } catch {}
  const rows = products.filter(p => p.status === 'pending' || auctionMap[p.id]).map(p => {
    const a = auctionMap[p.id] || null;
    // Server-authoritative deletability — the deciding rule is BID COUNT,
    // never auction status: no attached auction at all → deletable; otherwise
    // deletable only when ZERO bids exist across ALL auctions of the product
    // (exactly what deleteListing re-checks inside its transaction).
    const canDelete = (bidCountByProduct[p.id] || 0) === 0;
    return {
      ...p,
      auction_start_time: a?.start_time || null,
      auction_end_time: a?.end_time || null,
      auction_id: a?.id || null,
      auction_status: a ? String(a.status).toLowerCase() : null,
      branch_name: branchName,
      can_delete: canDelete,
      auction: a ? {
        id: a.id,
        status: String(a.status).toLowerCase(),
        start_time: a.start_time,
        end_time: a.end_time,
        start_price: a.start_price,
        current_bid: a.current_bid,
        bid_count: bidCountByAuction[a.id] || 0,
        watcher_count: watcherCountByProduct[p.id] || 0,
      } : null,
    };
  });
  // Effective status: auction-backed rows use stored status + times (stored
  // 'ended'/'paused' are terminal/authoritative — never time-resurrected);
  // bare products keep the legacy product-state mapping.
  const result = rows.map(p => {
    let computedStatus = p.status;
    if (p.auction) {
      computedStatus = effectiveStatus(p.auction.start_time, p.auction.end_time, p.auction.status);
    } else if (p.status === 'approved') {
      computedStatus = 'live';
    } else if (p.status === 'pending') {
      computedStatus = 'scheduled';
    } else if (p.status === 'rejected') {
      computedStatus = 'ended';
    }
    return { ...p, computed_status: computedStatus };
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

// Delete own listing (product) + its attached auction(s) atomically.
// THE deciding rule is BID COUNT, never auction status:
//   no attached auction → deletable
//   attached auction(s) + zero bids (any status) → deletable
//   one or more bids → 409 LISTING_HAS_BIDS (auction AND listing preserved)
//   linked order/sale → 409 LISTING_HAS_ORDER (financial records never deleted)
// Ownership: shop resolved server-side from req.user; foreign ids → 404
// (never reveal another seller's listing exists). No shop_id trust.
// Race safety: the bid recount happens INSIDE the transaction after row-locking
// the product's auctions (SELECT ... FOR UPDATE), so a bid landing between the
// frontend check and COMMIT aborts the delete instead of slipping through.
// Dependent rows: bids (none by check), auction_reminders CASCADE, notifications
// SET NULL, messages SET NULL per schema — no manual deletes needed, and orders
// (NO ACTION) are pre-checked so the FK can never fire mid-delete.
export const deleteListing = async (req, res) => {
  const shop = (await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
  if (!shop) return res.status(404).json({ message: 'Shop not found' });
  const prod = (await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id])).rows[0];
  if (!prod || String(prod.shop_id) !== String(shop.id)) {
    return res.status(404).json({ message: 'Listing not found' });
  }
  const attached = (await pool.query('SELECT id FROM auctions WHERE product_id=$1', [req.params.id])).rows;
  if (!attached.length) {
    // Bare listing: single REST-compatible DELETE, same as before.
    try {
      await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
      try {
        await pool.query(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
          [req.user.id, 'listing_deleted', 'product', req.params.id, JSON.stringify({ name: prod.name })]
        );
      } catch (logErr) {
        console.warn('[audit log] failed:', logErr.message);
      }
      return res.json({ success: true, id: req.params.id });
    } catch (e) {
      console.error('[shop-owner/deleteListing]', e.message);
      return res.status(500).json({ message: 'Failed to delete listing' });
    }
  }
  // Auction-backed: transactional path needs a real direct client (row locks).
  // Never REST: a mock client cannot lock or roll back atomically.
  let tx;
  try {
    tx = await acquireTxClient('deleteListing');
  } catch (acqErr) {
    return res.status(503).json({ code: 'AUCTION_OPERATION_UNAVAILABLE', message: 'Auction action temporarily unavailable.' });
  }
  const client = tx.client;
  try {
    if (client.__restFallback) {
      return res.status(503).json({ code: 'AUCTION_OPERATION_UNAVAILABLE', message: 'Auction action temporarily unavailable.' });
    }
    await client.query('BEGIN');
    // Lock every auction row for this product first — concurrent bid INSERTs
    // (FK key-share on the parent row) block here until we COMMIT/ROLLBACK.
    const { rows: locked } = await client.query('SELECT id FROM auctions WHERE product_id=$1 FOR UPDATE', [req.params.id]);
    // Authoritative recount INSIDE the transaction (frontend counts ignored).
    let bidTotal = 0;
    for (const a of locked) {
      const { rows: cnt } = await client.query('SELECT COUNT(*)::int AS cnt FROM bids WHERE auction_id=$1', [a.id]);
      bidTotal += Number(cnt[0]?.cnt || 0);
    }
    if (bidTotal > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'LISTING_HAS_BIDS',
        message: 'This listing cannot be deleted because it already has bids.',
      });
    }
    // Financial records are never deleted: any linked order blocks the delete.
    const auctionIds = locked.map(a => a.id);
    if (auctionIds.length) {
      const { rows: linkedOrders } = await client.query(
        `SELECT id FROM orders WHERE auction_id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')}) LIMIT 1`,
        auctionIds
      );
      if (linkedOrders.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'LISTING_HAS_ORDER',
          message: 'This listing cannot be deleted because it is linked to an order.',
        });
      }
      await client.query('DELETE FROM auctions WHERE product_id=$1', [req.params.id]);
    }
    await client.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    try {
      await pool.query(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'listing_deleted', 'product', req.params.id, JSON.stringify({ name: prod.name, auctions: auctionIds.length })]
      );
    } catch (logErr) {
      console.warn('[audit log] failed:', logErr.message);
    }
    return res.json({ success: true, id: req.params.id });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[shop-owner/deleteListing]', e.message);
    return res.status(500).json({ message: 'Failed to delete listing' });
  } finally {
    tx.release();
  }
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
  // Ownership is enforced IN the write itself, not only by the pre-check above:
  // a foreign listing id can never be updated even if this statement is ever
  // reached by another path.
  params.push(shop.id);
  const { rows } = await pool.query(
    `UPDATE products SET ${fields.join(', ')} WHERE id=$${idx} AND shop_id=$${idx + 1} RETURNING *`,
    params
  );
  if (!rows[0]) return res.status(404).json({ message: 'Listing not found' });
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
