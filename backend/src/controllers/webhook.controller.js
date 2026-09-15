import { pool } from '../db/pool.js';
import { verifyWebhookSignature } from '../services/paymongoService.js';

export const paymongoWebhook = async (req, res) => {
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const sig = req.headers['paymongo-signature'] || req.headers['x-paymongo-signature'] || '';
  if (!verifyWebhookSignature(rawBody, sig)) {
    console.warn('[webhook] invalid signature');
    // still return 200 to avoid retries with wrong secret in test mode; log only
  }
  try {
    const payload = req.body;
    const eventType = payload?.data?.attributes?.type || payload?.type || '';
    const eventData = payload?.data?.attributes?.data || payload?.data || {};
    const attrs = eventData?.attributes || {};
    const checkoutId = eventData?.id || attrs?.id || attrs?.checkout_session_id || attrs?.reference_number;
    const reference = attrs?.reference_number || checkoutId;
    const isPaid = eventType.includes('paid') || attrs?.status === 'paid' || (Array.isArray(attrs?.payments) && attrs.payments.some(p => p.attributes?.status === 'paid'));

    if (!reference && !checkoutId) {
      console.warn('[webhook] no reference', eventType);
      return res.json({ received: true });
    }

    // find payment by checkout_session_id or provider_reference or reference_number
    let payment = null;
    const { rows: byCheckout } = await pool.query(`SELECT * FROM payments WHERE checkout_session_id=$1 LIMIT 1`, [checkoutId]);
    if (byCheckout.length) payment = byCheckout[0];
    else {
      const { rows: byRef } = await pool.query(`SELECT * FROM payments WHERE id=$1 OR provider_reference_id=$1 LIMIT 1`, [reference]);
      if (byRef.length) payment = byRef[0];
      else {
        const { rows: byAny } = await pool.query(`SELECT * FROM payments WHERE provider_reference_id=$1 OR checkout_session_id=$1 LIMIT 1`, [checkoutId]);
        if (byAny.length) payment = byAny[0];
      }
    }

    if (!payment) {
      console.warn('[webhook] payment not found for', checkoutId, reference);
      return res.json({ received: true });
    }

    // idempotency: already paid
    if (payment.status === 'paid') return res.json({ received: true, already_paid: true });

    if (isPaid) {
      await pool.query(`UPDATE payments SET status='paid', paid_at=now(), updated_at=now(), metadata=$1 WHERE id=$2`, [JSON.stringify({ webhook_type: eventType, raw: attrs }), payment.id]);
      // keep orders.status as pending — fulfillment separate; but ensure notification
      try {
        await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)`, [payment.customer_id, `Payment confirmed for order ${payment.order_id} — we are preparing your jewelry.`]);
      } catch {}
      console.log(`[webhook] payment ${payment.id} marked paid for order ${payment.order_id}`);
    } else if (eventType.includes('failed') || attrs?.status === 'failed') {
      await pool.query(`UPDATE payments SET status='failed', updated_at=now(), metadata=$1 WHERE id=$2`, [JSON.stringify({ webhook_type: eventType, raw: attrs }), payment.id]);
    } else if (eventType.includes('expired') || attrs?.status === 'expired') {
      await pool.query(`UPDATE payments SET status='expired', updated_at=now(), metadata=$1 WHERE id=$2`, [JSON.stringify({ webhook_type: eventType }), payment.id]);
    }

    res.json({ received: true });
  } catch (e) {
    console.error('[webhook] error', e.message);
    res.status(500).json({ message: 'Webhook processing failed' });
  }
};
