// frontend/src/roles/customer/pages/__tests__/MyPurchases.test.jsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import React from 'react';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({
  apiFetch: (...args) => apiFetch(...args),
}));

vi.mock('../../../../shared/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
    },
    channel: () => ({ on: () => ({ on: () => ({ subscribe: () => {} }) }), subscribe: () => {} }),
    removeChannel: () => {},
  },
}));

vi.mock('../../../../shared/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'customer@example.com', user_metadata: {} },
    loading: false,
  }),
}));

vi.mock('../../../../shared/hooks/useBranch', () => ({
  useBranch: () => ({ branchId: 'b1', branchName: 'SM North' }),
}));

vi.mock('../../../../shared/components/NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

import MyPurchases from '../MyPurchases';

const orders = [
  {
    id: 11,
    transaction_code: 'TXN-1001',
    item: 'Gold Ring',
    img: null,
    amount: 25000,
    branch: 'SM North',
    branch_lat: 14.6,
    branch_lng: 121.0,
    status: 'pending',
    payment_status: null,
    is_expired: false,
    payment_deadline: '2099-09-25T10:00:00Z',
    winner_confirmed_at: '2026-09-18T10:00:00Z',
    auction_code: 'AUC-11',
    payment_method: null,
    date: '2026-09-18T10:00:00Z',
  },
  {
    id: 12,
    transaction_code: 'TXN-1002',
    item: 'Diamond Necklace',
    amount: 80000,
    branch: 'Trinoma',
    status: 'ready_pickup',
    payment_status: 'paid',
    is_expired: false,
    winner_confirmed_at: '2026-09-10T10:00:00Z',
    auction_code: 'AUC-12',
    payment_method: 'gcash',
    date: '2026-09-10T10:00:00Z',
  },
];

function renderPage(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('MyPurchases redesign', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('renders premium header, metrics, tabs, and cards from real orders', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/customer/orders') return Promise.resolve(orders);
      if (path === '/customer/auctions?status=live') return Promise.resolve([]);
      if (path === '/customer/auctions/live') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    renderPage(<MyPurchases />);

    await waitFor(() => {
      expect(screen.getByText('My Purchases')).toBeInTheDocument();
    });

    expect(screen.getByText('Lots won')).toBeInTheDocument();
    expect(screen.queryByText('CUSTOMER PORTAL')).not.toBeInTheDocument();
    expect(screen.getAllByText('Awaiting pickup').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Collected').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Gold Ring')).toBeInTheDocument();
    expect(screen.getByText('Diamond Necklace')).toBeInTheDocument();
    expect(screen.getByText('TXN-1001')).toBeInTheDocument();
    expect(screen.getAllByText('AUC-11').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Payment due/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pay now/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Get directions/i })).toBeInTheDocument();
  });

  it('does not invent LOT-/INV-/pickup sample values', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/customer/orders') return Promise.resolve(orders);
      return Promise.resolve([]);
    });

    renderPage(<MyPurchases />);
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());

    expect(screen.queryByText(/LOT-2038/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/INV-2026-1043/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/GM-4821/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pickup code/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Gmall Branch/i)).not.toBeInTheDocument();
  });

  it('shows error state when orders API fails', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/customer/orders') return Promise.reject(new Error('boom'));
      return Promise.resolve([]);
    });

    renderPage(<MyPurchases />);
    await waitFor(() => {
      expect(screen.getByText('Unable to load purchases')).toBeInTheDocument();
    });
  });

  it('shows empty state when no orders', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/customer/orders') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    renderPage(<MyPurchases />);
    await waitFor(() => {
      expect(screen.getByText('No purchases yet')).toBeInTheDocument();
    });
    expect(screen.getByText(/Explore Auctions/)).toBeInTheDocument();
  });

  it('does NOT render a search input inside the top header', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/customer/orders') return Promise.resolve(orders);
      return Promise.resolve([]);
    });

    const { container } = renderPage(<MyPurchases />);
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());

    const header = container.querySelector('.portal-page-header');
    expect(header).toBeTruthy();
    expect(header.querySelector('.portal-page-header__search')).toBeNull();
    expect(header.querySelectorAll('input').length).toBe(0);
    expect(screen.queryByLabelText('Search lots and branches')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search lots, branches...')).not.toBeInTheDocument();
  });

  it('keeps the page-level "Search your purchases..." field working', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/customer/orders') return Promise.resolve(orders);
      return Promise.resolve([]);
    });

    renderPage(<MyPurchases />);
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());

    const search = screen.getByLabelText('Search your purchases');
    expect(search).toHaveAttribute('placeholder', 'Search your purchases...');
    fireEvent.change(search, { target: { value: 'diamond' } });
    await waitFor(() => expect(screen.queryByText('Gold Ring')).not.toBeInTheDocument());
    expect(screen.getByText('Diamond Necklace')).toBeInTheDocument();
  });

  it('renders the menu (hamburger) control from the customer layout outlet context', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/customer/orders') return Promise.resolve(orders);
      return Promise.resolve([]);
    });

    const toggleMenu = vi.fn();
    const toggleSidebar = vi.fn();
    // The customer layout hands the SAME drawer/collapse controls to the page
    // through the outlet context.
    const Layout = () => (
      <Outlet context={{ toggleMenu, toggleSidebar, sidebarCollapsed: false }} />
    );

    render(
      <MemoryRouter initialEntries={['/customer/purchases']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/customer/purchases" element={<MyPurchases />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());

    const hamburger = screen.getByLabelText('Open navigation menu');
    expect(hamburger).toBeInTheDocument();
    fireEvent.click(hamburger);
    expect(toggleMenu).toHaveBeenCalled();

    const collapse = screen.getByLabelText('Toggle sidebar');
    fireEvent.click(collapse);
    expect(toggleSidebar).toHaveBeenCalled();
  });
});
