// frontend/src/shared/lib/paymongoElements.js
// PayMongo.js v1 (elements.js) client integration — secure card tokenization.
//
// REAL SDK CONTRACT (verified live against https://js.paymongo.com/v1/elements.js):
//   const root  = window.PayMongo(apiKeyString);   // key is the FIRST ARGUMENT
//   const els   = root.elements();                  // lowercase, no arguments
//   const card  = els.create('card', { style });    // unified number/expiry/cvc field
//   card.mount(container);
//   const pm    = await root.createPaymentMethod({
//     type: 'card',
//     details: { card_number, exp_month, exp_year, cvc },
//     billing: { name },
//   }); // → { id, type, attributes: { details: { brand, last4, exp_month, exp_year } } }
//
// KEY RESOLUTION (publishable only — pk_test_/pk_live_ — never the secret):
//   1. VITE_PAYMONGO_PUBLIC_KEY (frontend env — preferred)
//   2. VITE_PAYMONGO_PUBLISHABLE_KEY (legacy alias)
//   3. Runtime key from GET /billing/paymongo-config (server-driven fallback)
//
// SECURITY: this legacy SDK renders provider-styled inputs in a container we
// own the DOM of, but never stores card data in React state. Values are read
// from the SDK's own inputs only at tokenize time and forwarded directly to
// PayMongo's API by the SDK. Our backend NEVER receives PAN/CVC.

export const PAYMONGO_ELEMENTS_SRC = 'https://js.paymongo.com/v1/elements.js';

const PAYMONGO_KEY_RE = /^pk_(test|live)_/;

let runtimePublishableKey = '';

/** Set the publishable key fetched from GET /billing/paymongo-config. */
export function setPublishableKey(key) {
  runtimePublishableKey = typeof key === 'string' ? key.trim() : '';
}

/** Publishable key: frontend env first (preferred), runtime config fallback. */
export function getPublishableKey() {
  const env = import.meta.env?.VITE_PAYMONGO_PUBLIC_KEY
    ?? import.meta.env?.VITE_PAYMONGO_PUBLISHABLE_KEY
    ?? '';
  if (typeof env === 'string' && env.trim()) return env.trim();
  return runtimePublishableKey;
}

/** True only for a valid publishable key STRING (guards SDK init). */
export function isSecureCardEntryConfigured() {
  const key = getPublishableKey();
  return typeof key === 'string' && PAYMONGO_KEY_RE.test(key);
}

let loadPromise = null;

/**
 * Inject the PayMongo.js script once and resolve with window.PayMongo.
 * Rejects on network/script error or timeout — callers surface a clear error.
 */
