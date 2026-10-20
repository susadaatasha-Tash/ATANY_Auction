import { pool } from '../../db/pool.js';
export const getWatchlist = async (req, res) => {
  // Watchlist = unique auctions where customer has placed at least one bid
  // Branch-independent, includes ended auctions, no duplicates, REST-compatible
  const { rows: bidRows } = await pool.query('SELECT auction_id, created_at FROM bids WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  if (!bidRows.length) return res.json([]);
  // Deduplicate to unique auctions, keep last bid time
  const seen = new Set();
  const uniq = [];
  const lastBidMap = {};
  for (const r of bidRows) {
    if (!seen.has(r.auction_id)) {
      seen.add(r.auction_id);
      uniq.push(r.auction_id);
      lastBidMap[r.auction_id] = r.created_at;
    }
  }
  const auctionIds = uniq;
  const { rows: auctions } = await pool.query(`SELECT * FROM auctions WHERE id IN (${auctionIds.map((_,i)=>`$${i+1}`).join(',')})`, auctionIds);
  const auctionMap = Object.fromEntries(auctions.map(a => [a.id, a]));
  const productIds = [...new Set(auctions.map(a => a.product_id).filter(Boolean))];
  let productMap = {};
  if (productIds.length) {
    const { rows: products } = await pool.query(`SELECT * FROM products WHERE id IN (${productIds.map((_,i)=>`$${i+1}`).join(',')})`, productIds);
    productMap = Object.fromEntries(products.map(p => [p.id, p]));
  }
  const shopIds = [...new Set(Object.values(productMap).map(p => p.shop_id).filter(Boolean))];
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
  const result = auctions
    .sort((a,b) => new Date(lastBidMap[b.id]) - new Date(lastBidMap[a.id]))
    .map(a => {
      const p = productMap[a.product_id] || {};
      const s = shopMap[p.shop_id] || {};
      const b = branchMap[s.home_branch_id] || {};
      return {
        product_id: p.id,
        auction_id: a.id,
        name: p.name,
        img: p.image_url,
        category: p.category,
        price: p.price,
        currentBid: a.current_bid,
        status: a.status,
        end_time: a.end_time,
        branch_name: b.name,
        branch_address: b.address,
        last_bid_at: lastBidMap[a.id],
      };
    });
  res.json(result);
};
export const addToWatchlist = async (req, res) => {
  const { product_id } = req.body;
  if (!product_id) return res.status(400).json({ message: 'product_id required' });
  try {
    const { rows } = await pool.query('INSERT INTO watchlists (user_id, product_id) VALUES ($1,$2) ON CONFLICT (user_id, product_id) DO NOTHING RETURNING *', [req.user.id, product_id]);
    if (!rows.length) {
      const { rows: existing } = await pool.query('SELECT * FROM watchlists WHERE user_id=$1 AND product_id=$2', [req.user.id, product_id]);
      return res.json(existing[0] || { message: 'already in watchlist' });
    }
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23503') return res.status(400).json({ message: 'Invalid product_id' });
    throw e;
  }
};
export const removeFromWatchlist = async (req, res) => { await pool.query('DELETE FROM watchlists WHERE user_id=$1 AND product_id=$2', [req.user.id, req.params.id]); res.status(204).end(); };
