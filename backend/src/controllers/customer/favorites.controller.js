import { pool } from '../../db/pool.js';

export const getFavorites = async (req, res) => {
  let favs = [];
  try {
    const r = await pool.query('SELECT * FROM favorites WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
    favs = r.rows;
  } catch (e) {
    if (e.message && e.message.includes('favorites')) favs = [];
    else throw e;
  }
  // Fallback for pre-migration heart data still in watchlists (preserve existing favorites until manually migrated)
  if (!favs.length) {
    try {
      const { rows: legacy } = await pool.query('SELECT * FROM watchlists WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
      if (legacy.length) favs = legacy;
    } catch {}
  }
  if (!favs.length) return res.json([]);
  const productIds = [...new Set(favs.map(f => f.product_id))];
  const { rows: products } = await pool.query(`SELECT * FROM products WHERE id IN (${productIds.map((_,i)=>`$${i+1}`).join(',')})`, productIds);
  const productMap = Object.fromEntries(products.map(p => [p.id, p]));
  const shopIds = [...new Set(products.map(p => p.shop_id).filter(Boolean))];
  let shopMap = {};
  if (shopIds.length) {
    const { rows: shops } = await pool.query(`SELECT * FROM shops WHERE id IN (${shopIds.map((_,i)=>`$${i+1}`).join(',')})`, shopIds);
    shopMap = Object.fromEntries(shops.map(s => [s.id, s]));
  }
  const branchIds = [...new Set(Object.values(shopMap).map(s => s.home_branch_id).filter(Boolean))];
  let branchMap = {};
  if (branchIds.length) {
    const { rows: branches } = await pool.query(`SELECT * FROM branches WHERE id IN (${branchIds.map((_,i)=>`$${i+1}`).join(',')})`, branchIds);
    branchMap = Object.fromEntries(branches.map(b => [b.id, b]));
  }
  const auctionProductIds = [...new Set(products.map(p => p.id))];
  let auctionMap = {};
  if (auctionProductIds.length) {
    const { rows: auctions } = await pool.query(`SELECT * FROM auctions WHERE product_id IN (${auctionProductIds.map((_,i)=>`$${i+1}`).join(',')})`, auctionProductIds);
    auctionMap = Object.fromEntries(auctions.map(a => [a.product_id, a]));
  }
  const now = new Date();
  const result = favs.map(f => {
    const p = productMap[f.product_id] || {};
    const a = auctionMap[f.product_id] || {};
    const s = shopMap[p.shop_id] || {};
    const b = branchMap[s.home_branch_id] || {};
    return {
      ...f,
      name: p.name,
      img: p.image_url,
      category: p.category,
      price: p.price,
      currentBid: a.current_bid ?? p.price,
      branch_name: b.name,
      branch_address: b.address,
      auction_status: a.status,
      end_time: a.end_time,
      endsInSec: a.end_time ? Math.max(0, Math.floor((new Date(a.end_time) - now)/1000)) : undefined,
      auction_id: a.id,
    };
  });
  res.json(result);
};

export const addToFavorites = async (req, res) => {
  const { product_id } = req.body;
  if (!product_id) return res.status(400).json({ message: 'product_id required' });
  try {
    const { rows } = await pool.query('INSERT INTO favorites (user_id, product_id) VALUES ($1,$2) ON CONFLICT (user_id, product_id) DO NOTHING RETURNING *', [req.user.id, product_id]);
    if (!rows.length) {
      const { rows: existing } = await pool.query('SELECT * FROM favorites WHERE user_id=$1 AND product_id=$2', [req.user.id, product_id]);
      return res.json(existing[0] || { message: 'already in favorites' });
    }
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23503') return res.status(400).json({ message: 'Invalid product_id' });
    throw e;
  }
};

export const removeFromFavorites = async (req, res) => {
  await pool.query('DELETE FROM favorites WHERE user_id=$1 AND product_id=$2', [req.user.id, req.params.id]);
  res.status(204).end();
};
