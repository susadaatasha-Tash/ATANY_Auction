import { pool } from '../../db/pool.js';
export const listTransactions = async (_req, res) => {
  try {
    res.json((await pool.query("SELECT o.id, o.transaction_code, u.name as customer, p.name as item, o.amount, b.name as branch, o.status, o.created_at as date FROM orders o LEFT JOIN users u ON u.id=o.buyer_id LEFT JOIN products p ON p.id=(SELECT product_id FROM auctions WHERE id=o.auction_id) LEFT JOIN branches b ON b.id=o.branch_id ORDER BY o.created_at DESC")).rows);
  } catch (e) {
    console.error('[admin/transactions:list]', e.message);
    res.status(500).json({ message: 'Failed to load transactions' });
  }
};
export const markPaid = async (req, res) => {
  try {
    const { rows } = await pool.query("UPDATE orders SET status='ready_pickup' WHERE id=$1 RETURNING *", [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Order not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[admin/transactions:pay]', e.message);
    res.status(500).json({ message: 'Failed to update transaction' });
  }
};

const ALLOWED_TRANSITIONS = {
  pending: ['preparing'],
  preparing: ['ready_pickup'],
  ready_pickup: ['completed'],
  completed: [],
};

export const updateOrderStatus = async (req, res) => {
  const { status } = req.body;
  const allowed = ['pending','preparing','ready_pickup','completed'];
  if (!allowed.includes(status)) return res.status(400).json({ message: `status must be one of ${allowed.join(', ')}` });
  try {
    const { rows: cur } = await pool.query('SELECT status FROM orders WHERE id=$1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ message: 'Order not found' });
    const current = cur[0].status;
    // enforce valid transition (allow admin to stay same? no)
    if (current !== status && !(ALLOWED_TRANSITIONS[current] || []).includes(status)) {
      return res.status(400).json({ message: `Invalid transition ${current} → ${status}` });
    }
    // ensure payment paid before moving to preparing (unless already preparing etc)
    if (['preparing','ready_pickup','completed'].includes(status)) {
      const { rows: pay } = await pool.query(`SELECT status FROM payments WHERE order_id=$1 AND status='paid' LIMIT 1`, [req.params.id]);
      if (!pay.length) return res.status(400).json({ message: 'Cannot fulfill: payment not confirmed' });
    }
    const { rows } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
    try {
      const msgMap = { preparing: 'Your jewelry is being prepared.', ready_pickup: 'Your jewelry is ready for pickup — bring valid ID + order number.', completed: 'Enjoy your new piece! Picked up confirmed.' };
      if (msgMap[status]) {
        const { rows: o } = await pool.query('SELECT buyer_id FROM orders WHERE id=$1', [req.params.id]);
        if (o[0]?.buyer_id) await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)`, [o[0].buyer_id, msgMap[status]]);
      }
    } catch {}
    res.json(rows[0]);
  } catch (e) {
    console.error('[admin/orders:status]', e.message);
    res.status(500).json({ message: 'Failed to update order status' });
  }
};
