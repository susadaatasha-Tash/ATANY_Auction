// frontend/src/roles/admin/lib/currency.js
export function peso(n) {
  const num = Number(n || 0);
  return '₱' + num.toLocaleString('en-PH');
}

export function pesoCompact(n) {
  const num = Number(n || 0);
  if (Math.abs(num) >= 1_000_000) return `₱${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(num) >= 1_000) return `₱${(num / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return peso(num);
}
