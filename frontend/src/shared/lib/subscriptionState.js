// frontend/src/shared/lib/subscriptionState.js
// Shared subscription-state helpers so seller + admin agree on
// "current subscription" and metrics derived from CURRENT cycle only.
import { resolvePlanForRecord, normalizeBillingInterval, getPlanPeriodPrice } from './subscriptionPlans';

export const OPEN_BILLING_STATUSES = ['pending', 'processing', 'overdue', 'failed', 'expired'];

function startOfTodayMs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function isPaidPeriodActive(record) {
  if (!record || record.status !== 'paid') return false;
  const end = record.current_period_end || record.due_date;
  if (!end) return true;
  const ms = new Date(end).getTime();
  if (isNaN(ms)) return true;
  return ms >= startOfTodayMs();
}

/** Current subscription record: active paid period, else latest open, else newest. */
export function pickCurrentBillingRecord(records = []) {
  const list = [...(records || [])].sort(
    (a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0)
  );
  if (!list.length) return null;
  const currentPaid = list.find(isPaidPeriodActive);
  if (currentPaid) return currentPaid;
  const open = list.find((r) => OPEN_BILLING_STATUSES.includes(String(r?.status || '').toLowerCase()));
  return open || list[0];
}

export function pickOpenBillingRecord(records = []) {
  return (
    [...(records || [])]
      .sort((a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0))
      .find((r) => OPEN_BILLING_STATUSES.includes(String(r?.status || '').toLowerCase())) || null
  );
}

/** Map billing status → UI subscription status key. */
export function deriveSubscriptionStatusKey(current) {
  if (!current) return 'none';
  const s = String(current.status || '').toLowerCase();
  if (s === 'cancelled' || s === 'canceled') return 'canceled';
  if (s === 'paid') {
    return isPaidPeriodActive(current) ? 'active' : 'expired';
  }
  if (s === 'overdue') return 'past_due';
  if (s === 'pending' || s === 'processing') {
    const due = current.due_date || current.current_period_end;
    if (due && new Date(due).getTime() < startOfTodayMs()) return 'past_due';
    return 'pending';
  }
  if (s === 'failed' || s === 'expired') {
    const due = current.due_date || current.current_period_end;
    if (due && new Date(due).getTime() < startOfTodayMs()) return 'past_due';
    return 'pending';
  }
  return 'pending';
}

/** Normalized MRR contribution: annual → annualPrice/12; monthly → monthlyPrice. */
export function normalizeMrrForRecord(plan, record) {
  if (!plan) return Number(record?.amount) || 0;
  const iv = normalizeBillingInterval(record?.billing_interval || 'monthly');
  const periodPrice = getPlanPeriodPrice(plan, iv) || Number(record?.amount) || 0;
  if (iv === 'annual') return Math.round(periodPrice / 12);
  return periodPrice;
}

/**
 * Admin KPIs from CURRENT subscription per seller.
 * MRR = Σ current active normalized monthly prices (annual_price/12 for annual).
 * Scheduled downgrades do NOT change current plan counts until applied.
 */
export function computeCurrentSubscriptionMetrics(records = []) {
  const bySeller = new Map();
  for (const r of records || []) {
    if (!r?.seller_id) continue;
    const arr = bySeller.get(r.seller_id) || [];
    arr.push(r);
    bySeller.set(r.seller_id, arr);
  }

  let mrr = 0;
  let pastDueMrr = 0;
  let activeCount = 0;
  let pastDueCount = 0;
  let pendingCount = 0;
  let canceledCount = 0;
  const planCounts = {
    bronze: { subscribers: 0, active: 0, pastDue: 0, pending: 0 },
    gold: { subscribers: 0, active: 0, pastDue: 0, pending: 0 },
    platinum: { subscribers: 0, active: 0, pastDue: 0, pending: 0 },
  };

  for (const rows of bySeller.values()) {
    const current = pickCurrentBillingRecord(rows);
    if (!current) continue;
    const statusKey = deriveSubscriptionStatusKey(current);
    const plan = resolvePlanForRecord(current);
    const amount = normalizeMrrForRecord(plan, current);
    const planKey = plan.id || plan.code;
    if (planCounts[planKey]) planCounts[planKey].subscribers += 1;

    if (statusKey === 'active') {
      activeCount += 1;
      mrr += amount;
      if (planCounts[planKey]) planCounts[planKey].active += 1;
    } else if (statusKey === 'past_due') {
      pastDueCount += 1;
      pastDueMrr += amount;
      if (planCounts[planKey]) planCounts[planKey].pastDue += 1;
    } else if (statusKey === 'pending') {
      pendingCount += 1;
      if (planCounts[planKey]) planCounts[planKey].pending += 1;
    } else if (statusKey === 'canceled') {
      canceledCount += 1;
    }
  }

  return {
    totalSellers: bySeller.size,
    totalRecords: (records || []).length,
    activeCount,
    pastDueCount,
    pendingCount,
    canceledCount,
    mrr,
    pastDueMrr,
    arr: mrr * 12,
    planCounts,
  };
}
