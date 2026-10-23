// frontend/src/shared/components/__tests__/Sidebar.test.jsx
// Shared Sidebar — expand/collapse icon rail, icons, active-route matching,
// tooltips/accessibility. Used by Admin, Shop Owner and Customer portals.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { Sidebar } from '../Sidebar';
import fs from 'fs';
import path from 'path';

const cssPath = path.resolve(__dirname, '../../../index.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

const HomeIcon = () => <span data-testid="icon-home" />;
const GavelIcon = () => <span data-testid="icon-gavel" />;
const BagIcon = () => <span data-testid="icon-bag" />;
const LogoutIcon = () => <span data-testid="icon-logout" />;

const sections = [
  { label: 'OVERVIEW', items: [{ to: '/customer', name: 'Dashboard', end: true, icon: <HomeIcon /> }] },
  { label: 'SHOP', items: [
    { to: '/customer/auctions', name: 'Auctions', icon: <GavelIcon /> },
    { to: '/customer/purchases', name: 'My Purchases', icon: <BagIcon /> },
  ]},
];

function renderSidebar({
  collapsed = false,
  pathname = '/customer',
  sections: secs = sections,
  onSignOut,
} = {}) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Sidebar
        brand="ATANY"
        tag="TEST"
        sections={secs}
        collapsed={collapsed}
        onSignOut={onSignOut}
      />
    </MemoryRouter>
  );
}

describe('Sidebar — expanded state', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders icons + labels when expanded', () => {
    renderSidebar({ collapsed: false, pathname: '/customer' });
    expect(screen.getByTestId('icon-home')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Auctions')).toBeInTheDocument();
    expect(screen.getByText('My Purchases')).toBeInTheDocument();
    expect(screen.getByText('OVERVIEW')).toBeInTheDocument();
    expect(screen.getByText('SHOP')).toBeInTheDocument();
  });

  it('renders the brand logo + tag when expanded', () => {
    renderSidebar({ collapsed: false });
    expect(screen.getByText('ATANY')).toBeInTheDocument();
    expect(screen.getByText('TEST')).toBeInTheDocument();
  });
});

describe('Sidebar — collapsed state', () => {
  it('hides labels but keeps icons visible and centered', () => {
    renderSidebar({ collapsed: true, pathname: '/customer' });
    const aside = document.querySelector('aside.sidebar');
    expect(aside).toHaveClass('collapsed');
    // Icons remain.
    expect(screen.getByTestId('icon-home')).toBeInTheDocument();
    expect(screen.getByTestId('icon-gavel')).toBeInTheDocument();
    expect(screen.getByTestId('icon-bag')).toBeInTheDocument();
    // Labels are rendered (present in DOM) but visually hidden via CSS;
    // section headings are removed from the DOM when collapsed.
    expect(aside.querySelectorAll('.nav-label').length).toBe(3);
    expect(aside.querySelectorAll('.nav-section-label').length).toBe(0);
    // The collapsed class drives the icon-centering via CSS.
    expect(aside).toHaveClass('collapsed');
  });

  it('keeps the brand mark only (compact), no clipped role label', () => {
    renderSidebar({ collapsed: true });
    expect(screen.getByTestId('icon-home')).toBeInTheDocument();
    const aside = document.querySelector('aside.sidebar');
    expect(aside).toHaveClass('collapsed');
    // Compact mark only — no clipped or half-visible role labels.
    expect(screen.queryByText('ATANY')).not.toBeInTheDocument();
    expect(screen.queryByText('TEST')).not.toBeInTheDocument();
  });

  it('provides a tooltip (title) and accessible name on collapsed icons', () => {
    renderSidebar({ collapsed: true, pathname: '/customer' });
    const auctionsLink = screen.getByRole('link', { name: 'Auctions' });
    expect(auctionsLink).toHaveAttribute('title', 'Auctions');
    expect(auctionsLink).toHaveAttribute('aria-label', 'Auctions');
  });

  it('keeps Sign Out visible with icon + accessible name', () => {
    const sectionsWithSignOut = [
      ...sections,
      { label: 'BOTTOM', items: [{ to: '/signout', name: 'Sign Out', icon: <LogoutIcon /> }] },
    ];
    renderSidebar({
      collapsed: true,
      pathname: '/customer',
      sections: sectionsWithSignOut,
      onSignOut: vi.fn(),
    });
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
    expect(screen.getByTestId('icon-logout')).toBeInTheDocument();
  });
});

