// backend/src/services/commission.js
// Canonical ATANY platform commission: 10% platform, 90% seller.
// Single source of truth — money stays integer pesos (Math.round, no floats).
export const COMMISSION_RATE = 0.10;

export function calculatePlatformCommission(amount) {
  return Math.round(Number(amount || 0) * COMMISSION_RATE);
}

export function calculateSellerPayout(amount) {
  return Math.round(Number(amount || 0) * (1 - COMMISSION_RATE));
}
