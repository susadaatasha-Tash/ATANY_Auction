import { pool } from '../../db/pool.js';
export const listNotifications = async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json(rows);
};
export const markAllRead = async (req, res) => {
  await pool.query('UPDATE notifications SET read=true WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
};
export const markOneRead = async (req, res) => {
  await pool.query('UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
};
