// backend/src/controllers/shop-owner/sales.controller.js
// Spec 4.4/4.7: sales are orders where product's shop_id matches. Payout = 90% per original mock
// REST-compatible: decomposes JOINs into simple queries for Supabase REST fallback
import { pool } from '../../db/pool.js';
export const listSales = async (req, res) => {
  try {
    const shop = (await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
    if (!shop) return res.json([]);
    const { rows: products } = await pool.query('SELECT id FROM products WHERE shop_id=$1', [shop.id]);
    if (!products.length) return res.json([]);
    const productIds = products.map(p => p.id);
    const { rows: auctions } = await pool.query(
      `SELECT id, product_id FROM auctions WHERE product_id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`,
      productIds
    );
    if (!auctions.length) return res.json([]);
    const auctionMap = Object.fromEntries(auctions.map(a => [a.id, a.product_id]));
    const auctionIds = auctions.map(a => a.id);
    const { rows: orders } = await pool.query(
      `SELECT id, auction_id, buyer_id, amount, status, created_at, transaction_code FROM orders WHERE auction_id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY created_at DESC`,
      auctionIds
    );
    if (!orders.length) return res.json([]);

    // fetch product names
    const { rows: prodDetails } = await pool.query(
      `SELECT id, name FROM products WHERE id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`,
      productIds
    );
    const prodMap = Object.fromEntries(prodDetails.map(p => [p.id, p.name]));

    // fetch buyer names
    const buyerIds = [...new Set(orders.map(o => o.buyer_id).filter(Boolean))];
    let buyerMap = {};
    if (buyerIds.length) {
      const { rows: buyers } = await pool.query(
        `SELECT id, name FROM users WHERE id IN (${buyerIds.map((_, i) => `$${i + 1}`).join(',')})`,
        buyerIds
      );
      buyerMap = Object.fromEntries(buyers.map(u => [u.id, u.name]));
    }

    // attach payment_status per order (simple, REST-compatible)
    const rows = [];
    for (const o of orders) {
      let payment_status = null;
      try {
        const { rows: pay } = await pool.query(`SELECT status FROM payments WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1`, [o.id]);
        payment_status = pay[0]?.status || null;
      } catch { payment_status = null; }
      const productId = auctionMap[o.auction_id];
      rows.push({
        id: o.id,
        transaction_code: o.transaction_code,
        item: prodMap[productId] || 'Jewelry Item',
        buyer: buyerMap[o.buyer_id] || 'Customer',
        amount: o.amount,
        payout: Math.round(o.amount * 0.9),
        status: o.status,
        payment_status,
        date: o.created_at,
      });
    }
    res.json(rows);
  } catch (e) {
    console.error('[shop-owner/sales]', e.message);
    res.status(500).json({ message: 'Failed to load sales' });
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
  const allowed = ['pending', 'preparing', 'ready_pickup', 'completed'];
  if (!allowed.includes(status)) return res.status(400).json({ message: `status must be one of ${allowed.join(', ')}` });
  try {
    const shop = (await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
    if (!shop) return res.status(404).json({ message: 'Shop not found' });
    // verify order belongs to seller's shop
    const { rows: orderRows } = await pool.query(
      `SELECT o.id, o.status, o.auction_id FROM orders o WHERE o.id=$1`,
      [req.params.id]
    );
    if (!orderRows.length) return res.status(404).json({ message: 'Order not found' });
    const order = orderRows[0];
    const { rows: auctionRows } = await pool.query(`SELECT product_id FROM auctions WHERE id=$1`, [order.auction_id]);
    if (!auctionRows.length) return res.status(404).json({ message: 'Order not found' });
    const { rows: productRows } = await pool.query(`SELECT shop_id, name FROM products WHERE id=$1`, [auctionRows[0].product_id]);
    if (!productRows.length || productRows[0].shop_id !== shop.id) return res.status(404).json({ message: 'Order not found' });

    const current = order.status;
    if (current !== status && !(ALLOWED_TRANSITIONS[current] || []).includes(status)) {
      return res.status(400).json({ message: `Invalid transition ${current} → ${status}` });
    }
    if (['preparing', 'ready_pickup', 'completed'].includes(status)) {
      const { rows: pay } = await pool.query(`SELECT status FROM payments WHERE order_id=$1 AND status='paid' LIMIT 1`, [req.params.id]);
      if (!pay.length) return res.status(400).json({ message: 'Order cannot be prepared until payment is confirmed.' });
    }
    const { rows } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
    try {
      const prodName = productRows[0].name || 'your jewelry';
      const { rows: branchRows } = await pool.query(
        `SELECT b.name as branch_name FROM orders o LEFT JOIN branches b ON b.id=o.branch_id WHERE o.id=$1`,
        [req.params.id]
      );
      const branchName = branchRows[0]?.branch_name || 'branch';
      const msgMap = {
        preparing: `Your ${prodName} is being prepared.`,
        ready_pickup: `Your ${prodName} is ready for pickup at ${branchName}.`,
        completed: 'Enjoy your new piece! Picked up confirmed.',
      };
      if (msgMap[status]) {
        const { rows: o } = await pool.query('SELECT buyer_id FROM orders WHERE id=$1', [req.params.id]);
        if (o[0]?.buyer_id) {
          // prevent duplicate notification on retry
          const { rows: existing } = await pool.query(
            `SELECT id FROM notifications WHERE user_id=$1 AND message=$2 AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1`,
            [o[0].buyer_id, msgMap[status]]
          );
          if (!existing.length) await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)`, [o[0].buyer_id, msgMap[status]]);
        }
      }
    } catch {}
    res.json(rows[0]);
  } catch (e) {
    console.error('[shop-owner/orders:status]', e.message);
    res.status(500).json({ message: 'Failed to update order status' });
  }
};