export function loadPayMongoElements({ timeoutMs = 12000 } = {}) {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('PayMongo.js requires a browser environment'));
  }
  if (window.PayMongo) return Promise.resolve(window.PayMongo);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${PAYMONGO_ELEMENTS_SRC}"]`);
    const script = existing || document.createElement('script');
    const timer = setTimeout(() => {
      loadPromise = null;
      reject(new Error('PayMongo secure card entry took too long to load'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
    const onLoad = () => {
      cleanup();
      if (window.PayMongo) {
        resolve(window.PayMongo);
      } else {
        loadPromise = null;
        reject(new Error('PayMongo secure card entry failed to initialize'));
      }
    };
    const onError = () => {
      cleanup();
      loadPromise = null;
      reject(new Error('Unable to load PayMongo secure card entry'));
    };

    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    if (!existing) {
      script.src = PAYMONGO_ELEMENTS_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return loadPromise;
}

/**
 * Mount the secure card field into `container`.
 * Returns { root, card, container } — root is needed for tokenization.
 *
 * Guards (dev diagnostics only — never logs the key value):
 *   - key must be a non-empty string matching pk_test_/pk_live_
 *     (prevents "The apiKey passed should be a string.")
 *   - isCancelled() aborts BEFORE mount (and rolls back AFTER) so a stale
 *     async mount (React StrictMode double-effect, fast channel switches)
 *     can never leave an orphaned duplicate field in the container.
 */
export async function mountCardElement(container, { publicKey, style, isCancelled } = {}) {
  const key = typeof publicKey === 'string' ? publicKey.trim() : '';
  if (!key || !PAYMONGO_KEY_RE.test(key)) {
    throw new Error('PayMongo publishable key is missing or invalid');
  }
  if (!container) throw new Error('Card entry container missing');
  if (import.meta.env?.DEV && import.meta.env?.MODE !== 'test') {
    // Dev-only diagnostics: TYPE only, never the key itself.
    console.debug('[paymongo] elements init — key type:', typeof key, '| prefix ok:', PAYMONGO_KEY_RE.test(key));
  }
  const PayMongo = await loadPayMongoElements();
  if (typeof PayMongo !== 'function') {
    throw new Error('PayMongo SDK failed to load');
  }
  if (isCancelled?.()) {
    const err = new Error('Secure card field mount cancelled');
    err.code = 'MOUNT_CANCELLED';
    throw err;
  }
  // REAL signature: the publishable key string is the first argument.
  const root = PayMongo(key);
  const elements = root.elements();
  const card = elements.create('card', {
    style: style || {
      base: {
        color: '#142A4A',
        fontSize: '15px',
        fontFamily: 'inherit',
        '::placeholder': { color: '#9aa3b2' },
      },
      invalid: { color: '#9f1239' },
    },
  });
  card.mount(container);
  if (isCancelled?.()) {
    // Cancelled between load and mount (StrictMode remount race) — roll back
    // so the container stays clean for the live mount.
    try { card.unmount?.(); } catch { /* SDK may not expose unmount */ }
    try { container.innerHTML = ''; } catch { /* container may be gone */ }
    const err = new Error('Secure card field mount cancelled');
    err.code = 'MOUNT_CANCELLED';
    throw err;
  }
  return { root, card, container };
}

/**
 * Read the SDK-owned input values (number/expiry/cvc) from the mounted field.
 * FORWARDED TO PAYMONGO ONLY — callers must never store these in React state
 * or send them to the ATANY backend.
 */
export function readSecureCardFields(container) {
  const num = String(container?.querySelector?.('.pm-card-number')?.value || '').replace(/\D/g, '');
  const exp = String(container?.querySelector?.('.pm-card-expiry')?.value || '').replace(/\D/g, '');
  const cvc = String(container?.querySelector?.('.pm-card-cvc')?.value || '').replace(/\D/g, '');
  const expMonth = exp ? Number(exp.slice(0, 2)) : null;
  let expYear = exp ? Number(exp.slice(2, 4)) : null;
  if (expYear != null && expYear < 100) expYear += 2000;
  return { cardNumber: num, expMonth, expYear, cvc };
}

/**
 * Tokenize the mounted secure card field into a provider payment-method id.
 * Returns ONLY safe metadata — never raw card data:
 *   { providerPaymentMethodId, brand, last4, expMonth, expYear }
 */
export async function createCardPaymentMethod({ root, container, billingName, billingEmail }) {
  if (!root || typeof root.createPaymentMethod !== 'function') {
    throw new Error('Secure card field is not ready');
  }
  const { cardNumber, expMonth, expYear, cvc } = readSecureCardFields(container);
  if (!cardNumber || !expMonth || !expYear || !cvc) {
    const err = new Error('Please complete all card fields.');
    err.code = 'CARD_FIELDS_INCOMPLETE';
    throw err;
  }
  const billing = {};
  if (billingName) billing.name = billingName;
  if (billingEmail) billing.email = billingEmail;
  const response = await root.createPaymentMethod({
    type: 'card',
    details: { card_number: cardNumber, exp_month: expMonth, exp_year: expYear, cvc },
    ...(Object.keys(billing).length ? { billing } : {}),
  });
  const attrs = response?.attributes || {};
  const details = attrs.details || {};
  const providerPaymentMethodId = response?.id;
  if (!providerPaymentMethodId) throw new Error('PayMongo did not return a payment method');
  // Some PayMongo responses omit details.brand — fall back to IIN sniffing
  // (display metadata only; backend treats brand as opaque text).
  let brand = details.brand;
  if (!brand) {
    const n = cardNumber[0];
    if (n === '4') brand = 'visa';
    else if (n === '5') brand = 'mastercard';
    else if (n === '3') brand = 'amex';
    else brand = 'card';
  }
  return {
    providerPaymentMethodId,
    brand,
    last4: details.last4 || cardNumber.slice(-4),
    expMonth: details.exp_month || expMonth,
    expYear: details.exp_year || expYear,
  };
}

/**
 * Build the POST /billing/payment-methods/attach body from a tokenization
 * result. Exported for unit tests: the payload must contain ONLY the provider
 * id + safe metadata — never card number / CVC / PAN.
 */
export function buildAttachPayload(tokenized, { makeDefault = false } = {}) {
  return {
    provider_payment_method_id: tokenized.providerPaymentMethodId,
    type: 'card',
    brand: tokenized.brand || null,
    last4: tokenized.last4 || null,
    exp_month: tokenized.expMonth || null,
    exp_year: tokenized.expYear || null,
    make_default: makeDefault === true,
  };
}
