// frontend/src/roles/shop-owner/subscription/sellerSubscriptionSelectors.js
// Seller subscription view-model — real billing_records + shared plan catalog only.
import {
  SUBSCRIPTION_PLANS,
  planActionKind,
  planActionLabel,
  resolvePlanForRecord,
  normalizeBillingInterval,
  getPlanPeriodPrice,
  intervalLabel,
} from '../../../shared/lib/subscriptionPlans';
import { normalizeSubscriptionStatus } from '../../admin/lib/subscriptionStatus';
import { peso } from '../../admin/lib/currency';

export function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return isNaN(date)
    ? String(d)
    : date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function maskReference(ref) {
  if (!ref) return '—';
  const s = String(ref);
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 4) return `•••• ${digits.slice(-4)}`;
  return s.length > 10 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function periodEndMs(record) {
  const end = record?.current_period_end || record?.due_date;
  if (!end) return null;
  const ms = new Date(end).getTime();
  return isNaN(ms) ? null : ms;
}

export function isPaidPeriodActive(record) {
  if (!record || record.status !== 'paid') return false;
  const end = periodEndMs(record);
  if (end == null) return true;
  return end >= startOfToday();
}

/**
 * Pick the record that represents the seller's current subscription state.
 * API already returns newest-first; we still sort defensively.
 */
export function pickCurrentBillingRecord(records = []) {
  const list = [...(records || [])].sort(
    (a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0)
  );
  if (!list.length) return null;
  const currentPaid = list.find(isPaidPeriodActive);
  if (currentPaid) return currentPaid;
  const open = list.find((r) => ['pending', 'overdue', 'processing'].includes(r?.status));
  return open || list[0];
}

export function pickNextPaymentRecord(records = [], current = null) {
  const list = [...(records || [])].sort(
    (a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0)
  );
  const open = list.find((r) => ['pending', 'overdue', 'processing'].includes(r?.status));
  if (open) return open;
  return null;
}

/**
 * Build seller subscription page state from real /billing/me rows.
 */
export function buildSellerSubscriptionState(records = []) {
  const list = [...(records || [])].sort(
    (a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0)
  );
  const history = list;

  if (!list.length) {
    return {
      kind: 'none',
      record: null,
      plan: null,
      status: null,
      statusLabel: null,
      planName: null,
      amount: 0,
      amountLabel: peso(0),
      billingInterval: 'monthly',
      periodLabel: null,
      renewalLabel: null,
      lastPaidLabel: null,
      paymentReference: null,
      nextPayment: null,
      history,
      totalPaid: 0,
      totalDue: 0,
    };
  }

  const record = pickCurrentBillingRecord(list);
  const status = normalizeSubscriptionStatus(record?.status);
  const plan = resolvePlanForRecord(record);
  const billingInterval = normalizeBillingInterval(record?.billing_interval || 'monthly');
  const periodPrice = getPlanPeriodPrice(plan, billingInterval) || Number(record.amount) || 0;
  const nextPaymentRecord = pickNextPaymentRecord(list, record);

  let kind = 'active';
  if (status.key === 'pending') kind = 'pending';
  else if (status.key === 'past_due') kind = 'past_due';
  else if (status.key === 'canceled') kind = 'canceled';
  else if (status.key === 'trialing') kind = 'trialing';
  else if (status.key === 'active' && nextPaymentRecord) kind = 'active_with_upcoming';

  const periodStart = record?.current_period_start;
  const periodEnd = record?.current_period_end || record?.due_date;
  const periodLabel =
    periodStart && periodEnd
      ? `${formatDate(periodStart)} – ${formatDate(periodEnd)}`
      : record?.billing_period || null;

  const renewalLabel = formatDate(periodEnd);
  const lastPaidLabel = record?.paid_at ? formatDate(record.paid_at) : null;
  const paymentReference = record?.payment_reference || record?.paymongo_checkout_session_id || null;

  const totalPaid = history
    .filter((r) => r.status === 'paid')
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalDue = history
    .filter((r) => ['pending', 'overdue'].includes(r.status))
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  let nextPayment = null;
  if (nextPaymentRecord) {
    const npInterval = normalizeBillingInterval(nextPaymentRecord.billing_interval || billingInterval);
    nextPayment = {
      record: nextPaymentRecord,
      amount: Number(nextPaymentRecord.amount) || 0,
      amountLabel: peso(nextPaymentRecord.amount),
      billing_interval: npInterval,
      date: formatDate(nextPaymentRecord.due_date || nextPaymentRecord.current_period_end),
      planName: resolvePlanForRecord(nextPaymentRecord).name,
      statusKey: normalizeSubscriptionStatus(nextPaymentRecord.status).key,
      statusLabel: normalizeSubscriptionStatus(nextPaymentRecord.status).label,
      reference: maskReference(
        nextPaymentRecord.payment_reference || nextPaymentRecord.paymongo_checkout_session_id
      ),
      mode: 'open_invoice',
    };
  } else if (kind === 'active' || kind === 'trialing' || kind === 'active_with_upcoming') {
    nextPayment = {
      record: null,
      amount: periodPrice,
      amountLabel: peso(periodPrice),
      billing_interval: billingInterval,
      date: renewalLabel,
      planName: plan.name,
      statusKey: status.key,
      statusLabel: status.label,
      reference: maskReference(paymentReference),
      mode: 'next_billing_date',
    };
  }

  return {
    kind,
    record,
    plan,
    status,
    statusLabel: status.label,
    planName: plan.name,
    amount: periodPrice,
    amountLabel: peso(periodPrice),
    billingInterval,
    intervalLabel: intervalLabel(billingInterval),
    periodLabel,
    renewalLabel,
    lastPaidLabel,
    paymentReference,
    nextPayment,
    history,
    totalPaid,
    totalDue,
  };
}

