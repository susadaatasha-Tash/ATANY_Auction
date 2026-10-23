import { pool } from '../../db/pool.js';
export const getOrders = async (req, res) => {
  try {
    const { rows: orders } = await pool.query('SELECT * FROM orders WHERE buyer_id=$1 ORDER BY created_at DESC', [req.user.id]);
    if (!orders.length) return res.json([]);
    const auctionIds = [...new Set(orders.map(o => o.auction_id).filter(Boolean))];
    const branchIds = [...new Set(orders.map(o => o.branch_id).filter(Boolean))];
    let auctionMap = {};
    if (auctionIds.length) {
      const { rows: auctions } = await pool.query(`SELECT * FROM auctions WHERE id IN (${auctionIds.map((_,i)=>`$${i+1}`).join(',')})`, auctionIds);
      auctionMap = Object.fromEntries(auctions.map(a => [a.id, a]));
    }
    const productIds = [...new Set(Object.values(auctionMap).map(a => a.product_id).filter(Boolean))];
    let productMap = {};
    if (productIds.length) {
      const { rows: products } = await pool.query(`SELECT * FROM products WHERE id IN (${productIds.map((_,i)=>`$${i+1}`).join(',')})`, productIds);
      productMap = Object.fromEntries(products.map(p => [p.id, p]));
    }
    let branchMap = {};
    if (branchIds.length) {
      const { rows: branches } = await pool.query(`SELECT * FROM branches WHERE id IN (${branchIds.map((_,i)=>`$${i+1}`).join(',')})`, branchIds);
      branchMap = Object.fromEntries(branches.map(b => [b.id, b]));
    }
    const rows = orders.map(o => {
      const a = auctionMap[o.auction_id] || {};
      const p = productMap[a.product_id] || {};
      const b = branchMap[o.branch_id] || {};
      const winnerConfirmedAt = o.winner_confirmed_at || o.created_at;
      const paymentDeadline = o.payment_deadline || (winnerConfirmedAt ? new Date(new Date(winnerConfirmedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() : null);
      const isExpired = paymentDeadline && new Date() > new Date(paymentDeadline) && o.status === 'pending';
      return {
        id: o.id,
        transaction_code: o.transaction_code,
        item: p.name,
        img: p.image_url,
        category: p.category,
        karat_weight: o.karat_weight || p.karat_weight,
        amount: o.amount,
        branch: b.name || null,
        branch_id: o.branch_id || null,
        branch_address: b.address || null,
        branch_lat: b.lat ?? null,
        branch_lng: b.lng ?? null,
        status: o.status,
        date: o.created_at,
        winner_confirmed_at: winnerConfirmedAt,
        payment_deadline: paymentDeadline,
        winner_rank: o.winner_rank || 1,
        is_expired: isExpired || false,
        // Display fields already stored on the order/auction — no invented codes.
        auction_code: a.auction_code || null,
        auction_end: a.end_time || null,
        payment_method: o.payment_method || null,
      };
    });
    // attach latest payment status per order (REST-compatible: separate simple queries)
    for (const r of rows) {
      try {
        const { rows: pay } = await pool.query(`SELECT * FROM payments WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1`, [r.id]);
        const payment = pay[0] || null;
        r.payment_status = payment?.status || null;
        r.payment_method = payment?.payment_method || r.payment_method || null;
        r.paid_at = payment?.paid_at || null;
      } catch { r.payment_status = null; }
    }
    res.json(rows);
  } catch (e) {
    console.error('[customer/getOrders]', e.message);
    res.status(500).json({ message: 'Failed to load orders' });
  }
};
export const payOrder = async (req, res) => {
  // LEGACY: Pay at Branch Counter only. Online payments must use PayMongo checkout via POST /customer/orders/:id/payment
  const { payment_method = 'counter' } = req.body;
  // DENYLIST (not a selectable list): every online method must go through the
  // PayMongo checkout, never the counter endpoint. GrabPay / BillEase stay
  // listed even though the provider no longer offers them — dropping them here
  // would silently allow an unsupported method through this endpoint.
  const ONLINE_METHODS = ['gcash', 'card', 'paymaya', 'maya', 'grab_pay', 'qrph', 'billease', 'bank', 'bank_transfer'];
  if (ONLINE_METHODS.includes(String(payment_method).toLowerCase())) {
    return res.status(400).json({ message: 'Online payments must use PayMongo checkout. Use POST /customer/orders/:id/payment' });
  }
  // Only counter / branch-counter allowed here
  if (payment_method !== 'counter' && payment_method !== 'branch_counter') {
    return res.status(400).json({ message: 'Invalid payment method for this endpoint. Use PayMongo checkout for online payments.' });
  }
  const { rows } = await pool.query("UPDATE orders SET status='ready_pickup', payment_method=$1 WHERE id=$2 AND buyer_id=$3 AND status='pending' RETURNING *", [payment_method, req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ message: 'Order not found or not pending' });
  const msg = `Order ${rows[0].id} is ready for pickup — bring valid ID + order number within 7 days.`;
  const { shouldDeliverNotification } = await import('../../services/notificationPreference.js');
  if (await shouldDeliverNotification(req.user.id, 'payout', msg)) {
    await pool.query("INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)", [req.user.id, msg]);
  }
  res.json(rows[0]);
};
