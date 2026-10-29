// frontend/src/layouts/__tests__/AdminBellRemoval.test.jsx
//
// ADMIN-ONLY notification bell removal.
//
// The notification bell is a shared component injected into each portal header
// through the `rightExtra` prop (Topbar -> PortalPageHeader `actions`). Removing
// it from Admin must NOT affect Customer or Seller, and must not touch any shared
// notification infrastructure.
//
// Guarantees locked here:
//   · Admin header renders no bell, no unread badge, no bell trigger
//   · Admin profile/avatar chip still renders
//   · Admin no longer issues the notification-history request
//   · Customer and Seller still render their bells, badges and fetches
//   · the shared NotificationBell + useNotifications are left intact
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';

const apiFetch = vi.fn(() => Promise.resolve([]));
vi.mock('../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));

vi.mock('../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

// CustomerLayout refuses to render until a branch is resolved (it redirects to
// /select-branch otherwise), so the customer case must supply one.
let authValue = {
  user: { id: 'a1', email: 'admin@atany.ph', user_metadata: { name: 'Admin User' } },
  preferredBranchId: null, loading: false, signOut: vi.fn(),
};
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => authValue }));
vi.mock('../../shared/hooks/useBranch', () => ({
  useBranch: () => ({ branchId: 'b1', branchName: 'Gmall Branch', branches: [{ id: 'b1', name: 'Gmall Branch' }], loading: false }),
  // CustomerLayout imports the provider too; inert stand-in.
  BranchProvider: ({ children }) => children,
}));
// Keep the sidebar inert so these tests exercise the header only.
vi.mock('../../shared/components/Sidebar', () => ({ Sidebar: () => <nav data-testid="sidebar" /> }));
// Portal chrome that is irrelevant to the header.
vi.mock('../../shared/components/AssistantWidget', () => ({ AssistantWidget: () => null }));
vi.mock('../../shared/components/MessagesPage', () => ({ MessagesPage: () => null }));

import AdminLayout from '../AdminLayout';
import CustomerLayout from '../CustomerLayout';
import ShopOwnerLayout from '../ShopOwnerLayout';

const LAYOUTS = { AdminLayout, CustomerLayout, ShopOwnerLayout };

