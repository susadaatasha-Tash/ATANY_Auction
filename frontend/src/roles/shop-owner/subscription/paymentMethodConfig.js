// frontend/src/roles/shop-owner/subscription/paymentMethodConfig.js
// Payment-method catalog for the Update-payment-method modal.
// Exactly THREE rows: QR Ph, Card, E-Wallet (GCash + Maya only).
// ShopeePay, UnionBank, GrabPay and BNPL are FORBIDDEN in this flow —
// never defined, rendered, or tested for anywhere in this modal.

/** Canonical method ids used by state + tests. */
export const METHOD_IDS = {
  QRPH: 'qrph',
  CARD: 'card',
  EWALLET: 'ewallet',
};

/** E-wallet providers offered in this flow (PayMongo-supported only). */
export const WALLET_IDS = ['gcash', 'maya'];

export const WALLET_LABELS = { gcash: 'GCash', maya: 'Maya' };

/** Frontend method id → PayMongo hosted-checkout payment_method_types value. */
export const CHECKOUT_TYPE = {
  gcash: 'gcash',
  maya: 'paymaya',
  qrph: 'qrph',
  card: 'card',
};

const FALLBACK_CAPABILITY = {
  qrph: true,
  card: true,
  wallets: [
    { id: 'gcash', label: 'GCash' },
    { id: 'maya', label: 'Maya' },
  ],
};

/**
 * Category rows for the method selector, derived from the provider capability
 * map. Only QR Ph / Card / E-Wallet are ever returned for this modal.
 */
export function methodRows(capability) {
  const cap = capability || FALLBACK_CAPABILITY;
  const wallets = (cap.wallets || FALLBACK_CAPABILITY.wallets)
    .filter((w) => WALLET_IDS.includes(String(w?.id || '').toLowerCase()))
    .map((w) => String(w.id).toLowerCase());
  const rows = [];
  if (cap.qrph) {
    rows.push({
      id: METHOD_IDS.QRPH,
      title: 'QR Ph',
      hint: 'Scan and pay with any supported banking app',
      logo: 'qrph',
    });
  }
  if (cap.card) {
    rows.push({
      id: METHOD_IDS.CARD,
      title: 'Card',
      hint: 'Visa, Mastercard, Amex, JCB',
      logo: 'card',
    });
  }
  if (wallets.length) {
    rows.push({
      id: METHOD_IDS.EWALLET,
      title: 'E-Wallet',
      hint: 'Pay using e-wallets',
      logo: 'wallet',
      wallets,
    });
  }
  return rows;
}

/** E-wallet step rows (only providers this flow offers). */
export function walletRows(capability) {
  const cap = capability || FALLBACK_CAPABILITY;
  return (cap.wallets || FALLBACK_CAPABILITY.wallets)
    .filter((w) => WALLET_IDS.includes(String(w?.id || '').toLowerCase()))
    .map((w) => {
      const id = String(w.id).toLowerCase();
      return {
        id,
        title: WALLET_LABELS[id] || w.label || id,
        logo: id,
        hint: id === 'gcash' ? 'Pay with your GCash wallet' : 'Pay with your Maya wallet',
      };
    });
}

/** Human label for the review step given {category, wallet, savedMethod}. */
export function selectionLabel({ category, wallet, savedMethod, cardBrand }) {
  if (category === METHOD_IDS.QRPH) return 'QR Ph';
  if (category === METHOD_IDS.EWALLET) return WALLET_LABELS[wallet] || 'E-Wallet';
  if (category === METHOD_IDS.CARD) {
    if (savedMethod?.last4) return `Card •••• ${savedMethod.last4}`;
    if (savedMethod) return 'Saved card';
    return cardBrand ? `${cardBrand} card` : 'New card';
  }
  return 'Payment method';
}
