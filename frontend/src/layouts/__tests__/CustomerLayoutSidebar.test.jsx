// frontend/src/layouts/__tests__/CustomerLayoutSidebar.test.jsx
// Customer navigation after the Settings removal:
//  - no SETTINGS section, no Settings nav item
//  - Sign Out still present
//  - the old /customer/settings URL redirects to the Profile page
//  - admin + seller navigation untouched
//  - Help & Support lives only on Profile (no duplicate)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutsDir = path.join(__dirname, '..');

const { authState, branchState } = vi.hoisted(() => ({
  authState: {
    user: { id: 'u-1', email: 'maria.santos@email.com', user_metadata: { name: 'Maria Santos' } },
    signOut: vi.fn(),
    preferredBranchId: 'b1',
    profileName: 'Maria Santos',
    loading: false,
  },
  branchState: {
    branchId: 'b1',
    branchName: 'Abreeza Branch',
    branches: [{ id: 'b1', name: 'Abreeza Branch', status: 'Open' }],
    loading: false,
    switchBranch: vi.fn(),
    refreshBranch: vi.fn(),
  },
}));

vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../../shared/hooks/useBranch', () => ({
  BranchProvider: ({ children }) => children,
  useBranch: () => branchState,
}));
vi.mock('../../shared/components/AssistantWidget', () => ({ AssistantWidget: () => <div data-testid="chatbot" /> }));
vi.mock('../../shared/components/NotificationBell', () => ({ NotificationBell: () => <div data-testid="bell" /> }));
vi.mock('../../roles/customer/components/OtherBranchLivePopup', () => ({ default: () => null }));
vi.mock('../../roles/customer/components/AuctionStartPopup', () => ({ default: () => null }));

import CustomerLayout from '../CustomerLayout';

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/customer/account']}>
      <Routes>
        <Route path="/customer" element={<CustomerLayout />}>
          <Route path="account" element={<div data-testid="profile-page">PROFILE PAGE</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  authState.signOut.mockClear();
});

describe('Customer sidebar — Settings removed', () => {
  it('contains no Settings section label', async () => {
    renderLayout();
    await waitFor(() => expect(screen.getByTestId('profile-page')).toBeInTheDocument());
    const labels = screen.getAllByText(/^(OVERVIEW|SHOP|ORDERS|SETTINGS)$/).map((n) => n.textContent);
    expect(labels).not.toContain('SETTINGS');
    expect(labels).toContain('ORDERS');
  });

  it('contains no Settings nav item', async () => {
    renderLayout();
    await waitFor(() => expect(screen.getByTestId('profile-page')).toBeInTheDocument());
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Settings/i })).not.toBeInTheDocument();
  });

  it('keeps the core customer navigation intact', async () => {
    renderLayout();
    await waitFor(() => expect(screen.getByTestId('profile-page')).toBeInTheDocument());
    ['Dashboard', 'Auctions', 'My Bids', 'Favorites', 'Watchlist', 'Branch Locator', 'My Purchases'].forEach((name) => {
      expect(screen.getByRole('link', { name: new RegExp(name, 'i') })).toBeInTheDocument();
    });
  });

  it('still shows Sign Out', async () => {
    renderLayout();
    await waitFor(() => expect(screen.getByTestId('profile-page')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Sign Out/i })).toBeInTheDocument();
  });

  it('leaves no empty section gap after ORDERS / My Purchases', async () => {
    renderLayout();
    await waitFor(() => expect(screen.getByTestId('profile-page')).toBeInTheDocument());
    const nav = screen.getByRole('navigation');
    const labels = Array.from(nav.querySelectorAll('.nav-section-label')).map((n) => n.textContent);
    expect(labels).toEqual(['OVERVIEW', 'SHOP', 'ORDERS']);
  });
});

describe('Customer Settings route compatibility', () => {
  it('redirects the old /customer/settings URL to the Profile page', async () => {
    const { customerRoutes } = await import('../../roles/customer/routes');
    const settingsRoute = customerRoutes.find((r) => r.path === 'settings');
    expect(settingsRoute).toBeTruthy();

    render(
      <MemoryRouter initialEntries={['/customer/settings']}>
        <Routes>
          <Route path="/customer" element={<CustomerLayout />}>
            <Route path="account" element={<div data-testid="profile-page">PROFILE PAGE</div>} />
            <Route path="settings" element={settingsRoute.element} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByTestId('profile-page')).toBeInTheDocument());
  });

  it('the customer route table no longer renders a Settings page component', async () => {
    const src = fs.readFileSync(path.join(layoutsDir, '../roles/customer/routes.jsx'), 'utf8');
    expect(src).not.toMatch(/import Settings/);
    expect(src).toMatch(/path: 'settings', element: <Navigate to="\/customer\/account" replace \/>/);
    expect(src).toMatch(/path: 'account', element: <Profile \/>/);
  });

  it('the deleted customer Settings page file is gone', () => {
    expect(fs.existsSync(path.join(layoutsDir, '../roles/customer/pages/Settings.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(layoutsDir, '../roles/customer/pages/AccountSettings.jsx'))).toBe(false);
  });
});

describe('Help & Support placement', () => {
  it('exists only on the Profile page (no duplicate)', async () => {
    const src = fs.readFileSync(path.join(layoutsDir, '../roles/customer/pages/Profile.jsx'), 'utf8');
    expect(src).toMatch(/Help &amp; Support/);
    const rolesDir = path.join(layoutsDir, '../roles/customer/pages');
    const others = fs.readdirSync(rolesDir).filter((f) => f.endsWith('.jsx') && f !== 'Profile.jsx');
    others.forEach((f) => {
      const text = fs.readFileSync(path.join(rolesDir, f), 'utf8');
      expect(text).not.toMatch(/Help & Support/);
    });
  });

  it('the FAQ + Contact Us actions live on the Profile page', async () => {
    const src = fs.readFileSync(path.join(layoutsDir, '../roles/customer/pages/Profile.jsx'), 'utf8');
    expect(src).toMatch(/FAQ/);
    expect(src).toMatch(/Contact Us/);
    expect(src).toMatch(/\/customer\/support/);
  });
});

describe('Admin + Seller navigation unaffected', () => {
  it('the admin layout keeps its own navigation (no SETTINGS block added/removed)', () => {
    const src = fs.readFileSync(path.join(layoutsDir, 'AdminLayout.jsx'), 'utf8');
    expect(src).toMatch(/label: 'OVERVIEW'/);
    expect(src).toMatch(/label: 'BRANCH OPERATIONS'/);
    expect(src).toMatch(/label: 'PLATFORM MANAGEMENT'/);
    expect(src).not.toMatch(/label: 'SETTINGS'/);
  });

  it('the admin sidebar no longer has standalone Jewelry / Auctions entries', () => {
    const src = fs.readFileSync(path.join(layoutsDir, 'AdminLayout.jsx'), 'utf8');
    // Jewelry + Auctions are reached through Branches → branch → tabs.
    expect(src).not.toMatch(/label: 'INVENTORY & AUCTIONS'/);
    expect(src).not.toMatch(/name: 'Jewelry'/);
    expect(src).not.toMatch(/name: 'Auctions'/);
    expect(src).toMatch(/name: 'Branches'/);
  });

  it('the seller layout keeps its SETTINGS section', () => {
    const src = fs.readFileSync(path.join(layoutsDir, 'ShopOwnerLayout.jsx'), 'utf8');
    expect(src).toMatch(/label: 'SETTINGS'/);
    expect(src).toMatch(/\/shop\/profile/);
  });
});