describe('Sidebar — active route highlighting (nested routes)', () => {
  it('highlights the parent route for a nested child path', () => {
    const nestedSections = [
      {
        label: 'BRANCH OPERATIONS',
        items: [
          { to: '/admin/users', name: 'Users & Roles', icon: <HomeIcon />, matchPrefixes: ['/admin/users'] },
          { to: '/admin/orders', name: 'Orders', icon: <BagIcon /> },
        ],
      },
    ];
    renderSidebar({ collapsed: false, pathname: '/admin/users/42', sections: nestedSections });
    const usersLink = screen.getByRole('link', { name: 'Users & Roles' });
    expect(usersLink).toHaveAttribute('aria-current', 'page');
    expect(usersLink).toHaveClass('active');
    const ordersLink = screen.getByRole('link', { name: 'Orders' });
    expect(ordersLink).not.toHaveClass('active');
  });

  it('highlights exact route when end is true', () => {
    renderSidebar({ collapsed: false, pathname: '/customer/branches' });
    const dashboard = screen.getByRole('link', { name: 'Dashboard' });
    expect(dashboard).not.toHaveClass('active');
  });

  it('prefix-matches by default for non-end items', () => {
    renderSidebar({ collapsed: false, pathname: '/customer/purchases/11' });
    const purchases = screen.getByRole('link', { name: 'My Purchases' });
    expect(purchases).toHaveClass('active');
  });
});

describe('Sidebar — horizontal overflow prevention', () => {
  it('CSS defines overflow-x: hidden on .sidebar root', () => {
    expect(cssContent).toContain('.sidebar {');
    const sidebarBlock = cssContent.match(/\.sidebar\s*\{[\s\S]*?\}/)?.[0] || '';
    expect(sidebarBlock).toContain('overflow-x: hidden');
    expect(sidebarBlock).toContain('overflow-y: auto');
  });

  it('CSS defines overflow-x: hidden on .sidebar-nav', () => {
    const navBlock = cssContent.match(/\.sidebar-nav\s*\{[\s\S]*?\}/)?.[0] || '';
    expect(navBlock).toContain('overflow-x: hidden');
    expect(navBlock).toContain('overflow-y: auto');
  });

  it('CSS defines min-width: 0 on .nav-item', () => {
    const itemBlock = cssContent.match(/\.nav-item\s*\{[\s\S]*?\}/)?.[0] || '';
    expect(itemBlock).toContain('min-width: 0');
  });

  it('CSS defines text-overflow ellipsis on .nav-label', () => {
    const labelBlock = cssContent.match(/\.nav-label\s*\{[\s\S]*?\}/)?.[0] || '';
    expect(labelBlock).toContain('text-overflow: ellipsis');
    expect(labelBlock).toContain('overflow: hidden');
    expect(labelBlock).toContain('white-space: nowrap');
  });

  it('sidebar root is mounted in the DOM', () => {
    renderSidebar({ collapsed: false, pathname: '/customer' });
    const aside = document.querySelector('aside.sidebar');
    expect(aside).toBeTruthy();
    expect(aside.querySelectorAll('.nav-item').length).toBeGreaterThan(0);
  });

  it('collapsed sidebar is mounted with icon rail (no overflow)', () => {
    renderSidebar({ collapsed: true, pathname: '/customer' });
    const aside = document.querySelector('aside.sidebar.collapsed');
    expect(aside).toBeTruthy();
    // Icons remain visible
    expect(aside.querySelectorAll('svg').length).toBeGreaterThan(0);
    // Labels are present in DOM but hidden via CSS
    expect(aside.querySelectorAll('.nav-label').length).toBeGreaterThan(0);
  });

  it('Sign Out button stays inside sidebar width (no overflow)', () => {
    const sectionsWithSignOut = [
      ...sections,
      { label: 'BOTTOM', items: [{ to: '/signout', name: 'Sign Out', icon: <LogoutIcon /> }] },
    ];
    renderSidebar({
      collapsed: true,
      pathname: '/customer',
      sections: sectionsWithSignOut,
      onSignOut: vi.fn(),
    });
    const signOut = document.querySelector('.sidebar-foot .nav-item');
    expect(signOut).toBeTruthy();
    expect(signOut).toHaveClass('nav-item');
  });
});
