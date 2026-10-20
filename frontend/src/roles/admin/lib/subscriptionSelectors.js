// frontend/src/roles/admin/lib/subscriptionSelectors.js
import { peso, pesoCompact } from './currency';
import { matchesStatusFilter, normalizeSubscriptionStatus } from './subscriptionStatus';
import { SUBSCRIPTION_PLANS, resolvePlanForRecord, normalizeBillingInterval } from './subscriptionPlans';
import {
  computeCurrentSubscriptionMetrics,
  deriveSubscriptionStatusKey,
  pickCurrentBillingRecord,
} from '../../../shared/lib/subscriptionState';

export function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return isNaN(date)
    ? String(d)
    : date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function initialsOf(name, email) {
  const src = name || email || '';
  if (!src) return 'SU';
  if (src.includes('@')) {
    return src.split('@')[0].split(/[._-]/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
  }
  return src.trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
}

export function maskMethod(record) {
  const ref = record?.payment_reference || record?.paymongo_checkout_session_id || '';
  if (!ref) return '—';
  const digits = String(ref).replace(/\D/g, '');
  if (digits.length >= 4) return `•• ${digits.slice(-4)}`;
  const short = String(ref).slice(-6);
  return short.length > 2 ? `•• ${short}` : 'PayMongo';
}

export function renewsLabel(record) {
  const status = normalizeSubscriptionStatus(record?.status);
  const end = record?.current_period_end || record?.due_date;
  if (status.key === 'past_due') {
    const due = record?.due_date ? new Date(record.due_date) : null;
    if (due && !isNaN(due)) {
      const days = Math.max(0, Math.floor((Date.now() - due.getTime()) / 86400000));
      if (days > 0) return `Overdue · ${days} day${days === 1 ? '' : 's'}`;
    }
    return 'Overdue';
  }
  if (status.key === 'canceled') {
    return end ? `Ends ${formatDate(end)}` : 'Ended';
  }
  if (status.key === 'trialing') {
    return end ? `Trial ends ${formatDate(end)}` : 'Trial';
  }
  return formatDate(end);
}

/** Normalized MRR: annual_price/12 for annual intervals. */
export function rowMrr(plan, billingInterval, fallbackAmount) {
  const iv = normalizeBillingInterval(billingInterval);
  if (iv === 'annual') {
    return Math.round((Number(plan?.annualPrice) || 0) / 12);
  }
  return Number(plan?.monthlyPrice) || Number(fallbackAmount) || 0;
}

export function normalizeBillingRow(row) {
  const plan = resolvePlanForRecord(row);
  const status = normalizeSubscriptionStatus(row?.status);
  const interval = normalizeBillingInterval(row?.billing_interval || 'monthly');
  const periodPrice =
    interval === 'annual'
      ? Number(plan.annualPrice) || Number(row?.amount) || 0
      : Number(plan.monthlyPrice) || Number(row?.amount) || 0;
  // When backend sends mrr already normalized, prefer it; else compute
  const mrr =
    row?.billing_interval && row?.mrr != null && row?.billing_type !== 'upgrade_proration'
      ? Number(row.mrr)
      : rowMrr(plan, interval, row?.amount);

  const scheduledCode = row?.scheduled_plan_code || null;
  const scheduledPlan = scheduledCode
    ? (SUBSCRIPTION_PLANS.find((p) => p.id === scheduledCode || p.code === scheduledCode) || null)
    : null;
  const scheduledAt = row?.scheduled_effective_at || null;

  return {
    ...row,
    id: row?.id,
    sellerId: row?.seller_id,
    subscriberName: row?.seller_name || row?.shop_name || 'Unknown seller',
    subscriberEmail: row?.seller_email || '',
    subscriptionId: row?.id ? `SUB-${String(row.id).slice(0, 8).toUpperCase()}` : '—',
    planCode: plan.id || plan.code,
    planName: plan.name,
    planTone: plan.tone,
    planAmount: plan.monthlyPrice ?? (Number(row?.amount) || 0),
    planAnnualPrice: plan.annualPrice,
    billingInterval: interval,
    billingIntervalLabel: interval === 'annual' ? 'Annual' : 'Monthly',
    periodPrice,
    periodPriceLabel:
      interval === 'annual'
        ? `₱${periodPrice.toLocaleString()} / year`
        : `₱${periodPrice.toLocaleString()} / month`,
    mrrLabel: peso(mrr),
    scheduledPlanCode: scheduledCode,
    scheduledPlanName: scheduledPlan?.name || (scheduledCode ? scheduledCode : null),
    scheduledEffectiveAt: scheduledAt,
    scheduledEffectiveLabel: scheduledAt ? formatDate(scheduledAt) : null,
    scheduledIsDowngrade:
      scheduledCode &&
      scheduledCode !== (plan.id || plan.code),
    branchName: row?.branch_name || '—',
    mrr,
    statusKey: status.key,
    statusLabel: status.label,
    statusChip: status.chip,
    renews: renewsLabel(row),
    method: maskMethod(row),
    initials: initialsOf(row?.seller_name, row?.seller_email),
  };
}

export function computeSubscriptionMetrics(records) {
  // Metrics use CURRENT subscription per seller (not historical paid rows).
  const current = computeCurrentSubscriptionMetrics(records || []);
  const rows = (records || []).map(normalizeBillingRow);
  return {
    totalSellers: current.totalSellers,
    totalRecords: rows.length,
    activeCount: current.activeCount,
    pastDueCount: current.pastDueCount,
    pendingCount: current.pendingCount,
    canceledCount: current.canceledCount,
    trialingCount: 0,
    mrr: current.mrr,
    pastDueMrr: current.pastDueMrr,
    arr: current.arr,
    mrrLabel: peso(current.mrr),
    mrrCompact: pesoCompact(current.mrr),
    arrLabel: pesoCompact(current.arr),
    pastDueCompact: pesoCompact(current.pastDueMrr),
    planCounts: current.planCounts,
  };
}

export function buildPlanTiers(records) {
  const rows = (records || []).map(normalizeBillingRow);

  // Group live subscriber data by catalog plan (source of truth for plan existence)
  const byPlanId = new Map();
  for (const plan of SUBSCRIPTION_PLANS) {
    byPlanId.set(plan.id, {
      id: plan.id,
      name: plan.name,
      tone: plan.tone,
      amount: plan.monthlyPrice,
      allowance: plan.allowance,
      description: plan.description,
      catalogFeatures: plan.features,
      subscribers: 0,
      active: 0,
      pastDue: 0,
      pending: 0,
      branches: new Set(),
    });
  }

  // Count unique sellers by their CURRENT subscription plan only
  const bySeller = new Map();
  for (const r of rows) {
    if (!r?.sellerId) continue;
    const arr = bySeller.get(r.sellerId) || [];
    arr.push(r);
    bySeller.set(r.sellerId, arr);
  }

  for (const sellerRows of bySeller.values()) {
    const current = pickCurrentBillingRecord(sellerRows);
    if (!current) continue;
    const plan = resolvePlanForRecord(current);
    const statusKey = deriveSubscriptionStatusKey(current);
    const tier = byPlanId.get(plan.id);
    if (!tier) continue;
    tier.subscribers += 1;
    if (statusKey === 'active') tier.active += 1;
    if (statusKey === 'past_due') tier.pastDue += 1;
    if (statusKey === 'pending') tier.pending += 1;
    const branchName = current.branch_name || current.branchName;
    if (branchName && branchName !== '—') tier.branches.add(branchName);
  }

  // Share based on unique current subscribers across catalog plans
  const total = [...bySeller.values()].filter((rowsForSeller) => pickCurrentBillingRecord(rowsForSeller)).length || 1;
  const catalogOrder = new Map(SUBSCRIPTION_PLANS.map((p, i) => [p.id, i]));
  const tiers = [...byPlanId.values()]
    .map((t) => ({
      ...t,
      branchCount: t.branches.size,
      share: Math.round((t.subscribers / total) * 100),
      amountLabel: peso(t.amount),
      features: [
        ...t.catalogFeatures,
        t.allowance,
        `${t.subscribers} linked subscription${t.subscribers === 1 ? '' : 's'}`,
        `${t.active} active · ${t.pending} pending · ${t.pastDue} past due`,
      ],
    }))
    .sort((a, b) => {
      if (b.subscribers !== a.subscribers) return b.subscribers - a.subscribers;
      return (catalogOrder.get(a.id) || 0) - (catalogOrder.get(b.id) || 0);
    });

  // Always keep all catalog plans (Platinum stays visible at 0 subscribers)
  if (!tiers.length) return [];
  const popularId = tiers[0].id;
  return tiers.map((t) => ({ ...t, popular: t.id === popularId }));
}

export function filterSubscriptionRows(rows, { search = '', status = 'all', branch = 'all', plan = '' } = {}) {
  let list = rows || [];
  list = list.filter((r) => matchesStatusFilter(r.status, status));
  if (branch && branch !== 'all') list = list.filter((r) => (r.branch_name || '') === branch);
  if (plan) list = list.filter((r) => r.planName === plan);
  const q = (search || '').trim().toLowerCase();
  if (q) {
    list = list.filter((r) =>
      (r.subscriberName || '').toLowerCase().includes(q) ||
      (r.subscriberEmail || '').toLowerCase().includes(q) ||
      (r.branchName || '').toLowerCase().includes(q) ||
      (r.planName || '').toLowerCase().includes(q) ||
      (r.subscriptionId || '').toLowerCase().includes(q) ||
      String(r.id || '').toLowerCase().includes(q)
    );
  }
  return list;
}

export function extractBranches(records) {
  return [...new Set((records || []).map((r) => r.branch_name).filter(Boolean))].sort();
}

export function statusSummaryCounts(records) {
  const rows = (records || []).map(normalizeBillingRow);
  return {
    active: rows.filter((r) => r.statusKey === 'active').length,
    pastDue: rows.filter((r) => r.statusKey === 'past_due').length,
    pending: rows.filter((r) => r.statusKey === 'pending').length,
    canceled: rows.filter((r) => r.statusKey === 'canceled').length,
    trialing: rows.filter((r) => r.statusKey === 'trialing').length,
  };
}

export function canRetryCharge(record) {
  const status = normalizeSubscriptionStatus(record?.status);
  const raw = String(record?.status || '').toLowerCase();
  return (
    status.key === 'past_due' ||
    status.key === 'pending' ||
    raw === 'failed' ||
    raw === 'expired' ||
    raw === 'overdue'
  );
}
