// backend/src/controllers/shop-owner/listing.controller.js
// Thin handlers — DB via pool. Spec 4.3: pending -> approved/rejected, resubmit rejected -> pending
import { pool } from '../../db/pool.js';
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
  // REST-compatible: two simple queries + JS compose (JOIN fails on REST fallback)
  const { rows: products } = await pool.query('SELECT * FROM products WHERE shop_id=$1 ORDER BY created_at DESC', [shop?.id]);
  const productIds = products.map(p => p.id);
  let auctionMap = {};
  if (productIds.length) {
    const { rows: auctions } = await pool.query(`SELECT id, product_id, start_time, end_time FROM auctions WHERE product_id IN (${productIds.map((_,i)=>`$${i+1}`).join(',')})`, productIds);
    auctionMap = Object.fromEntries(auctions.map(a => [a.product_id, a]));
  }
  const rows = products.filter(p => p.status === 'pending' || auctionMap[p.id]).map(p => ({
    ...p,
    auction_start_time: auctionMap[p.id]?.start_time || null,
    auction_end_time: auctionMap[p.id]?.end_time || null,
    auction_id: auctionMap[p.id]?.id || null,
  }));
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
