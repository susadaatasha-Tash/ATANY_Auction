// frontend/src/shared/lib/subscriptionPlans.js
// Display catalog for ATANY seller subscription plan tiers.
// Backend /subscription-plans + billing controllers remain authoritative for
// price and plan_code on billing_records. Frontend submits plan_code only.
// Annual prices mirror backend integer-centavo formula (monthly*12 with 17% off).

export const ANNUAL_DISCOUNT_PERCENT = 17;

export function computeAnnualPrice(monthlyPrice) {
  const monthlyCents = Math.round(Number(monthlyPrice) * 100);
  const yearlyBaseCents = monthlyCents * 12;
  const discountCents = Math.floor((yearlyBaseCents * ANNUAL_DISCOUNT_PERCENT) / 100);
  return Math.round((yearlyBaseCents - discountCents) / 100);
}

export const SUBSCRIPTION_PLANS = [
  {
    id: 'bronze',
    code: 'bronze',
    name: 'Bronze Access',
    monthlyPrice: 1000,
    annualPrice: computeAnnualPrice(1000),
    rank: 1,
    tone: 'bronze',
    order: 0,
    allowance: '1 branch · 3 staff seats',
    description: 'For independent consignors testing the auction floor.',
    features: [
      'Up to 25 active lots',
      'Standard listing fees',
      'Email support',
      'Basic bid analytics',
    ],
    limits: {
      activeLots: 25,
      branches: 1,
      staffSeats: 3,
    },
  },
  {
    id: 'gold',
    code: 'gold',
    name: 'Gold Circle',
    monthlyPrice: 1500,
    annualPrice: computeAnnualPrice(1500),
    rank: 2,
    tone: 'gold',
    order: 1,
    allowance: '3 branches · 12 staff seats',
    description: 'For established sellers running weekly live auctions.',
    features: [
      'Up to 200 active lots',
      'Reduced 6% commission',
      'Priority lot placement',
      'Live auction tools',
      'Buyer messaging',
    ],
    limits: {
      activeLots: 200,
      branches: 3,
      staffSeats: 12,
    },
  },
  {
    id: 'platinum',
    code: 'platinum',
    name: 'Platinum Vault',
    monthlyPrice: 12000,
    annualPrice: computeAnnualPrice(12000),
    rank: 3,
    tone: 'platinum',
    order: 2,
    allowance: 'Unlimited branches · Unlimited seats',
    description: 'For high-volume vaults and multi-branch consignment houses.',
    features: [
      'Unlimited active lots',
      'Lowest 3% commission',
      'Insured vault storage',
      'Dedicated account manager',
      'Custom API + scheduled reports',
    ],
    limits: {
      activeLots: null,
      branches: null,
      staffSeats: null,
    },
  },
];

export function getSubscriptionPlanCatalog() {
  return SUBSCRIPTION_PLANS.map((p) => ({ ...p }));
}

export function findPlanByName(name) {
  if (!name) return null;
  return SUBSCRIPTION_PLANS.find((p) => p.name === name) || null;
}

export function findPlanById(id) {
  if (!id) return null;
  const key = String(id).toLowerCase().trim();
  return SUBSCRIPTION_PLANS.find((p) => p.id === key || p.code === key) || null;
}

export function getPlanForPlanCode(code) {
  return findPlanById(code);
}

export function normalizeBillingInterval(interval) {
  const key = String(interval || 'monthly').toLowerCase().trim();
  return key === 'annual' || key === 'year' || key === 'yearly' ? 'annual' : 'monthly';
}

export function getPlanPeriodPrice(plan, interval) {
  if (!plan) return 0;
  return normalizeBillingInterval(interval) === 'annual'
    ? Number(plan.annualPrice) || 0
    : Number(plan.monthlyPrice) || 0;
}

export function intervalSuffix(interval) {
  return normalizeBillingInterval(interval) === 'annual' ? '/year' : '/month';
}

export function intervalLabel(interval) {
  return normalizeBillingInterval(interval) === 'annual' ? 'Annual' : 'Monthly';
}

/**
 * Map a billing amount to a catalog plan (legacy fallback when plan_code missing).
 * Closest monthly OR annual catalog price wins.
 */
export function getPlanForBillingAmount(amount) {
  const n = Number(amount) || 0;
  let best = SUBSCRIPTION_PLANS[0];
  let bestDiff = Infinity;
  for (const plan of SUBSCRIPTION_PLANS) {
    for (const candidate of [plan.monthlyPrice, plan.annualPrice]) {
      const diff = Math.abs(n - Number(candidate) || 0);
      if (diff < bestDiff) {
        best = plan;
        bestDiff = diff;
      }
    }
  }
  return best;
}

/**
 * Resolve plan for a billing_records row.
 * plan_code (server source of truth) wins; amount is legacy fallback only.
 */
export function resolvePlanForRecord(record) {
  if (!record) return SUBSCRIPTION_PLANS[0];
  if (record.plan_code) {
    const byCode = getPlanForPlanCode(record.plan_code);
    if (byCode) return byCode;
  }
  return getPlanForBillingAmount(record.amount);
}

/** Catalog rank comparison for Upgrade / Downgrade labels. */
export function comparePlanOrders(a, b) {
  const aRank = a?.rank ?? (a?.order != null ? a.order + 1 : 0);
  const bRank = b?.rank ?? (b?.order != null ? b.order + 1 : 0);
  return aRank - bRank;
}

export function planActionKind(currentPlan, targetPlan, currentInterval, targetInterval) {
  if (!targetPlan) return 'select';
  if (!currentPlan) return 'select';
  const currentId = currentPlan.id || currentPlan.code;
  const targetId = targetPlan.id || targetPlan.code;
  const curIv = normalizeBillingInterval(currentInterval);
  const tgtIv = normalizeBillingInterval(targetInterval || currentInterval);

  if (currentId === targetId && curIv === tgtIv) return 'current';
  const rankDelta = comparePlanOrders(targetPlan, currentPlan);
  if (rankDelta > 0) return 'upgrade';
  if (rankDelta < 0) return 'downgrade';
  // same rank — interval only
  if (tgtIv === 'annual' && curIv === 'monthly') return 'upgrade';
  return 'downgrade';
}

export function planActionLabel(currentPlan, targetPlan, currentInterval, targetInterval) {
  const kind = planActionKind(currentPlan, targetPlan, currentInterval, targetInterval);
  if (kind === 'current') return 'Current plan';
  if (kind === 'upgrade') return 'Upgrade';
  if (kind === 'downgrade') return 'Downgrade';
  return 'Select plan';
}

export function planPriceLabel(plan, interval) {
  if (!plan) return '—';
  const price = getPlanPeriodPrice(plan, interval);
  return `₱${price.toLocaleString()}${intervalSuffix(interval)}`;
}
