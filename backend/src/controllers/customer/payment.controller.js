import { readCancellationActor } from '../../services/cancellationRead.js';
import { createOrderCheckoutSafely, sendPaymentSafetyError, cancellationSnapshot } from '../../services/orderPaymentSafety.js';
import { recordCheckoutObservation } from '../../services/paymentEvidence.js';
import { pool } from '../../db/pool.js';
import { getCheckoutSession } from '../../services/paymongoService.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getOrderDetails = async (req, res) => {
  try {
    const orderId = req.params.id;
    if (!UUID_RE.test(String(orderId || ''))) return res.status(404).json({ message: 'Order not found' });
    // REST-compatible: separate simple queries instead of JOINs (the pool's
    // Supabase REST fallback cannot translate JOINs and returns empty rows,
    // which surfaced as 404 "Order not found" for existing orders).
    // Semantics preserved: missing order/auction/product still 404s; branch stays optional.
    const { rows: orderRows } = await pool.query(
      'SELECT * FROM orders WHERE id = $1 AND buyer_id = $2',
      [orderId, req.user.id]
    );
    if (!orderRows.length) return res.status(404).json({ message: 'Order not found' });
    const base = orderRows[0];
    if (!base.auction_id) return res.status(404).json({ message: 'Order not found' });
    const { rows: auctionRows } = await pool.query('SELECT * FROM auctions WHERE id = $1', [base.auction_id]);
    if (!auctionRows.length) return res.status(404).json({ message: 'Order not found' });
    const auction = auctionRows[0];
    if (!auction.product_id) return res.status(404).json({ message: 'Order not found' });
    const { rows: productRows } = await pool.query('SELECT * FROM products WHERE id = $1', [auction.product_id]);
    if (!productRows.length) return res.status(404).json({ message: 'Order not found' });
    const product = productRows[0];
    let branch = {};
    if (base.branch_id) {
      const { rows: branchRows } = await pool.query('SELECT * FROM branches WHERE id = $1', [base.branch_id]);
      branch = branchRows[0] || {};
    }
    // Rebuild the exact shape the JOIN previously returned (o.* + aliases)
    const order = {
      ...base,
      product_name: product.name,
      product_img: product.image_url,
      category: product.category,
      karat_weight: product.karat_weight,
      product_desc: product.description,
      branch_name: branch.name,
      branch_address: branch.address,
      branch_phone: branch.phone,
      branch_hours: branch.hours,
      auction_code: auction.auction_code,
      auction_start: auction.start_time,
      auction_end: auction.end_time,
      product_id: product.id,
    };
    // Calculate 7-day payment deadline from winner_confirmed_at or created_at (backend source of truth)
    const winnerConfirmedAt = order.winner_confirmed_at || order.created_at;
    const paymentDeadline = order.payment_deadline || (winnerConfirmedAt ? new Date(new Date(winnerConfirmedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() : null);
    order.winner_confirmed_at = winnerConfirmedAt;
    order.payment_deadline = paymentDeadline;
    // Check if deadline has passed and payment not paid (for display, actual expiration is handled by cron)
    const isExpired = paymentDeadline && new Date() > new Date(paymentDeadline) && order.status === 'pending';
    if (isExpired) {
      order.is_expired = true;
    }
    // latest payment for this order
    const { rows: payments } = await pool.query(
      `SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC`,
      [orderId]
    );
    let payment = payments.find(p=>p.status==='paid') || payments[0] || null;

    // Provider truth is durably preserved even if this order was cancelled.
    if (payment?.checkout_session_id && payment.status !== 'paid') {
      try { await recordCheckoutObservation(await getCheckoutSession(payment.checkout_session_id)); }
      catch { /* A failed lookup cannot establish successful payment or closure. */ }
      const {rows: refreshed}=await pool.query('SELECT * FROM payments WHERE id=$1',[payment.id]);
      payment=refreshed[0] || payment;
    }

    order.is_expired=order.status==='expired' || (!!isExpired && payment?.status!=='paid');
    Object.assign(order,await cancellationSnapshot(order));
    let cancellationActor=null,customer=null;
    const {rows:buyer}=await pool.query('SELECT id,name,email FROM users WHERE id=$1',[order.buyer_id]);
    customer=buyer[0] || null;
    cancellationActor=await readCancellationActor(order);
    res.json({ order,payment,customer,cancellation_actor:cancellationActor,
      product:{name:order.product_name,img:order.product_img,category:order.category,karat_weight:order.karat_weight,desc:order.product_desc,id:order.product_id,condition:product.condition || null,certificate:product.certificate ?? product.certificate_status ?? null},
      branch:{name:branch.name,address:branch.address,phone:branch.phone,hours:branch.hours,lat:branch.lat,lng:branch.lng} });
  } catch (e) {
    if (e?.code === 'DB_UNAVAILABLE' || e?.statusCode === 503) {
      return res.status(503).json({ message: 'Payment service temporarily unavailable' });
    }
    console.error('[customer/getOrderDetails]', e.message);
    res.status(500).json({ message: 'Failed to load order' });
  }
};

export const createCheckout = async (req, res) => {
  const orderId = req.params.id;
  if (!UUID_RE.test(String(orderId || ''))) return res.status(404).json({ message: 'Order not found' });
  let { payment_method } = req.body; // gcash, maya, card etc - optional hint
  if (payment_method === 'maya') payment_method = 'paymaya';
  try {
    // verify order belongs to customer and is payable
    // REST-compatible: separate simple queries (JOINs return empty via REST fallback)
    const { rows: orderRows } = await pool.query(
      'SELECT * FROM orders WHERE id = $1 AND buyer_id = $2',
      [orderId, req.user.id]
    );
    if (!orderRows.length) return res.status(404).json({ message: 'Order not found' });
    const orderBase = orderRows[0];
    if (!orderBase.auction_id) return res.status(404).json({ message: 'Order not found' });
    const { rows: coAuctionRows } = await pool.query('SELECT * FROM auctions WHERE id = $1', [orderBase.auction_id]);
    if (!coAuctionRows.length) return res.status(404).json({ message: 'Order not found' });
    const { rows: coProductRows } = await pool.query('SELECT * FROM products WHERE id = $1', [coAuctionRows[0].product_id]);
    if (!coProductRows.length) return res.status(404).json({ message: 'Order not found' });
    let coBranch = {};
    if (orderBase.branch_id) {
      const { rows: coBranchRows } = await pool.query('SELECT * FROM branches WHERE id = $1', [orderBase.branch_id]);
      coBranch = coBranchRows[0] || {};
    }
    const order = {
      ...orderBase,
      product_name: coProductRows[0].name,
      product_img: coProductRows[0].image_url,
      branch_name: coBranch.name,
    };
    const result = await createOrderCheckoutSafely({ orderId,actorId:req.user.id,paymentMethod:payment_method,product:{name:order.product_name},branch:{name:order.branch_name} });
    if (result.requires_review) return res.status(409).json({message:'Order changed during checkout creation. Contact support.',code:'ORDER_CHANGED'});
    return res.json(result);
  } catch (e) {
    console.error('[customer/createCheckout]', e.message);
    return sendPaymentSafetyError(res,e);
  }
};
