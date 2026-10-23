// backend/src/services/paymongoService.js
// Real PayMongo Checkout integration — server-only, never exposed to frontend
import crypto from 'crypto';
const PAYMONGO_API = 'https://api.paymongo.com/v1/checkout_sessions';

/**
 * Customer-facing payment methods (matches the UI exactly).
 * Maps frontend method IDs -> PayMongo provider identifiers.
 * Do NOT add methods not exposed in the customer UI.
 */
const CUSTOMER_PAYMENT_METHODS = {
  gcash: 'gcash',
  maya: 'paymaya',
  card: 'card',
};

const ALLOWED_PAYMENT_METHODS = new Set(Object.keys(CUSTOMER_PAYMENT_METHODS));

/**
 * Normalize a frontend payment method ID to a PayMongo provider identifier.
 * Throws if the method is not supported for customer checkout.
 */
export function normalizePaymentMethod(method) {
  if (!method || typeof method !== 'string') {
    const err = new Error('Unsupported payment method');
    err.statusCode = 400;
    err.code = 'UNSUPPORTED_PAYMENT_METHOD';
    throw err;
  }
  const normalized = CUSTOMER_PAYMENT_METHODS[method.trim().toLowerCase()];
  if (!normalized) {
    const err = new Error('Unsupported payment method');
    err.statusCode = 400;
    err.code = 'UNSUPPORTED_PAYMENT_METHOD';
    throw err;
  }
  return normalized;
}

/**
 * Is the provider actually configured for this deployment?
 * (The secret key is server-only and is NEVER returned or logged.)
 */
export function isPayMongoConfigured() {
  return !!process.env.PAYMONGO_SECRET_KEY;
}

function authHeader() {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) throw new Error('PayMongo is not configured on the server. Contact ATANY Support.');
  return `Basic ${Buffer.from(key + ':').toString('base64')}`;
}

/**
 * Create a REAL PayMongo Checkout Session restricted to ONE payment method.
 *
 * Used by the customer checkout flow. Only the customer-selected method is
 * sent to PayMongo — never a bundled list of unrelated methods.
 *
 * Returns ONLY safe values: the provider checkout id, the hosted checkout URL,
 * the reference number. The secret key is never returned to the caller.
 */
export async function createPayMongoCheckout({ order, payment, branch, product, paymentMethod }) {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5178').replace(/\/$/, '');
  const amountCentavos = Math.round(Number(order.amount) * 100);
  if (!amountCentavos || amountCentavos <= 0) throw new Error('Invalid amount');

  const successUrl = `${frontendUrl}/customer/orders/${order.id}/success`;
  const cancelUrl = `${frontendUrl}/customer/orders/${order.id}/payment`;

  const normalizedMethod = normalizePaymentMethod(paymentMethod);

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
        // One selected payout method per checkout session — the customer chose it.
        payment_method_types: [normalizedMethod],
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
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.errors?.[0]?.detail || body?.errors?.[0]?.code || JSON.stringify(body) || res.statusText;
    const err = new Error('The payment provider could not start this payment.');
    err.statusCode = 502;
    err.providerDetail = msg;
    throw err;
  }
  const attrs = body?.data?.attributes || {};
  const checkoutUrl = attrs.checkout_url;
  if (typeof checkoutUrl !== 'string' || !checkoutUrl.startsWith('https://')) {
    const err = new Error('The payment provider could not start this payment.');
    err.statusCode = 502;
    err.providerDetail = 'Invalid or missing checkout URL from provider';
    throw err;
  }
  return {
    checkoutId: body?.data?.id,
    checkoutUrl,
    reference: attrs.reference_number || payment.id,
  };
}

/**
 * Create a REAL PayMongo Checkout Session restricted to ONE payment method.
 *
 * Used by the seller subscription flow (QR Ph / GCash / Maya). The hosted
 * checkout page owns the secure provider UI (QR rendering, e-wallet redirect,
 * card tokenization) so no raw payment credential ever reaches ATANY.
 *
 * Returns ONLY safe values: the provider checkout id, the hosted checkout URL,
 * the reference number and — when the provider supplies one — the session
 * expiry. The secret key is never returned to the caller.
 */
export async function createPayMongoSubscriptionCheckout({
  amount,
  description = 'ATANY Subscription',
  methodType,
  referenceNumber,
  successUrl,
  cancelUrl,
}) {
  const amountCentavos = Math.round(Number(amount) * 100);
  if (!amountCentavos || amountCentavos <= 0) throw new Error('Invalid amount');

  const payload = {
    data: {
      attributes: {
        line_items: [
          {
            currency: 'PHP',
            amount: amountCentavos,
            name: description,
            quantity: 1,
          },
        ],
        // A single method per session — the seller already chose it.
        payment_method_types: [methodType],
        send_email_receipt: false,
        show_description: true,
        show_line_items: true,
        description,
        success_url: successUrl,
        cancel_url: cancelUrl,
        reference_number: referenceNumber,
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
  const rawBody = await res.text();

let body = {};

try {
  body = rawBody ? JSON.parse(rawBody) : {};
} catch {
  body = {
    raw: rawBody.slice(0, 1000)
  };
}

if (!res.ok) {
  console.error('[paymongo provider response]', {
    status: res.status,
    statusText: res.statusText,
    errors: body?.errors || null,
    body: body?.errors ? undefined : body
  });

  const msg =
    body?.errors?.[0]?.detail ||
    body?.errors?.[0]?.code ||
    rawBody ||
    res.statusText;

  const err = new Error(
    'The payment provider could not start this payment.'
  );

  err.statusCode = 502;
  err.providerDetail = msg;
  throw err;
}
  const attrs = body?.data?.attributes || {};
  return {
    checkoutId: body?.data?.id || null,
    checkoutUrl: attrs.checkout_url || null,
    reference: attrs.reference_number || referenceNumber || null,
    // Only present when the provider actually returns an expiry.
    expiresAt: attrs.expires_at || attrs.expiry || null,
  };
}

export async function getCheckoutSession(checkoutSessionId) {
  const res = await fetch(`${PAYMONGO_API}/${checkoutSessionId}`, {
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(15000),
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
  const insecureAllowed = process.env.ALLOW_INSECURE_PAYMONGO_WEBHOOKS === 'true';
  if (!secret) {
    // Priority 1 / C4: fail closed. Only explicit opt-in bypass (tests/dev) accepts missing secret.
    // Production (NODE_ENV=production) never bypasses.
    const isProduction = process.env.NODE_ENV === 'production';
    return !isProduction && insecureAllowed;
  }
  if (!signature) return false;
  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    // PayMongo may send "t=...,v1=<hex>" or bare hex — accept exact v1 candidates only.
    const candidates = String(signature)
      .split(',')
      .map((part) => part.trim())
      .map((part) => (part.startsWith('v1=') ? part.slice(3) : part))
      .filter(Boolean);
    for (const candidate of candidates) {
      const candidateBuf = Buffer.from(candidate, 'utf8');
      if (candidateBuf.length === expectedBuf.length && crypto.timingSafeEqual(candidateBuf, expectedBuf)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
