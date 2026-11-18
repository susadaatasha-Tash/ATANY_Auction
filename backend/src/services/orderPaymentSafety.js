import { randomUUID } from 'node:crypto';
import { paymentTransaction, lockOrder, assertNoPaymentOperation, PaymentSafetyError } from './paymentTransaction.js';
import { createPayMongoCheckout, getCheckoutSession, expireCheckoutSession, inspectCheckout, configuredPaymongoMode } from './paymongoService.js';
import { isPastDeadline, PAYMENT_WINDOW_EXPIRED } from './winnerRules.js';

const reject = (code, message, status) => { throw new PaymentSafetyError(code, message, status); };
const paymentsFor = async (c, id) => (await c.query('SELECT * FROM payments WHERE order_id=$1 ORDER BY created_at ASC', [id])).rows;

async function assertRunningOperation(c,op) {
  const {rows}=await c.query("SELECT id FROM payment_operations WHERE order_id=$1 AND state='running'",[op.order.id]);
  if(rows.length!==1 || rows[0].id!==op.id)reject('PAYMENT_OPERATION_PENDING','Payment operation changed. Please refresh and retry.');
}

async function authorize(c, order, actorId, role) {
  if (role === 'customer') {
    if (String(order.buyer_id) !== String(actorId)) reject('ORDER_NOT_FOUND', 'Order not found', 403);
  } else if (role === 'shop_owner') {
    const { rows } = await c.query(`SELECT s.id FROM shops s JOIN products p ON p.shop_id=s.id
      JOIN auctions a ON a.product_id=p.id WHERE a.id=$1 AND s.user_id=$2`, [order.auction_id, actorId]);
    if (!rows.length) reject('ORDER_NOT_FOUND', 'Order not found', 404);
  } else reject('ROLE_FORBIDDEN', 'Not authorized', 403);
}

function assertPending(order, payments) {
  if (order.status === 'cancelled') reject('ALREADY_CANCELLED', 'Order is already cancelled.');
  if (order.status !== 'pending') reject('ORDER_NOT_CANCELLABLE', `Order cannot be changed in its current state (${order.status}).`, 400);
  if (payments.some(p => ['paid','processing'].includes(p.status))) {
    reject('PAYMENT_NOT_CANCELLABLE', 'Order cannot be changed — payment is paid or processing.', 400);
  }
}

async function reserve({ orderId, actorId, role, kind, reason, paymentMethod }) {
  return paymentTransaction(async c => {
    const order = await lockOrder(c, orderId);
    await authorize(c, order, actorId, role);
    await assertNoPaymentOperation(c, orderId);
    const payments = await paymentsFor(c, orderId);
    assertPending(order, payments);
    if (kind === 'checkout' && isPastDeadline(order)) reject(PAYMENT_WINDOW_EXPIRED, 'Your payment window has expired.', 410);
    // Old null identifiers can mean the provider succeeded but its response was lost.
    if (payments.some(p => p.provider === 'paymongo' && !p.checkout_session_id && p.metadata?.checkout_creation_rejected !== true)) {
      reject('CHECKOUT_STATE_UNKNOWN', 'A previous checkout could not be verified. Contact support before retrying.');
    }
    const id = randomUUID();
    const context = { buyer_id: order.buyer_id, amount: order.amount, winner_rank: order.winner_rank, role, reason };
    await c.query("INSERT INTO payment_operations(id,order_id,actor_id,kind,state,context) VALUES($1,$2,$3,$4,'running',$5)", [id,orderId,actorId,kind,JSON.stringify(context)]);
    return { id, order, payments, context, paymentMethod };
  });
}

async function finishOperation(op, state, extra = {}) {
  await paymentTransaction(async c => {
    await lockOrder(c, op.order.id);
    await c.query('UPDATE payment_operations SET state=$2,context=context || $3::jsonb,updated_at=now() WHERE id=$1', [op.id,state,JSON.stringify(extra)]);
  });
}

function checkProvider(body, expectedId) {
  const view = inspectCheckout(body);
  if (view.state === 'unknown' || view.id !== expectedId) reject('CHECKOUT_STATE_UNKNOWN', 'Checkout state could not be verified. Please retry.');
  if (view.paid) reject('PAYMENT_PAID', 'Payment has already been received. Cancellation is unavailable.');
  if (view.processing) reject('PAYMENT_PROCESSING', 'Payment is still processing. Please wait before retrying.');
  return view;
}

