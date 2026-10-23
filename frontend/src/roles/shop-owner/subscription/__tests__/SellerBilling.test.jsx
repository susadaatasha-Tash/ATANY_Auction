// frontend/src/roles/shop-owner/subscription/__tests__/SellerBilling.test.jsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({
  apiFetch: (...args) => apiFetch(...args),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => vi.fn(),
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

// A pending invoice whose payment method has already been chosen.
const pendingNextWithMethod = { ...pendingNext, payment_method_type: 'gcash' };

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
} = {}) {
  apiFetch.mockImplementation((path, opts) => {
    if (path === '/billing/me') return Promise.resolve(billing);
    if (path === '/shop-owner/listings') return Promise.resolve(listingRows);
    if (path === '/shop-owner/auctions') return Promise.resolve(auctionRows);
    if (path === '/shop-owner/shop') return Promise.resolve(shopRow);
    if (path === '/billing/me/subscription') return Promise.resolve(subscription);
    return Promise.resolve([]);
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Billing />
    </MemoryRouter>,
  );
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

  it('opens payment method modal via Update payment method button', async () => {
    mockApis({
      billing: [paidGold],
      subscription: null,
    });
    apiFetch.mockImplementation((path) => {
      if (path === '/billing/me') return Promise.resolve([paidGold]);
      if (path === '/shop-owner/listings') return Promise.resolve(listings);
      if (path === '/shop-owner/auctions') return Promise.resolve(auctions);
      if (path === '/shop-owner/shop') return Promise.resolve(shop);
      if (path === '/billing/me/subscription') return Promise.resolve(null);
      if (path === '/billing/subscription/payment-methods') {
        return Promise.resolve({
          methods: [
            { value: 'qrph', label: 'QR Ph', description: 'Scan a QR Ph code to pay', group: 'qrph' },
            { value: 'card', label: 'Card', description: 'Use a debit or credit card', group: 'card' },
            { value: 'gcash', label: 'GCash', description: 'Pay using your GCash account', group: 'ewallet' },
            { value: 'paymaya', label: 'Maya', description: 'Pay using your Maya account', group: 'ewallet' },
          ],
          saved_cards: [
            {
              id: 'pm-1',
              brand: 'visa',
              last4: '4242',
              is_default: true,
              exp_month: 12,
              exp_year: 2028,
            },
          ],
          preference: null,
        });
      }
      return Promise.resolve([]);
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('update-payment-method-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('update-payment-method-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('payment-method-modal')).toBeInTheDocument();
    });
    // The initial step offers exactly QR Ph / Card / E-Wallet.
    expect(screen.getByTestId('spm-method-qrph')).toBeInTheDocument();
    expect(screen.getByTestId('spm-method-card')).toBeInTheDocument();
    expect(screen.getByTestId('spm-method-ewallet')).toBeInTheDocument();

    // Card explains that PayMongo hosts the card entry — there is no card
    // number / CVC form anywhere in ATANY.
    fireEvent.click(screen.getByTestId('spm-method-card'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-card-info')).toBeInTheDocument());
    expect(screen.getByTestId('spm-card-info')).toHaveTextContent(/securely through PayMongo/i);
    expect(document.querySelector('input[autocomplete="cc-number"]')).toBeNull();
    expect(document.querySelector('input[autocomplete="cc-csc"]')).toBeNull();
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
    expect(screen.getByTestId('scheduled-downgrade-banner')).toHaveTextContent('bronze');
    expect(screen.getByTestId('cancel-scheduled-downgrade')).toBeInTheDocument();
  });

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
    mockApis({ billing: [pendingNextWithMethod] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('current-plan-hero')).toBeInTheDocument();
    });
    expect(screen.getByTestId('current-plan-status')).toHaveTextContent('Pending');
    expect(screen.getByTestId('pending-notice')).toBeInTheDocument();
    expect(screen.getByTestId('next-payment-pay-btn')).toBeInTheDocument();
  });

  it('asks for a payment method before paying when none is selected yet', async () => {
    mockApis({ billing: [pendingNext] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('current-plan-hero')).toBeInTheDocument();
    });
    // No "Pay now" until a method is chosen.
    expect(screen.queryByTestId('next-payment-pay-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('next-payment-select-method-btn')).toBeInTheDocument();
    expect(screen.getByTestId('next-payment-method')).toHaveTextContent(/not selected yet/i);
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
