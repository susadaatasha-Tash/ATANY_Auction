import { pool } from '../../db/pool.js';
import {
  MANUAL_PROVIDER, recordManualPayment, advanceOrderTo, PAYMENT_WINDOW_EXPIRED,
} from '../../services/manualPayment.js';
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
        winner_rank: o.winner_rank ?? 1,
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
  // Counter / manual payment. LEGACY UI path: online payments must use PayMongo
  // checkout via POST /customer/orders/:id/payment.
  const { payment_method = 'counter' } = req.body;
  const ONLINE_METHODS = ['gcash', 'card', 'paymaya', 'maya', 'grab_pay', 'qrph', 'billease', 'bank', 'bank_transfer'];
  if (ONLINE_METHODS.includes(String(payment_method).toLowerCase())) {
    return res.status(400).json({ message: 'Online payments must use PayMongo checkout. Use POST /customer/orders/:id/payment' });
  }
  if (payment_method !== 'counter' && payment_method !== 'branch_counter') {
    return res.status(400).json({ message: 'Invalid payment method for this endpoint. Use PayMongo checkout for online payments.' });
  }

  // 1) Record the money as an authoritative payment record. This is what makes a
  //    counter sale financially equivalent to a gateway sale: revenueRule
  //    recognizes it and winner-expiration stops treating it as unpaid.
  const recorded = await recordManualPayment({
    orderId: req.params.id,
    actorId: req.user.id,
    paymentMethod: payment_method,
    provider: MANUAL_PROVIDER,
    source: 'customer_counter',
    expectedBuyerId: req.user.id, // cross-user access guard
  });
  if (!recorded.ok) {
    if (recorded.reason === PAYMENT_WINDOW_EXPIRED) {
      // The winner's 7-day window closed. Stable, business-level contract — the
      // UI shows a human message and never surfaces raw server text.
      return res.status(410).json({
        message: 'Your payment window has expired. This item may now be offered to the next eligible bidder.',
        error: { code: PAYMENT_WINDOW_EXPIRED },
        reason: PAYMENT_WINDOW_EXPIRED,
        payment_deadline: recorded.deadline || null,
      });
    }
    const status = recorded.reason === 'ORDER_NOT_FOUND' ? 404 : recorded.reason === 'BUYER_MISMATCH' ? 403 : 400;
    return res.status(status).json({ message: 'Order not found or not payable', reason: recorded.reason });
  }

  // 2) Fulfillment is a SEPARATE state machine. Move the order forward through
  //    its legal steps (pending → preparing → ready_pickup), each one validated
  //    and payment-gated, instead of writing 'ready_pickup' blindly.
  const advanced = await advanceOrderTo(req.params.id, 'ready_pickup');
  if (!advanced.ok) {
    return res.status(400).json({ message: 'Payment recorded but fulfillment could not advance', reason: advanced.reason });
  }
  const rows = [advanced.order];

  const msg = `Order ${rows[0].id} is ready for pickup — bring valid ID + order number within 7 days.`;
  const { shouldDeliverNotification } = await import('../../services/notificationPreference.js');
  if (await shouldDeliverNotification(req.user.id, 'payout', msg)) {
    await pool.query("INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)", [req.user.id, msg]);
  }
  res.json({ ...rows[0], payment_status: 'paid', paid_at: recorded.payment?.paid_at || null });
};
