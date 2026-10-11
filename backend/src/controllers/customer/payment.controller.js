import { pool } from '../../db/pool.js';
import { createPayMongoCheckout, getCheckoutSession, checkoutStatus } from '../../services/paymongoService.js';
import { assertPaymentStillPayable, markStalePayment } from '../../services/paymentRaceGuard.js';

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
          // Priority 1 / H3: polling path must also validate order still payable + buyer match
          const raceCheck = await assertPaymentStillPayable(payment);
          if (!raceCheck.ok) {
            await markStalePayment(payment, { reason: raceCheck.reason, eventType: 'checkout_polling' });
            const { rows: updStale } = await pool.query(`SELECT * FROM payments WHERE id=$1`, [payment.id]);
            payment = updStale[0] || payment;
          } else {
            // H2 money path: atomic claim — never last-write-wins paid on REST fallback.
            const { requireDirectPg } = await import('../../db/dbGuard.js');
            requireDirectPg('payment polling paid transition');
            const { rows: paidClaim } = await pool.query(
              `UPDATE payments SET status='paid', paid_at=now(), updated_at=now(), metadata=$1
               WHERE id=$2 AND status IN ('pending','processing','failed','expired')
               RETURNING id`,
              [JSON.stringify({ checkout_sync: true, raw: checkout?.data?.attributes || checkout }), payment.id]
            );
            if (!paidClaim.length) {
              const { rows: already } = await pool.query(`SELECT * FROM payments WHERE id=$1`, [payment.id]);
              payment = already[0] || payment;
            } else {
              try {
                const msg = `Payment confirmed for order ${payment.order_id} — we are preparing your jewelry.`;
                try {
                  await pool.query(`INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1,'payout',$2,$3)`, [payment.customer_id, msg, order.auction_id || null]);
                } catch (insErr) {
                  if (insErr.code !== '42703') throw insErr;
                  await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)`, [payment.customer_id, msg]);
                }
              } catch {}
              const { rows: upd } = await pool.query(`SELECT * FROM payments WHERE id=$1`, [payment.id]);
              payment = upd[0] || payment;
              console.log(`[payment-sync] payment ${payment.id} marked paid via polling for order ${payment.order_id}`);
            }
          }
        } else if ((status === 'failed' || status === 'expired') && payment.status !== status) {
          await pool.query(`UPDATE payments SET status=$1, updated_at=now(), metadata=$2 WHERE id=$3`, [status, JSON.stringify({ checkout_sync: true, raw: checkout?.data?.attributes || checkout }), payment.id]);
          const { rows: upd } = await pool.query(`SELECT * FROM payments WHERE id=$1`, [payment.id]);
          payment = upd[0] || payment;
          // Definitive failure only (not mere checkout-session expiry): notify once per event.
          // Same message shape as the webhook path so the 1-hour guard dedups across both paths.
          if (status === 'failed') {
            try {
              const failMsg = `Payment for order ${order.transaction_code || orderId} was unsuccessful. Please try again before your payment deadline.`;
              const { rows: dup } = await pool.query(
                `SELECT id FROM notifications WHERE user_id=$1 AND message=$2 AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1`,
                [payment.customer_id, failMsg]
              );
              if (!dup.length) {
                try {
                  await pool.query(`INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1,'payout',$2,$3)`, [payment.customer_id, failMsg, order.auction_id || null]);
                } catch (insErr) {
                  if (insErr.code !== '42703') throw insErr;
                  await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)`, [payment.customer_id, failMsg]);
                }
              }
            } catch {}
          }
        }
      } catch (e) {
        console.warn(`[payment-sync] Unable to verify checkout session ${payment.checkout_session_id}: ${e.message}`);
      }
    }

    res.json({ order, payment, product: { name: order.product_name, img: order.product_img, category: order.category, karat_weight: order.karat_weight, desc: order.product_desc, id: order.product_id }, branch: { name: order.branch_name, address: order.branch_address, phone: order.branch_phone, hours: order.branch_hours } });
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
