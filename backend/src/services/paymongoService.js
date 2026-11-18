// backend/src/services/paymongoService.js
// Real PayMongo Checkout integration — server-only, never exposed to frontend
import crypto from 'crypto';
const PAYMONGO_API = 'https://api.paymongo.com/v1/checkout_sessions';

export function configuredPaymongoMode() {
  const key=process.env.PAYMONGO_SECRET_KEY || '';
  return key.startsWith('sk_live_') ? true : key.startsWith('sk_test_') ? false : null;
}

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
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.errors?.[0]?.detail || body?.errors?.[0]?.code || JSON.stringify(body) || res.statusText;
    const error = new Error(`PayMongo checkout failed: ${msg}`);
    error.providerStatus = res.status;
    throw error;
  }
  const attrs = body?.data?.attributes || {};
  return {
    checkoutId: body?.data?.id,
    checkoutUrl: attrs.checkout_url,
    reference: attrs.reference_number || payment.id,
  };
}

export async function getCheckoutSession(checkoutSessionId) {
  const res = await fetch(`${PAYMONGO_API}/${encodeURIComponent(checkoutSessionId)}`, {
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: authHeader() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.errors?.[0]?.detail || `PayMongo get checkout failed: ${res.status}`);
  return body;
}

export async function expireCheckoutSession(id) {
  const res = await fetch(`${PAYMONGO_API}/${encodeURIComponent(id)}/expire`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Authorization: authHeader() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error('Checkout could not be expired. Its payment state must be verified.');
    error.providerStatus = res.status;
    throw error;
  }
  return body;
}

// Session closure, payment attempts and Payment Intent state are independent.
// A failed attempt never establishes that an active checkout is closed.
export function inspectCheckout(body) {
  const session = body?.data;
  const attrs = session?.attributes;
  const state = session?.id && ['active', 'expired'].includes(attrs?.status) ? attrs.status : 'unknown';
  const intent = attrs?.payment_intent?.attributes || {};
  const payments = [...(Array.isArray(attrs?.payments) ? attrs.payments : []), ...(Array.isArray(intent.payments) ? intent.payments : [])];
  return {
    state, id: session?.id, attrs, payments,
    paid: intent.status === 'succeeded' || payments.some(p => ['paid', 'succeeded'].includes(p?.attributes?.status)),
    processing: intent.status === 'processing' || payments.some(p => ['pending', 'processing'].includes(p?.attributes?.status)),
  };
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
  const insecureAllowed = process.env.ALLOW_INSECURE_PAYMONGO_WEBHOOKS === 'true';
  if (!secret) {
    // Priority 1 / C4: fail closed. Only explicit opt-in bypass (tests/dev) accepts missing secret.
    // Production (NODE_ENV=production) never bypasses.
    const isProduction = process.env.NODE_ENV === 'production';
    return !isProduction && insecureAllowed;
  }
  if (!signature) return false;
  try {
    const fields = Object.fromEntries(String(signature).split(',').map(part => part.trim().split('=')));
    if (!/^\d+$/.test(fields.t || '') || Math.abs(Date.now() / 1000 - Number(fields.t)) > 300) return false;
    const payload = JSON.parse(rawBody);
    const live = payload?.data?.attributes?.livemode ?? payload?.data?.livemode;
    if (typeof live !== 'boolean') return false;
    const candidate = live ? fields.li : fields.te;
    if (!/^[a-f0-9]{64}$/i.test(candidate || '')) return false;
    const expected = crypto.createHmac('sha256', secret).update(`${fields.t}.${rawBody}`).digest();
    return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), expected);
  } catch {
    return false;
  }
}
