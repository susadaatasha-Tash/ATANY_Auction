// frontend/src/roles/shop-owner/subscription/BillingStatusBadge.jsx
export function BillingStatusChip({ statusKey, statusLabel }) {
  const key = statusKey || 'pending';
  return (
    <span className={`ssub-chip ssub-chip--${key}`} data-testid="billing-status-chip">
      {statusLabel || key}
    </span>
  );
}

export default BillingStatusChip;
