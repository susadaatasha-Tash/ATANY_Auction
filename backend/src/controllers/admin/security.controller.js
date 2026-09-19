import { pool } from '../../db/pool.js';
export const listAlerts = async (_req, res) => {
  try {
    const { rows: alerts } = await pool.query('SELECT * FROM security_alerts ORDER BY created_at DESC');
    const userIds = [...new Set(alerts.map(a => a.user_id).filter(Boolean))];
    let userMap = {};
    if (userIds.length) {
      const { rows: users } = await pool.query(`SELECT id, name, email FROM users WHERE id IN (${userIds.map((_,i)=>`$${i+1}`).join(',')})`, userIds);
      userMap = Object.fromEntries(users.map(u => [u.id, u]));
    }
    const mapped = alerts.map(r => ({
      ...r,
      customer: userMap[r.user_id]?.name || r.customer || (r.user_id ? r.user_id.slice(0,8) : 'Unknown (Guest Checkout)'),
      customer_email: userMap[r.user_id]?.email || r.customer_email || null,
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
