import { pool } from '../../db/pool.js';
export const getWatchlist = async (req, res) => {
  const { rows } = await pool.query(`
    SELECT w.*, p.name, p.image_url as img, p.category, p.price,
           COALESCE(a.current_bid, p.price) as "currentBid",
           b.name as branch_name, b.address as branch_address
    FROM watchlists w
    JOIN products p ON p.id = w.product_id
    LEFT JOIN auctions a ON a.product_id = p.id
    LEFT JOIN shops s ON s.id = p.shop_id
    LEFT JOIN branches b ON b.id = s.home_branch_id
    WHERE w.user_id=$1
  `, [req.user.id]);
  res.json(rows);
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
