import { pool } from '../../db/pool.js';

export const listAuditLogs = async (req, res) => {
  try {
    const { action, entity_type, user_id, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, Number(page)) - 1) * Number(limit);
    let where = [];
    let params = [];
    
    if (action) { params.push(action); where.push(`al.action = $${params.length}`); }
    if (entity_type) { params.push(entity_type); where.push(`al.entity_type = $${params.length}`); }
    if (user_id) { params.push(user_id); where.push(`al.user_id = $${params.length}`); }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    
    const countResult = await pool.query(`SELECT COUNT(*)::int as total FROM audit_logs al ${whereClause}`, params);
    const total = countResult.rows?.[0]?.total ?? 0;

    params.push(Number(limit));
    params.push(offset);
    const { rows } = await pool.query(
      `SELECT al.*, u.name as user_name, u.email as user_email
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ).catch(() => ({ rows: [] }));

    res.json({ logs: rows, total, page: Number(page), limit: Number(limit) });
  } catch (e) {
    console.error('listAuditLogs failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch audit logs' });
  }
};
