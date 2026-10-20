import { pool } from '../../db/pool.js';

export const listAuditLogs = async (req, res) => {
  try {
    const { action, entity_type, user_id, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, Number(page)) - 1) * Number(limit);
    // Fetch all audit_logs via simple query, filter in JS (REST-compatible)
    const { rows: allLogs } = await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC');
    let filtered = allLogs;
    if (action) filtered = filtered.filter(l => l.action === action);
    if (entity_type) filtered = filtered.filter(l => l.entity_type === entity_type);
    if (user_id) filtered = filtered.filter(l => String(l.user_id) === String(user_id));
    const total = filtered.length;
    const paged = filtered.slice(offset, offset + Number(limit));
    const userIds = [...new Set(paged.map(l => l.user_id).filter(Boolean))];
    let userMap = {};
    if (userIds.length) {
      const { rows: users } = await pool.query(`SELECT id, name, email FROM users WHERE id IN (${userIds.map((_,i)=>`$${i+1}`).join(',')})`, userIds);
      userMap = Object.fromEntries(users.map(u => [u.id, u]));
    }
    const rows = paged.map(l => ({
      ...l,
      user_name: userMap[l.user_id]?.name || null,
      user_email: userMap[l.user_id]?.email || null,
    }));
    res.json({ logs: rows, total, page: Number(page), limit: Number(limit) });
  } catch (e) {
    console.error('listAuditLogs failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch audit logs' });
  }
};
