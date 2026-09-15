import { pool } from '../../db/pool.js';
import { createPayMongoCheckout, getCheckoutSession, checkoutStatus } from '../../services/paymongoService.js';

export const getOrderDetails = async (req, res) => {
  try {
    const orderId = req.params.id;
    const { rows: orders } = await pool.query(
      `SELECT o.*, p.name as product_name, p.image_url as product_img, p.category, p.karat_weight, p.description as product_desc,
              b.name as branch_name, b.address as branch_address, b.phone as branch_phone, b.hours as branch_hours,
              a.auction_code, a.start_time as auction_start, a.end_time as auction_end, p.id as product_id
       FROM orders o
       JOIN auctions a ON a.id = o.auction_id
       JOIN products p ON p.id = a.product_id
       LEFT JOIN branches b ON b.id = o.branch_id
       WHERE o.id = $1 AND o.buyer_id = $2`,
      [orderId, req.user.id]
    );
    if (!orders.length) return res.status(404).json({ message: 'Order not found' });
    const order = orders[0];
    // latest payment for this order
    const { rows: payments } = await pool.query(
      `SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [orderId]
    );
    let payment = payments[0] || null;

    // POLLING FALLBACK for localhost: if pending/processing with checkout, verify with PayMongo
    if (payment && ['pending','processing'].includes(payment.status) && payment.checkout_session_id) {
      try {
        const checkout = await getCheckoutSession(payment.checkout_session_id);
        const status = checkoutStatus(checkout);
        if (status === 'paid' && payment.status !== 'paid') {
          await pool.query(`UPDATE payments SET status='paid', paid_at=now(), updated_at=now(), metadata=$1 WHERE id=$2`, [JSON.stringify({ checkout_sync: true, raw: checkout?.data?.attributes || checkout }), payment.id]);
          try {
            await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)`, [payment.customer_id, `Payment confirmed for order ${payment.order_id} — we are preparing your jewelry.`]);
          } catch {}
          const { rows: upd } = await pool.query(`SELECT * FROM payments WHERE id=$1`, [payment.id]);
          payment = upd[0] || payment;
          console.log(`[payment-sync] payment ${payment.id} marked paid via polling for order ${payment.order_id}`);
        } else if ((status === 'failed' || status === 'expired') && payment.status !== status) {
          await pool.query(`UPDATE payments SET status=$1, updated_at=now(), metadata=$2 WHERE id=$3`, [status, JSON.stringify({ checkout_sync: true, raw: checkout?.data?.attributes || checkout }), payment.id]);
          const { rows: upd } = await pool.query(`SELECT * FROM payments WHERE id=$1`, [payment.id]);
          payment = upd[0] || payment;
        }
      } catch (e) {
        console.warn(`[payment-sync] Unable to verify checkout session ${payment.checkout_session_id}: ${e.message}`);
      }
    }

    res.json({ order, payment, product: { name: order.product_name, img: order.product_img, category: order.category, karat_weight: order.karat_weight, desc: order.product_desc, id: order.product_id }, branch: { name: order.branch_name, address: order.branch_address, phone: order.branch_phone, hours: order.branch_hours } });
  } catch (e) {
    console.error('[customer/getOrderDetails]', e.message);
    res.status(500).json({ message: 'Failed to load order' });
  }
};

export const createCheckout = async (req, res) => {
  const orderId = req.params.id;
  let { payment_method } = req.body; // gcash, maya, card etc - optional hint
  if (payment_method === 'maya') payment_method = 'paymaya';
  try {
    // verify order belongs to customer and is payable
    const { rows: orders } = await pool.query(
      `SELECT o.*, p.name as product_name, p.image_url as product_img, b.name as branch_name
       FROM orders o
       JOIN auctions a ON a.id = o.auction_id
       JOIN products p ON p.id = a.product_id
       LEFT JOIN branches b ON b.id = o.branch_id
       WHERE o.id = $1 AND o.buyer_id = $2`,
      [orderId, req.user.id]
    );
    if (!orders.length) return res.status(404).json({ message: 'Order not found' });
    const order = orders[0];
    if (order.status !== 'pending') return res.status(400).json({ message: 'Order is not payable' });

    // check existing paid payment
    const { rows: paid } = await pool.query(`SELECT id FROM payments WHERE order_id=$1 AND status='paid' LIMIT 1`, [orderId]);
    if (paid.length) return res.status(400).json({ message: 'Order already paid' });

    // check existing pending/processing checkout that is still active (created < 30min ago) - reuse
    const { rows: existing } = await pool.query(
      `SELECT * FROM payments WHERE order_id=$1 AND status IN ('pending','processing') AND created_at > NOW() - INTERVAL '30 minutes' ORDER BY created_at DESC LIMIT 1`,
      [orderId]
    );
    let payment;
    if (existing.length && existing[0].checkout_session_id) {
      payment = existing[0];
      // try to return existing checkout_url if stored in metadata
      if (payment.metadata?.checkout_url) {
        return res.json({ checkout_url: payment.metadata.checkout_url, payment });
      }
    }

    // create pending payment record — amount from DB order, never from frontend
    const amount = Number(order.amount);
    if (!amount) return res.status(400).json({ message: 'Invalid order amount' });

    // if no existing pending, create new
    if (!payment) {
      const { rows: pRows } = await pool.query(
        `INSERT INTO payments (order_id, customer_id, amount, currency, payment_method, status) VALUES ($1,$2,$3,'PHP',$4,'pending') RETURNING *`,
        [orderId, req.user.id, amount, payment_method || 'gcash']
      );
      payment = pRows[0];
    }

    // call PayMongo
    try {
      const { checkoutId, checkoutUrl } = await createPayMongoCheckout({ order, payment, branch: { name: order.branch_name }, product: { name: order.product_name } });
      await pool.query(
        `UPDATE payments SET checkout_session_id=$1, provider_reference_id=$1, metadata=$2, updated_at=now() WHERE id=$3`,
        [checkoutId, JSON.stringify({ checkout_url: checkoutUrl, payment_method }), payment.id]
      );
      const { rows: upd } = await pool.query(`SELECT * FROM payments WHERE id=$1`, [payment.id]);
      return res.json({ checkout_url: checkoutUrl, payment: upd[0] });
    } catch (payErr) {
      await pool.query(`UPDATE payments SET status='failed', metadata=$1, updated_at=now() WHERE id=$2`, [JSON.stringify({ error: payErr.message }), payment.id]);
      console.error('[paymongo checkout]', payErr.message);
      return res.status(500).json({ message: payErr.message || 'Failed to create checkout' });
    }
  } catch (e) {
    console.error('[customer/createCheckout]', e.message);
    res.status(500).json({ message: 'Failed to create payment' });
  }
};
