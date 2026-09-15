import { pool } from '../db/pool.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const sendMessage = async (req, res) => {
  const { receiver_id, message, auction_id, order_id } = req.body;
  if (!receiver_id || !message) return res.status(400).json({ message: 'Receiver and message are required' });
  if (receiver_id === req.user.id) return res.status(400).json({ message: 'Cannot message yourself' });
  if (!UUID_RE.test(receiver_id)) return res.status(400).json({ message: 'Invalid receiver ID' });
  try {
    // Look up both sender and receiver roles from DB (message routes don't use requireRole)
    const [senderRes, receiverRes] = await Promise.all([
      pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]),
      pool.query('SELECT id, role FROM users WHERE id = $1', [receiver_id]),
    ]);
    if (!receiverRes.rows[0]) return res.status(404).json({ message: 'Receiver not found' });
    const senderRole = senderRes.rows[0]?.role;
    const receiverRole = receiverRes.rows[0].role;

    // Enforce role-based messaging:
    // - customer can only message shop_owner
    // - shop_owner can only message customer
    // - admin can message anyone
    if (senderRole === 'customer' && receiverRole !== 'shop_owner') {
      return res.status(403).json({ message: 'Customers can only message shop owners' });
    }
    if (senderRole === 'shop_owner' && receiverRole !== 'customer') {
      return res.status(403).json({ message: 'Shop owners can only message customers' });
    }

    const { rows } = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, message, auction_id, order_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, receiver_id, message, auction_id || null, order_id || null]
    );

    // Emit via Socket.io if available
    if (req.io) {
      req.io.to(`user:${receiver_id}`).emit('message:new', rows[0]);
    }

    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('sendMessage failed:', e.message);
    res.status(500).json({ message: 'Failed to send message' });
  }
};

export const getConversations = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (partner_id)
        partner_id, partner_name, partner_role, last_message, last_message_at, unread_count
       FROM (
         SELECT
           CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END as partner_id,
           u.name as partner_name,
           u.role as partner_role,
           m.message as last_message,
           m.created_at as last_message_at,
           CASE WHEN m.receiver_id = $1 AND m.is_read = false THEN 1 ELSE 0 END as unread
         FROM messages m
         JOIN users u ON u.id = CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END
         WHERE m.sender_id = $1 OR m.receiver_id = $1
         ORDER BY m.created_at DESC
       ) sub
       ORDER BY partner_id, last_message_at DESC`,
      [req.user.id]
    );

    // Aggregate unread counts per partner
    const unreadCounts = await pool.query(
      `SELECT sender_id as partner_id, COUNT(*)::int as unread_count
       FROM messages WHERE receiver_id = $1 AND is_read = false
       GROUP BY sender_id`,
      [req.user.id]
    );
    const unreadMap = {};
    unreadCounts.rows.forEach(r => { unreadMap[r.partner_id] = r.unread_count; });

    const conversations = rows.map(r => ({
      partner_id: r.partner_id,
      partner_name: r.partner_name,
      partner_role: r.partner_role,
      last_message: r.last_message,
      last_message_at: r.last_message_at,
      unread_count: unreadMap[r.partner_id] || 0,
    }));

    res.json(conversations);
  } catch (e) {
    console.error('getConversations failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch conversations' });
  }
};

export const getMessages = async (req, res) => {
  const { partner_id } = req.params;
  if (!partner_id) return res.status(400).json({ message: 'Partner ID required' });
  if (!UUID_RE.test(partner_id)) return res.status(400).json({ message: 'Invalid partner ID' });
  // Verify the partner is someone the user has actually messaged (privacy gate)
  try {
    const check = await pool.query(
      `SELECT 1 FROM messages
       WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
       LIMIT 1`,
      [req.user.id, partner_id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'No conversation with this user' });
    }
    const { rows } = await pool.query(
      `SELECT m.*, u.name as sender_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE (m.sender_id = $1 AND m.receiver_id = $2)
          OR (m.sender_id = $2 AND m.receiver_id = $1)
       ORDER BY m.created_at ASC`,
      [req.user.id, partner_id]
    );

    // Mark messages from partner as read
    await pool.query(
      'UPDATE messages SET is_read = true WHERE sender_id = $1 AND receiver_id = $2 AND is_read = false',
      [partner_id, req.user.id]
    );

    res.json(rows);
  } catch (e) {
    console.error('getMessages failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
};

export const markRead = async (req, res) => {
  const { partner_id } = req.params;
  if (!UUID_RE.test(partner_id)) return res.status(400).json({ message: 'Invalid partner ID' });
  try {
    await pool.query(
      'UPDATE messages SET is_read = true WHERE sender_id = $1 AND receiver_id = $2 AND is_read = false',
      [partner_id, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('markRead failed:', e.message);
    res.status(500).json({ message: 'Failed to mark messages as read' });
  }
};