/**
 * Usage metrics — only what the app can actually calculate from real APIs.
 * Limits come from the shared plan catalog.
 */
export function buildUsageMetrics({ listings = [], auctions = [], shop = null, plan = null } = {}) {
  const activeStatuses = new Set(['live', 'scheduled', 'approved', 'pending']);
  const activeListings = (listings || []).filter((l) => {
    const s = l?.computed_status || l?.status;
    return activeStatuses.has(s);
  }).length;

  const liveAuctions = (auctions || []).filter((a) => {
    const s = a?.status || a?.computed_status;
    return s === 'live';
  }).length;

  const scheduledAuctions = (auctions || []).filter((a) => {
    const s = a?.status || a?.computed_status;
    return s === 'scheduled';
  }).length;

  const branchesUsed = shop?.home_branch_id ? 1 : 0;
  const limits = plan?.limits || null;

  const metrics = [
    {
      id: 'active-listings',
      label: 'Active listings',
      used: activeListings,
      limit: limits?.activeLots ?? null,
      unlimited: limits?.activeLots == null,
    },
    {
      id: 'live-auctions',
      label: 'Live auctions',
      used: liveAuctions,
      limit: null,
      unlimited: true,
      note: scheduledAuctions > 0 ? `${scheduledAuctions} scheduled` : null,
    },
    {
      id: 'branch-usage',
      label: 'Branch usage',
      used: branchesUsed,
      limit: limits?.branches ?? null,
      unlimited: limits?.branches == null,
    },
  ];

  return metrics.map((m) => {
    if (m.unlimited || m.limit == null) {
      return {
        ...m,
        ratio: m.used > 0 ? 1 : 0,
        percentLabel: m.limit == null && m.unlimited ? 'Unlimited' : `${m.used} used`,
        remainingLabel: m.limit == null ? null : `${Math.max(0, m.limit - m.used)} remaining`,
      };
    }
    const limit = m.limit;
    const ratio = limit > 0 ? Math.min(1, m.used / limit) : 0;
    const percent = Math.round(ratio * 100);
    return {
      ...m,
      ratio,
      percentLabel: `${percent}% used`,
      remainingLabel:
        m.used >= limit ? 'At plan limit' : `${Math.max(0, limit - m.used)} remaining`,
    };
  });
}

export function buildComparePlans(currentPlan) {
  return SUBSCRIPTION_PLANS.map((plan) => {
    const kind = planActionKind(currentPlan, plan);
    return {
      ...plan,
      priceLabel: peso(plan.monthlyPrice),
      actionKind: kind,
      actionLabel: planActionLabel(currentPlan, plan),
      isCurrent: kind === 'current',
    };
  });
}

export function heroFeatures(plan) {
  if (!plan) return [];
  const features = [...(plan.features || [])];
  if (plan.allowance) features.push(plan.allowance);
  return features;
}

export function billingHistoryRows(records = []) {
  return [...(records || [])]
    .sort((a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0))
    .map((r) => {
    const status = normalizeSubscriptionStatus(r?.status);
    const plan = resolvePlanForRecord(r);
    return {
      id: r.id,
      reference: r.payment_reference || r.paymongo_checkout_session_id || r.id,
      referenceLabel: maskReference(r.payment_reference || r.paymongo_checkout_session_id || r.id),
      rawReference: r.payment_reference || r.paymongo_checkout_session_id || null,
      date: formatDate(r.paid_at || r.created_at || r.due_date),
      planName: plan.name,
      billingPeriod: r.billing_period || '—',
      amount: Number(r.amount) || 0,
      amountLabel: peso(r.amount),
      statusKey: status.key,
      statusLabel: status.label,
      chip: status.chip,
      payable: ['pending', 'overdue'].includes(status.key),
      record: r,
    };
  });
}
