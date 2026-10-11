import { pool } from '../db/pool.js';
import { verifyWebhookSignature } from '../services/paymongoService.js';
import {
  markBillingPaid,
  markBillingFailed,
  notifyPaymentFailed,
  writeAuditLog,
} from '../services/subscriptionService.js';
import { assertPaymentStillPayable, markStalePayment } from '../services/paymentRaceGuard.js';

export const paymongoWebhook = async (req, res) => {
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const sig = req.headers['paymongo-signature'] || req.headers['x-paymongo-signature'] || '';

  // Priority 1 / C4: fail closed. Missing secret → reject unless explicit insecure opt-in
  // (tests/dev only). Invalid signature → 403. Never log secret material.
  if (!verifyWebhookSignature(rawBody, sig)) {
    const secretConfigured = !!process.env.PAYMONGO_WEBHOOK_SECRET;
    const insecureAllowed = process.env.ALLOW_INSECURE_PAYMONGO_WEBHOOKS === 'true';
    const isProduction = process.env.NODE_ENV === 'production';
    if (!secretConfigured && !isProduction && insecureAllowed) {
      console.warn('[webhook] PAYMONGO_WEBHOOK_SECRET not set — ALLOW_INSECURE_PAYMONGO_WEBHOOKS=true (dev only)');
    } else {
      console.warn('[webhook] webhook rejected —', secretConfigured ? 'invalid signature' : 'PAYMONGO_WEBHOOK_SECRET not configured');
      return res.status(403).json({ message: 'Invalid webhook signature' });
    }
  }

  try {
    const payload = req.body;
    const eventType = payload?.data?.attributes?.type || payload?.type || '';
    const eventData = payload?.data?.attributes?.data || payload?.data || {};
    const attrs = eventData?.attributes || {};
    const checkoutId =
      eventData?.id || attrs?.id || attrs?.checkout_session_id || attrs?.reference_number;
    const reference = attrs?.reference_number || checkoutId;
    const isPaid =
      eventType.includes('paid') ||
      attrs?.status === 'paid' ||
      (Array.isArray(attrs?.payments) &&
        attrs.payments.some((p) => p.attributes?.status === 'paid'));

    if (!reference && !checkoutId) {
      console.warn('[webhook] no reference', eventType);
      return res.json({ received: true });
    }

    // Customer order payments (payments table)
    let payment = null;
    const { rows: byCheckout } = await pool.query(
      `SELECT * FROM payments WHERE checkout_session_id=$1 LIMIT 1`,
      [checkoutId]
    );
    if (byCheckout.length) payment = byCheckout[0];
    else {
      const { rows: byRef } = await pool.query(
        `SELECT * FROM payments WHERE id::text=$1 OR provider_reference_id=$1 LIMIT 1`,
        [reference]
      );
      if (byRef.length) payment = byRef[0];
      else {
        const { rows: byAny } = await pool.query(
          `SELECT * FROM payments WHERE provider_reference_id=$1 OR checkout_session_id=$1 LIMIT 1`,
          [checkoutId]
        );
        if (byAny.length) payment = byAny[0];
      }
    }

    // Seller subscription / maintenance billing (billing_records) — same entity admin sees
    if (!payment) {
      const { rows: billingRows } = await pool.query(
        `SELECT * FROM billing_records WHERE paymongo_checkout_session_id=$1 OR id::text=$1 LIMIT 1`,
        [checkoutId]
      );
      const billing =
        billingRows[0] ||
        (
          await pool.query(
            `SELECT * FROM billing_records WHERE paymongo_checkout_session_id=$1 OR id::text=$1 LIMIT 1`,
            [reference]
          )
        ).rows[0];

      if (billing) {
        if (billing.status === 'paid') {
          return res.json({ received: true, already_paid: true });
        }
        if (isPaid) {
          const payId =
            attrs.payments?.[0]?.id || attrs.payment_intent?.id || checkoutId || reference;
          const paid = await markBillingPaid({
            billingId: billing.id,
            paymentReference: payId,
            source: 'webhook',
          });
          if (!paid) return res.json({ received: true, already_paid: true });
          console.log(`[webhook] billing ${billing.id} marked paid`);
        } else if (
          eventType.includes('failed') ||
          attrs?.status === 'failed' ||
          eventType.includes('expired') ||
          attrs?.status === 'expired'
        ) {
          const next = eventType.includes('expired') || attrs?.status === 'expired'
            ? 'expired'
            : 'failed';
          const failed = await markBillingFailed({ billingId: billing.id, status: next });
          if (failed && next === 'failed') await notifyPaymentFailed(failed);
        }
        return res.json({ received: true });
      }
      console.warn('[webhook] payment not found for', checkoutId, reference);
      return res.json({ received: true });
    }

    // Idempotency for customer payments
    if (payment.status === 'paid') return res.json({ received: true, already_paid: true });

    if (isPaid) {
      // Priority 1 / H3: re-read order before marking paid. Stale winner checkouts
      // must not pay a reassigned order.
      const raceCheck = await assertPaymentStillPayable(payment);
      if (!raceCheck.ok) {
        await markStalePayment(payment, { reason: raceCheck.reason, eventType });
        return res.json({ received: true, stale: true, reason: raceCheck.reason });
      }
      // H2 money path: atomic claim — only pending/processing/failed/expired can become paid.
      // Concurrent duplicate webhooks cannot last-write-wins a second paid transition.
      // Direct pg required for reliable multi-predicate claim under load (fail closed otherwise).
      const { requireDirectPg } = await import('../db/dbGuard.js');
      requireDirectPg('webhook paid transition');
      const { rows: paidRows } = await pool.query(
        `UPDATE payments SET status='paid', paid_at=now(), updated_at=now(), metadata=$1
         WHERE id=$2 AND status IN ('pending','processing','failed','expired')
         RETURNING id`,
        [JSON.stringify({ webhook_type: eventType, raw: attrs }), payment.id]
      );
      if (!paidRows.length) {
        return res.json({ received: true, already_paid: true });
      }
      try {
        const { rows: oAuc } = await pool.query(`SELECT auction_id FROM orders WHERE id=$1`, [
          payment.order_id,
        ]);
        const aucId = oAuc[0]?.auction_id || null;
        const msg = `Payment confirmed for order ${payment.order_id} — we are preparing your jewelry.`;
        try {
          await pool.query(
            `INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1,'payout',$2,$3)`,
            [payment.customer_id, msg, aucId]
          );
        } catch (insErr) {
          if (insErr.code !== '42703') throw insErr;
          await pool.query(
            `INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)`,
            [payment.customer_id, msg]
          );
        }
      } catch {}
      console.log(`[webhook] payment ${payment.id} marked paid for order ${payment.order_id}`);
    } else if (eventType.includes('failed') || attrs?.status === 'failed') {
      await pool.query(
        `UPDATE payments SET status='failed', updated_at=now(), metadata=$1 WHERE id=$2`,
        [JSON.stringify({ webhook_type: eventType, raw: attrs }), payment.id]
      );
      try {
        const { rows: oRows } = await pool.query(
          `SELECT transaction_code, auction_id FROM orders WHERE id=$1`,
          [payment.order_id]
        );
        const failMsg = `Payment for order ${oRows[0]?.transaction_code || payment.order_id} was unsuccessful. Please try again before your payment deadline.`;
        const { rows: dup } = await pool.query(
          `SELECT id FROM notifications WHERE user_id=$1 AND message=$2 AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1`,
          [payment.customer_id, failMsg]
        );
        if (!dup.length) {
          try {
            await pool.query(
              `INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1,'payout',$2,$3)`,
              [payment.customer_id, failMsg, oRows[0]?.auction_id || null]
            );
          } catch (insErr) {
            if (insErr.code !== '42703') throw insErr;
            await pool.query(
              `INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)`,
              [payment.customer_id, failMsg]
            );
          }
        }
      } catch {}
    } else if (eventType.includes('expired') || attrs?.status === 'expired') {
      await pool.query(
        `UPDATE payments SET status='expired', updated_at=now(), metadata=$1 WHERE id=$2`,
        [JSON.stringify({ webhook_type: eventType }), payment.id]
      );
    }

    res.json({ received: true });
  } catch (e) {
    if (e?.code === 'DB_UNAVAILABLE' || e?.statusCode === 503) {
      console.warn('[webhook] 503 — database unavailable for money transition (fail closed)');
      return res.status(503).json({ message: 'Service temporarily unavailable' });
    }
    console.error('[webhook] error', e.message);
    res.status(500).json({ message: 'Webhook processing failed' });
  }
};

// re-export for tests that assert audit side-effects
export { writeAuditLog };
