import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import { paymentTransaction, lockOrder, PaymentSafetyError } from './paymentTransaction.js';
import { getCheckoutSession, inspectCheckout, configuredPaymongoMode } from './paymongoService.js';

export function normalizePaymentEvent(body) {
  const attrs = body?.data?.attributes;
  // Both documented envelopes are accepted, never arbitrary substring event types.
  return attrs?.type ? { id:body.data.id,type:attrs.type,live:attrs.livemode,resource:attrs.data }
    : { id:body?.data?.id || body?.id,type:body?.data?.type,live:body?.data?.livemode,resource:body?.data?.data };
}

export async function receivePaymentEvent({ body, rawBody }) {
  const event = normalizePaymentEvent(body);
  if (!event.id || typeof event.live !== 'boolean' || !event.type || !event.resource?.id) {
    throw new PaymentSafetyError('INVALID_PROVIDER_EVENT','Provider event is incomplete.',400);
  }
  return paymentTransaction(async c => {
    const { rows } = await c.query(`INSERT INTO payment_webhook_events(id,provider_event_id,livemode,event_type,payload,raw_body)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider,livemode,provider_event_id) DO UPDATE SET provider_event_id=EXCLUDED.provider_event_id RETURNING *`,
    [randomUUID(),event.id,event.live,event.type,JSON.stringify(body),rawBody]);
    return rows[0];
  });
}

