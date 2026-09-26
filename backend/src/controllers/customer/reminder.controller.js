import { pool } from '../../db/pool.js';

export const getReminders = async (req, res) => {
  // REST-compatible: avoid JOIN (isComplexQuery → [] via pool fallback)
  const { rows: reminders } = await pool.query('SELECT * FROM auction_reminders WHERE user_id=$1', [req.user.id]);
  if (!reminders.length) return res.json([]);
  const auctionIds = [...new Set(reminders.map((r) => r.auction_id))];
  const { rows: auctions } = await pool.query(
    `SELECT id, product_id FROM auctions WHERE id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')})`,
    auctionIds
  );
  const map = Object.fromEntries(auctions.map((a) => [a.id, a.product_id]));
  res.json(reminders.map((r) => ({ ...r, product_id: map[r.auction_id] || null })));
};

export const addReminder = async (req, res) => {
  const { auction_id } = req.body;
  if (!auction_id) return res.status(400).json({ message: 'auction_id required' });
  try {
    const { rows } = await pool.query('INSERT INTO auction_reminders (user_id, auction_id) VALUES ($1,$2) ON CONFLICT (user_id, auction_id) DO NOTHING RETURNING *', [req.user.id, auction_id]);
    if (!rows.length) {
      const { rows: existing } = await pool.query('SELECT * FROM auction_reminders WHERE user_id=$1 AND auction_id=$2', [req.user.id, auction_id]);
      return res.json(existing[0] || { message: 'already subscribed' });
    }
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23503') return res.status(400).json({ message: 'Invalid auction_id' });
    throw e;
  }
};

export const removeReminder = async (req, res) => {
  await pool.query('DELETE FROM auction_reminders WHERE user_id=$1 AND auction_id=$2', [req.user.id, req.params.id]);
  res.status(204).end();
};
