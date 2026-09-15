// backend/src/services/paymongoService.js
// Real PayMongo Checkout integration — server-only, never exposed to frontend
import crypto from 'crypto';
const PAYMONGO_API = 'https://api.paymongo.com/v1/checkout_sessions';

function authHeader() {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) throw new Error('PAYMONGO_SECRET_KEY not configured');
  return `Basic ${Buffer.from(key + ':').toString('base64')}`;
}

export async function createPayMongoCheckout({ order, payment, branch, product }) {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5178').replace(/\/$/, '');
  const amountCentavos = Math.round(Number(order.amount) * 100);
  if (!amountCentavos || amountCentavos <= 0) throw new Error('Invalid amount');

  const successUrl = `${frontendUrl}/customer/orders/${order.id}/success`;
  const cancelUrl = `${frontendUrl}/customer/orders/${order.id}/payment`;

  const payload = {
    data: {
      attributes: {
        line_items: [
          {
            currency: 'PHP',
            amount: amountCentavos,
            name: product?.name || order.item || 'ATANY Jewelry',
            quantity: 1,
          },
        ],
        payment_method_types: ['gcash', 'card', 'paymaya', 'grab_pay', 'qrph', 'billease'],
        send_email_receipt: false,
        show_description: true,
        show_line_items: true,
        description: `ATANY Order ${order.transaction_code || order.id}`,
        success_url: successUrl,
        cancel_url: cancelUrl,
        reference_number: payment.id,
      },
    },
  };

  const res = await fetch(PAYMONGO_API, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.errors?.[0]?.detail || body?.errors?.[0]?.code || JSON.stringify(body) || res.statusText;
    throw new Error(`PayMongo checkout failed: ${msg}`);
  }
  const attrs = body?.data?.attributes || {};
  return {
    checkoutId: body?.data?.id,
    checkoutUrl: attrs.checkout_url,
    reference: attrs.reference_number || payment.id,
  };
}

export async function getCheckoutSession(checkoutSessionId) {
  const res = await fetch(`${PAYMONGO_API}/${checkoutSessionId}`, {
    headers: { Authorization: authHeader() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.errors?.[0]?.detail || `PayMongo get checkout failed: ${res.status}`);
  return body;
}

export function isCheckoutPaid(checkoutBody) {
  const attrs = checkoutBody?.data?.attributes || checkoutBody?.attributes || {};
  if (attrs.status === 'paid' || attrs.status === 'succeeded' || attrs.status === 'active_paid') return true;
  const payments = attrs.payments || attrs.payment_intents || [];
  if (Array.isArray(payments) && payments.some(p => {
    const s = p?.attributes?.status || p?.status || '';
    return s === 'paid' || s === 'succeeded';
  })) return true;
  // PayMongo checkout may have attributes with payments array under data
  return false;
}

export function checkoutStatus(checkoutBody) {
  const attrs = checkoutBody?.data?.attributes || checkoutBody?.attributes || {};
  if (isCheckoutPaid(checkoutBody)) return 'paid';
  const s = (attrs.status || '').toLowerCase();
  if (s === 'failed' || s.includes('fail')) return 'failed';
  if (s === 'expired' || s.includes('expired')) return 'expired';
  const payments = attrs.payments || [];
  if (Array.isArray(payments) && payments.some(p => (p.attributes?.status || p.status || '').toLowerCase() === 'failed')) return 'failed';
  if (Array.isArray(payments) && payments.some(p => (p.attributes?.status || p.status || '').toLowerCase() === 'expired')) return 'expired';
  return 'pending';
}

export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!secret) return true; // no secret configured — accept (test mode)
  if (!signature) return false;
  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return signature.includes(expected) || signature === expected;
  } catch { return false; }
}
