// frontend/src/roles/customer/lib/currency.js
// Peso formatting for purchase dashboard — real amounts only.

const php0 = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
});

export function peso(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return php0.format(0);
  return php0.format(num);
}
