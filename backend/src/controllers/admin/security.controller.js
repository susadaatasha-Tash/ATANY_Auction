import { pool } from '../../db/pool.js';
export const listAlerts = async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT sa.*, u.name as customer, u.email as customer_email
      FROM security_alerts sa
      LEFT JOIN users u ON u.id = sa.user_id
      ORDER BY sa.created_at DESC
    `);
    // Ensure activity_trail is parsed array and customer fallback
    const mapped = rows.map(r => ({
      ...r,
      customer: r.customer || (r.user_id ? r.user_id.slice(0,8) : 'Unknown (Guest Checkout)'),
      activity_trail: typeof r.activity_trail === 'string' ? JSON.parse(r.activity_trail || '[]') : (r.activity_trail || []),
    }));
    res.json(mapped);
  } catch (e) {
    console.error('[admin/security:list]', e.message);
    res.status(500).json({ message: 'Failed to load security alerts' });
  }
};
export const updateAlert = async (req, res) => {
  const { status } = req.body; // dismissed | resolved
  const allowedStatuses = ['new', 'dismissed', 'resolved'];
  if (status && !allowedStatuses.includes(status)) return res.status(400).json({ message: `Status must be one of: ${allowedStatuses.join(', ')}` });
  try {
    const { rows } = await pool.query('UPDATE security_alerts SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Alert not found' });
    if (req.body.suspendUserId) {
      // Validate suspendUserId is a UUID
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(req.body.suspendUserId)) return res.status(400).json({ message: 'Invalid user ID' });
      await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [req.body.suspendUserId]);
    }
    res.json(rows[0]);
  } catch (e) {
    console.error('[admin/security:update]', e.message);
    res.status(500).json({ message: 'Failed to update alert' });
  }
};
