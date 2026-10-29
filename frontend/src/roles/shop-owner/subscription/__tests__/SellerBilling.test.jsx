// frontend/src/roles/shop-owner/subscription/__tests__/SellerBilling.test.jsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({
  apiFetch: (...args) => apiFetch(...args),
}));

const mockToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('../../../../shared/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { email: 'seller@atany.test' } } },
      }),
    },
  },
}));

import Billing from '../../pages/Billing';
import {
  buildSellerSubscriptionState,
  buildUsageMetrics,
  buildComparePlans,
  billingHistoryRows,
  pickCurrentBillingRecord,
} from '../sellerSubscriptionSelectors';
import {
  SUBSCRIPTION_PLANS,
  getPlanForBillingAmount,
  computeAnnualPrice,
  getPlanPeriodPrice,
  planActionKind,
} from '../../../../shared/lib/subscriptionPlans';
import { setPublishableKey, getPublishableKey } from '../../../../shared/lib/paymongoElements';

// Tests must be deterministic regardless of frontend/.env: the real
// VITE_PAYMONGO_PUBLIC_KEY must never enable secure entry here.
beforeEach(() => {
  vi.stubEnv('VITE_PAYMONGO_PUBLIC_KEY', '');
  vi.stubEnv('VITE_PAYMONGO_PUBLISHABLE_KEY', '');
  setPublishableKey('');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const paidGold = {
  id: '11111111-1111-1111-1111-111111111111',
  seller_id: 'seller-1',
  amount: 1500,
  billing_period: 'September 2026 – October 2026',
  billing_interval: 'monthly',
  status: 'paid',
  due_date: '2026-10-14',
  paid_at: '2026-09-15T10:00:00Z',
  payment_reference: 'pay_ref_9021',
  current_period_start: '2026-09-14',
  current_period_end: '2026-10-14',
  created_at: '2026-09-14T00:00:00Z',
};

const paidGoldAnnual = {
  ...paidGold,
  id: '11111111-1111-1111-1111-111111111112',
  amount: 14940,
  plan_code: 'gold',
  billing_interval: 'annual',
  billing_period: 'October 2025 – October 2026',
  current_period_start: '2025-10-14',
  current_period_end: '2026-10-14',
  created_at: '2025-10-14T00:00:00Z',
};

const pendingNext = {
  id: '22222222-2222-2222-2222-222222222222',
  seller_id: 'seller-1',
  amount: 1500,
  billing_period: 'October 2026 – November 2026',
  billing_interval: 'monthly',
  status: 'pending',
  due_date: '2026-11-14',
  paid_at: null,
  payment_reference: null,
  current_period_start: '2026-10-15',
  current_period_end: '2026-11-14',
  created_at: '2026-10-10T00:00:00Z',
};

const overdueBronze = {
  id: '33333333-3333-3333-3333-333333333333',
  seller_id: 'seller-1',
  amount: 1000,
  billing_period: 'August 2026 – September 2026',
  billing_interval: 'monthly',
  status: 'overdue',
  due_date: '2026-09-14',
  paid_at: null,
  payment_reference: null,
  current_period_start: '2026-08-14',
  current_period_end: '2026-09-14',
  created_at: '2026-08-14T00:00:00Z',
};

const listings = [
  { id: 'p1', status: 'approved', computed_status: 'live' },
  { id: 'p2', status: 'approved', computed_status: 'scheduled' },
  { id: 'p3', status: 'pending', computed_status: 'pending' },
  { id: 'p4', status: 'approved', computed_status: 'ended' },
];

const auctions = [
  { id: 'a1', status: 'live' },
  { id: 'a2', status: 'scheduled' },
  { id: 'a3', status: 'ended' },
];

const shop = { home_branch_id: 'br-1', shop_name: 'Golden Heritage' };

function mockApis({
  billing = [],
  listingRows = listings,
  auctionRows = auctions,
  shopRow = shop,
  subscription = null,
  paymentMethods = [],
  paymongoConfig = { publishable_key: null },
} = {}) {
  apiFetch.mockImplementation((path, opts) => {
    if (path === '/billing/me') return Promise.resolve(billing);
    if (path === '/shop-owner/listings') return Promise.resolve(listingRows);
    if (path === '/shop-owner/auctions') return Promise.resolve(auctionRows);
    if (path === '/shop-owner/shop') return Promise.resolve(shopRow);
    if (path === '/billing/me/subscription') return Promise.resolve(subscription);
    if (path === '/billing/paymongo-config') return Promise.resolve(paymongoConfig);
    if (path === '/billing/payment-methods') {
      return Promise.resolve({ payment_methods: paymentMethods });
    }
    return Promise.resolve([]);
  });
}

/**
 * Stub window.PayMongo to the REAL v1 elements.js contract:
 *   PayMongo(apiKeyString) → { elements(), createPaymentMethod }
 * The card element's mount() renders SDK-owned inputs (.pm-*) into the
 * container so tests can fill them like a real user would.
 */
function stubPayMongoElements({ createPaymentMethodImpl } = {}) {
  const card = {
    mount: vi.fn((container) => {
      container.innerHTML = `
        <fieldset>
          <input class="pm-input pm-card-number" placeholder="Card number" />
          <div>
            <input class="pm-input pm-card-expiry" placeholder="MM / YY" />
            <input class="pm-input pm-card-cvc" placeholder="CVC" />
          </div>
        </fieldset>`;
    }),
  };
  const elements = { create: vi.fn(() => card) };
  const root = {
    elements: vi.fn(() => elements),
    createPaymentMethod: vi.fn(async (payload) => {
      if (createPaymentMethodImpl) return createPaymentMethodImpl(payload);
      return {
        id: 'pm_token_123',
        type: 'payment_method',
        attributes: {
          type: 'card',
          details: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2028 },
          billing: { name: payload?.billing?.name || '' },
        },
      };
    }),
  };
  window.PayMongo = vi.fn((apiKey) => {
    // Real SDK contract: a non-string apiKey throws exactly this error.
    if (typeof apiKey !== 'string') {
      throw new Error('The apiKey passed should be a string.');
    }
    return root;
  });
  return { card, elements, root };
}

function fillSecureCardFields({ number = '4242424242424242', expiry = '12 / 28', cvc = '123' } = {}) {
  fireEvent.change(document.querySelector('.pm-card-number'), { target: { value: number } });
  fireEvent.change(document.querySelector('.pm-card-expiry'), { target: { value: expiry } });
  fireEvent.change(document.querySelector('.pm-card-cvc'), { target: { value: cvc } });
}

function renderPage(initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Billing />
    </MemoryRouter>,
  );
}

/** Open the Update-payment-method modal and wait for the method selector. */
async function openPaymentMethodModal() {
  await waitFor(() => {
    expect(screen.getByTestId('update-payment-method-btn')).toBeInTheDocument();
  });
  fireEvent.click(screen.getByTestId('update-payment-method-btn'));
  await waitFor(() => {
    expect(screen.getByTestId('method-selector')).toBeInTheDocument();
  });
}

/** Select a method row then press Continue (rows only select; Continue opens). */
async function selectAndContinue(rowTestId) {
  fireEvent.click(screen.getByTestId(rowTestId));
  await waitFor(() => expect(screen.getByTestId('continue-btn')).toBeEnabled());
  fireEvent.click(screen.getByTestId('continue-btn'));
}

async function openCardFlow() {
  await openPaymentMethodModal();
  await selectAndContinue('method-card');
}

async function openEwalletFlow() {
  await openPaymentMethodModal();
  await selectAndContinue('method-ewallet');
}

async function openQrPhFlow() {
  await openPaymentMethodModal();
  await selectAndContinue('method-qrph');
}

const upgradePreviewFixture = {
  type: 'upgrade',
  billing_interval: 'monthly',
  current_plan: {
    code: 'gold',
    name: 'Gold Circle',
    period_price: 1500,
    billing_interval: 'monthly',
    features: ['Up to 200 active lots'],
  },
  target_plan: {
    code: 'platinum',
    name: 'Platinum Vault',
    period_price: 12000,
    billing_interval: 'monthly',
    features: ['Unlimited active lots', 'Dedicated account manager'],
  },
  amount_due_now: 9250,
  next_billing_amount: 12000,
  next_billing_interval: 'monthly',
  effective_at: 'immediate',
  proration: { remaining_fraction: 0.74 },
};

