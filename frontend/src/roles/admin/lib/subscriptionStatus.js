// frontend/src/roles/admin/lib/subscriptionStatus.js
// Status mapping for admin subscriptions — based on billing_records.status
// Backend statuses: pending | paid | overdue | failed | expired | cancelled
import { resolvePlanForRecord } from '../../../shared/lib/subscriptionPlans';

const STATUS_MAP = {
  paid: {
    key: 'active',
    label: 'Active',
    filter: 'active',
    chip: 'active',
  },
  active: {
    key: 'active',
    label: 'Active',
    filter: 'active',
    chip: 'active',
  },
  overdue: {
    key: 'past_due',
    label: 'Past Due',
    filter: 'past_due',
    chip: 'past_due',
  },
  pending: {
    key: 'pending',
    label: 'Pending',
    filter: 'pending',
    chip: 'pending',
  },
  processing: {
    key: 'pending',
    label: 'Processing',
    filter: 'pending',
    chip: 'pending',
  },
  failed: {
    key: 'pending',
    label: 'Failed',
    filter: 'pending',
    chip: 'pending',
  },
  expired: {
    key: 'pending',
    label: 'Expired',
    filter: 'pending',
    chip: 'pending',
  },
  cancelled: {
    key: 'canceled',
    label: 'Canceled',
    filter: 'canceled',
    chip: 'canceled',
  },
  canceled: {
    key: 'canceled',
    label: 'Canceled',
    filter: 'canceled',
    chip: 'canceled',
  },
  trial: {
    key: 'trialing',
    label: 'Trialing',
    filter: 'trialing',
    chip: 'trialing',
  },
  trialing: {
    key: 'trialing',
    label: 'Trialing',
    filter: 'trialing',
    chip: 'trialing',
  },
};

export const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'past_due', label: 'Past Due' },
  { id: 'pending', label: 'Pending' },
  { id: 'canceled', label: 'Canceled' },
];

export function normalizeSubscriptionStatus(raw) {
  if (!raw) return STATUS_MAP.pending;
  const key = String(raw).toLowerCase().trim();
  return STATUS_MAP[key] || STATUS_MAP.pending;
}

export function statusLabel(raw) {
  return normalizeSubscriptionStatus(raw).label;
}

export function statusChip(raw) {
  return normalizeSubscriptionStatus(raw).chip;
}

export function matchesStatusFilter(raw, filterId) {
  if (!filterId || filterId === 'all') return true;
  return normalizeSubscriptionStatus(raw).filter === filterId;
}

// Plan tiers derived from the shared subscription plan catalog.
// billing_records.plan_code wins; amount is legacy fallback.
export function getPlanForAmount(amount) {
  const plan = resolvePlanForRecord({ amount });
  return { name: plan.name, tone: plan.tone, amount: Number(amount) || 0 };
}

export function getPlanForRecord(record) {
  const plan = resolvePlanForRecord(record);
  return {
    name: plan.name,
    tone: plan.tone,
    code: plan.code || plan.id,
    amount: Number(record?.amount) || plan.monthlyPrice || 0,
  };
}

export function planToneClass(tone) {
  return `sub-plan-tone--${tone || 'standard'}`;
}
