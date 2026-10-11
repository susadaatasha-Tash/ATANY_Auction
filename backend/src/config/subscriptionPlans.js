// backend/src/config/subscriptionPlans.js
// SINGLE source of truth for ATANY seller subscription plans (backend).
// Frontend may mirror this for display, but the server always resolves
// price and identity from this catalog. Clients submit plan_code only.
// Currency math is integer centavos — never floating-point money.

export const ANNUAL_DISCOUNT_PERCENT = 17;
export const BILLING_INTERVALS = ['monthly', 'annual'];

/** Integer centavo annual price: monthly*12 with 17% discount. */
export function computeAnnualPriceCents(monthlyPricePesos) {
  const monthlyCents = Math.round(Number(monthlyPricePesos) * 100);
  const yearlyBaseCents = monthlyCents * 12;
  const discountCents = Math.floor((yearlyBaseCents * ANNUAL_DISCOUNT_PERCENT) / 100);
  return yearlyBaseCents - discountCents;
}

/** Annual price in whole pesos for a monthly catalog price. */
export function computeAnnualPricePesos(monthlyPricePesos) {
  return Math.round(computeAnnualPriceCents(monthlyPricePesos) / 100);
}

export function normalizeBillingInterval(interval) {
  const key = String(interval || 'monthly').toLowerCase().trim();
  return key === 'annual' || key === 'year' || key === 'yearly' ? 'annual' : 'monthly';
}

function buildPlan({ code, name, monthly_price, rank, sort_order, tone, allowance, description, features, limits }) {
  return {
    code,
    name,
    monthly_price,
    annual_price: computeAnnualPricePesos(monthly_price),
    rank,
    sort_order,
    tone,
    allowance,
    description,
    features,
    limits,
  };
}

export const SUBSCRIPTION_PLANS = [
  buildPlan({
    code: 'bronze',
    name: 'Bronze Access',
    monthly_price: 1000,
    rank: 1,
    sort_order: 0,
    tone: 'bronze',
    allowance: '1 branch · 3 staff seats',
    description: 'For independent consignors testing the auction floor.',
    features: [
      'Up to 25 active lots',
      'Standard listing fees',
      'Email support',
      'Basic bid analytics',
    ],
    limits: { activeLots: 25, branches: 1, staffSeats: 3 },
  }),
  buildPlan({
    code: 'gold',
    name: 'Gold Circle',
    monthly_price: 1500,
    rank: 2,
    sort_order: 1,
    tone: 'gold',
    allowance: '3 branches · 12 staff seats',
    description: 'For established sellers running weekly live auctions.',
    features: [
      'Up to 200 active lots',
      'Reduced 6% commission',
      'Priority lot placement',
      'Live auction tools',
      'Buyer messaging',
    ],
    limits: { activeLots: 200, branches: 3, staffSeats: 12 },
  }),
  buildPlan({
    code: 'platinum',
    name: 'Platinum Vault',
    monthly_price: 12000,
    rank: 3,
    sort_order: 2,
    tone: 'platinum',
    allowance: 'Unlimited branches · Unlimited seats',
    description: 'For high-volume vaults and multi-branch consignment houses.',
    features: [
      'Unlimited active lots',
      'Lowest 3% commission',
      'Insured vault storage',
      'Dedicated account manager',
      'Custom API + scheduled reports',
    ],
    limits: { activeLots: null, branches: null, staffSeats: null },
  }),
];

export function getPlanCatalog() {
  return SUBSCRIPTION_PLANS.map((p) => ({ ...p }));
}

export function getPlanByCode(code) {
  if (!code) return null;
  const key = String(code).toLowerCase().trim();
  return SUBSCRIPTION_PLANS.find((p) => p.code === key) || null;
}

export function getPlanByPrice(amount) {
  const n = Number(amount) || 0;
  let best = SUBSCRIPTION_PLANS[0];
  let bestDiff = Math.abs(n - best.monthly_price);
  for (const plan of SUBSCRIPTION_PLANS) {
    const diff = Math.abs(n - plan.monthly_price);
    if (diff < bestDiff) {
      best = plan;
      bestDiff = diff;
    }
  }
  return best;
}

/** Resolve plan for a billing_records row: plan_code wins; amount is legacy fallback. */
export function resolvePlanForRecord(record) {
  if (!record) return SUBSCRIPTION_PLANS[0];
  if (record.plan_code) {
    const byCode = getPlanByCode(record.plan_code);
    if (byCode) return byCode;
  }
  return getPlanByPrice(record.amount);
}

export function isValidPlanCode(code) {
  return !!getPlanByCode(code);
}

export function isValidBillingInterval(interval) {
  return BILLING_INTERVALS.includes(normalizeBillingInterval(interval));
}

/** Period price in whole pesos for plan + interval. */
export function getPlanPriceForInterval(plan, interval) {
  if (!plan) return 0;
  return normalizeBillingInterval(interval) === 'annual'
    ? Number(plan.annual_price) || 0
    : Number(plan.monthly_price) || 0;
}

/** Rank comparison — upgrade/downgrade uses rank, not price alone. */
export function comparePlanRank(a, b) {
  return (Number(a?.rank) || 0) - (Number(b?.rank) || 0);
}

export function intervalLabel(interval) {
  return normalizeBillingInterval(interval) === 'annual' ? 'year' : 'month';
}