const downgradePreviewFixture = {
  type: 'downgrade',
  billing_interval: 'monthly',
  current_plan: {
    code: 'gold',
    name: 'Gold Circle',
    period_price: 1500,
    billing_interval: 'monthly',
    features: ['Up to 200 active lots', 'Reduced 6% commission'],
  },
  target_plan: {
    code: 'bronze',
    name: 'Bronze Access',
    period_price: 1000,
    billing_interval: 'monthly',
    features: ['Up to 25 active lots'],
  },
  amount_due_now: 0,
  next_billing_amount: 1000,
  next_billing_interval: 'monthly',
  effective_at: '2026-11-14',
  proration: { remaining_fraction: 0.25 },
};

describe('seller subscription selectors', () => {
  it('shares the plan catalog with admin logic', () => {
    expect(SUBSCRIPTION_PLANS.map((p) => p.id)).toEqual(['bronze', 'gold', 'platinum']);
    expect(getPlanForBillingAmount(1000).name).toBe('Bronze Access');
    expect(getPlanForBillingAmount(1500).name).toBe('Gold Circle');
    expect(getPlanForBillingAmount(12000).name).toBe('Platinum Vault');
  });

  it('computes annual prices from the server-side 17% formula', () => {
    expect(computeAnnualPrice(1000)).toBe(9960);
    expect(computeAnnualPrice(1500)).toBe(14940);
    expect(computeAnnualPrice(12000)).toBe(119520);
  });

  it('resolves period prices by interval', () => {
    const gold = SUBSCRIPTION_PLANS.find((p) => p.id === 'gold');
    expect(getPlanPeriodPrice(gold, 'monthly')).toBe(1500);
    expect(getPlanPeriodPrice(gold, 'annual')).toBe(14940);
  });

  it('classifies plan actions from rank + interval', () => {
    const bronze = SUBSCRIPTION_PLANS.find((p) => p.id === 'bronze');
    const gold = SUBSCRIPTION_PLANS.find((p) => p.id === 'gold');
    const platinum = SUBSCRIPTION_PLANS.find((p) => p.id === 'platinum');
    expect(planActionKind(gold, platinum, 'monthly', 'monthly')).toBe('upgrade');
    expect(planActionKind(gold, bronze, 'monthly', 'monthly')).toBe('downgrade');
    expect(planActionKind(gold, gold, 'monthly', 'annual')).toBe('upgrade');
    expect(planActionKind(gold, gold, 'annual', 'monthly')).toBe('downgrade');
    expect(planActionKind(gold, gold, 'monthly', 'monthly')).toBe('current');
    expect(planActionKind(bronze, platinum, 'monthly', 'annual')).toBe('upgrade');
  });

  it('maps current plan from real subscription amount', () => {
    const state = buildSellerSubscriptionState([paidGold]);
    expect(state.planName).toBe('Gold Circle');
    expect(state.amountLabel).toBe('₱1,500');
    expect(state.statusLabel).toBe('Active');
    expect(state.kind).toBe('active');
    expect(state.billingInterval).toBe('monthly');
  });

  it('maps annual subscription interval + period price', () => {
    const state = buildSellerSubscriptionState([paidGoldAnnual]);
    expect(state.billingInterval).toBe('annual');
    expect(state.planName).toBe('Gold Circle');
    expect(state.amountLabel).toBe('₱14,940');
  });

  it('marks correct plan card as current in compare list', () => {
    const state = buildSellerSubscriptionState([paidGold]);
    const plans = buildComparePlans(state.plan);
    expect(plans.find((p) => p.isCurrent)?.id).toBe('gold');
    expect(plans.find((p) => p.id === 'bronze')?.actionLabel).toBe('Downgrade');
    expect(plans.find((p) => p.id === 'platinum')?.actionLabel).toBe('Upgrade');
  });

  it('builds usage metrics only from real data + catalog limits', () => {
    const state = buildSellerSubscriptionState([paidGold]);
    const metrics = buildUsageMetrics({ listings, auctions, shop, plan: state.plan });
    const active = metrics.find((m) => m.id === 'active-listings');
    expect(active.used).toBe(3);
    expect(active.limit).toBe(200);
    expect(active.percentLabel).toBe('2% used');

    const live = metrics.find((m) => m.id === 'live-auctions');
    expect(live.used).toBe(1);
    expect(live.unlimited).toBe(true);

    const branch = metrics.find((m) => m.id === 'branch-usage');
    expect(branch.used).toBe(1);
    expect(branch.limit).toBe(3);
  });

  it('does not invent staff seats or media storage metrics', () => {
    const metrics = buildUsageMetrics({ listings, auctions, shop, plan: SUBSCRIPTION_PLANS[0] });
    const ids = metrics.map((m) => m.id);
    expect(ids).not.toContain('staff-seats');
    expect(ids).not.toContain('media-storage');
    expect(ids).not.toContain('featured-spots');
  });

  it('handles no subscription state', () => {
    const state = buildSellerSubscriptionState([]);
    expect(state.kind).toBe('none');
    expect(state.plan).toBeNull();
  });

  it('handles pending payment state', () => {
    const state = buildSellerSubscriptionState([pendingNext]);
    expect(state.kind).toBe('pending');
    expect(state.statusLabel).toBe('Pending');
    expect(state.nextPayment?.mode).toBe('open_invoice');
  });

  it('handles past due state', () => {
    const state = buildSellerSubscriptionState([overdueBronze]);
    expect(state.kind).toBe('past_due');
    expect(state.statusLabel).toBe('Past Due');
    expect(state.planName).toBe('Bronze Access');
  });

  it('maps billing history statuses and plan names', () => {
    const rows = billingHistoryRows([paidGold, pendingNext, overdueBronze]);
    expect(rows.find((r) => r.id === pendingNext.id).statusLabel).toBe('Pending');
    expect(rows.find((r) => r.id === pendingNext.id).planName).toBe('Gold Circle');
    expect(rows.find((r) => r.id === overdueBronze.id).statusLabel).toBe('Past Due');
    expect(rows.find((r) => r.id === overdueBronze.id).planName).toBe('Bronze Access');
    expect(rows.every((r) => r.amountLabel.startsWith('₱'))).toBe(true);
  });

  it('prefers active paid period over later pending renewal row', () => {
    const current = pickCurrentBillingRecord([pendingNext, paidGold]);
    expect(current.id).toBe(paidGold.id);
    const state = buildSellerSubscriptionState([pendingNext, paidGold]);
    expect(state.kind).toBe('active_with_upcoming');
    expect(state.planName).toBe('Gold Circle');
    expect(state.nextPayment?.mode).toBe('open_invoice');
  });
});

