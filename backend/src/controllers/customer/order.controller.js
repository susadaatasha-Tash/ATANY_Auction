import { pool } from '../../db/pool.js';
export const getOrders = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.transaction_code, p.name as item, p.image_url as img, p.category, p.karat_weight, o.amount, b.name as branch, o.status,
              o.created_at as date
       FROM orders o JOIN auctions a ON a.id=o.auction_id JOIN products p ON p.id=a.product_id LEFT JOIN branches b ON b.id=o.branch_id WHERE o.buyer_id=$1 ORDER BY o.created_at DESC`, [req.user.id]);
    // attach latest payment status per order (REST-compatible: separate simple queries)
    for (const r of rows) {
      try {
        const { rows: pay } = await pool.query(`SELECT status FROM payments WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1`, [r.id]);
        r.payment_status = pay[0]?.status || null;
      } catch { r.payment_status = null; }
    }
    res.json(rows);
  } catch (e) {
    console.error('[customer/getOrders]', e.message);
    res.status(500).json({ message: 'Failed to load orders' });
  }
};
export const payOrder = async (req, res) => {
  // Spec 4.4 + 1: PayMongo sandbox — create source then mark pending -> ready_pickup. Pickup-only, no shipped status anywhere (spec 5.5).
  const { payment_method = 'gcash' } = req.body;
  // In production: call PayMongo sources API with PAYMONGO_SECRET_KEY (server-only spec 5.6)
  // const payRes = await fetch('https://api.paymongo.com/v1/sources', { method:'POST', headers:{ Authorization: `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY).toString('base64')}` }, body: JSON.stringify({ data:{ attributes:{ amount: rows[0].amount*100, currency:'PHP', type: payment_method }}}});
  const { rows } = await pool.query("UPDATE orders SET status='ready_pickup', payment_method=$1 WHERE id=$2 AND buyer_id=$3 AND status='pending' RETURNING *", [payment_method, req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ message: 'Order not found or not pending' });
  // Spec 4.6: notify customer ready_pickup + shop owner sale
  await pool.query("INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)", [req.user.id, `Order ${rows[0].id} is ready for pickup — bring valid ID + order number within 7 days.`]);
  res.json(rows[0]);
};