async function review(c, event, collection, orderId, reason, evidence) {
  await c.query(`INSERT INTO payment_reconciliations(id,event_id,collection_id,order_id,reason,evidence)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [randomUUID(),event.id,collection?.id || null,orderId || null,reason,JSON.stringify(evidence)]);
}

async function findPayment(c, resource) {
  const a = resource.attributes || {};
  const { rows } = await c.query(`SELECT * FROM payments WHERE checkout_session_id=$1 OR id::text=$2 OR provider_reference_id=$1 ORDER BY created_at ASC LIMIT 1`,
    [resource.id,a.reference_number || '']);
  return rows[0];
}

export async function processPaymentEvent(id) {
  const initial = await paymentTransaction(async c => (await c.query('SELECT * FROM payment_webhook_events WHERE id=$1',[id])).rows[0]);
  if (!initial || initial.state !== 'received') return;
  const normalized = normalizePaymentEvent(initial.payload);
  const resource = normalized.resource;
  const payment = await paymentTransaction(c => findPayment(c,resource));
  if (!payment) {
    // Preserve existing subscription settlement, without routing it into order money.
    const billing = await paymentTransaction(async c => (await c.query('SELECT * FROM billing_records WHERE paymongo_checkout_session_id=$1 OR id::text=$2 LIMIT 1', [resource.id,resource.attributes?.reference_number || ''])).rows[0]);
    if (billing) {
      const { markBillingPaid,markBillingFailed,notifyPaymentFailed } = await import('./subscriptionService.js');
      if (normalized.type === 'checkout_session.payment.paid') {
        const paidPayments=(resource.attributes?.payments || []).filter(p=>p.attributes?.status==='paid');
        const paid=paidPayments[0];
        const invalid=paidPayments.length!==1 || !paid?.id || paid.attributes.amount!==Math.round(Number(billing.amount)*100) || paid.attributes.currency!=='PHP' || configuredPaymongoMode()!==normalized.live;
        await paymentTransaction(async c=>{
          for(const p of paidPayments) {
            if(!p.id || !Number.isSafeInteger(p.attributes?.amount) || typeof p.attributes?.currency!=='string') continue;
            const {rows}=await c.query(`INSERT INTO provider_collections(id,livemode,provider_payment_id,checkout_session_id,amount_centavos,currency,evidence)
              VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *`,[randomUUID(),normalized.live,p.id,resource.id,p.attributes.amount,p.attributes.currency,JSON.stringify({payment:p,billing_record_id:billing.id})]);
            if(invalid && rows[0]) await review(c,initial,rows[0],null,'BILLING_EVIDENCE_INVALID',resource);
          }
        });
        if(invalid) {
          await paymentTransaction(async c=>{await c.query("UPDATE payment_webhook_events SET state='review',processed_at=now() WHERE id=$1",[id]);});
          return;
        }
        await markBillingPaid({billingId:billing.id,paymentReference:paid.id,source:'webhook'});
      } else if (normalized.type === 'payment.failed') {
        const failed=await markBillingFailed({billingId:billing.id,status:'failed'}); if(failed) await notifyPaymentFailed(failed);
      }
      await paymentTransaction(async c => { await c.query("UPDATE payment_webhook_events SET state='processed',processed_at=now() WHERE id=$1",[id]); });
      return;
    }
  }
  return paymentTransaction(async c => {
    const order = payment ? await lockOrder(c,payment.order_id) : null;
    const event = (await c.query('SELECT * FROM payment_webhook_events WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if (!event || event.state !== 'received') return;
    let requiresReview = false;
    const a = resource.attributes || {};
    const paid = normalized.type === 'checkout_session.payment.paid'
      ? (a.payments || []).filter(p => p.attributes?.status === 'paid')
      : normalized.type === 'payment.paid' && a.status === 'paid' ? [resource] : [];
    if (['checkout_session.payment.paid','payment.paid'].includes(normalized.type) && !paid.length) {
      await review(c,event,null,order?.id,'MISSING_PAYMENT_EVIDENCE',resource); requiresReview=true;
    }
    for (const external of paid) {
      const p = external.attributes || {};
      if (!external.id || !Number.isSafeInteger(p.amount) || p.amount < 0 || typeof p.currency !== 'string') {
        await review(c,event,null,order?.id,'MISSING_PAYMENT_EVIDENCE',external); requiresReview=true; continue;
      }
      const { rows:existing } = await c.query('SELECT * FROM provider_collections WHERE provider=\'paymongo\' AND livemode=$1 AND provider_payment_id=$2', [event.livemode,external.id]);
      const { rows } = existing.length ? {rows:existing} : await c.query(`INSERT INTO provider_collections(id,livemode,provider_payment_id,checkout_session_id,payment_intent_id,order_id,payment_id,amount_centavos,currency,provider_paid_at,evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING *`,
      [randomUUID(),event.livemode,external.id,resource.type==='checkout_session'?resource.id:null,a.payment_intent?.id || p.payment_intent_id || null,
        order?.id || null,payment?.id || null,p.amount,p.currency,p.paid_at ? new Date(Number(p.paid_at)*1000) : null,JSON.stringify(external)]);
      const collection = rows[0]; if (!collection) continue;
      const modeMismatch=configuredPaymongoMode()===null || event.livemode!==configuredPaymongoMode() || (typeof payment?.metadata?.livemode==='boolean' && payment.metadata.livemode!==event.livemode);
      if (payment && !modeMismatch && (!collection.order_id || collection.order_id===order.id)) {
        await c.query('UPDATE provider_collections SET order_id=$2,payment_id=$3,checkout_session_id=COALESCE(checkout_session_id,$4) WHERE id=$1',[collection.id,order.id,payment.id,resource.type==='checkout_session'?resource.id:null]);
        if(resource.type==='checkout_session' && a.reference_number===payment.id && (!payment.checkout_session_id || payment.checkout_session_id===resource.id)) {
          await c.query(`UPDATE payments SET checkout_session_id=COALESCE(checkout_session_id,$2),provider_reference_id=COALESCE(provider_reference_id,$2) WHERE id=$1`,[payment.id,resource.id]);
          await c.query(`UPDATE payment_operations SET state='completed',updated_at=now() WHERE id=$1 AND kind='checkout' AND state IN ('running','unknown') AND context->>'attempt_id'=$2`,[payment.metadata?.operation_id || null,payment.id]);
        }
      }
      const sameAllocation=payment && (await c.query(`SELECT id FROM payments WHERE id=$1 AND status='paid' AND metadata->>'collection_id'=$2`,[payment.id,collection.id])).rows.length;
      if(sameAllocation) continue;
      let reason = modeMismatch ? 'PROVIDER_MODE_MISMATCH' : !payment ? 'UNMATCHED_COLLECTION'
        : collection.order_id && collection.order_id!==order.id ? 'COLLECTION_IDENTITY_MISMATCH'
        : resource.type==='checkout_session' && payment.checkout_session_id && payment.checkout_session_id!==resource.id ? 'CHECKOUT_IDENTITY_MISMATCH'
        : order.status !== 'pending' ? 'ORDER_NOT_PAYABLE'
        : order.buyer_id !== payment.customer_id ? 'BUYER_MISMATCH'
        : p.amount !== Math.round(Number(order.amount)*100) || p.currency !== (payment.currency || 'PHP') ? 'AMOUNT_OR_CURRENCY_MISMATCH' : null;
      const allocated = order ? (await c.query("SELECT id FROM payments WHERE order_id=$1 AND status='paid'",[order.id])).rows : [];
      if (!reason && allocated.length) reason='ADDITIONAL_COLLECTION';
      if (reason) { await review(c,event,collection,order?.id,reason,resource); requiresReview=true; }
      else {
        // Persist financial truth without advancing fulfillment.
        await c.query(`UPDATE payments SET status='paid',paid_at=COALESCE(paid_at,now()),updated_at=now(),
          metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb WHERE id=$1`, [payment.id,JSON.stringify({provider_payment_id:external.id,collection_id:collection.id})]);
        await c.query(`UPDATE payment_reconciliations SET state='resolved',evidence=evidence || $2::jsonb WHERE collection_id=$1 AND reason='UNMATCHED_COLLECTION'`,[collection.id,JSON.stringify({correlated_order_id:order.id})]);
        await c.query(`INSERT INTO notifications(user_id,type,message) VALUES($1,'payout',$2)`,[payment.customer_id,`Payment confirmed for order ${order.transaction_code || order.id} — we are preparing your jewelry.`]);
      }
    }
    if (normalized.type === 'payment.failed' && payment && normalized.live!==configuredPaymongoMode()) {
      await review(c,event,null,order?.id,'PROVIDER_MODE_MISMATCH',resource);requiresReview=true;
    } else if (normalized.type === 'payment.failed' && payment) {
      const failed=await c.query("UPDATE payments SET status='failed',updated_at=now() WHERE id=$1 AND status IN ('pending','processing') RETURNING id",[payment.id]);
      if(failed.rows.length) await c.query(`INSERT INTO notifications(user_id,type,message) VALUES($1,'payout',$2)`,[payment.customer_id,`Payment for order ${order.transaction_code || order.id} was unsuccessful. Please try again before your payment deadline.`]);
    }
    if (!payment && !paid.length) { await review(c,event,null,null,'UNMATCHED_EVENT',resource); requiresReview=true; }
    await c.query('UPDATE payment_webhook_events SET state=$2,processed_at=now(),last_error=NULL WHERE id=$1', [id,requiresReview?'review':'processed']);
  });
}

// Polling is another evidence source; never mutate a stale payment into a fake failure.
export async function recordCheckoutObservation(body) {
  const view = inspectCheckout(body);
  if (!view.paid) return;
  const paidIds=view.payments.filter(p=>p.attributes?.status==='paid').map(p=>p.id).sort().join(':');
  const live=view.attrs?.livemode;
  if (typeof live !== 'boolean' || !paidIds) throw new PaymentSafetyError('PROVIDER_EVIDENCE_UNKNOWN','Payment evidence could not be verified.');
  const payload={data:{id:`sync:${view.id}:${paidIds}`,attributes:{type:'checkout_session.payment.paid',livemode:live,data:body.data}}};
  const e=await receivePaymentEvent({body:payload,rawBody:JSON.stringify(body)});
  await processPaymentEvent(e.id);
}

export async function recoverPaymentEvents() {
  // Never imports credentials or runs migrations. Missing schema fails closed.
  const events=await paymentTransaction(async c => (await c.query("SELECT id FROM payment_webhook_events WHERE state='received' AND next_attempt_at<=now() ORDER BY next_attempt_at,received_at LIMIT 25")).rows);
  for(const e of events) {
    try { await processPaymentEvent(e.id); }
    catch(error) { await paymentTransaction(async c => { await c.query("UPDATE payment_webhook_events SET last_error=$2,next_attempt_at=now()+interval '5 minutes' WHERE id=$1",[e.id,error.code || 'PROCESSING_FAILED']); }); }
  }
}

export async function recoverPaymentOperations() {
  const operations=await paymentTransaction(async c=>(await c.query("SELECT * FROM payment_operations WHERE state='running' AND updated_at < now()-interval '5 minutes' ORDER BY updated_at LIMIT 25")).rows);
  for(const op of operations) await paymentTransaction(async c=>{
    await lockOrder(c,op.order_id);
    const current=(await c.query("SELECT * FROM payment_operations WHERE id=$1 AND state='running' AND updated_at < now()-interval '5 minutes' FOR UPDATE",[op.id])).rows[0];
    if(!current) return;
    // Cancellation can be revalidated from immutable session identities. An
    // interrupted creation with an attempt might already exist at the provider.
    const unknown=current.kind==='checkout' && !!current.context?.attempt_id;
    await c.query('UPDATE payment_operations SET state=$2,updated_at=now() WHERE id=$1',[op.id,unknown?'unknown':'failed']);
    if(unknown) await review(c,{id:null},null,op.order_id,'CHECKOUT_OPERATION_INTERRUPTED',{operation_id:op.id,...current.context});
  });
}

export async function reconcileCheckoutAttempts() {
  const attempts=await paymentTransaction(async c => (await c.query("SELECT * FROM payments WHERE checkout_session_id IS NOT NULL AND status <> 'paid' ORDER BY provider_checked_at ASC NULLS FIRST LIMIT 20")).rows);
  for(const p of attempts) {
    try {
      const body=await getCheckoutSession(p.checkout_session_id),view=inspectCheckout(body);
      await recordCheckoutObservation(body);
      if(view.id===p.checkout_session_id && view.state==='expired' && !view.paid && !view.processing) await paymentTransaction(async c=>{
        await lockOrder(c,p.order_id);
        await c.query("UPDATE payments SET metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('checkout_closed_at',now()) WHERE id=$1",[p.id]);
      });
    } catch { /* Unknown remains blocked; never treat a failed lookup as expiry. */ }
    finally { await paymentTransaction(async c=>{ await c.query('UPDATE payments SET provider_checked_at=now() WHERE id=$1',[p.id]); }); }
  }
}

export async function listPaymentReconciliations(_req,res) {
  try {
    const rows=await paymentTransaction(async c => (await c.query(`SELECT r.id,r.order_id,r.reason,r.state,r.created_at,
      c.provider_payment_id,c.checkout_session_id,c.payment_intent_id,c.amount_centavos,c.currency,c.provider_paid_at,c.livemode,
      o.transaction_code,o.status AS order_status,o.cancelled_at,o.cancelled_by,o.cancellation_reason,
      r.evidence->>'operation_id' AS operation_id,e.provider_event_id,e.received_at AS event_received_at
      FROM payment_reconciliations r LEFT JOIN provider_collections c ON c.id=r.collection_id
      LEFT JOIN orders o ON o.id=r.order_id LEFT JOIN payment_webhook_events e ON e.id=r.event_id ORDER BY r.created_at DESC LIMIT 200`)).rows);
    res.json(rows);
  } catch(error) { res.status(503).json({message:'Payment reconciliation is temporarily unavailable.',code:error.code || 'DB_UNAVAILABLE'}); }
}