function renderLayout(name, pathname) {
  const Layout = LAYOUTS[name];
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path={pathname} element={<div>child</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const bells = () => document.querySelectorAll('.portal-page-header button[aria-label="Notifications"]');
const rightGroup = () => document.querySelector('.portal-page-header__right');

beforeEach(() => {
  apiFetch.mockClear();
  apiFetch.mockReturnValue(Promise.resolve([]));
  authValue = {
    user: { id: 'a1', email: 'admin@atany.ph', user_metadata: { name: 'Admin User' } },
    preferredBranchId: null, loading: false, signOut: vi.fn(),
  };
});
afterEach(() => cleanup());

describe('ADMIN — bell removed', () => {
  it('1. the Admin header renders no notification bell', async () => {
    renderLayout('AdminLayout', '/admin');
    await waitFor(() => expect(document.querySelector('.portal-page-header')).toBeTruthy());
    expect(bells()).toHaveLength(0);
  });

  it('2. the Admin header renders no unread badge', async () => {
    renderLayout('AdminLayout', '/admin');
    await waitFor(() => expect(document.querySelector('.portal-page-header')).toBeTruthy());
    // no bell button at all, so no badge can float free inside the right group
    expect(rightGroup().querySelectorAll('span')).toHaveLength(0);
  });

  it('3. no Admin notification dropdown trigger remains', async () => {
    renderLayout('AdminLayout', '/admin');
    await waitFor(() => expect(document.querySelector('.portal-page-header')).toBeTruthy());
    expect(document.querySelector('button[aria-label="Notifications"]')).toBeNull();
    // nothing links out to the admin notifications page from the header
    expect(document.querySelector('.portal-page-header a[href*="/admin/notifications"]')).toBeNull();
  });

  it('4. the Admin header leaves no orphan element where the bell was', async () => {
    renderLayout('AdminLayout', '/admin');
    await waitFor(() => expect(document.querySelector('.portal-page-header')).toBeTruthy());
    // the right group holds exactly one child: the profile/avatar menu
    expect(rightGroup().children).toHaveLength(1);
    expect(rightGroup().firstElementChild.className).toContain('user-menu-wrap');
  });

  it('5. the Admin profile/avatar chip still renders', async () => {
    renderLayout('AdminLayout', '/admin');
    await waitFor(() => expect(document.querySelector('.portal-page-header')).toBeTruthy());
    expect(document.querySelector('.admin-avatar')).toBeTruthy();
    expect(screen.getByText('Admin User')).toBeTruthy();
    expect(screen.getByText('Administrator')).toBeTruthy();
  });

  it('6. Admin no longer issues the notification-history request', async () => {
    renderLayout('AdminLayout', '/admin');
    await waitFor(() => expect(document.querySelector('.portal-page-header')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 150));
    const paths = apiFetch.mock.calls.map(([p]) => p);
    expect(paths.filter((p) => String(p).includes('notifications'))).toHaveLength(0);
  });

  it('7. AdminLayout no longer references NotificationBell at all', () => {
    const src = fs.readFileSync(path.join(__dirname, '../AdminLayout.jsx'), 'utf8');
    expect(src).not.toMatch(/NotificationBell/);
    expect(src).not.toMatch(/rightExtra\s*=/);   // no bell prop passed (prose may mention it)
  });
});

describe('CUSTOMER + SELLER — bells preserved', () => {
  it('8. the Customer header still renders its notification bell', async () => {
    authValue.preferredBranchId = 'b1';
    renderLayout('CustomerLayout', '/customer');
    await waitFor(() => expect(document.querySelector('.portal-page-header')).toBeTruthy());
    expect(bells()).toHaveLength(1);
  });

  it('9. the Customer bell still shows an unread badge and fetches', async () => {
    apiFetch.mockResolvedValue([{ id: 'n1', read: false }, { id: 'n2', read: false }]);
    authValue.preferredBranchId = 'b1';
    renderLayout('CustomerLayout', '/customer');
    await waitFor(() => expect(document.querySelector('.portal-page-header')).toBeTruthy());
    await waitFor(() => expect(bells()).toHaveLength(1));
    const paths = apiFetch.mock.calls.map(([p]) => String(p));
    expect(paths.some((p) => p.includes('notifications'))).toBe(true);
  });

  it('10. the Seller header still renders its notification bell', async () => {
    renderLayout('ShopOwnerLayout', '/shop');
    await waitFor(() => expect(document.querySelector('.portal-page-header')).toBeTruthy());
    expect(bells()).toHaveLength(1);
  });

  it('11. the Seller bell still points at the seller notifications route', async () => {
    renderLayout('ShopOwnerLayout', '/shop');
    await waitFor(() => expect(document.querySelector('.portal-page-header')).toBeTruthy());
    expect(bells()[0]).toBeTruthy();
    expect(fs.readFileSync(path.join(__dirname, '../ShopOwnerLayout.jsx'), 'utf8'))
      .toMatch(/NotificationBell to="\/shop\/notifications"/);
  });

  it('12. CustomerLayout still passes the bell AND its branch switcher', () => {
    const src = fs.readFileSync(path.join(__dirname, '../CustomerLayout.jsx'), 'utf8');
    expect(src).toMatch(/NotificationBell/);
    expect(src).toMatch(/BranchSwitcher/);
  });
});

describe('shared infrastructure untouched', () => {
  it('13. the shared NotificationBell component still exists and is unchanged in shape', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../shared/components/NotificationBell.jsx'), 'utf8');
    expect(src).toMatch(/export function NotificationBell/);
    expect(src).toMatch(/aria-label="Notifications"/);
    expect(src).toMatch(/useNotifications\(apiPath\)/);
  });

  it('14. the shared useNotifications hook is untouched', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../roles/customer/hooks/useNotifications.js'), 'utf8');
    expect(src).toMatch(/export function useNotifications/);
    expect(src).toMatch(/apiFetch/);
  });

  it('15. the shared header still supports rightExtra for other portals', () => {
    const topbar = fs.readFileSync(path.join(__dirname, '../../shared/components/Topbar.jsx'), 'utf8');
    expect(topbar).toMatch(/rightExtra/);
    const header = fs.readFileSync(path.join(__dirname, '../../shared/components/PortalPageHeader.jsx'), 'utf8');
    // `actions` slot must remain, since Customer/Seller still feed the bell through it
    expect(header).toMatch(/\{actions\}/);
  });
});
