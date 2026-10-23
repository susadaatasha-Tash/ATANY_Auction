// backend/src/services/subscriptionPaymentMethods.js
// The canonical payment-method contract for seller subscriptions.
//
// The PREFERENCE value is what ATANY stores (billing_records.payment_method_type):
//   qrph → QR Ph
//   card → debit/credit card
//   gcash→ GCash
//   maya → Maya
//
// The PAYMONGO provider identifier can differ from the preference value —
// PayMongo calls Maya "paymaya". The actual payment ALWAYS runs through
// PayMongo Hosted Checkout restricted to that single provider method.
//
// GrabPay, ShopeePay, UnionBank, BillEase and Buy Now Pay Later are NOT
// supported and are rejected server-side (never only hidden in the UI).
//
// Kept in its own module so both the billing service and the payment-method
// service can use it without a circular import.

export const SUBSCRIPTION_PAYMENT_METHOD = Object.freeze({
  QRPH: 'qrph',
  CARD: 'card',
  GCASH: 'gcash',
  MAYA: 'maya',
});

export const SUPPORTED_SUBSCRIPTION_METHODS = Object.freeze([
  SUBSCRIPTION_PAYMENT_METHOD.QRPH,
  SUBSCRIPTION_PAYMENT_METHOD.CARD,
  SUBSCRIPTION_PAYMENT_METHOD.GCASH,
  SUBSCRIPTION_PAYMENT_METHOD.MAYA,
]);

/** ATANY preference value -> PayMongo provider method identifier. */
export const PAYMONGO_METHOD_MAP = Object.freeze({
  [SUBSCRIPTION_PAYMENT_METHOD.CARD]: 'card',
  [SUBSCRIPTION_PAYMENT_METHOD.GCASH]: 'gcash',
  [SUBSCRIPTION_PAYMENT_METHOD.MAYA]: 'paymaya',
  [SUBSCRIPTION_PAYMENT_METHOD.QRPH]: 'qrph',
});

/**
 * Resolve the PayMongo provider method for a stored preference.
 * @param {string} preference the ATANY preference value (card/gcash/maya/qrph)
 * @returns {string} the PayMongo payment method identifier
 */
export function toPayMongoMethodType(preference) {
  const provider = PAYMONGO_METHOD_MAP[String(preference || '').toLowerCase()];
  if (!provider) {
    const err = new Error('This payment method is not supported.');
    err.statusCode = 400;
    err.code = 'UNSUPPORTED_PAYMENT_METHOD';
    throw err;
  }
  return provider;
}

/**
 * Reject any payment method outside the supported allowlist.
 * @param {string} value raw method value from the request
 * @returns {string} the normalized (lower-cased) supported method
 */
export function assertSupportedSubscriptionMethod(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    const err = new Error('Payment method is required');
    err.statusCode = 400;
    err.code = 'INVALID_PAYMENT_METHOD';
    throw err;
  }
  if (!SUPPORTED_SUBSCRIPTION_METHODS.includes(normalized)) {
    const err = new Error('This payment method is not supported.');
    err.statusCode = 400;
    err.code = 'UNSUPPORTED_PAYMENT_METHOD';
    throw err;
  }
  return normalized;
}
