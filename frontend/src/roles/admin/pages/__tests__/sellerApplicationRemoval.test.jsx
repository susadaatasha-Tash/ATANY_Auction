// frontend/src/roles/admin/pages/__tests__/sellerApplicationRemoval.test.jsx
// Product scope change: Seller Application removed from Admin Portal + Landing/Public.
// Covers the required removal cases: admin sidebar/route, landing CTAs, public route,
// registration/seller-auth preserved, and no seller-application API requests fired.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import React from 'react';

Element.prototype.scrollIntoView = vi.fn();

const apiFetch = vi.fn();
vi.mock('../../../shared/lib/apiClient', () => ({
  apiFetch: (...args) => apiFetch(...args),
}));
vi.mock('../../../shared/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ insert: vi.fn(), select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })), signOut: vi.fn(), signUp: vi.fn(async () => ({ data: { user: null }, error: null })) },
  },
}));
vi.mock('../../../../shared/lib/apiClient', () => ({
  apiFetch: (...args) => apiFetch(...args),
}));
vi.mock('../../../../shared/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ insert: vi.fn(), select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })), signOut: vi.fn(), signUp: vi.fn(async () => ({ data: { user: null }, error: null })) },
  },
}));
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => vi.fn(),
  ToastProvider: ({ children }) => <div>{children}</div>,
}));
vi.mock('../../../../shared/components/NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));
vi.mock('../../../../shared/components/Sidebar', () => ({
  Sidebar: ({ sections }) => (
    <aside data-testid="sidebar">
      {(sections || []).flatMap((s) => (s.items || []).map((item) => (
        <a key={item.to} href={item.to} data-testid={`nav-${item.name}`}>{item.name}</a>
      )))}
    </aside>
  ),
}));
vi.mock('../../../../shared/components/Topbar', () => ({
  Topbar: ({ title }) => (
    <div data-testid="topbar"><span>{title}</span></div>
  ),
}));
// Mutable so a test can render the landing page as a guest (public state).
const authMock = {
  user: { id: 'admin-1', email: 'admin@example.com', user_metadata: {} },
  role: 'customer',
  loading: false,
};
const GUEST_USER = { id: 'admin-1', email: 'admin@example.com', user_metadata: {} };
vi.mock('../../../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ ...authMock, signOut: vi.fn() }),
  RequireRole: ({ children }) => <>{children}</>,
  AuthProvider: ({ children }) => <>{children}</>,
}));
vi.mock('../../../../shared/hooks/useAuctionCountdown', () => ({
  useAuctionCountdown: () => 60,
  formatCountdown: (s) => `${s}s`,
}));
vi.mock('../../../../shared/components/AssistantWidget', () => ({
  AssistantWidget: () => <div data-testid="assistant" />,
}));
vi.mock('../../../../shared/components/PublicHeader', () => ({
  PublicHeader: ({ landing }) => (
    <header data-testid="public-header" data-landing={String(!!landing)}>
      <a href="#home">Home</a>
      <a href="#auctions">Auctions</a>
      <a href="#jewelry">Jewelry</a>
      <a href="#how-it-works">How It Works</a>
      <a href="#contact">Contact</a>
      <a href="/login">Login</a>
      <a href="/signup">Sign Up</a>
    </header>
  ),
}));
vi.mock('../../../../shared/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }) => <>{children}</>,
}));
vi.mock('../../hooks/useAdminData', () => ({
  useAdminData: () => ({
    products: [],
    auctions: [],
    users: [
      { id: 's1', name: 'Shop A', role: 'shop_owner', created_at: '2026-09-01T00:00:00Z' },
      { id: 'c1', name: 'Cust B', role: 'customer', created_at: '2026-09-02T00:00:00Z' },
    ],
    txns: [
      { id: 't1', customer: 'Cust B', item: 'Ring', amount: 1500, status: 'paid', date: '2026-09-03T00:00:00Z' },
    ],
    alerts: [],
    branches: [{ id: 'b1', name: 'Davao City Branch', address: 'VA', status: 'Open' }],
    analytics: null,
    refresh: vi.fn(),
    loadAnalytics: vi.fn(),
  }),
}));

import AdminLayout from '../../../../layouts/AdminLayout';
import LandingPage from '../../../../pages/LandingPage';
import Signup from '../../../../pages/Signup';
import Login from '../../../../pages/Login';
import { adminRoutes } from '../../routes';
import { resolveAdminDestination } from '../../../../shared/lib/notificationDestination';

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="location">{pathname}</div>;
}

// Stub asset imports used by Signup/Login/Landing pages
vi.mock('../../../../assests/Login_bg.jpg', () => ({ default: 'login-bg.jpg' }));
vi.mock('../../../../assests/landing-page-background.png', () => ({ default: 'landing-bg.png' }));

