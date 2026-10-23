// frontend/src/roles/shop-owner/subscription/subscriptionPaymentMethods.js
// The payment methods ATANY offers for seller subscriptions.
//
// The values are the PREFERENCE values ATANY stores (billing_records
// .payment_method_type). The actual payment always runs through PayMongo
// Hosted Checkout, restricted to the selected method — the provider's own
// identifier for Maya ("paymaya") never reaches the customer.
//
//   qrph  → QR Ph
//   card  → debit / credit card
//   gcash → GCash
//   maya  → Maya
//
// GrabPay, ShopeePay, UnionBank, BillEase and Buy Now Pay Later are NOT
// supported and are not rendered anywhere in this flow.
export const SUBSCRIPTION_PAYMENT_METHOD = Object.freeze({
  QRPH: 'qrph',
  CARD: 'card',
  GCASH: 'gcash',
  MAYA: 'maya',
});

/** The three top-level choices shown in the initial step. */
export const TOP_LEVEL_METHODS = Object.freeze([
  {
    value: SUBSCRIPTION_PAYMENT_METHOD.QRPH,
    label: 'QR Ph',
    description: 'Scan a QR Ph code to pay',
    group: 'qrph',
  },
  {
    value: SUBSCRIPTION_PAYMENT_METHOD.CARD,
    label: 'Card',
    description: 'Use a debit or credit card',
    group: 'card',
  },
  {
    // Frontend-only routing sentinel — it opens the e-wallet provider list.
    // The real provider value is chosen afterwards (gcash / paymaya).
    value: 'ewallet',
    label: 'E-Wallet',
    description: 'Pay using your preferred e-wallet',
    group: 'ewallet',
  },
]);

/** E-wallet providers — GCash and Maya ONLY. */
export const EWALLET_PROVIDERS = Object.freeze([
  {
    value: SUBSCRIPTION_PAYMENT_METHOD.GCASH,
    label: 'GCash',
    description: 'Pay using your GCash account',
  },
  {
    value: SUBSCRIPTION_PAYMENT_METHOD.MAYA,
    label: 'Maya',
    description: 'Pay using your Maya account',
  },
]);

/** Human label for a stored method value. */
export function subscriptionMethodLabel(value) {
  const v = String(value || '').toLowerCase();
  if (v === SUBSCRIPTION_PAYMENT_METHOD.QRPH) return 'QR Ph';
  if (v === SUBSCRIPTION_PAYMENT_METHOD.CARD) return 'Card';
  if (v === SUBSCRIPTION_PAYMENT_METHOD.GCASH) return 'GCash';
  if (v === SUBSCRIPTION_PAYMENT_METHOD.MAYA) return 'Maya';
  return 'QR Ph';
}

/** Description for a stored method value. */
export function subscriptionMethodDescription(value) {
  const v = String(value || '').toLowerCase();
  if (v === SUBSCRIPTION_PAYMENT_METHOD.QRPH) return 'Scan a QR Ph code to pay';
  if (v === SUBSCRIPTION_PAYMENT_METHOD.CARD) return 'Use a debit or credit card';
  if (v === SUBSCRIPTION_PAYMENT_METHOD.GCASH) return 'Pay using your GCash account';
  if (v === SUBSCRIPTION_PAYMENT_METHOD.MAYA) return 'Pay using your Maya account';
  return '';
}
