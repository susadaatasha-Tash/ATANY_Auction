// Dashboard skeleton loading — customer, seller and admin portals.
// Verifies skeletons are driven by REAL request state, mirror the real layout,
// never show a false empty state, and always resolve into content/empty/error.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const apiFetch = vi.hoisted(() => vi.fn());
const outlet = vi.hoisted(() => ({ current: { loading: true, listings: [], auctions: [], sales: [], shop: null } }));

vi.mock('../../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock('../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));
// The real dashboards are rendered inside their portal layouts; stub only the
// two boundaries that require providers (branch context, layout outlet data).
vi.mock('../../../shared/hooks/useBranch', () => ({
  useBranch: () => ({ branchName: '', branches: [], loading: false }),
}));
vi.mock('../../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ preferredBranchId: null, user: null }),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useOutletContext: () => outlet.current };
});

import CustomerDashboard from '../../../roles/customer/pages/Dashboard';
import SellerDashboard from '../../../roles/shop-owner/pages/Dashboard';
import AdminDashboard from '../../../roles/admin/pages/Dashboard';
import { Skeleton, SkeletonKpiRow, SkeletonList, SkeletonRegion } from '../Skeleton';

/** Deferred promise so we can assert the loading state deterministically. */
function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const skelCount = (c = document) => c.querySelectorAll('.atany-skel').length;