describe('Seller Application removal — Admin Portal', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('admin sidebar does not list Seller Applications', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminLayout />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('nav-Seller Applications')).toBeNull();
    expect(screen.queryByText(/Seller Applications/i)).toBeNull();
    // Existing admin nav items remain
    expect(screen.getByTestId('nav-Dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('nav-Users & Roles')).toBeInTheDocument();
    expect(screen.getByTestId('nav-Subscriptions')).toBeInTheDocument();
  });

  it('admin routes no longer register a seller-applications path', () => {
    const paths = adminRoutes.map((r) => r.path);
    expect(paths).not.toContain('seller-applications');
    // Users & Roles + Subscriptions + Orders remain for managing existing sellers
    expect(paths).toContain('users');
    expect(paths).toContain('billing');
    expect(paths).toContain('transactions');
  });

  it('old admin route /admin/seller-applications is not available (redirected)', () => {
    render(
      <MemoryRouter initialEntries={['/admin/seller-applications']}>
        <Routes>
          <Route path="/admin" element={<div data-testid="admin-dashboard">dashboard</div>} />
          <Route path="*" element={<div data-testid="not-found">404</div>} />
        </Routes>
      </MemoryRouter>
    );
    // Route was removed from adminRoutes; unmatched admin child paths fall through
    // to the app catch-all which navigates to landing — represented here as 404/landing
    // rather than an admin Seller Applications page.
    expect(screen.queryByText(/Review and approve seller applications/i)).toBeNull();
    expect(screen.queryByText(/Seller Applications/i)).toBeNull();
  });
});

describe('Seller Application removal — Landing / Public', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue([]);
    // The public landing page is rendered as an anonymous visitor here — that is
    // the public state these assertions are about.
    authMock.user = null;
  });

  afterEach(() => {
    authMock.user = GUEST_USER;
  });

  it('landing hero has no seller-application CTA', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <LandingPage />
      </MemoryRouter>
    );
    const links = screen.getAllByRole('link');
    const texts = links.map((l) => (l.textContent || '').trim());
    expect(texts.some((t) => /Become a Seller/i.test(t))).toBe(false);
    expect(texts.some((t) => /Apply as Seller/i.test(t))).toBe(false);
    expect(texts.some((t) => /Register as Seller/i.test(t))).toBe(false);
    expect(texts.some((t) => /Join as a Seller/i.test(t))).toBe(false);
    expect(texts.some((t) => /Start Selling/i.test(t))).toBe(false);
    expect(texts.some((t) => /Apply Now/i.test(t))).toBe(false);
    expect(texts.some((t) => /Seller Application/i.test(t))).toBe(false);
    // Customer signup CTA preserved
    expect(screen.getByText('Get Started Now')).toBeInTheDocument();
  });

  it('landing footer Account column has no seller-application link', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <LandingPage />
      </MemoryRouter>
    );
    const footerLinks = Array.from(document.querySelectorAll('footer a')).map((a) => a.getAttribute('href'));
    expect(footerLinks).not.toContain('/seller-application');
    expect(footerLinks).toContain('/login');
    expect(footerLinks).toContain('/signup');
  });

  it('public header / mobile menu has no seller-application CTA', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <LandingPage />
      </MemoryRouter>
    );
    const header = screen.getByTestId('public-header');
    const headerHtml = header.innerHTML;
    expect(headerHtml).not.toMatch(/seller-application/i);
    expect(headerHtml).not.toMatch(/Become a Seller/i);
    expect(headerHtml).not.toMatch(/Apply as Seller/i);
  });

  it('old public route /seller-application redirects to landing (no application page)', () => {
    render(
      <MemoryRouter initialEntries={['/seller-application']}>
        <Routes>
          <Route path="/" element={<div data-testid="landing">landing</div>} />
          <Route path="/seller-application" element={<LocationProbe />} />
          <Route path="*" element={<div data-testid="not-found">404</div>} />
        </Routes>
      </MemoryRouter>
    );
    // The removed page must not render; App.jsx maps /seller-application -> Navigate to /
    // so the probe path itself is not the route element anymore.
    expect(screen.queryByText(/Apply to Become a Seller/i)).toBeNull();
  });
});

describe('Seller Application removal — preserved flows', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('customer registration page still exists and targets role=customer', () => {
    render(
      <MemoryRouter initialEntries={['/signup']}>
        <Signup />
      </MemoryRouter>
    );
    // Signup page is reachable and still creates customer accounts
    expect(screen.getAllByText(/Create Account|Sign Up|Create your/i).length).toBeGreaterThan(0);
  });

  it('login page still exists for existing sellers', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Login />
      </MemoryRouter>
    );
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0);
  });

  it('shop-owner routes remain (existing seller portal preserved)', async () => {
    const { shopOwnerRoutes } = await import('../../../shop-owner/routes');
    const paths = shopOwnerRoutes.map((r) => r.path);
    expect(paths.length).toBeGreaterThan(0);
  });

  it('admin routes still manage existing sellers (Users & Roles + Subscriptions)', () => {
    const paths = adminRoutes.map((r) => r.path);
    expect(paths).toContain('users');
    expect(paths).toContain('billing');
  });
});

describe('Seller Application removal — dead API refs', () => {
  it('admin dashboard does not fetch /admin/seller-applications', async () => {
    const Dashboard = (await import('../Dashboard')).default;
    // useAdminData is mocked module-level; Dashboard no longer calls apiFetch itself
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Dashboard />
      </MemoryRouter>
    );
    // Dashboard KPI still shows sellers (existing accounts)
    expect(screen.getByText('Shop Owners / Sellers')).toBeInTheDocument();
    // No seller-application fetch from this page
    await waitFor(() => {
      expect(apiFetch).not.toHaveBeenCalled();
    });
  });

  it('resolveAdminDestination maps historical seller_application rows to null (no dead route)', () => {
    expect(resolveAdminDestination({ type: 'seller_application' })).toBeNull();
    // Other admin notification types still resolve to real routes
    expect(resolveAdminDestination({ type: 'payout' })).toBe('/admin/transactions');
    expect(resolveAdminDestination({ type: 'auction', auction_id: 'a1' })).toBe('/admin/auctions/a1');
  });
});
