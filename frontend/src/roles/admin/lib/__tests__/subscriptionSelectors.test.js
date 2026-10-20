// frontend/src/roles/admin/lib/__tests__/subscriptionSelectors.test.js
import { describe, expect, it } from 'vitest';
import {
  buildPlanTiers,
  canRetryCharge,
  computeSubscriptionMetrics,
  filterSubscriptionRows,
  normalizeBillingRow,
  renewsLabel,
} from '../subscriptionSelectors';
import { getPlanForAmount, normalizeSubscriptionStatus } from '../subscriptionStatus';
import { SUBSCRIPTION_PLANS } from '../subscriptionPlans';

const sample = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    seller_id: 'a',
    amount: 1500,
    status: 'paid',
    seller_name: 'A Shop',
    branch_name: 'Branch A',
    due_date: '2026-10-15',
    current_period_end: '2026-10-15',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    seller_id: 'b',
    amount: 1000,
    status: 'overdue',
    seller_name: 'B Shop',
    branch_name: 'Branch B',
    due_date: '2026-09-20',
    current_period_end: '2026-09-20',
  },
];

describe('subscription selectors', () => {
  it('normalizes statuses', () => {
    expect(normalizeSubscriptionStatus('paid').label).toBe('Active');
    expect(normalizeSubscriptionStatus('overdue').label).toBe('Past Due');
    expect(normalizeSubscriptionStatus('pending').label).toBe('Pending');
    expect(normalizeSubscriptionStatus('cancelled').label).toBe('Canceled');
  });

  it('maps amounts to catalog plan tiers', () => {
    expect(getPlanForAmount(1500).name).toBe('Gold Circle');
    expect(getPlanForAmount(1000).name).toBe('Bronze Access');
    expect(getPlanForAmount(12000).name).toBe('Platinum Vault');
  });

  it('computes metrics from real rows', () => {
    const m = computeSubscriptionMetrics(sample);
    expect(m.activeCount).toBe(1);
    expect(m.pastDueCount).toBe(1);
    expect(m.mrr).toBe(1500);
    expect(m.mrrLabel).toBe('₱1,500');
  });

  it('normalizes annual rows to monthly MRR (annual_price/12)', () => {
    const annual = {
      id: '44444444-4444-4444-4444-444444444444',
      seller_id: 'd',
      amount: 14940,
      billing_interval: 'annual',
      status: 'paid',
      seller_name: 'D Shop',
      branch_name: 'Branch D',
      plan_code: 'gold',
      current_period_end: '2027-10-14',
    };
    const m = computeSubscriptionMetrics([annual]);
    expect(m.activeCount).toBe(1);
    expect(m.mrr).toBe(1245);
  });

  it('keeps scheduled downgrades out of current plan counts until applied', () => {
    const scheduled = {
      ...sample[0],
      seller_id: 'a',
      plan_code: 'gold',
      scheduled_plan_code: 'bronze',
      scheduled_effective_at: '2026-11-14',
    };
    const m = computeSubscriptionMetrics([scheduled]);
    expect(m.planCounts.gold.active).toBe(1);
    expect(m.planCounts.bronze.active).toBe(0);
  });

  it('always returns all catalog plans even with zero subscribers', () => {
    const tiers = buildPlanTiers([]);
    expect(tiers).toHaveLength(SUBSCRIPTION_PLANS.length);
    expect(tiers.map((t) => t.name)).toEqual(['Bronze Access', 'Gold Circle', 'Platinum Vault']);
    expect(tiers.every((t) => t.subscribers === 0)).toBe(true);
    expect(tiers.every((t) => t.share === 0)).toBe(true);
  });

  it('builds plan tiers with live counts, share, and most popular', () => {
    const tiers = buildPlanTiers(sample);
    expect(tiers).toHaveLength(3);

    const bronze = tiers.find((t) => t.id === 'bronze');
    const gold = tiers.find((t) => t.id === 'gold');
    const platinum = tiers.find((t) => t.id === 'platinum');

    expect(bronze.subscribers).toBe(1);
    expect(gold.subscribers).toBe(1);
    expect(platinum.subscribers).toBe(0);

    // Share uses all mapped rows (2 total)
    expect(bronze.share).toBe(50);
    expect(gold.share).toBe(50);
    expect(platinum.share).toBe(0);

    // One popular badge; never hide platinum
    const popular = tiers.filter((t) => t.popular);
    expect(popular).toHaveLength(1);
    expect(platinum).toBeDefined();
  });

  it('marks most popular from subscriber counts when skewed', () => {
    const skewed = [
      ...sample,
      { ...sample[0], id: '33333333-3333-3333-3333-333333333333', seller_id: 'c', amount: 1000, status: 'paid', seller_name: 'C Shop' },
    ];
    const tiers = buildPlanTiers(skewed);
    const bronze = tiers.find((t) => t.id === 'bronze');
    const popular = tiers.find((t) => t.popular);
    expect(bronze.subscribers).toBe(2);
    expect(popular.id).toBe('bronze');
    expect(tiers.find((t) => t.id === 'platinum').subscribers).toBe(0);
  });

  it('filters by status and search', () => {
    const rows = sample.map(normalizeBillingRow);
    expect(filterSubscriptionRows(rows, { status: 'past_due' })).toHaveLength(1);
    expect(filterSubscriptionRows(rows, { search: 'B Shop' })).toHaveLength(1);
    expect(filterSubscriptionRows(rows, { search: 'Branch A' })).toHaveLength(1);
  });

  it('retry only for past due or pending', () => {
    expect(canRetryCharge({ status: 'overdue' })).toBe(true);
    expect(canRetryCharge({ status: 'pending' })).toBe(true);
    expect(canRetryCharge({ status: 'paid' })).toBe(false);
  });

  it('formats renews labels', () => {
    expect(renewsLabel({ status: 'paid', current_period_end: '2026-10-15' })).toContain('2026');
    expect(renewsLabel({ status: 'overdue', due_date: '2020-01-01' })).toMatch(/Overdue/);
  });
});
