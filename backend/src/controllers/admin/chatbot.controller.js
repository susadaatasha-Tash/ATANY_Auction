import { pool } from '../../db/pool.js';

// Admin Chatbot Logs — reads the server-persisted chatbot_sessions/chatbot_messages
// tables (migration 023). Simple SELECTs + JS enrichment only (pool REST fallback
// cannot translate JOIN/GROUP BY/aggregates). Mounted behind requireAuth +
// requireRole(['admin']); RLS additionally restricts the tables to admins.
export const listChatbotLogs = async (req, res) => {
  try {
    const { resolved } = req.query;
    const { rows } = await pool.query('SELECT * FROM chatbot_sessions ORDER BY last_active DESC LIMIT 100');
    let sessions = rows;
    if (resolved === 'true') sessions = sessions.filter((s) => s.resolved !== false);
    if (resolved === 'false') sessions = sessions.filter((s) => s.resolved === false);
    const userIds = [...new Set(sessions.map((s) => s.user_id).filter(Boolean))];
    let userMap = {};
    if (userIds.length) {
      const { rows: users } = await pool.query(
        `SELECT id, name, email FROM users WHERE id IN (${userIds.map((_, i) => `$${i + 1}`).join(',')})`,
        userIds
      );
      userMap = Object.fromEntries(users.map((u) => [u.id, u]));
    }
    res.json(sessions.map((s) => ({
      id: s.id,
      user: userMap[s.user_id]?.name || (s.user_id ? s.user_id.slice(0, 8) : 'Guest'),
      user_email: userMap[s.user_id]?.email || null,
      topic: s.topic,
      mode: s.mode,
      messages: Number(s.message_count || 0),
      resolved: s.resolved !== false,
      last: s.last_active,
      created_at: s.created_at,
      last_active: s.last_active,
    })));
  } catch (e) {
    console.error('[admin/chatbot:list]', e.message);
    res.status(500).json({ message: 'Failed to load chatbot sessions' });
  }
};

export const getChatbotSession = async (req, res) => {
  try {
    const { rows: sessions } = await pool.query('SELECT * FROM chatbot_sessions WHERE id=$1', [req.params.id]);
    if (!sessions.length) return res.status(404).json({ message: 'Chatbot session not found' });
    const session = sessions[0];
    let user = null;
    if (session.user_id) {
      const { rows: users } = await pool.query('SELECT id, name, email FROM users WHERE id=$1', [session.user_id]);
      if (users[0]) user = { name: users[0].name, email: users[0].email };
    }
    const { rows: messages } = await pool.query(
      'SELECT id, role, message, created_at FROM chatbot_messages WHERE session_id=$1 ORDER BY created_at ASC',
      [session.id]
    );
    res.json({ session, user, messages });
  } catch (e) {
    console.error('[admin/chatbot:get]', e.message);
    res.status(500).json({ message: 'Failed to load chatbot session' });
  }
};

export const resolveChatbotSession = async (req, res) => {
  const { resolved } = req.body;
  if (typeof resolved !== 'boolean') return res.status(400).json({ message: 'resolved must be true or false' });
  try {
    const { rows } = await pool.query('UPDATE chatbot_sessions SET resolved=$1 WHERE id=$2 RETURNING *', [resolved, req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Chatbot session not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[admin/chatbot:resolve]', e.message);
    res.status(500).json({ message: 'Failed to update chatbot session' });
  }
};