export async function cancelOrderSafely({ orderId, actorId, role, reason }) {
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000) reject('CANCELLATION_REASON_REQUIRED', 'A valid cancellation reason is required.', 400);
  const op = await reserve({ orderId,actorId,role,kind:'cancel',reason:reason.trim() });
  try {
    const closed = [];
    for (const payment of op.payments) {
      const id = payment.checkout_session_id;
      if (!id) continue;
      let view = checkProvider(await getCheckoutSession(id), id);
      if (view.state === 'active') {
        let body;
        try { body = await expireCheckoutSession(id); }
        catch (error) {
          // A 400 conflates paid, ongoing and already expired. Never infer safety.
          if (error.providerStatus !== 400) throw error;
          body = await getCheckoutSession(id);
        }
        view = checkProvider(body, id);
      }
      if (view.state !== 'expired') reject('CHECKOUT_NOT_CLOSED', 'Checkout remains active. Please retry cancellation.');
      await paymentTransaction(async c => {
        await lockOrder(c,orderId);
        await c.query("UPDATE payments SET metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('checkout_closed_at',now()) WHERE id=$1",[payment.id]);
      });
      closed.push(id);
    }
    return await paymentTransaction(async c => {
      const current = await lockOrder(c, orderId);
      await authorize(c, current, actorId, role);
      const payments = await paymentsFor(c, orderId);
      assertPending(current, payments);
      if(payments.some(p=>p.provider==='paymongo' && !p.checkout_session_id && p.metadata?.checkout_creation_rejected!==true))reject('CHECKOUT_STATE_UNKNOWN','A checkout creation outcome requires verification.');
      if (String(current.buyer_id) !== String(op.order.buyer_id) || current.winner_rank !== op.order.winner_rank) reject('ORDER_CHANGED', 'The order assignment changed. Refresh and retry.');
      if (payments.some(p => p.checkout_session_id && !closed.includes(p.checkout_session_id))) reject('ORDER_CHANGED', 'A new checkout requires verification.');
      const active = (await c.query("SELECT id FROM payment_operations WHERE order_id=$1 AND state='running'", [orderId])).rows;
      if (active.length !== 1 || active[0].id !== op.id) reject('PAYMENT_OPERATION_PENDING', 'Payment operation changed.');
      const sellerScope = role === 'shop_owner' ? ` AND auction_id IN (SELECT a.id FROM auctions a JOIN products p ON p.id=a.product_id JOIN shops s ON s.id=p.shop_id WHERE s.user_id=$3)` : '';
      const { rows } = await c.query(`UPDATE orders SET status='cancelled',cancellation_reason=$2,cancelled_at=now(),cancelled_by=$3 WHERE id=$1${sellerScope} RETURNING *`, [orderId,reason.trim(),actorId]);
      if (!rows[0]) reject('ORDER_NOT_FOUND','Order not found',404);
      await c.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES($1,'order_cancelled','order',$2,$3)`, [actorId,orderId,JSON.stringify({ reason:reason.trim(),role,closed_checkouts:closed })]);
      await c.query("UPDATE payment_operations SET state='completed',context=context || $2::jsonb,updated_at=now() WHERE id=$1", [op.id,JSON.stringify({closed_checkouts:closed})]);
      return rows[0];
    });
  } catch (error) {
    await finishOperation(op, 'failed', { error: error.code || 'CHECKOUT_VERIFICATION_FAILED' });
    if (error instanceof PaymentSafetyError) throw error;
    throw new PaymentSafetyError('CHECKOUT_VERIFICATION_FAILED', 'Unable to safely close the checkout. Your order was not cancelled. Please retry.', 503);
  }
}

export async function createOrderCheckoutSafely({ orderId, actorId, paymentMethod = null, product, branch }) {
  const op = await reserve({ orderId,actorId,role:'customer',kind:'checkout',paymentMethod });
  let attemptId = null;
  let providerStarted = false;
  try {
    let reuse = null;
    for (const p of op.payments) {
      if (!p.checkout_session_id) continue;
      const view = checkProvider(await getCheckoutSession(p.checkout_session_id), p.checkout_session_id);
      if (view.state === 'active') {
        if (reuse) reject('MULTIPLE_ACTIVE_CHECKOUTS', 'Multiple checkouts require support review. No new checkout was created.');
        if (p.customer_id !== actorId) reject('CHECKOUT_STATE_UNKNOWN', 'An older checkout requires support review.');
        const items=view.attrs?.line_items;
        const intent=view.attrs?.payment_intent?.attributes;
        const amount=Array.isArray(items) && items.length ? items.reduce((n,item)=>n+Number(item.amount)*Number(item.quantity),0) : intent?.amount;
        const currency=Array.isArray(items) && items.length && items.every(item=>item.currency==='PHP') ? 'PHP' : intent?.currency;
        if (amount !== Number(op.order.amount)*100 || Number(p.amount)!==Number(op.order.amount) || currency!=='PHP'
          || view.attrs?.reference_number!==p.id || configuredPaymongoMode()===null || view.attrs?.livemode!==configuredPaymongoMode()
          || (p.metadata?.winner_rank ?? 1)!==(op.order.winner_rank ?? 1)) reject('CHECKOUT_EVIDENCE_MISMATCH','An existing checkout does not match this order. Contact support.');
        reuse = { payment:p, checkout_url:view.attrs?.checkout_url || p.metadata?.checkout_url };
        if (!reuse.checkout_url) reject('CHECKOUT_STATE_UNKNOWN', 'Checkout URL could not be verified.');
      }
    }
    if (reuse) {
      await paymentTransaction(async c => {
        const current=await lockOrder(c,orderId);
        await assertRunningOperation(c,op);
        assertPending(current,await paymentsFor(c,orderId));
        if(current.buyer_id!==actorId || Number(current.amount)!==Number(op.order.amount) || current.winner_rank!==op.order.winner_rank || isPastDeadline(current)) reject('ORDER_CHANGED','Order changed while verifying checkout.');
        await c.query("UPDATE payment_operations SET state='completed',updated_at=now() WHERE id=$1 AND state='running'",[op.id]);
      });
      return reuse;
    }
    const payment = await paymentTransaction(async c => {
      const current = await lockOrder(c, orderId);
      await assertRunningOperation(c,op);
      if (current.buyer_id !== actorId || current.status !== 'pending' || Number(current.amount)!==Number(op.order.amount) || current.winner_rank!==op.order.winner_rank || isPastDeadline(current)) reject('ORDER_CHANGED', 'Order is no longer payable.');
      const id = randomUUID();
      const { rows } = await c.query(`INSERT INTO payments(id,order_id,customer_id,amount,currency,payment_method,status,metadata)
        VALUES($1,$2,$3,$4,'PHP',$5,'pending',$6) RETURNING *`, [id,orderId,actorId,current.amount,paymentMethod,JSON.stringify({ operation_id:op.id,creation_state:'creating',winner_rank:current.winner_rank ?? 1,livemode:configuredPaymongoMode() })]);
      await c.query('UPDATE payment_operations SET context=context || $2::jsonb WHERE id=$1',[op.id,JSON.stringify({attempt_id:id})]);
      return rows[0];
    });
    attemptId = payment.id;
    providerStarted = true;
    const result = await createPayMongoCheckout({ order:op.order,payment,product,branch });
    if (!result.checkoutId || !result.checkoutUrl) reject('CHECKOUT_STATE_UNKNOWN','Provider response was incomplete.');
    return await paymentTransaction(async c => {
      const current = await lockOrder(c, orderId);
      // Persist provider identity even if assignment changed during the network call.
      const { rows } = await c.query(`UPDATE payments SET checkout_session_id=$2,provider_reference_id=$2,
        metadata=COALESCE(metadata,'{}'::jsonb) || $3::jsonb,updated_at=now() WHERE id=$1 AND checkout_session_id IS NULL RETURNING *`,
      [attemptId,result.checkoutId,JSON.stringify({checkout_url:result.checkoutUrl,creation_state:'created'})]);
      if (!rows[0]) reject('CHECKOUT_STATE_UNKNOWN','Checkout identity requires review.');
      await c.query("UPDATE payment_operations SET state='completed',updated_at=now() WHERE id=$1", [op.id]);
      if (current.status !== 'pending' || current.buyer_id !== actorId || Number(current.amount)!==Number(op.order.amount) || current.winner_rank!==op.order.winner_rank) {
        await c.query(`INSERT INTO payment_reconciliations(id,order_id,reason,evidence) VALUES($1,$2,'CHECKOUT_ASSIGNMENT_CHANGED',$3)`,[randomUUID(),orderId,JSON.stringify({operation_id:op.id,checkout_session_id:result.checkoutId,payment_id:attemptId})]);
        return { checkout_url:null, payment:rows[0], requires_review:true };
      }
      return { checkout_url:result.checkoutUrl,payment:rows[0] };
    });
  } catch (error) {
    // A timeout/5xx can occur after provider creation. Never clear that uncertainty.
    const rejected = [400,401,403,422].includes(error.providerStatus);
    const unknown = providerStarted && !rejected;
    await paymentTransaction(async c => {
      await lockOrder(c, orderId);
      if (attemptId) await c.query(`UPDATE payments SET metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb WHERE id=$1`, [attemptId,JSON.stringify({creation_state:unknown?'unknown':'rejected',checkout_creation_rejected:rejected})]);
      await c.query('UPDATE payment_operations SET state=$2,updated_at=now() WHERE id=$1', [op.id,unknown?'unknown':'failed']);
      if(unknown) await c.query(`INSERT INTO payment_reconciliations(id,order_id,reason,evidence) VALUES($1,$2,'CHECKOUT_CREATION_UNKNOWN',$3)`,[randomUUID(),orderId,JSON.stringify({operation_id:op.id,payment_id:attemptId})]);
    });
    if (error instanceof PaymentSafetyError) throw error;
    throw new PaymentSafetyError(unknown?'CHECKOUT_STATE_UNKNOWN':'CHECKOUT_VERIFICATION_FAILED', unknown?'Checkout creation is being verified. Do not start another payment; contact support.':'Checkout could not be verified. Please retry.',503);
  }
}

export function sendPaymentSafetyError(res, error) {
  return res.status(error.status || 503).json({ message:error.message || 'Payment service unavailable', code:error.code || 'PAYMENT_SAFETY_UNAVAILABLE' });
}

export async function cancellationSnapshot(order) {
  // Read-only advice for customer actions. Mutation services still revalidate
  // ownership, provider state and durable operation fencing independently.
  const blocked=(code,reason)=>({can_request_cancellation:false,can_request_payment:false,
    action_block_code:code,cancellation_block_reason:reason,payment_block_reason:reason});
  if(order.status!=='pending') return blocked('ORDER_NOT_PAYABLE',`This order is ${order.status}. Payment and cancellation are unavailable.`);
  if(order.is_expired || isPastDeadline(order)) return blocked('PAYMENT_WINDOW_EXPIRED','The payment window has expired. Payment and cancellation are unavailable.');
  try {
    return await paymentTransaction(async c=>{
      const {rows:readiness}=await c.query(`SELECT
        (SELECT count(*)=3 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='orders' AND column_name IN ('cancelled_by','cancelled_at','cancellation_reason'))
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='payments' AND column_name='provider_checked_at')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='payment_webhook_events' AND column_name='next_attempt_at')
        AND to_regclass('public.payment_operations') IS NOT NULL
        AND to_regclass('public.provider_collections') IS NOT NULL
        AND to_regclass('public.payment_reconciliations') IS NOT NULL AS safety_schema_ready`);
      if(readiness[0]?.safety_schema_ready!==true) return blocked('PAYMENT_SCHEMA_REQUIRED','Order changes are temporarily unavailable. Please try again later or contact support.');
      const payments=await paymentsFor(c,order.id);
      if(payments.some(p=>p.status==='paid')) return blocked('PAYMENT_PAID','Payment has been confirmed. Further payment and cancellation are unavailable.');
      if(payments.some(p=>p.status==='processing')) return blocked('PAYMENT_PROCESSING','Payment is processing. Please wait for verification before trying again.');
      await assertNoPaymentOperation(c,order.id);
      if(payments.some(p=>p.provider==='paymongo' && !p.checkout_session_id && p.metadata?.checkout_creation_rejected!==true)) return blocked('CHECKOUT_STATE_UNKNOWN','A previous checkout could not be verified. Contact support before trying again.');
      return {can_request_cancellation:true,can_request_payment:true,action_block_code:null,cancellation_block_reason:null,payment_block_reason:null};
    });
  } catch(error) {
    if(error.code==='PAYMENT_OPERATION_PENDING') return blocked(error.code,'A payment is still being verified. Please wait or contact support.');
    return blocked(error.code==='PAYMENT_SCHEMA_REQUIRED'?'PAYMENT_SCHEMA_REQUIRED':'PAYMENT_SAFETY_UNAVAILABLE','Order changes are temporarily unavailable. Please refresh or contact support.');
  }
}