describe('Seller Subscription page', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    mockToast.mockClear();
    vi.unstubAllGlobals();
    setPublishableKey('');
    delete window.PayMongo;
  });

  it('renders real current plan, features, usage, next payment, compare, history', async () => {
    mockApis({ billing: [pendingNext, paidGold] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('current-plan-hero')).toBeInTheDocument();
    });

    expect(screen.getByTestId('current-plan-name')).toHaveTextContent('Gold Circle');
    expect(screen.getByTestId('current-plan-price')).toHaveTextContent('₱1,500');
    expect(screen.getByTestId('current-plan-status')).toHaveTextContent('Active');
    expect(screen.getByTestId('current-plan-interval')).toHaveTextContent('Monthly billing');
    expect(screen.getByTestId('current-plan-renewal')).toHaveTextContent('Oct 14, 2026');

    expect(screen.getByTestId('plan-features-panel')).toBeInTheDocument();
    expect(screen.getAllByText('Up to 200 active lots').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/3 branches · 12 staff seats/).length).toBeGreaterThanOrEqual(1);

    expect(screen.getByTestId('usage-this-cycle')).toBeInTheDocument();
    expect(screen.getByTestId('usage-value-active-listings')).toHaveTextContent('3 / 200');
    expect(screen.getByTestId('usage-value-live-auctions')).toHaveTextContent('1');
    expect(screen.getByTestId('usage-value-branch-usage')).toHaveTextContent('1 / 3');

    expect(screen.getByTestId('next-payment-card')).toBeInTheDocument();
    expect(screen.getByTestId('next-payment-amount')).toHaveTextContent('₱1,500');
    expect(screen.getByTestId('next-payment-subtitle')).toHaveTextContent('Payment pending');
    expect(screen.getByTestId('next-payment-pay-btn')).toBeInTheDocument();
    expect(screen.getByTestId('update-payment-method-btn')).toBeInTheDocument();

    expect(screen.getByTestId('compare-plans')).toBeInTheDocument();
    expect(screen.getByTestId('seller-plan-bronze')).toBeInTheDocument();
    expect(screen.getByTestId('seller-plan-gold')).toBeInTheDocument();
    expect(screen.getByTestId('seller-plan-platinum')).toBeInTheDocument();
    expect(screen.getByTestId('seller-plan-gold')).toHaveAttribute('data-current', 'true');
    expect(screen.getByTestId('seller-plan-action-gold')).toBeDisabled();
    expect(screen.getByTestId('seller-plan-action-platinum')).toHaveTextContent('Upgrade');
    expect(screen.getByTestId('seller-plan-action-bronze')).toHaveTextContent('Downgrade');

    expect(screen.getByTestId('billing-history')).toBeInTheDocument();
    expect(screen.getAllByTestId('billing-row').length).toBeGreaterThanOrEqual(1);
  });

  it('shows monthly + annual toggle and all ATANY plans in Manage billing modal', async () => {
    mockApis({ billing: [paidGold] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('change-plan-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('change-plan-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('manage-billing-modal')).toBeInTheDocument();
    });

    expect(screen.getByTestId('interval-monthly')).toBeInTheDocument();
    expect(screen.getByTestId('interval-annual')).toBeInTheDocument();
    expect(screen.getByTestId('manage-plan-bronze')).toBeInTheDocument();
    expect(screen.getByTestId('manage-plan-gold')).toBeInTheDocument();
    expect(screen.getByTestId('manage-plan-platinum')).toBeInTheDocument();
    expect(screen.getByTestId('current-plan-badge')).toBeInTheDocument();
    expect(screen.getByTestId('manage-plan-action-gold')).toHaveTextContent('Current plan');
    expect(screen.getByTestId('manage-plan-action-platinum')).toHaveAttribute('data-action', 'upgrade');
    expect(screen.getByTestId('manage-plan-action-bronze')).toHaveAttribute('data-action', 'downgrade');
  });

  it('shows annual prices when Annual toggle is selected', async () => {
    mockApis({ billing: [paidGold] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('manage-billing-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('manage-billing-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('manage-billing-modal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('interval-annual'));
    expect(screen.getByTestId('manage-plan-price-platinum')).toHaveTextContent('₱119,520/year');
    expect(screen.getByTestId('manage-plan-price-gold')).toHaveTextContent('₱14,940/year');
    expect(screen.getByTestId('manage-plan-price-bronze')).toHaveTextContent('₱9,960/year');
  });

  it('opens upgrade confirm modal with backend preview amounts', async () => {
    mockApis({ billing: [paidGold] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('change-plan-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('change-plan-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('manage-plan-action-platinum')).toBeInTheDocument();
    });

    apiFetch.mockImplementation((path, opts) => {
      if (path === '/billing/me') return Promise.resolve([paidGold]);
      if (path === '/shop-owner/listings') return Promise.resolve(listings);
      if (path === '/shop-owner/auctions') return Promise.resolve(auctions);
      if (path === '/shop-owner/shop') return Promise.resolve(shop);
      if (path === '/billing/me/subscription') return Promise.resolve(null);
      if (path === '/billing/subscription/change/preview') {
        return Promise.resolve(upgradePreviewFixture);
      }
      return Promise.resolve([]);
    });

    fireEvent.click(screen.getByTestId('manage-plan-action-platinum'));

    await waitFor(() => {
      expect(screen.getByTestId('upgrade-confirm-modal')).toBeInTheDocument();
    });
    expect(screen.getByTestId('upgrade-amount-due')).toHaveTextContent('₱9,250');
    expect(screen.getByTestId('upgrade-effective')).toHaveTextContent('Instantly');
    expect(screen.getByTestId('confirm-upgrade-btn')).toHaveTextContent('Confirm upgrade · ₱9,250');
  });

  it('opens downgrade confirm modal with $0 charged + effective date', async () => {
    mockApis({ billing: [paidGold] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('change-plan-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('change-plan-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('manage-plan-action-bronze')).toBeInTheDocument();
    });

    apiFetch.mockImplementation((path) => {
      if (path === '/billing/me') return Promise.resolve([paidGold]);
      if (path === '/shop-owner/listings') return Promise.resolve(listings);
      if (path === '/shop-owner/auctions') return Promise.resolve(auctions);
      if (path === '/shop-owner/shop') return Promise.resolve(shop);
      if (path === '/billing/me/subscription') return Promise.resolve(null);
      if (path === '/billing/subscription/change/preview') {
        return Promise.resolve(downgradePreviewFixture);
      }
      return Promise.resolve([]);
    });

    fireEvent.click(screen.getByTestId('manage-plan-action-bronze'));

    await waitFor(() => {
      expect(screen.getByTestId('downgrade-confirm-modal')).toBeInTheDocument();
    });
    expect(screen.getByTestId('downgrade-charge')).toHaveTextContent('₱0');
    expect(screen.getByTestId('downgrade-effective-date')).toHaveTextContent('Nov 14, 2026');
    expect(screen.getByTestId('confirm-downgrade-btn')).toHaveTextContent('Schedule downgrade');
  });

  it('opens payment method modal with three method rows + real subscription summary', async () => {
    stubPayMongoElements();
    mockApis({
      billing: [paidGold],
      paymentMethods: [
        { id: 'pm-1', brand: 'visa', last4: '4242', is_default: true, exp_month: 12, exp_year: 2028 },
      ],
      paymongoConfig: { publishable_key: 'pk_test_modal' },
      subscription: {
        plan: { code: 'gold', name: 'Gold Circle', monthly_price: 1500, annual_price: 14940 },
        billing_interval: 'monthly',
        subscription_status: 'active',
        current_record: paidGold,
        open_record: pendingNext,
        next_payment: {
          mode: 'open_invoice',
          billing_id: pendingNext.id,
          amount: 1500,
          plan_name: 'Gold Circle',
          billing_interval: 'monthly',
          due_date: '2026-11-14',
          payment_reference: null,
        },
      },
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('update-payment-method-btn')).toBeInTheDocument();
    });

    await openPaymentMethodModal();

    // ---- LEFT: real subscription summary (plan card → fee → total → metadata)
    expect(screen.getByTestId('payment-summary')).toBeInTheDocument();
    expect(screen.getByTestId('summary-plan-name')).toHaveTextContent('Gold Circle');
    expect(screen.getByTestId('summary-plan-interval')).toHaveTextContent('Monthly Subscription');
    expect(screen.getByTestId('summary-plan-badge')).toHaveTextContent('Active Plan');
    expect(screen.getByTestId('summary-plan-description')).toHaveTextContent(
      'For established sellers running weekly live auctions.'
    );
    expect(screen.getByTestId('summary-fee')).toHaveTextContent('₱1,500.00');
    expect(screen.getByTestId('summary-taxes')).toHaveTextContent('Free');
    expect(screen.getByTestId('summary-total')).toHaveTextContent('₱1,500.00');
    expect(screen.getByTestId('summary-date')).toHaveTextContent('Nov 14, 2026');
    expect(screen.getByTestId('summary-reference')).toHaveTextContent('SUB-20261114-2222');
    expect(screen.getByTestId('summary-cycle')).toHaveTextContent('Monthly');
    expect(screen.getByTestId('summary-note')).toHaveTextContent(
      /charged once when you confirm your payment method/i
    );

    // ---- RIGHT: exactly three rows, nothing selected yet
    expect(screen.getByTestId('method-selector')).toBeInTheDocument();
    expect(screen.getByTestId('method-qrph')).toBeInTheDocument();
    expect(screen.getByTestId('method-card')).toBeInTheDocument();
    expect(screen.getByTestId('method-ewallet')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.queryByTestId('method-bnpl')).not.toBeInTheDocument();
    expect(screen.getByTestId('continue-btn')).toBeDisabled();
    expect(screen.getByTestId('payment-security-note')).toHaveTextContent(
      'Your payment is securely processed by ATANY. All transactions are encrypted.'
    );

    // Row copy matches the approved reference
    expect(screen.getByTestId('method-qrph')).toHaveTextContent('Scan and pay with any supported banking app');
    expect(screen.getByTestId('method-card')).toHaveTextContent('Visa, Mastercard, Amex, JCB');
    expect(screen.getByTestId('method-ewallet')).toHaveTextContent('Pay using e-wallets');

    // Row icon boxes + right-side provider logos (local SVG only)
    expect(screen.getByTestId('row-icon-qrph')).toBeInTheDocument();
    expect(screen.getByTestId('row-icon-card')).toBeInTheDocument();
    expect(screen.getByTestId('row-icon-ewallet')).toBeInTheDocument();
    expect(screen.getByTestId('row-logos-qrph')).toBeInTheDocument();
    expect(screen.getByTestId('row-logos-card')).toBeInTheDocument();
    expect(screen.getByTestId('logo-gcash')).toBeInTheDocument();
    expect(screen.getByTestId('logo-maya')).toBeInTheDocument();
    expect(screen.getByTestId('logo-visa')).toBeInTheDocument();
    expect(screen.getByTestId('logo-mastercard')).toBeInTheDocument();
    expect(screen.getByTestId('logo-amex')).toBeInTheDocument();
    expect(screen.getByTestId('logo-jcb')).toBeInTheDocument();

    // Forbidden providers are never rendered anywhere in the modal
    const modal = screen.getByTestId('payment-method-modal');
    expect(modal.textContent).not.toMatch(/grabpay|shopeepay|unionbank|billease/i);
    expect(screen.queryByTestId('logo-grabpay')).not.toBeInTheDocument();

    // Selecting a row only selects; Continue opens the flow
    fireEvent.click(screen.getByTestId('method-card'));
    await waitFor(() => expect(screen.getByTestId('continue-btn')).toBeEnabled());
    expect(screen.getByTestId('method-card')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('method-qrph')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByTestId('continue-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('saved-method-pm-1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('saved-cards-heading')).toBeInTheDocument();
    expect(screen.getByTestId('step-back')).toBeInTheDocument();
    expect(screen.getByTestId('payment-summary')).toBeInTheDocument();
  });

  it('displays scheduled downgrade banner from subscription summary', async () => {
    mockApis({
      billing: [paidGold],
      subscription: {
        scheduled_change: {
          target_plan_code: 'bronze',
          effective_at: '2026-11-14',
          status: 'scheduled',
        },
      },
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('scheduled-downgrade-banner')).toBeInTheDocument();
    });
    expect(screen.getByTestId('scheduled-downgrade-banner')).toHaveTextContent('Bronze Access');
    expect(screen.getByTestId('scheduled-downgrade-banner')).toHaveTextContent('2026-11-14');
    expect(screen.getByTestId('cancel-scheduled-downgrade')).toBeInTheDocument();
  });

describe('payment method modal — method selector (exactly three rows)', () => {
  const methodsFixture = [
    { id: 'pm-1', brand: 'visa', last4: '4242', is_default: true, exp_month: 12, exp_year: 2028 },
    { id: 'pm-2', brand: 'mastercard', last4: '5555', is_default: false, exp_month: 1, exp_year: 2027 },
  ];

  async function openModal({ billing = [paidGold], methods = methodsFixture, paymongoConfig, subscription } = {}) {
    mockApis({ billing, paymentMethods: methods, paymongoConfig, subscription });
    renderPage();
    await openPaymentMethodModal();
  }

  it('renders QR Ph, Card and E-Wallet rows from the backend capability map', async () => {
    await openModal({
      paymongoConfig: {
        publishable_key: 'pk_test_x',
        payment_methods: {
          qrph: true,
          card: true,
          wallets: [
            { id: 'gcash', label: 'GCash' },
            { id: 'maya', label: 'Maya' },
          ],
        },
      },
    });
    expect(screen.getByTestId('method-qrph')).toBeInTheDocument();
    expect(screen.getByTestId('method-card')).toBeInTheDocument();
    expect(screen.getByTestId('method-ewallet')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    // E-Wallet copy is the generic wallet line (no provider enumeration)
    expect(screen.getByTestId('method-ewallet')).toHaveTextContent('Pay using e-wallets');
  });

  it('never renders BNPL even when the provider reports BillEase support', async () => {
    await openModal({
      paymongoConfig: {
        publishable_key: 'pk_test_x',
        payment_methods: {
          qrph: true,
          card: true,
          wallets: [{ id: 'gcash', label: 'GCash' }],
          bnpl: [{ id: 'billease', label: 'BillEase' }],
        },
      },
    });
    expect(screen.queryByTestId('method-bnpl')).not.toBeInTheDocument();
    expect(screen.queryByText(/billease/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('never renders GrabPay, ShopeePay or UnionBank', async () => {
    await openModal({
      paymongoConfig: {
        publishable_key: 'pk_test_x',
        payment_methods: {
          qrph: true,
          card: true,
          wallets: [
            { id: 'gcash', label: 'GCash' },
            { id: 'grabpay', label: 'GrabPay' },
            { id: 'shopeepay', label: 'ShopeePay' },
            { id: 'unionbank', label: 'UnionBank' },
            { id: 'maya', label: 'Maya' },
          ],
        },
      },
    });
    const modal = screen.getByTestId('payment-method-modal');
    expect(modal.textContent).not.toMatch(/grabpay|shopeepay|unionbank/i);
    expect(screen.queryByTestId('logo-grabpay')).not.toBeInTheDocument();
    // Only the two allowed provider logos appear in the row
    expect(within(screen.getByTestId('row-logos-ewallet')).getByTestId('logo-gcash')).toBeInTheDocument();
    expect(within(screen.getByTestId('row-logos-ewallet')).getByTestId('logo-maya')).toBeInTheDocument();
  });

  it('falls back to safe default rows when no capability map is returned', async () => {
    await openModal({ paymongoConfig: { publishable_key: null } });
    expect(screen.getByTestId('method-qrph')).toBeInTheDocument();
    expect(screen.getByTestId('method-card')).toBeInTheDocument();
    expect(screen.getByTestId('method-ewallet')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('Continue stays disabled until a row is selected, then opens that flow', async () => {
    await openModal();
    const continueBtn = screen.getByTestId('continue-btn');
    expect(continueBtn).toBeDisabled();
    expect(continueBtn).toHaveTextContent('Continue');

    fireEvent.click(screen.getByTestId('method-qrph'));
    await waitFor(() => expect(continueBtn).toBeEnabled());
    expect(screen.getByTestId('method-qrph')).toHaveAttribute('aria-checked', 'true');
    // Selecting never navigates on its own
    expect(screen.getByTestId('method-selector')).toBeInTheDocument();

    fireEvent.click(continueBtn);
    await waitFor(() => expect(screen.getByTestId('qrph-heading')).toBeInTheDocument());
    // Back returns to the selector with the selection intact
    fireEvent.click(screen.getByTestId('step-back'));
    expect(screen.getByTestId('method-selector')).toBeInTheDocument();
    expect(screen.getByTestId('method-qrph')).toHaveAttribute('aria-checked', 'true');
  });

  it('each row opens its own flow through Continue', async () => {
    await openModal();
    fireEvent.click(screen.getByTestId('method-ewallet'));
    fireEvent.click(screen.getByTestId('continue-btn'));
    await waitFor(() => expect(screen.getByTestId('wallet-heading')).toBeInTheDocument());
  });

  it('Total Due falls back to the real plan fee (never ₱0.00) without an open invoice', async () => {
    await openModal({
      billing: [paidGold], // paid → no open invoice / no payable record
      subscription: {
        plan: { code: 'gold', name: 'Gold Circle', monthly_price: 1500, annual_price: 14940 },
        billing_interval: 'monthly',
        subscription_status: 'active',
        next_payment: { amount: 1500, plan_name: 'Gold Circle', billing_interval: 'monthly', due_date: '2026-11-14' },
      },
    });
    expect(screen.getByTestId('summary-fee')).toHaveTextContent('₱1,500.00');
    expect(screen.getByTestId('summary-total')).toHaveTextContent('₱1,500.00');
    expect(screen.getByTestId('summary-total')).not.toHaveTextContent('₱0.00');
  });

  it('failed saved-methods load shows a clean error state', async () => {
    mockApis({ billing: [paidGold] });
    apiFetch.mockImplementation((path) => {
      if (path === '/billing/me') return Promise.resolve([paidGold]);
      if (path === '/shop-owner/listings') return Promise.resolve(listings);
      if (path === '/shop-owner/auctions') return Promise.resolve(auctions);
      if (path === '/shop-owner/shop') return Promise.resolve(shop);
      if (path === '/billing/me/subscription') return Promise.resolve(null);
      if (path === '/billing/payment-methods') return Promise.reject(new Error('boom'));
      return Promise.resolve([]);
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('update-payment-method-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('update-payment-method-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('payment-method-error')).toHaveTextContent(
        'Unable to load saved payment methods.'
      );
    });
  });
});

describe('payment method modal — card steps', () => {
  const methodsFixture = [
    { id: 'pm-1', brand: 'visa', last4: '4242', is_default: true, exp_month: 12, exp_year: 2028 },
    { id: 'pm-2', brand: 'mastercard', last4: '5555', is_default: false, exp_month: 1, exp_year: 2027 },
  ];

  async function openModal({ billing = [paidGold], methods = methodsFixture, paymongoConfig } = {}) {
    mockApis({ billing, paymentMethods: methods, paymongoConfig });
    renderPage();
    await openPaymentMethodModal();
    await selectAndContinue('method-card');
    await waitFor(() => {
      expect(screen.getByTestId('saved-cards-heading')).toBeInTheDocument();
      expect(screen.queryByText('Loading payment methods…')).not.toBeInTheDocument();
      if (methods.length) {
        expect(screen.getByTestId(`saved-method-${methods[0].id}`)).toBeInTheDocument();
      } else {
        expect(screen.getByTestId('saved-methods-empty')).toBeInTheDocument();
      }
    });
  }

  it('saved cards show safe metadata only — never a full PAN', async () => {
    await openModal();
    const modal = within(screen.getByTestId('payment-method-modal'));
    expect(modal.getByText(/•••• 4242/)).toBeInTheDocument();
    expect(modal.getByText(/•••• 5555/)).toBeInTheDocument();
    expect(modal.getByText(/Expires 12\/28/)).toBeInTheDocument();
    expect(screen.getByTestId('default-chip-pm-1')).toHaveTextContent('Default');
    expect(modal.queryByText(/4242424242424242/)).toBeNull();
  });

  it('empty state offers Add card without fake saved methods', async () => {
    await openModal({ methods: [] });
    expect(screen.getByTestId('saved-methods-empty')).toHaveTextContent('No saved payment methods yet.');
    expect(screen.getByText(/Cards securely saved through the payment provider/)).toBeInTheDocument();
    expect(screen.getByTestId('open-add-card')).toBeInTheDocument();
    // Continue is disabled (nothing selected to apply)
    expect(screen.getByTestId('continue-btn')).toBeDisabled();
  });

  it('NO raw card-number/CVC inputs exist; graceful fallback + disabled Add card', async () => {
    await openModal({ methods: [] });
    fireEvent.click(screen.getByTestId('open-add-card'));
    expect(screen.getByTestId('add-card-heading')).toBeInTheDocument();
    const modal = screen.getByTestId('payment-method-modal');
    const placeholders = Array.from(modal.querySelectorAll('input'))
      .map((i) => i.getAttribute('placeholder') || '')
      .join(' ');
    expect(placeholders).not.toMatch(/0000|MM\/YY|CVC/i);
    expect(modal.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByText(/Secure card entry is not enabled yet/i)).toBeNull();
    expect(screen.getByTestId('secure-entry-unavailable')).toHaveTextContent(
      /Secure card entry is temporarily unavailable/i
    );
    expect(screen.queryByText(/VITE_PAYMONGO/)).toBeNull();
    const addBtn = screen.getByTestId('add-card-btn');
    expect(addBtn).toBeDisabled();
    expect(addBtn).toHaveTextContent(/^Add card$/);
  });

  it('with backend publishable key, secure card entry mounts and Add card enables', async () => {
    stubPayMongoElements();
    await openModal({
      methods: [],
      paymongoConfig: { publishable_key: 'pk_test_live_key' },
    });
    fireEvent.click(screen.getByTestId('open-add-card'));
    expect(screen.getByTestId('secure-card-field')).toBeInTheDocument();
    expect(screen.getByTestId('secure-entry-note')).toHaveTextContent(/securely encrypted by PayMongo/i);
    await waitFor(() => expect(screen.getByTestId('add-card-btn')).toBeEnabled());
    expect(screen.queryByTestId('secure-entry-unavailable')).toBeNull();
  });

  it('Add card tokenizes in the secure field and POSTs ONLY the safe attach payload', async () => {
    const { root } = stubPayMongoElements();
    await openModal({
      methods: [],
      paymongoConfig: { publishable_key: 'pk_test_live_key' },
    });
    fireEvent.click(screen.getByTestId('open-add-card'));
    await waitFor(() => expect(screen.getByTestId('add-card-btn')).toBeEnabled());
    fireEvent.change(screen.getByTestId('cardholder-name-input'), {
      target: { value: 'Juan Dela Cruz' },
    });
    fillSecureCardFields();
    fireEvent.click(screen.getByTestId('add-card-btn'));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/billing/payment-methods/attach',
        expect.objectContaining({ method: 'POST' })
      );
    });
    const attachCall = apiFetch.mock.calls.find(
      ([p, o]) => p === '/billing/payment-methods/attach' && o?.method === 'POST'
    );
    const body = JSON.parse(attachCall[1].body);
    expect(body).toEqual({
      provider_payment_method_id: 'pm_token_123',
      type: 'card',
      brand: 'visa',
      last4: '4242',
      exp_month: 12,
      exp_year: 2028,
      make_default: false,
    });
    expect(JSON.stringify(body)).not.toMatch(/card_number|cvc|cvv|pan/i);
    expect(root.createPaymentMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'card',
        details: {
          card_number: '4242424242424242',
          exp_month: 12,
          exp_year: 2028,
          cvc: '123',
        },
        // billing.email comes from the Supabase session (PayMongo requires it)
        billing: { name: 'Juan Dela Cruz', email: 'seller@atany.test' },
      })
    );
    // SDK initialized with a STRING key — regression for
    // "The apiKey passed should be a string."
    expect(window.PayMongo).toHaveBeenCalledWith('pk_test_live_key');
    expect(typeof window.PayMongo.mock.calls[0][0]).toBe('string');
    // After a successful add the step returns to the saved-card list
    await waitFor(() => {
      expect(screen.getByTestId('saved-cards-heading')).toBeInTheDocument();
    });
    expect(mockToast).toHaveBeenCalledWith('Card added.');
  });

  it('Add card blocked without cardholder name — no tokenize, no attach POST', async () => {
    const { root } = stubPayMongoElements();
    await openModal({
      methods: [],
      paymongoConfig: { publishable_key: 'pk_test_live_key' },
    });
    fireEvent.click(screen.getByTestId('open-add-card'));
    await waitFor(() => expect(screen.getByTestId('add-card-btn')).toBeEnabled());
    fireEvent.click(screen.getByTestId('add-card-btn'));
    expect(screen.getByTestId('payment-method-error')).toHaveTextContent(
      'Please enter the cardholder name.'
    );
    expect(root.createPaymentMethod).not.toHaveBeenCalled();
    expect(
      apiFetch.mock.calls.filter(([p, o]) => p === '/billing/payment-methods/attach' && o?.method === 'POST')
        .length
    ).toBe(0);
  });

  it('Add card with incomplete card fields shows a field error — no attach POST', async () => {
    const { root } = stubPayMongoElements();
    await openModal({
      methods: [],
      paymongoConfig: { publishable_key: 'pk_test_live_key' },
    });
    fireEvent.click(screen.getByTestId('open-add-card'));
    await waitFor(() => expect(screen.getByTestId('add-card-btn')).toBeEnabled());
    fireEvent.change(screen.getByTestId('cardholder-name-input'), {
      target: { value: 'Juan Dela Cruz' },
    });
    // Leave the SDK inputs empty
    fireEvent.click(screen.getByTestId('add-card-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('payment-method-error')).toHaveTextContent(
        'Please complete all card fields.'
      );
    });
    expect(root.createPaymentMethod).not.toHaveBeenCalled();
    expect(
      apiFetch.mock.calls.filter(([p, o]) => p === '/billing/payment-methods/attach' && o?.method === 'POST')
        .length
    ).toBe(0);
  });

  it('PayMongo SDK init rejects a non-string apiKey (the original bug)', async () => {
    stubPayMongoElements();
    await openModal({
      methods: [],
      paymongoConfig: { publishable_key: 'pk_test_live_key' },
    });
    fireEvent.click(screen.getByTestId('open-add-card'));
    await waitFor(() => expect(screen.getByTestId('add-card-btn')).toBeEnabled());
    const [arg] = window.PayMongo.mock.calls[0];
    expect(typeof arg).toBe('string');
    expect(arg).toMatch(/^pk_(test|live)_/);
  });

  it('selects a saved card; Confirm applies default via PATCH (no reload)', async () => {
    await openModal();
    const continueBtn = screen.getByTestId('continue-btn');
    // Default card preselected → Continue enabled
    await waitFor(() => expect(continueBtn).toBeEnabled());
    // Select non-default → Continue → review → Confirm → PATCH
    fireEvent.click(within(screen.getByTestId('saved-method-pm-2')).getByRole('radio'));
    fireEvent.click(continueBtn);
    await waitFor(() => {
      expect(screen.getByTestId('review-method-label')).toHaveTextContent('Card •••• 5555');
    });
    fireEvent.click(screen.getByTestId('confirm-method-btn'));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/billing/payment-methods/pm-2/default',
        expect.objectContaining({ method: 'PATCH' })
      );
    });
    expect(mockToast).toHaveBeenCalledWith('Payment method updated.');
    await waitFor(() => {
      expect(screen.queryByTestId('payment-method-modal')).not.toBeInTheDocument();
    });
  });

  it('options menu: set as default and remove both hit real routes', async () => {
    await openModal();
    fireEvent.click(screen.getByTestId('menu-pm-2'));
    fireEvent.click(screen.getByTestId('menu-set-default-pm-2'));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/billing/payment-methods/pm-2/default',
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    fireEvent.click(screen.getByTestId('menu-pm-2'));
    fireEvent.click(screen.getByTestId('menu-remove-pm-2'));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/billing/payment-methods/pm-2',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  it('without publishable key, no attach POST is ever sent', async () => {
    await openModal({ methods: [] });
    fireEvent.click(screen.getByTestId('open-add-card'));
    expect(screen.getByTestId('add-card-btn')).toBeDisabled();
    const calls = apiFetch.mock.calls.filter(
      ([p, o]) => p.includes('/billing/payment-methods') && o?.method === 'POST'
    );
    expect(calls.length).toBe(0);
  });
});

describe('payment method modal — review step', () => {
  const methodsFixture = [
    { id: 'pm-1', brand: 'visa', last4: '4242', is_default: true, exp_month: 12, exp_year: 2028 },
  ];

  it('shows the real plan, amount, billing date and reference (never hardcoded samples)', async () => {
    mockApis({
      billing: [pendingNext],
      paymentMethods: methodsFixture,
      subscription: {
        plan: { code: 'gold', name: 'Gold Circle', monthly_price: 1500, annual_price: 14940 },
        billing_interval: 'monthly',
        current_record: null,
        open_record: pendingNext,
        next_payment: {
          mode: 'open_invoice',
          billing_id: pendingNext.id,
          amount: 1500,
          plan_name: 'Gold Circle',
          billing_interval: 'monthly',
          due_date: '2026-11-14',
          payment_reference: null,
        },
      },
    });
    renderPage();
    await openPaymentMethodModal();
    await selectAndContinue('method-card');
    await waitFor(() => expect(screen.getByTestId('saved-method-pm-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('continue-btn'));
    await waitFor(() => expect(screen.getByTestId('review-heading')).toBeInTheDocument());

    expect(screen.getByTestId('review-plan')).toHaveTextContent('Gold Circle · Monthly');
    expect(screen.getByTestId('review-amount')).toHaveTextContent('₱1,500');
    expect(screen.getByTestId('review-date')).toHaveTextContent('Nov 14, 2026');
    expect(screen.getByTestId('review-reference')).toHaveTextContent('SUB-20261114-2222');
    expect(screen.getByTestId('review-method-label')).toHaveTextContent('Card •••• 4242');
  });

  it('Back from review returns to the saved-card step', async () => {
    mockApis({ billing: [pendingNext], paymentMethods: methodsFixture });
    renderPage();
    await openPaymentMethodModal();
    await selectAndContinue('method-card');
    await waitFor(() => expect(screen.getByTestId('saved-method-pm-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('continue-btn'));
    await waitFor(() => expect(screen.getByTestId('review-heading')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('step-back'));
    expect(screen.getByTestId('saved-cards-heading')).toBeInTheDocument();
    expect(screen.queryByTestId('review-heading')).not.toBeInTheDocument();
  });
});

describe('payment method attach payload (security contract)', () => {
  it('buildAttachPayload sends ONLY provider id + safe metadata — never PAN/CVC', async () => {
    const { buildAttachPayload } = await import('../../../../shared/lib/paymongoElements');
    const payload = buildAttachPayload(
      { providerPaymentMethodId: 'pm_token_123', brand: 'visa', last4: '4242', expMonth: 8, expYear: 29 },
      { makeDefault: true }
    );
    expect(payload).toEqual({
      provider_payment_method_id: 'pm_token_123',
      type: 'card',
      brand: 'visa',
      last4: '4242',
      exp_month: 8,
      exp_year: 29,
      make_default: true,
    });
    const keys = Object.keys(payload);
    expect(keys.some((k) => /card_number|pan|cvc|cvv|number|security_code/i.test(k))).toBe(false);
    expect(JSON.stringify(payload)).not.toMatch(/\d{12,}/); // no long digit runs (PAN)
  });

  it('secure entry reports unconfigured without a publishable key', async () => {
    const { isSecureCardEntryConfigured, getPublishableKey } = await import(
      '../../../../shared/lib/paymongoElements'
    );
    expect(getPublishableKey()).toBe('');
    expect(isSecureCardEntryConfigured()).toBe(false);
  });
});

describe('payment method modal — e-wallet steps (GCash + Maya only)', () => {
  const methodsFixture = [
    { id: 'pm-1', brand: 'visa', last4: '4242', is_default: true, exp_month: 12, exp_year: 2028 },
  ];

  function setup({ billing, checkoutImpl } = {}) {
    mockApis({ billing, paymentMethods: methodsFixture });
    if (checkoutImpl) {
      apiFetch.mockImplementation((path, opts) => {
        if (path === '/billing/me') return Promise.resolve(billing);
        if (path === '/shop-owner/listings') return Promise.resolve(listings);
        if (path === '/shop-owner/auctions') return Promise.resolve(auctions);
        if (path === '/shop-owner/shop') return Promise.resolve(shop);
        if (path === '/billing/me/subscription') return Promise.resolve(null);
        if (path === '/billing/paymongo-config') return Promise.resolve({ publishable_key: null });
        if (path === '/billing/payment-methods') return Promise.resolve({ payment_methods: methodsFixture });
        if (opts?.method === 'POST' && /^\/billing\/[^/]+\/checkout$/.test(path)) {
          return checkoutImpl(path, opts);
        }
        return Promise.resolve([]);
      });
    }
    renderPage();
    const loc = { href: '' };
    vi.stubGlobal('location', loc);
    return loc;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function gotoWallet() {
    await openEwalletFlow();
    await waitFor(() => {
      expect(screen.getByTestId('wallet-heading')).toBeInTheDocument();
    });
  }

  it('offers exactly GCash and Maya — no GrabPay/ShopeePay/UnionBank, no PIN/OTP inputs', async () => {
    setup({ billing: [pendingNext] });
    await gotoWallet();
    expect(screen.getByTestId('wallet-list')).toBeInTheDocument();
    expect(screen.getByTestId('wallet-gcash')).toBeInTheDocument();
    expect(screen.getByTestId('wallet-maya')).toBeInTheDocument();
    // GCash preselected as the safe default
    expect(screen.getByTestId('wallet-gcash')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('wallet-security')).toHaveTextContent(
      /never asks for your\s+wallet PIN or OTP/i
    );
    const modal = screen.getByTestId('payment-method-modal');
    expect(modal.textContent).not.toMatch(/grabpay|shopeepay|unionbank/i);
    expect(screen.queryByTestId('wallet-grabpay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('logo-grabpay')).not.toBeInTheDocument();
    // No credential inputs of any kind (never collect wallet PIN/OTP)
    expect(screen.getByTestId('wallet-list').querySelectorAll('input').length).toBe(0);
    expect(screen.queryByLabelText(/pin|otp|password/i)).toBeNull();
  });

  it('wallet review shows the chosen wallet; Confirm blocked without a payable record', async () => {
    setup({ billing: [paidGold] }); // paid → no open invoice
    await gotoWallet();
    fireEvent.click(screen.getByTestId('wallet-maya'));
    expect(screen.getByTestId('wallet-maya')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('continue-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('review-heading')).toBeInTheDocument();
    });
    expect(screen.getByTestId('review-method-label')).toHaveTextContent('Maya');
    expect(screen.getByTestId('no-payable-note')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-method-btn')).toBeDisabled();
  });

  it('GCash confirm posts { payment_method: "gcash" } with NO client amount and redirects', async () => {
    const loc = setup({
      billing: [pendingNext],
      checkoutImpl: () => Promise.resolve({ checkout_url: 'https://paymongo.test/gcash-checkout' }),
    });
    await gotoWallet();
    fireEvent.click(screen.getByTestId('continue-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('review-heading')).toBeInTheDocument();
    });
    expect(screen.getByTestId('review-method-label')).toHaveTextContent('GCash');
    const btn = screen.getByTestId('confirm-method-btn');
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        `/billing/${pendingNext.id}/checkout`,
        expect.objectContaining({ method: 'POST' })
      );
    });
    const call = apiFetch.mock.calls.find(
      ([p, o]) => p === `/billing/${pendingNext.id}/checkout` && o?.method === 'POST'
    );
    const body = JSON.parse(call[1].body);
    expect(body).toEqual({ payment_method: 'gcash' });
    expect(Object.keys(body)).not.toContain('amount');
    await waitFor(() => {
      expect(loc.href).toBe('https://paymongo.test/gcash-checkout');
    });
  });

  it('Maya confirm maps to provider type paymaya', async () => {
    const loc = setup({
      billing: [pendingNext],
      checkoutImpl: () => Promise.resolve({ checkout_url: 'https://paymongo.test/maya-checkout' }),
    });
    await gotoWallet();
    fireEvent.click(screen.getByTestId('wallet-maya'));
    fireEvent.click(screen.getByTestId('continue-btn'));
    await waitFor(() => expect(screen.getByTestId('review-method-label')).toBeInTheDocument());
    expect(screen.getByTestId('review-method-label')).toHaveTextContent('Maya');
    fireEvent.click(screen.getByTestId('confirm-method-btn'));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        `/billing/${pendingNext.id}/checkout`,
        expect.objectContaining({ method: 'POST' })
      );
    });
    const call = apiFetch.mock.calls.find(
      ([p, o]) => p === `/billing/${pendingNext.id}/checkout` && o?.method === 'POST'
    );
    expect(JSON.parse(call[1].body)).toEqual({ payment_method: 'paymaya' });
    await waitFor(() => expect(loc.href).toBe('https://paymongo.test/maya-checkout'));
  });

  it('provider failure shows a safe error — no fake success', async () => {
    setup({
      billing: [pendingNext],
      checkoutImpl: () => Promise.reject(new Error('PayMongo failed')),
    });
    await gotoWallet();
    fireEvent.click(screen.getByTestId('continue-btn'));
    await waitFor(() => expect(screen.getByTestId('review-heading')).toBeInTheDocument());
    const btn = screen.getByTestId('confirm-method-btn');
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByTestId('payment-method-error')).toHaveTextContent(
        'Unable to start payment.'
      );
    });
    expect(screen.getByTestId('confirm-method-btn')).toBeEnabled();
  });
});

describe('payment method modal — QR Ph step', () => {
  const methodsFixture = [
    { id: 'pm-1', brand: 'visa', last4: '4242', is_default: true, exp_month: 12, exp_year: 2028 },
  ];

  function setup({ billing, checkoutImpl } = {}) {
    mockApis({ billing, paymentMethods: methodsFixture });
    if (checkoutImpl) {
      apiFetch.mockImplementation((path, opts) => {
        if (path === '/billing/me') return Promise.resolve(billing);
        if (path === '/shop-owner/listings') return Promise.resolve(listings);
        if (path === '/shop-owner/auctions') return Promise.resolve(auctions);
        if (path === '/shop-owner/shop') return Promise.resolve(shop);
        if (path === '/billing/me/subscription') return Promise.resolve(null);
        if (path === '/billing/paymongo-config') return Promise.resolve({ publishable_key: null });
        if (path === '/billing/payment-methods') return Promise.resolve({ payment_methods: methodsFixture });
        if (opts?.method === 'POST' && /^\/billing\/[^/]+\/checkout$/.test(path)) {
          return checkoutImpl(path, opts);
        }
        return Promise.resolve([]);
      });
    }
    renderPage();
    const loc = { href: '' };
    vi.stubGlobal('location', loc);
    return loc;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function gotoQrph() {
    await openQrPhFlow();
    await waitFor(() => {
      expect(screen.getByTestId('qrph-heading')).toBeInTheDocument();
    });
  }

  it('shows instructions + provider notice; NEVER a fake QR image or fabricated countdown', async () => {
    setup({ billing: [pendingNext] });
    await gotoQrph();
    expect(screen.getByTestId('qrph-hero')).toHaveTextContent('Scan the QR on the payment page');
    expect(screen.getByTestId('qrph-steps')).toBeInTheDocument();
    expect(screen.getByTestId('qrph-notice')).toHaveTextContent(
      /provided by PayMongo on the payment page/i
    );
    const modal = screen.getByTestId('payment-method-modal');
    // No embedded/placeholder QR graphics
    expect(modal.querySelectorAll('img').length).toBe(0);
    expect(modal.querySelector('canvas')).toBeNull();
    // No fabricated expiry/countdown anywhere
    expect(modal.textContent).not.toMatch(/QR expires in/i);
    expect(modal.textContent).not.toMatch(/valid for \d+\s*(s|sec)/i);
    expect(modal.textContent).not.toMatch(/countdown/i);
    expect(modal.textContent).not.toMatch(/\d{1,2}:\d{2}/);
    // Back link returns to the method selector
    fireEvent.click(screen.getByTestId('step-back'));
    expect(screen.getByTestId('method-selector')).toBeInTheDocument();
  });

  it('QR Ph confirm posts { payment_method: "qrph" } with NO amount and redirects', async () => {
    const loc = setup({
      billing: [pendingNext],
      checkoutImpl: () => Promise.resolve({ checkout_url: 'https://paymongo.test/qrph-checkout' }),
    });
    await gotoQrph();
    fireEvent.click(screen.getByTestId('continue-btn'));
    await waitFor(() => expect(screen.getByTestId('review-heading')).toBeInTheDocument());
    expect(screen.getByTestId('review-method-label')).toHaveTextContent('QR Ph');
    const btn = screen.getByTestId('confirm-method-btn');
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        `/billing/${pendingNext.id}/checkout`,
        expect.objectContaining({ method: 'POST' })
      );
    });
    const call = apiFetch.mock.calls.find(
      ([p, o]) => p === `/billing/${pendingNext.id}/checkout` && o?.method === 'POST'
    );
    const body = JSON.parse(call[1].body);
    expect(body).toEqual({ payment_method: 'qrph' });
    expect(Object.keys(body)).not.toContain('amount');
    await waitFor(() => {
      expect(loc.href).toBe('https://paymongo.test/qrph-checkout');
    });
  });

  it('QR Ph review is blocked without a payable record', async () => {
    setup({ billing: [paidGold] });
    await gotoQrph();
    fireEvent.click(screen.getByTestId('continue-btn'));
    await waitFor(() => expect(screen.getByTestId('review-heading')).toBeInTheDocument());
    expect(screen.getByTestId('no-payable-note')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-method-btn')).toBeDisabled();
  });
});

describe('checkout return handling', () => {
  it('cancelled return shows a safe notice and cleans the URL', async () => {
    mockApis({ billing: [pendingNext], paymentMethods: [] });
    renderPage(['/shop/billing?payment=cancelled']);
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('Payment was cancelled.');
    });
    // Billing state remains — page still renders the pending payment
    await waitFor(() => {
      expect(screen.getByTestId('next-payment-card')).toBeInTheDocument();
    });
  });
});

describe('pending upgrade banner', () => {
  it('displays pending upgrade banner with resume and cancel', async () => {
    mockApis({
      billing: [paidGold],
      subscription: {
        pending_change: {
          id: 'chg-1',
          target_plan_code: 'platinum',
          target_billing_interval: 'monthly',
          proration_amount: 250,
          status: 'pending_payment',
          created_at: new Date().toISOString(),
        },
      },
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('pending-upgrade-banner')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pending-upgrade-banner')).toHaveTextContent('Platinum Vault');
    expect(screen.getByTestId('resume-pending-upgrade')).toBeInTheDocument();
    expect(screen.getByTestId('cancel-pending-upgrade')).toBeInTheDocument();
  });
});

describe('remaining Seller Subscription page tests', () => {
  it('shows error when preview API fails', async () => {
    mockApis({ billing: [paidGold] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('change-plan-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('change-plan-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('manage-plan-action-platinum')).toBeInTheDocument();
    });

    apiFetch.mockImplementation((path) => {
      if (path === '/billing/me') return Promise.resolve([paidGold]);
      if (path === '/billing/subscription/change/preview') {
        return Promise.reject(new Error('PLAN_LIMIT_CONFLICT: too many active lots'));
      }
      if (path === '/billing/me/subscription') return Promise.resolve(null);
      return Promise.resolve([]);
    });

    fireEvent.click(screen.getByTestId('manage-plan-action-platinum'));

    await waitFor(() => {
      expect(screen.getByTestId('manage-billing-modal')).toBeInTheDocument();
      expect(screen.getByTestId('modal-error')).toHaveTextContent('PLAN_LIMIT_CONFLICT');
    });
  });

  it('does not show fake auto-renew, download all, or wrong plan names', async () => {
    mockApis({ billing: [paidGold] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('current-plan-hero')).toBeInTheDocument();
    });

    expect(screen.queryByText(/auto-renew is on/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Download all/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Atelier Pro/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Maison Elite/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Starter/i)).not.toBeInTheDocument();
  });

  it('shows no-subscription choose plan state without fake hero', async () => {
    mockApis({ billing: [], listingRows: [], auctionRows: [], shopRow: null });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('current-plan-none')).toBeInTheDocument();
    });
    expect(screen.getByText('Choose your seller plan')).toBeInTheDocument();
    expect(screen.queryByTestId('current-plan-price')).not.toBeInTheDocument();
    expect(screen.getByTestId('compare-plans')).toBeInTheDocument();
  });

  it('shows pending payment state with complete payment action', async () => {
    mockApis({ billing: [pendingNext] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('current-plan-hero')).toBeInTheDocument();
    });
    expect(screen.getByTestId('current-plan-status')).toHaveTextContent('Pending');
    expect(screen.getByTestId('pending-notice')).toBeInTheDocument();
    expect(screen.getByTestId('next-payment-pay-btn')).toBeInTheDocument();
  });

  it('shows past due warning and retry payment', async () => {
    mockApis({ billing: [overdueBronze] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('current-plan-hero')).toBeInTheDocument();
    });
    expect(screen.getByTestId('current-plan-status')).toHaveTextContent('Past Due');
    expect(screen.getByTestId('past-due-notice')).toBeInTheDocument();
    expect(screen.getByTestId('retry-payment-btn')).toBeInTheDocument();
  });

  it('renders backend API errors', async () => {
    apiFetch.mockRejectedValue(new Error('Failed to load subscription data'));
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('subscription-error')).toHaveTextContent('Failed to load subscription data');
    });
  });

  it('uses catalog price mapping consistent with admin for ₱1,000 bronze seller', async () => {
    mockApis({ billing: [overdueBronze] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('current-plan-name')).toHaveTextContent('Bronze Access');
    });
    expect(screen.getByTestId('current-plan-price')).toHaveTextContent('₱1,000');
    expect(screen.getByTestId('usage-value-active-listings')).toHaveTextContent('3 / 25');
  });
});

});

