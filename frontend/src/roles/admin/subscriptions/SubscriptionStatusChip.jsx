// frontend/src/roles/admin/subscriptions/SubscriptionStatusChip.jsx
import { statusChip, statusLabel } from '../lib/subscriptionStatus';

export function SubscriptionStatusChip({ status }) {
  const chip = statusChip(status);
  return (
    <span className={`sub-chip sub-chip--${chip}`} data-testid="subscription-status">
      {statusLabel(status)}
    </span>
  );
}

export default SubscriptionStatusChip;
