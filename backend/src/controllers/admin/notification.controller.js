import { pool } from '../../db/pool.js';
export const sendNotification = async (req, res) => {
  const { audience, message } = req.body;
  // Input validation
  if (!message || typeof message !== 'string' || !message.trim()) return res.status(400).json({ message: 'Message is required' });
  if (message.length > 2000) return res.status(400).json({ message: 'Message must be at most 2000 characters' });
  // Spec 4.6: audiences map to targeted queries; also send via Resend emailService (spec 1)
  const queries = {
    'All Users': 'SELECT id, email FROM users',
    'Active Bidders': "SELECT DISTINCT user_id as id FROM bids WHERE created_at > NOW() - INTERVAL '24 hours'",
    'Winners Awaiting Payment': "SELECT buyer_id as id FROM orders WHERE status='pending'",
  };
  const q = queries[audience] || queries['All Users'];
  try {
    const users = (await pool.query(q)).rows;
    const safeMessage = message.trim();
    for (const u of users) {
      await pool.query('INSERT INTO notifications (user_id, type, message) VALUES ($1,$2,$3)', [u.id, 'auction', safeMessage]);
      // Fire-and-forget Resend email (best-effort); emailService handles missing key gracefully
      const { sendNotificationEmail } = await import('../../services/emailService.js');
      if (u.email) sendNotificationEmail({ to: u.email, subject: 'ATANY Notification', html: `<p>${safeMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` }).catch(()=>{});
    }
    res.json({ sent: users.length });
  } catch (e) {
    console.error('[admin/notifications:send]', e.message);
    res.status(500).json({ message: 'Failed to send notifications' });
  }
};
export const listHistory = async (_req, res) => res.json((await pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50')).rows);
// Admin's own notification mutations — always scoped to the authenticated admin's
// own rows (same ownership rule as customer/shop-owner controllers). Never touches
// another admin's notifications. RLS is left unchanged.
export const markAllRead = async (req, res) => {
  await pool.query('UPDATE notifications SET read=true WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
};
export const markOneRead = async (req, res) => {
  await pool.query('UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
};
export const deleteNotification = async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM notifications WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ message: 'Notification not found' });
  res.status(204).end();
};