beforeEach(() => { apiFetch.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('shared skeleton primitive', () => {
  test('is decorative, never focusable, and marked busy', () => {
    render(
      <SkeletonRegion label="Loading dashboard">
        <Skeleton w="40%" h={12} />
        <SkeletonKpiRow count={4} />
        <SkeletonList count={3} />
      </SkeletonRegion>
    );
    const region = screen.getByLabelText('Loading dashboard');
    expect(region).toHaveAttribute('aria-busy', 'true');
    const blocks = document.querySelectorAll('.atany-skel');
    expect(blocks.length).toBeGreaterThan(5);
    blocks.forEach((b) => {
      expect(b).toHaveAttribute('aria-hidden', 'true');
      expect(b.tabIndex).toBe(-1);
      expect(b.tagName).not.toBe('BUTTON');
    });
  });

  test('KPI skeleton mirrors the real card structure (icon, label, value, badge)', () => {
    const { container } = render(<div className="kpi-grid"><SkeletonKpiRow count={4} /></div>);
    const cards = container.querySelectorAll('.atany-skel-kpi');
    expect(cards).toHaveLength(4);
    cards.forEach((c) => {
      expect(c.querySelector('.atany-skel-kpi__head')).not.toBeNull();
      expect(c.querySelector('.atany-skel-kpi__divider')).not.toBeNull();
      expect(c.querySelector('.atany-skel-kpi__badge')).not.toBeNull();
      expect(c.textContent).toBe('');
    });
  });
});

describe('customer dashboard skeleton', () => {
  function setupApi({ bids = [], orders = [], watchlist = [], notifications = [], branches = [] } = {}) {
    apiFetch.mockImplementation(async (path) => {
      if (path === '/customer/bids') return Promise.resolve(bids);
      if (path === '/customer/orders') return Promise.resolve(orders);
      if (path === '/customer/watchlist') return Promise.resolve(watchlist);
      if (path === '/customer/notifications') return Promise.resolve(notifications);
      if (path === '/branches') return Promise.resolve(branches);
      return Promise.resolve([]);
    });
  }

  function renderCustomer() {
    return render(
      <MemoryRouter>
        <CustomerDashboard />
      </MemoryRouter>
    );
  }

  test('shows a mirrored skeleton while the request is pending, then real KPIs', async () => {
    const gate = deferred();
    apiFetch.mockImplementation((path) => (path === '/customer/bids' ? gate.promise : Promise.resolve([])));

    const { container } = renderCustomer();

    // Skeleton composition mirrors hero + 4 KPI + branch grid + activity
    expect(container.querySelector('.customer-hero')).not.toBeNull();
    expect(container.querySelectorAll('.atany-skel-kpi')).toHaveLength(4);
    expect(container.querySelectorAll('.explore-branches-grid .atany-skel').length).toBeGreaterThan(0);
    expect(screen.queryByText('Loading your dashboard…')).not.toBeInTheDocument();
    // No fabricated sample content while loading
    expect(screen.queryByText(/Diamond Halo Ring/)).not.toBeInTheDocument();
    expect(screen.queryByText('No activity yet.')).not.toBeInTheDocument();

    gate.resolve([]);
    await waitFor(() => expect(container.querySelectorAll('.atany-skel-kpi')).toHaveLength(0));
    expect(skelCount()).toBe(0);
  });

  test('real zero values are shown as 0, never replaced by sample numbers', async () => {
    setupApi();
    renderCustomer();
    await waitFor(() => expect(screen.getByText('Active Bids')).toBeInTheDocument());
    expect(screen.getByText('Active Bids').closest('.kpi-card')).toHaveTextContent('0');
    expect(screen.getByText('Auctions Won').closest('.kpi-card')).toHaveTextContent('0');
  });

  test('confirmed empty response shows the empty state (not a skeleton)', async () => {
    setupApi();
    renderCustomer();
    await waitFor(() => expect(screen.getByText('No activity yet.')).toBeInTheDocument());
    expect(skelCount()).toBe(0);
  });

  test('API failure stops the skeleton and shows the error state', async () => {
    apiFetch.mockImplementation((path) =>
      path === '/customer/bids' ? Promise.reject(new Error('boom')) : Promise.resolve([])
    );
    renderCustomer();
    await waitFor(() => expect(screen.getByText(/Error loading dashboard/)).toBeInTheDocument());
    expect(skelCount()).toBe(0);
  });
});

describe('seller dashboard skeleton', () => {
  function setupApi({ sales = [], activity = [], failActivity = false } = {}) {
    apiFetch.mockImplementation(async (path, opts = {}) => {
      if (path === '/shop-owner/activity') {
        if (failActivity) return Promise.reject(Object.assign(new Error('nope'), { status: 500 }));
        return Promise.resolve(activity);
      }
      if (path === '/shop-owner/listings') return Promise.resolve([]);
      if (path === '/shop-owner/auctions') return Promise.resolve([]);
      if (path === '/shop-owner/sales') return Promise.resolve(sales);
      if (path === '/shop-owner/shop') return Promise.resolve({ shop_name: 'Test Shop', id: 's1' });
      if (opts?.method) return Promise.resolve({});
      return Promise.resolve([]);
    });
  }

  function renderSeller() {
    return render(
      <MemoryRouter>
        <SellerDashboard />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    outlet.current = { loading: true, listings: [], auctions: [], sales: [], shop: null };
  });

  test('table + summary skeletons appear during the sales request and clear after', async () => {
    const gate = deferred();
    apiFetch.mockImplementation((path, opts = {}) => {
      if (path === '/shop-owner/sales') return gate.promise;
      if (path === '/shop-owner/listings') return Promise.resolve([]);
      if (path === '/shop-owner/auctions') return Promise.resolve([]);
      if (path === '/shop-owner/shop') return Promise.resolve({ shop_name: 'Test Shop', id: 's1' });
      if (path === '/shop-owner/activity') return Promise.resolve([]);
      return [];
    });

    const { container } = renderSeller();

    // Summary cards show a shape, not a fabricated ₱0 / 0 lots
    const summary = container.querySelector('.sdash-summary');
    expect(summary).toHaveAttribute('aria-busy', 'true');
    expect(summary.querySelectorAll('.sdash-summary-card__value .atany-skel').length).toBe(3);
    expect(summary.textContent).not.toMatch(/₱0/);
    // Tables use the shared skeleton inside the real table wrapper
    expect(container.querySelector('.sdash-table-wrap .sdash-skeleton-row')).not.toBeNull();

    gate.resolve([]);
    outlet.current = { ...outlet.current, loading: false };
    // rerender with the resolved layout data (what the real layout does)
    await waitFor(() => expect(container.querySelector('.sdash-summary').hasAttribute('aria-busy')).toBe(false));
  });

  test('activity rail resolves independently of the sales tables', async () => {
    const gate = deferred();
    apiFetch.mockImplementation((path) => {
      if (path === '/shop-owner/sales') return gate.promise; // stays pending
      if (path === '/shop-owner/activity') return Promise.resolve([]);
      if (path === '/shop-owner/listings') return Promise.resolve([]);
      if (path === '/shop-owner/auctions') return Promise.resolve([]);
      if (path === '/shop-owner/shop') return Promise.resolve({ shop_name: 'Test Shop', id: 's1' });
      return [];
    });
    const { container } = renderSeller();
    // Sales skeletons still up, but the activity rail has finished loading
    await waitFor(() => {
      const rail = within(container.querySelector('.sdash-side-col'));
      expect(rail.queryByText('No recent activity')).toBeInTheDocument();
    });
    expect(container.querySelector('.sdash-summary').hasAttribute('aria-busy')).toBe(true);
  });

  test('activity failure shows the existing error UI, never an endless skeleton', async () => {
    setupApi({ failActivity: true });
    const { container } = renderSeller();
    await waitFor(() => {
      expect(within(container.querySelector('.sdash-side-col')).getByText('Unable to load recent activity')).toBeInTheDocument();
    });
    expect(container.querySelector('.sdash-side-col .atany-skel')).toBeNull();
  });
});

describe('admin dashboard skeleton', () => {
  test('four KPI skeletons + section skeletons while loading, cleared after', async () => {
    const gate = deferred();
    apiFetch.mockImplementation((path) => {
      if (path === '/admin/users') return gate.promise;
      if (path === '/admin/transactions') return gate.promise;
      if (path === '/branches') return gate.promise;
      return Promise.resolve([]);
    });

    const { container } = render(<AdminDashboard />);

    // Four KPI skeletons — never one giant block (aria-busy marks the region)
    await waitFor(() => {
      expect(container.querySelector('.kpi-grid').getAttribute('aria-busy')).toBe('true');
      expect(container.querySelectorAll('.kpi-grid .atany-skel-kpi')).toHaveLength(4);
    });
    // Section skeletons mirror branches grid + activity + orders table
    expect(container.querySelectorAll('.admin-branches-grid .atany-skel').length).toBeGreaterThan(0);
    expect(container.querySelector('.activity-list').getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('tbody tr[aria-hidden="true"]')).toHaveLength(6);
    // No fake numbers or false empty states
    expect(screen.queryByText('No branches found.')).not.toBeInTheDocument();
    expect(screen.queryByText('No transactions recorded yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('No activity yet.')).not.toBeInTheDocument();

    gate.resolve([]);
    await waitFor(() => expect(container.querySelectorAll('.atany-skel-kpi')).toHaveLength(0));
  });

  test('empty response shows the real empty states once loading finishes', async () => {
    apiFetch.mockImplementation(async () => []);
    const { container } = render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByText('No branches found.')).toBeInTheDocument());
    expect(screen.getByText('No transactions recorded yet.')).toBeInTheDocument();
    expect(container.querySelectorAll('.atany-skel-kpi')).toHaveLength(0);
  });

  test('KPI cards now render their change badge (fixed delta→badge prop)', async () => {
    apiFetch.mockImplementation(async (path) => {
      if (path === '/admin/users') {
        return [
          { id: 'u1', name: 'A', role: 'shop_owner', created_at: new Date().toISOString() },
          { id: 'u2', name: 'B', role: 'customer', created_at: new Date().toISOString() },
        ];
      }
      if (path === '/branches') return [{ id: 'b1', name: 'Branch', status: 'Open' }];
      if (path === '/admin/transactions') {
        return [{ id: 't1', status: 'paid', amount: 5000, customer: 'C', item: 'I', date: new Date().toISOString() }];
      }
      return [];
    });
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByText('Total Branches')).toBeInTheDocument());
    const branchesCard = screen.getByText('Total Branches').closest('.kpi-card');
    expect(branchesCard).toHaveTextContent('1 active');
  });

  test('mounting the dashboard issues one refresh pass (no duplicate fetch storm)', async () => {
    apiFetch.mockImplementation(async () => []);
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByText('Total Branches')).toBeInTheDocument());
    const initial = apiFetch.mock.calls.length;
    // The hook fetches once on mount; the page only sets up its 15s poll.
    const onMount = apiFetch.mock.calls.filter(([p]) => p === '/admin/users').length;
    expect(initial).toBeGreaterThan(0);
    expect(onMount).toBeLessThanOrEqual(2); // StrictMode-safe, not one per render
  });
});