// backend/src/controllers/shop-owner/activity.controller.js
// Seller-scoped activity feed — reads ONLY the authenticated seller's own audit_logs rows.
// Mounted behind requireAuth + requireRole('shop_owner'); filtering happens in SQL, never in React.
import { pool } from '../../db/pool.js';

export const listActivity = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, action, entity_type, entity_id, details, created_at
       FROM audit_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error('[shop-owner/activity]', e.message);
    res.status(500).json({ message: 'Failed to load activity' });
  }
};
