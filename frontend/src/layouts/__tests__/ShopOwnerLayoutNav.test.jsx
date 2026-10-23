// frontend/src/layouts/__tests__/ShopOwnerLayoutNav.test.jsx
// Shop Owner navigation: icons on every item, expand/collapse behavior,
// role-scoped persistence key, existing sidebar architecture preserved.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import '../../index.css';

const apiFetch = vi.fn();
vi.mock('../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));

const authState = {
  user: { id: 'shop-1', email: 'contact@goldenheritage.ph', user_metadata: { name: 'Golden Heritage', role: 'shop_owner' } },
  signOut: vi.fn(),
  loading: false,
};
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => authState }));

vi.mock('../../shared/lib/socketClient', () => ({ socket: { on: vi.fn(), off: vi.fn() } }));

import ShopOwnerLayout from '../ShopOwnerLayout';

function renderShop({ pathname = '/shop' } = {}) {
  apiFetch.mockImplementation((path) => {
    if (path === '/shop-owner/listings') return Promise.resolve([]);
    if (path === '/shop-owner/auctions') return Promise.resolve([]);
    if (path === '/shop-owner/sales') return Promise.resolve([]);
    if (path === '/shop-owner/shop') return Promise.resolve({ shop_name: 'Golden Heritage' });
    return Promise.resolve(null);
  });
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/shop" element={<ShopOwnerLayout />}>
          <Route index element={<div data-testid="shop-dashboard">Dashboard</div>} />
          <Route path="listings" element={<div data-testid="shop-listings">Listings</div>} />
          <Route path="auctions" element={<div data-testid="shop-auctions">Auctions</div>} />
          <Route path="orders" element={<div data-testid="shop-orders">Orders</div>} />
          <Route path="sales" element={<div data-testid="shop-sales">Sales</div>} />
          <Route path="billing" element={<div data-testid="shop-billing">Billing</div>} />
          <Route path="profile" element={<div data-testid="shop-profile">Profile</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const collapsedAside = () => document.querySelector('aside.sidebar.collapsed');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('Shop Owner nav items have icons', () => {
  it('every sidebar nav item renders an icon', async () => {
    renderShop();
    await waitFor(() => expect(screen.getByTestId('shop-dashboard')).toBeInTheDocument());
    const navItems = screen.getAllByRole('link', { name: /Dashboard|My Listings|My Auctions|Won Lots & Orders|Sales & Payouts|Subscription|Shop Profile/i });
    expect(navItems.length).toBeGreaterThan(0);
    navItems.forEach((item) => {
      expect(item.querySelector('svg')).toBeTruthy();
    });
  });

  it('includes expected Shop Owner sections and Sign Out', async () => {
    renderShop();
    await waitFor(() => expect(screen.getByTestId('shop-dashboard')).toBeInTheDocument());
    expect(screen.getByText('OVERVIEW')).toBeInTheDocument();
    expect(screen.getByText('INVENTORY')).toBeInTheDocument();
    expect(screen.getByText('EARNINGS')).toBeInTheDocument();
    expect(screen.getByText('SETTINGS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign Out/i })).toBeInTheDocument();
  });
});

describe('Shop Owner collapse behavior', () => {
  it('collapses to icon rail: labels hidden, icons remain', async () => {
    localStorage.setItem('atany_shop_sidebar_collapsed', 'true');
    renderShop({ pathname: '/shop/auctions' });
    await waitFor(() => expect(screen.getByTestId('shop-auctions')).toBeInTheDocument());
    await waitFor(() => expect(collapsedAside()).toBeTruthy());
    const aside = collapsedAside();
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
    expect(aside).toHaveClass('collapsed');
    expect(aside.querySelectorAll('.nav-label').length).toBeGreaterThan(0);
    aside.querySelectorAll('svg').forEach((icon) => expect(icon).toBeInTheDocument());
  });

  it('restores collapsed state from role-scoped localStorage key', async () => {
    localStorage.setItem('atany_shop_sidebar_collapsed', 'true');
    renderShop({ pathname: '/shop' });
    await waitFor(() => expect(screen.getByTestId('shop-dashboard')).toBeInTheDocument());
    await waitFor(() => expect(collapsedAside()).toBeTruthy());
  });
});
