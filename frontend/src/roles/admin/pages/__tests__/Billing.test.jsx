// frontend/src/roles/admin/pages/__tests__/Billing.test.jsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = vi.fn();

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({
  apiFetch: (...args) => apiFetch(...args),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => vi.fn(),
}));

vi.mock('../../../../shared/components/Modal', () => ({
  Modal: ({ open, children }) => (open ? <div data-testid="modal">{children}</div> : null),
}));

vi.mock('../../../../shared/components/NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

vi.mock('../../../../shared/components/PortalPageHeader', () => ({
  PortalPageHeader: ({ title, search, actions }) => (
    <header>
      <h1>{title}</h1>
      {search}
      {actions}
    </header>
  ),
}));

vi.mock('../../../../shared/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', email: 'admin@example.com', user_metadata: {} },
  }),
}));

import AdminBilling from '../Billing';

const records = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    seller_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    amount: 1500,
    billing_period: 'October 2026 – November 2026',
    status: 'paid',
    due_date: '2026-10-15',
    paid_at: '2026-09-15T10:00:00Z',
    payment_reference: 'pay_1234567890',
    current_period_start: '2026-09-15',
    current_period_end: '2026-10-15',
    seller_name: 'Golden Heritage',
    seller_email: 'abreeza@goldenheritage.ph',
    shop_name: 'Golden Heritage — Abreeza',
    branch_name: 'Abreeza Branch',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    seller_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    amount: 1000,
    billing_period: 'September 2026 – October 2026',
    status: 'overdue',
    due_date: '2026-09-28',
    payment_reference: null,
    current_period_start: '2026-08-28',
    current_period_end: '2026-09-28',
    seller_name: 'Luntian Heirlooms',
    seller_email: 'contact@luntian.ph',
    shop_name: 'Luntian — Davao',
    branch_name: 'Davao Central',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    seller_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    amount: 1000,
    billing_period: 'October 2026 – November 2026',
    status: 'pending',
    due_date: '2026-10-20',
    payment_reference: null,
    current_period_start: '2026-09-20',
    current_period_end: '2026-10-20',
    seller_name: 'SM Lanang Gold',
    seller_email: 'smlanang@goldenheritage.ph',
    shop_name: 'Golden Heritage — SM Lanang',
    branch_name: 'SM Lanang Branch',
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminBilling />
    </MemoryRouter>,
  );
}