describe('billing error mapping', () => {
  it('maps structured backend codes to friendly messages', async () => {
    const { billingErrorText } = await import('../../pages/Billing');
    expect(billingErrorText({ code: 'SUBSCRIPTION_NOT_FOUND' })).toBe('Subscription information could not be found.');
    expect(billingErrorText({ code: 'INVALID_PLAN' })).toBe('Selected plan is unavailable.');
    expect(billingErrorText({ code: 'INVALID_INTERVAL' })).toBe('Selected billing interval is invalid.');
    expect(billingErrorText({ code: 'INVALID_BILLING_INTERVAL' })).toBe('Selected billing interval is invalid.');
    expect(billingErrorText({ code: 'MIGRATION_MISSING' })).toBe('Billing configuration is unavailable.');
    expect(billingErrorText({ code: 'BILLING_UNAVAILABLE' })).toBe('Billing service is temporarily unavailable.');
    expect(billingErrorText({ message: 'boom' }, 'Fallback')).toBe('boom');
    expect(billingErrorText({}, 'Fallback')).toBe('Fallback');
  });

  it('preview failure shows friendly message, not raw error', async () => {
    mockApis({ billing: [paidGold] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('manage-billing-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('manage-billing-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('manage-billing-modal')).toBeInTheDocument();
    });
    apiFetch.mockImplementation((path) => {
      if (path === '/billing/subscription/change/preview') {
        return Promise.reject(Object.assign(new Error('Invalid plan code'), { code: 'INVALID_PLAN', status: 400 }));
      }
      return Promise.resolve([]);
    });
    fireEvent.click(screen.getByTestId('manage-plan-action-platinum'));
    await waitFor(() => {
      expect(screen.getByText('Selected plan is unavailable.')).toBeInTheDocument();
    });
  });
});

