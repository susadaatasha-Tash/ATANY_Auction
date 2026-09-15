// backend/src/routes/review.routes.js
// Extension d) — public GET reviews, authenticated POST (requires Auth, but any role can review approved product)
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { pool } from '../db/pool.js';

const router = Router();
router.get('/products/:id/reviews', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM product_reviews WHERE product_id=$1 ORDER BY created_at DESC', [req.params.id]);
  res.json(rows);
});
router.post('/products/:id/reviews', requireAuth, async (req, res) => {
  const { rating, comment } = req.body;
  if (rating < 1 || rating > 5) return res.status(400).json({ message: 'rating 1-5' });
  const { rows } = await pool.query('INSERT INTO product_reviews (product_id, user_id, rating, comment) VALUES ($1,$2,$3,$4) RETURNING *', [req.params.id, req.user.id, rating, (comment || '').slice(0, 500)]);
  res.status(201).json(rows[0]);
});
export default router;
