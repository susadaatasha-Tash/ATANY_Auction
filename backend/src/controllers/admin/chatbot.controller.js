import { pool } from '../../db/pool.js';
export const listChatbotLogs = async (_req, res) => {
  // Placeholder table chatbot_sessions — spec 4.8 unresolved flagged for follow-up
  const { rows } = await pool.query('SELECT * FROM chatbot_sessions ORDER BY last_active DESC').catch(() => ({ rows: [] }));
  res.json(rows);
};