describe('pending upgrade gating in Manage Billing', () => {
  it('disables other upgrades with explanation while pending exists', async () => {
    mockApis({
      billing: [{
        id: 'b1', seller_id: 'seller-1', amount: 1000, status: 'paid',
        plan_code: 'bronze', billing_interval: 'monthly',
        current_period_start: '2026-10-01', current_period_end: '2026-11-01',
      }],
      subscription: {
        pending_change: { id: 'chg-1', target_plan_code: 'gold', target_billing_interval: 'monthly', status: 'pending_payment' },
      },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('manage-billing-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('manage-billing-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('manage-billing-modal')).toBeInTheDocument();
    });
    const platinumBtn = screen.getByTestId('manage-plan-action-platinum');
    expect(platinumBtn).toBeDisabled();
    expect(platinumBtn.getAttribute('title')).toMatch(/pending gold upgrade first/i);
    // Same-target gold stays clickable (resume path)
    expect(screen.getByTestId('manage-plan-action-gold')).not.toBeDisabled();
  });
});

describe('upgrade modal text contrast (a11y)', () => {
  function luminance(hex) {
    const c = hex.replace('#', '');
    const f = (i) => {
      const v = parseInt(c.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4);
  }
  function ratio(fg, bg) {
    const a = luminance(fg);
    const b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  it('feature list + helper text meet contrast on cream', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const css = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../seller-subscription.css'),
      'utf8'
    );
    const rule = (sel) => {
      const m = css.match(new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm'));
      return m ? m[1] : '';
    };
    const colorOf = (body) => (body.match(/color:\s*(#[0-9a-fA-F]{6})/) || [])[1];
    const cream = '#FFFEFA';
    const liColor = colorOf(rule('.ssub-feature-list li'));
    expect(liColor).toBeTruthy();
    expect(ratio(liColor, cream)).toBeGreaterThanOrEqual(4.5);
    const mutedColor = colorOf(rule('.ssub-upgrade__row--muted'));
    expect(ratio(mutedColor, cream)).toBeGreaterThanOrEqual(4.5);
    const labelColor = colorOf(rule('.ssub-upgrade__plan-label'));
    expect(ratio(labelColor, cream)).toBeGreaterThanOrEqual(4.0);
    expect(rule('.ssub-feature-list li')).not.toMatch(/opacity:\s*0?\.[0-3]/);
  });

  it('dark hero panel uses light feature text; light cards scope ghost buttons', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const css = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../seller-subscription.css'),
      'utf8'
    );
    const rule = (sel) => {
      const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
      return m ? m[1] : '';
    };
    const colorOf = (body) => (body.match(/color:\s*(rgba?\([^)]*\)|#[0-9a-fA-F]{6})/) || [])[1];
    // Dark navy hero background
    const navy = '#0E1524';
    const heroLi = colorOf(rule('.ssub-hero__panel .ssub-feature-list li'));
    expect(heroLi).toBeTruthy();
    // rgba white ~0.88 on navy must clear 4.5
    expect(heroLi).toMatch(/255,\s*255,\s*255,\s*0\.8[5-9]|255,\s*255,\s*255,\s*0\.9/);
    // Light-card ghost buttons must not reuse near-white text
    const ghostLight = colorOf(rule('.ssub-card .ssub-btn--ghost'));
    expect(ghostLight).toBe('#142A4A');
    // Disabled ghost stays legible (opacity 1, no faint fade)
    const ghostDisabled = rule('.ssub-card .ssub-btn--ghost:disabled');
    expect(ghostDisabled).toMatch(/opacity:\s*1/);
    expect(ghostDisabled).not.toMatch(/opacity:\s*0?\.[0-7]/);
  });
});
