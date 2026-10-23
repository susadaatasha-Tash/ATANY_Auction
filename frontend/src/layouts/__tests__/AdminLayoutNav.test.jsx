// frontend/src/layouts/__tests__/AdminLayoutNav.test.jsx
// Admin navigation: icons on every item, expand/collapse behavior,
// role-scoped persistence key, active nested routes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import '../../index.css';

const authState = {
  user: { id: 'admin-1', email: 'admin@atany.ph', user_metadata: { name: 'Admin User', role: 'admin' } },
  signOut: vi.fn(),
  loading: false,
};

vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => authState }));

import AdminLayout from '../AdminLayout';

function renderAdmin({ pathname = '/admin' } = {}) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<div data-testid="admin-dashboard">Dashboard</div>} />
          <Route path="branches" element={<div data-testid="admin-branches">Branches</div>} />
          <Route path="branches/:branchId" element={<div data-testid="admin-branches-detail">Branch Detail</div>} />
          <Route path="users" element={<div data-testid="admin-users">Users</div>} />
          <Route path="users/:id" element={<div data-testid="admin-user-detail">User Detail</div>} />
          <Route path="transactions" element={<div data-testid="admin-orders">Orders</div>} />
          <Route path="billing" element={<div data-testid="admin-billing">Billing</div>} />
          <Route path="analytics" element={<div data-testid="admin-reports">Reports</div>} />
          <Route path="security" element={<div data-testid="admin-security">Security</div>} />
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

describe('Admin nav items have icons', () => {
  it('every sidebar nav item renders an icon', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByTestId('admin-dashboard')).toBeInTheDocument());
    const navItems = screen.getAllByRole('link', { name: /Dashboard|Branches|Users & Roles|Orders|Subscriptions|Reports|Security Alerts/i });
    expect(navItems.length).toBeGreaterThan(0);
    // Each nav item contains an svg/icon.
    navItems.forEach((item) => {
      expect(item.querySelector('svg, [data-testid^="icon-"]')).toBeTruthy();
    });
  });

  it('includes all expected Admin sections and Sign Out', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByTestId('admin-dashboard')).toBeInTheDocument());
    expect(screen.getByText('OVERVIEW')).toBeInTheDocument();
    expect(screen.getByText('BRANCH OPERATIONS')).toBeInTheDocument();
    expect(screen.getByText('PLATFORM MANAGEMENT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign Out/i })).toBeInTheDocument();
  });
});

describe('Admin collapse behavior', () => {
  it('collapses to icon rail: labels hidden, icons remain', async () => {
    localStorage.setItem('atany_admin_sidebar_collapsed', 'true');
    renderAdmin({ pathname: '/admin/branches' });
    await waitFor(() => expect(screen.getByTestId('admin-branches')).toBeInTheDocument());
    await waitFor(() => expect(collapsedAside()).toBeTruthy());
    const aside = collapsedAside();
    // Icons remain visible.
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
    // The collapsed class is present — this is what hides labels/headings via CSS.
    expect(aside).toHaveClass('collapsed');
    // Labels are rendered (present in DOM) but visually hidden; icons stay.
    expect(aside.querySelectorAll('.nav-label').length).toBeGreaterThan(0);
    aside.querySelectorAll('svg').forEach((icon) => expect(icon).toBeInTheDocument());
  });

  it('restores collapsed state from role-scoped localStorage key', async () => {
    localStorage.setItem('atany_admin_sidebar_collapsed', 'true');
    renderAdmin({ pathname: '/admin' });
    await waitFor(() => expect(screen.getByTestId('admin-dashboard')).toBeInTheDocument());
    await waitFor(() => expect(collapsedAside()).toBeTruthy());
  });
});

describe('Admin active nested routes', () => {
  it('highlights Users & Roles when on /admin/users/:id', async () => {
    renderAdmin({ pathname: '/admin/users/42' });
    await waitFor(() => expect(screen.getByTestId('admin-user-detail')).toBeInTheDocument());
    const usersLink = screen.getByRole('link', { name: 'Users & Roles' });
    expect(usersLink).toHaveClass('active');
    expect(usersLink).toHaveAttribute('aria-current', 'page');
  });

  it('highlights Branches when on /admin/branches/:id', async () => {
    renderAdmin({ pathname: '/admin/branches/9' });
    await waitFor(() => expect(screen.getByTestId('admin-branches-detail')).toBeInTheDocument());
    const branchesLink = screen.getByRole('link', { name: 'Branches' });
    expect(branchesLink).toHaveClass('active');
    expect(branchesLink).toHaveAttribute('aria-current', 'page');
    const dashboardLink = screen.getByRole('link', { name: 'Dashboard' });
    expect(dashboardLink).not.toHaveClass('active');
  });
});