describe('Admin Subscriptions redesign', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('renders KPI metrics, plan tiers, and real subscriber rows from API data', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve(records);
      return Promise.resolve([]);
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Subscriptions')).toBeInTheDocument();
    });
    expect(screen.queryByText('ADMIN PORTAL')).not.toBeInTheDocument();
    expect(screen.queryByText('Monitor monthly seller subscriptions and payments.')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('kpi-mrr')).toBeInTheDocument();
    });
    expect(screen.getByTestId('kpi-active')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-past-due')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-pending')).toBeInTheDocument();

    // MRR from paid ₱1,500 only
    expect(screen.getAllByText('₱1,500').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('kpi-mrr')).toHaveTextContent('₱1,500');
    expect(screen.getByText('Golden Heritage')).toBeInTheDocument();
    expect(screen.getByText('Luntian Heirlooms')).toBeInTheDocument();
    expect(screen.getByText('SM Lanang Gold')).toBeInTheDocument();

    // Plan tiers = product catalog — always Bronze / Gold / Platinum
    expect(screen.getByText('Plan tiers')).toBeInTheDocument();
    expect(screen.getByTestId('plan-tier-bronze')).toBeInTheDocument();
    expect(screen.getByTestId('plan-tier-gold')).toBeInTheDocument();
    expect(screen.getByTestId('plan-tier-platinum')).toBeInTheDocument();
    expect(screen.getAllByText(/Bronze Access/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Gold Circle/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Platinum Vault/).length).toBeGreaterThanOrEqual(1);

    expect(screen.getByText('Active subscribers')).toBeInTheDocument();
  });

  it('shows retry charge only for past due / pending rows', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve(records);
      return Promise.resolve([]);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Luntian Heirlooms')).toBeInTheDocument());

    const retryButtons = screen.getAllByRole('button', { name: /Retry charge/i });
    expect(retryButtons.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /Retry charge for Luntian Heirlooms/i })).toBeInTheDocument();
    // Active paid row should not show retry
    expect(screen.queryByRole('button', { name: /Retry charge for Golden Heritage/i })).not.toBeInTheDocument();
  });

  it('filters by status pills', async () => {
    const { fireEvent } = await import('@testing-library/react');
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve(records);
      return Promise.resolve([]);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Golden Heritage')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: 'Past Due' }));

    await waitFor(() => {
      expect(screen.queryByText('Golden Heritage')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Luntian Heirlooms')).toBeInTheDocument();
  });

  it('searches subscriber or plan', async () => {
    const { fireEvent } = await import('@testing-library/react');
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve(records);
      return Promise.resolve([]);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Golden Heritage')).toBeInTheDocument());

    const search = screen.getByLabelText(/Search subscriber or plan/i);
    fireEvent.change(search, { target: { value: 'Luntian' } });

    await waitFor(() => {
      expect(screen.queryByText('Golden Heritage')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Luntian Heirlooms')).toBeInTheDocument();
  });

  it('shows empty state when no subscriptions but still shows plan catalog', async () => {
    apiFetch.mockImplementation(() => Promise.resolve([]));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('subscription-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('plan-tier-bronze')).toBeInTheDocument();
    expect(screen.getByTestId('plan-tier-gold')).toBeInTheDocument();
    expect(screen.getByTestId('plan-tier-platinum')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    apiFetch.mockImplementation(() => Promise.reject(new Error('boom')));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('subscription-error')).toBeInTheDocument();
    });
  });

  it('preserves admin billing endpoint path', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve(records);
      return Promise.resolve([]);
    });
    renderPage();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/billing'));
  });

  it('shows annual interval, period price, and normalized MRR for annual rows', async () => {
    const annualGold = {
      id: '44444444-4444-4444-4444-444444444444',
      seller_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      amount: 14940,
      plan_code: 'gold',
      billing_interval: 'annual',
      billing_type: 'subscription',
      billing_period: 'October 2025 – October 2026',
      status: 'paid',
      due_date: '2026-10-14',
      current_period_start: '2025-10-14',
      current_period_end: '2026-10-14',
      seller_name: 'Vault Gold Co',
      seller_email: 'vault@gold.ph',
      shop_name: 'Vault Gold',
      branch_name: 'Abreeza Branch',
    };
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve([annualGold]);
      return Promise.resolve([]);
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Vault Gold Co')).toBeInTheDocument());
    expect(screen.getAllByText(/Gold Circle/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Annual/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/₱14,940 \/ year/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/MRR ₱1,245/).length).toBeGreaterThanOrEqual(1);
    // ARR label must not say LTV
    expect(screen.queryByText(/LTV/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/ARR/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows scheduled change indicator with target plan + effective date', async () => {
    const scheduledGold = {
      id: '55555555-5555-5555-5555-555555555555',
      seller_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      amount: 1500,
      plan_code: 'gold',
      billing_interval: 'monthly',
      status: 'paid',
      due_date: '2026-11-14',
      current_period_start: '2026-10-14',
      current_period_end: '2026-11-14',
      seller_name: 'Scheduled Seller',
      seller_email: 'sched@gold.ph',
      shop_name: 'Scheduled Shop',
      branch_name: 'Davao Central',
      scheduled_plan_code: 'bronze',
      scheduled_effective_at: '2026-11-14',
    };
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve([scheduledGold]);
      return Promise.resolve([]);
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Scheduled Seller')).toBeInTheDocument());
    const indicator = screen.getByTestId('scheduled-change-indicator');
    expect(indicator).toHaveTextContent(/Scheduled:/i);
    expect(indicator).toHaveTextContent(/Bronze Access/i);
    expect(indicator).toHaveTextContent(/Nov 14, 2026/);
  });

  it('clicking Bronze makes it selected', async () => {
    const { fireEvent } = await import('@testing-library/react');
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve(records);
      return Promise.resolve([]);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Golden Heritage')).toBeInTheDocument());

    const bronzeCard = screen.getByTestId('plan-tier-bronze');
    const bronzeButton = within(bronzeCard).getByRole('button', { name: /view bronze access/i });
    fireEvent.click(bronzeButton);

    expect(bronzeCard).toHaveAttribute('data-selected', 'true');
    expect(within(bronzeCard).getByRole('button', { name: /selected: bronze access/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking Gold selects Gold and deselects Bronze', async () => {
    const { fireEvent } = await import('@testing-library/react');
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve(records);
      return Promise.resolve([]);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Golden Heritage')).toBeInTheDocument());

    // Select Bronze first
    const bronzeCard = screen.getByTestId('plan-tier-bronze');
    fireEvent.click(within(bronzeCard).getByRole('button', { name: /view bronze access/i }));
    expect(bronzeCard).toHaveAttribute('data-selected', 'true');

    // Select Gold
    const goldCard = screen.getByTestId('plan-tier-gold');
    fireEvent.click(within(goldCard).getByRole('button', { name: /view gold circle/i }));

    expect(goldCard).toHaveAttribute('data-selected', 'true');
    expect(bronzeCard).toHaveAttribute('data-selected', 'false');
  });

  it('clicking Platinum selects Platinum and deselects Gold', async () => {
    const { fireEvent } = await import('@testing-library/react');
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve(records);
      return Promise.resolve([]);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Golden Heritage')).toBeInTheDocument());

    // Select Gold first
    const goldCard = screen.getByTestId('plan-tier-gold');
    fireEvent.click(within(goldCard).getByRole('button', { name: /view gold circle/i }));
    expect(goldCard).toHaveAttribute('data-selected', 'true');

    // Select Platinum
    const platinumCard = screen.getByTestId('plan-tier-platinum');
    fireEvent.click(within(platinumCard).getByRole('button', { name: /view platinum vault/i }));

    expect(platinumCard).toHaveAttribute('data-selected', 'true');
    expect(goldCard).toHaveAttribute('data-selected', 'false');
  });

  it('subscriber table follows the selected plan filter', async () => {
    const { fireEvent } = await import('@testing-library/react');
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve(records);
      return Promise.resolve([]);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Golden Heritage')).toBeInTheDocument());

    // Select Gold
    const goldCard = screen.getByTestId('plan-tier-gold');
    fireEvent.click(within(goldCard).getByRole('button', { name: /view gold circle/i }));

    // Filter chip should appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /clear plan filter gold circle/i })).toBeInTheDocument();
    });

    // Only Golden Heritage (₱1,500) should show in the table
    expect(screen.getByText('Golden Heritage')).toBeInTheDocument();
    expect(screen.queryByText('Luntian Heirlooms')).not.toBeInTheDocument();
    expect(screen.queryByText('SM Lanang Gold')).not.toBeInTheDocument();
  });

  it('clearing the plan filter removes the selected visual state', async () => {
    const { fireEvent } = await import('@testing-library/react');
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve(records);
      return Promise.resolve([]);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Golden Heritage')).toBeInTheDocument());

    // Select Gold
    const goldCard = screen.getByTestId('plan-tier-gold');
    fireEvent.click(within(goldCard).getByRole('button', { name: /view gold circle/i }));
    expect(goldCard).toHaveAttribute('data-selected', 'true');

    // Clear via filter chip
    fireEvent.click(screen.getByRole('button', { name: /clear plan filter gold circle/i }));

    // All cards should be unselected
    expect(screen.getByTestId('plan-tier-bronze')).toHaveAttribute('data-selected', 'false');
    expect(screen.getByTestId('plan-tier-gold')).toHaveAttribute('data-selected', 'false');
    expect(screen.getByTestId('plan-tier-platinum')).toHaveAttribute('data-selected', 'false');

    // All subscribers should show again
    expect(screen.getByText('Golden Heritage')).toBeInTheDocument();
    expect(screen.getByText('Luntian Heirlooms')).toBeInTheDocument();
    expect(screen.getByText('SM Lanang Gold')).toBeInTheDocument();
  });

  it('clicking selected plan again clears the selection (toggle)', async () => {
    const { fireEvent } = await import('@testing-library/react');
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve(records);
      return Promise.resolve([]);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Golden Heritage')).toBeInTheDocument());

    const bronzeCard = screen.getByTestId('plan-tier-bronze');

    // Select Bronze
    fireEvent.click(within(bronzeCard).getByRole('button', { name: /view bronze access/i }));
    expect(bronzeCard).toHaveAttribute('data-selected', 'true');

    // Click again to deselect
    fireEvent.click(within(bronzeCard).getByRole('button', { name: /selected: bronze access/i }));
    expect(bronzeCard).toHaveAttribute('data-selected', 'false');
  });

  it('Most popular badge remains independent from selected plan', async () => {
    const { fireEvent } = await import('@testing-library/react');
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve(records);
      return Promise.resolve([]);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Golden Heritage')).toBeInTheDocument());

    // Bronze should have Most popular badge (based on subscriber count)
    const bronzeCard = screen.getByTestId('plan-tier-bronze');
    expect(within(bronzeCard).getByText(/most popular/i)).toBeInTheDocument();

    // Select Gold
    const goldCard = screen.getByTestId('plan-tier-gold');
    fireEvent.click(within(goldCard).getByRole('button', { name: /view gold circle/i }));

    // Gold should be selected
    expect(goldCard).toHaveAttribute('data-selected', 'true');
    expect(bronzeCard).toHaveAttribute('data-selected', 'false');

    // Bronze keeps Most popular badge
    expect(within(bronzeCard).getByText(/most popular/i)).toBeInTheDocument();
    // Gold does NOT get Most popular badge
    expect(within(goldCard).queryByText(/most popular/i)).not.toBeInTheDocument();

    // Gold button should be filled (Viewing subscribers), Bronze should be outline
    expect(within(goldCard).getByRole('button', { name: /selected: gold circle/i })).toBeInTheDocument();
    expect(within(bronzeCard).getByRole('button', { name: /view bronze access/i })).toBeInTheDocument();
  });

  it('Bronze keeps Most popular badge but not selected border when unselected', async () => {
    const { fireEvent } = await import('@testing-library/react');
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve(records);
      return Promise.resolve([]);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Golden Heritage')).toBeInTheDocument());

    const bronzeCard = screen.getByTestId('plan-tier-bronze');
    const goldCard = screen.getByTestId('plan-tier-gold');

    // Initially: badge present, NO selected border class
    expect(within(bronzeCard).getByText(/most popular/i)).toBeInTheDocument();
    expect(bronzeCard).not.toHaveClass('sub-plan--selected');
    expect(bronzeCard).toHaveAttribute('data-selected', 'false');
    expect(within(bronzeCard).getByRole('button', { name: /view bronze access/i })).toHaveClass('sub-btn--outline');

    // Select Gold: Bronze badge stays, Gold gets selected border
    fireEvent.click(within(goldCard).getByRole('button', { name: /view gold circle/i }));

    expect(within(bronzeCard).getByText(/most popular/i)).toBeInTheDocument();
    expect(bronzeCard).not.toHaveClass('sub-plan--selected');
    expect(goldCard).toHaveClass('sub-plan--selected');
    expect(within(goldCard).getByRole('button', { name: /selected: gold circle/i })).toHaveClass('sub-btn--gold');
    expect(within(bronzeCard).getByRole('button', { name: /view bronze access/i })).toHaveClass('sub-btn--outline');
  });

  it('Platinum selected: Platinum gets border+filled CTA; Bronze keeps badge only', async () => {
    const { fireEvent } = await import('@testing-library/react');
    apiFetch.mockImplementation((path) => {
      if (path === '/billing') return Promise.resolve(records);
      return Promise.resolve([]);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Golden Heritage')).toBeInTheDocument());

    const bronzeCard = screen.getByTestId('plan-tier-bronze');
    const platinumCard = screen.getByTestId('plan-tier-platinum');

    fireEvent.click(within(platinumCard).getByRole('button', { name: /view platinum vault/i }));

    // Platinum selected: border + filled CTA, no Most popular badge
    expect(platinumCard).toHaveClass('sub-plan--selected');
    expect(within(platinumCard).getByRole('button', { name: /selected: platinum vault/i })).toHaveClass('sub-btn--gold');
    expect(within(platinumCard).queryByText(/most popular/i)).not.toBeInTheDocument();

    // Bronze: badge only, neutral border, outline CTA
    expect(within(bronzeCard).getByText(/most popular/i)).toBeInTheDocument();
    expect(bronzeCard).not.toHaveClass('sub-plan--selected');
    expect(within(bronzeCard).getByRole('button', { name: /view bronze access/i })).toHaveClass('sub-btn--outline');
  });
});
