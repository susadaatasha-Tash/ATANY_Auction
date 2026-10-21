// frontend/src/pages/__tests__/LandingPageCtaFooter.test.jsx
// Landing CTA + footer: real routes, real mailto links, no dead controls,
// role-aware CTA, and the layout/typography contracts of the design system.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssSrc = fs.readFileSync(path.join(__dirname, '../../index.css'), 'utf8');
const landingSrc = fs.readFileSync(path.join(__dirname, '../LandingPage.jsx'), 'utf8');

const apiFetch = vi.fn();
vi.mock('../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));

const authState = { user: null, role: null, status: null, loading: false, signOut: vi.fn() };
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => authState }));

vi.mock('../../shared/components/Toast', () => ({
  useToast: () => vi.fn(),
  ToastProvider: ({ children }) => children,
}));

vi.mock('../../shared/components/AssistantWidget', () => ({
  AssistantWidget: () => <div data-testid="assistant-widget" />,
}));

vi.mock('../../roles/customer/components/BranchMap', () => ({
  BranchMap: () => <div data-testid="branch-map" />,
}));

import LandingPage from '../LandingPage';

const BRANCHES = [{ id: 'b1', name: 'Abreeza Branch', address: 'Abreeza Mall', phone: '(082) 221-5200', status: 'Open', lat: 7.09, lng: 125.61 }];

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/signup" element={<div data-testid="signup-page">SIGNUP</div>} />
        <Route path="/login" element={<div data-testid="login-page">LOGIN</div>} />
        <Route path="/branches" element={<div data-testid="branches-page">BRANCHES</div>} />
        <Route path="/customer" element={<div data-testid="customer-page">CUSTOMER</div>} />
        <Route path="/shop" element={<div data-testid="shop-page">SHOP</div>} />
        <Route path="/admin" element={<div data-testid="admin-page">ADMIN</div>} />
        <Route path="/account-suspended" element={<div data-testid="suspended-page">SUSPENDED</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const footerLink = (text) =>
  [...document.querySelectorAll('.site-footer a')].find((a) => a.textContent.trim() === text);

describe('Landing CTA', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation((p) => {
      if (p === '/branches') return Promise.resolve(BRANCHES);
      if (p === '/api/auctions/live') return Promise.resolve([]);
      return Promise.resolve({});
    });
    authState.user = null;
    authState.role = null;
    authState.status = null;
    authState.signOut = vi.fn();
  });

  it('renders the CTA card with title, copy and action', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getByText('Join ATANY Today')).toBeInTheDocument());
    expect(screen.getByText('Create a customer account and start your journey to owning timeless beauty.')).toBeInTheDocument();
    expect(screen.getByText('Get Started Now')).toBeInTheDocument();
  });

  it('guest: Get Started Now routes to /signup', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getByText('Get Started Now')).toBeInTheDocument());
    expect(screen.getByText('Get Started Now').closest('a')).toHaveAttribute('href', '/signup');
    fireEvent.click(screen.getByText('Get Started Now'));
    await waitFor(() => expect(screen.getByTestId('signup-page')).toBeInTheDocument());
  });

  it('active customer: CTA goes to the customer portal, never back to signup', async () => {
    authState.user = { id: 'u1' };
    authState.role = 'customer';
    authState.status = 'active';
    renderLanding();
    await waitFor(() => expect(screen.getByText('Go to My Account')).toBeInTheDocument());
    expect(screen.getByText('Go to My Account').closest('a')).toHaveAttribute('href', '/customer');
    fireEvent.click(screen.getByText('Go to My Account'));
    await waitFor(() => expect(screen.getByTestId('customer-page')).toBeInTheDocument());
  });

  it('shop owner: CTA goes to the seller portal', async () => {
    authState.user = { id: 'u2' };
    authState.role = 'shop_owner';
    authState.status = 'active';
    renderLanding();
    await waitFor(() => expect(screen.getByText('Open Seller Portal')).toBeInTheDocument());
    expect(screen.getByText('Open Seller Portal').closest('a')).toHaveAttribute('href', '/shop');
  });

  it('admin: CTA goes to the admin portal', async () => {
    authState.user = { id: 'u3' };
    authState.role = 'admin';
    authState.status = 'active';
    renderLanding();
    await waitFor(() => expect(screen.getByText('Open Admin Portal')).toBeInTheDocument());
    expect(screen.getByText('Open Admin Portal').closest('a')).toHaveAttribute('href', '/admin');
  });

  it('suspended customer: CTA routes to the account-suspension notice', async () => {
    authState.user = { id: 'u4' };
    authState.role = 'customer';
    authState.status = 'suspended';
    renderLanding();
    await waitFor(() => expect(screen.getByText('View Account Status')).toBeInTheDocument());
    expect(screen.getByText('View Account Status').closest('a')).toHaveAttribute('href', '/account-suspended');
    fireEvent.click(screen.getByText('View Account Status'));
    await waitFor(() => expect(screen.getByTestId('suspended-page')).toBeInTheDocument());
  });
});

describe('Landing footer', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation((p) => {
      if (p === '/branches') return Promise.resolve(BRANCHES);
      if (p === '/api/auctions/live') return Promise.resolve([]);
      return Promise.resolve({});
    });
    authState.user = null;
    authState.role = null;
    authState.status = null;
    authState.signOut = vi.fn();
  });

  it('renders a semantic footer with the four approved columns', async () => {
    const { container } = renderLanding();
    await waitFor(() => expect(container.querySelector('footer.site-footer')).toBeInTheDocument());
    const labels = [...container.querySelectorAll('.footer-col')].map((c) => c.getAttribute('aria-label'));
    expect(labels).toEqual(['Quick Links', 'Account', 'Contact']);
    expect(container.querySelector('.footer-brand .footer-logo').textContent).toBe('ATANY');
  });

  it('ATANY brand links to /', async () => {
    const { container } = renderLanding();
    await waitFor(() => expect(container.querySelector('.footer-logo')).toBeInTheDocument());
    expect(container.querySelector('.footer-logo')).toHaveAttribute('href', '/');
  });

  it('Quick Links target the real landing sections', async () => {
    renderLanding();
    await waitFor(() => expect(footerLink('Live Auctions')).toBeTruthy());
    expect(footerLink('Live Auctions')).toHaveAttribute('href', '#auctions');
    expect(footerLink('Shop Jewelry')).toHaveAttribute('href', '#jewelry');
    expect(footerLink('How It Works')).toHaveAttribute('href', '#how-it-works');
  });

  it('Find a Branch and Branch locations both point at /branches', async () => {
    renderLanding();
    await waitFor(() => expect(footerLink('Find a Branch')).toBeTruthy());
    expect(footerLink('Find a Branch')).toHaveAttribute('href', '/branches');
    expect(footerLink('Branch locations')).toHaveAttribute('href', '/branches');
  });

  it('Find a Branch actually navigates to the public branch locator', async () => {
    renderLanding();
    await waitFor(() => expect(footerLink('Find a Branch')).toBeTruthy());
    fireEvent.click(footerLink('Find a Branch'));
    await waitFor(() => expect(screen.getByTestId('branches-page')).toBeInTheDocument());
  });

  it('guest Account column: Sign In -> /login, Create Account -> /signup', async () => {
    renderLanding();
    await waitFor(() => expect(footerLink('Sign In')).toBeTruthy());
    expect(footerLink('Sign In')).toHaveAttribute('href', '/login');
    expect(footerLink('Create Account')).toHaveAttribute('href', '/signup');
  });

  it('signed-in Account column points at the own portal instead of a login page', async () => {
    authState.user = { id: 'u1' };
    authState.role = 'customer';
    authState.status = 'active';
    renderLanding();
    await waitFor(() => expect(footerLink('My Account')).toBeTruthy());
    expect(footerLink('My Account')).toHaveAttribute('href', '/customer');
    expect(footerLink('Sign In')).toBeFalsy();
  });

  it('email links use real mailto addresses', async () => {
    renderLanding();
    await waitFor(() => expect(footerLink('hello@atany.ph')).toBeTruthy());
    expect(footerLink('hello@atany.ph')).toHaveAttribute('href', 'mailto:hello@atany.ph');
    expect(footerLink('support@atany.ph')).toHaveAttribute('href', 'mailto:support@atany.ph');
  });

  it('contact links carry decorative icons', async () => {
    const { container } = renderLanding();
    await waitFor(() => expect(container.querySelector('.site-footer')).toBeInTheDocument());
    expect(container.querySelector('a[href="mailto:hello@atany.ph"] svg')).toBeTruthy();
    expect(container.querySelector('a[href="/branches"] svg')).toBeTruthy();
  });

  it('no dead anchors: every footer link has an href and none is "#"', async () => {
    const { container } = renderLanding();
    await waitFor(() => expect(container.querySelector('.site-footer')).toBeInTheDocument());
    const links = [...container.querySelectorAll('.site-footer a')];
    expect(links.length).toBeGreaterThanOrEqual(9);
    links.forEach((a) => {
      expect(a.getAttribute('href')).toBeTruthy();
      expect(a.getAttribute('href')).not.toBe('#');
      expect(a.getAttribute('href')).not.toContain('javascript:');
    });
  });

  it('footer links are separate elements (no concatenated link text)', async () => {
    const { container } = renderLanding();
    await waitFor(() => expect(container.querySelector('.site-footer')).toBeInTheDocument());
    const texts = [...container.querySelectorAll('.footer-col a')].map((a) => a.textContent.trim());
    expect(texts).toContain('Live Auctions');
    expect(texts).toContain('Shop Jewelry');
    expect(texts).toContain('How It Works');
    expect(texts).toContain('Find a Branch');
    texts.forEach((t) => expect(t).not.toMatch(/Live AuctionsShop Jewelry/));
  });

  it('legal row renders the current year and the pickup-only rule', async () => {
    const { container } = renderLanding();
    await waitFor(() => expect(container.querySelector('.footer-bottom')).toBeInTheDocument());
    const legal = container.querySelector('.footer-bottom').textContent;
    expect(legal).toContain(`© ${new Date().getFullYear()} ATANY. All rights reserved.`);
    expect(legal).toContain('Pickup-only · No delivery');
  });

  it('chatbot is still rendered on the landing page', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getByTestId('assistant-widget')).toBeInTheDocument());
  });
});

describe('Landing CTA + footer — layout contracts (source level)', () => {
  it('footer uses the 4-column desktop grid with the approved gaps', () => {
    expect(cssSrc).toMatch(/\.footer-main \{[^}]*grid-template-columns:\s*minmax\(240px, 1\.3fr\) minmax\(150px, \.9fr\) minmax\(140px, \.8fr\) minmax\(200px, 1fr\)/);
    expect(cssSrc).toMatch(/\.footer-main \{[^}]*column-gap:\s*64px/);
  });

  it('footer link groups are flex columns with a 10–12px gap', () => {
    expect(cssSrc).toMatch(/\.footer-col \{[^}]*display:\s*flex[^}]*flex-direction:\s*column/);
    expect(cssSrc).toMatch(/\.footer-col \{[^}]*gap:\s*11px/);
  });

  it('footer typography matches the approved scale', () => {
    expect(cssSrc).toMatch(/\.footer-logo \{[^}]*font-size:\s*22px[^}]*font-weight:\s*700/);
    expect(cssSrc).toMatch(/\.footer-col h3 \{[^}]*font-size:\s*17px[^}]*font-weight:\s*600/);
    expect(cssSrc).toMatch(/\.footer-col a \{[^}]*font-size:\s*14\.5px/);
    expect(cssSrc).toMatch(/\.footer-brand p \{[^}]*font-size:\s*14px[^}]*line-height:\s*1\.6/);
  });

  it('footer hover uses the ATANY gold with a ~180ms transition and a visible focus ring', () => {
    expect(cssSrc).toMatch(/\.footer-col a \{[^}]*transition:\s*color \.18s/);
    expect(cssSrc).toMatch(/\.footer-col a:hover \{ color: var\(--gold\); \}/);
    expect(cssSrc).toMatch(/\.footer-col a:focus-visible \{[^}]*outline:\s*2px solid var\(--gold\)/);
  });

  it('CTA card and button match the approved proportions', () => {
    expect(cssSrc).toMatch(/\.cta-box \{[^}]*background:\s*var\(--navy\)[^}]*border-radius:\s*18px[^}]*padding:\s*32px 36px/);
    expect(cssSrc).toMatch(/\.cta-box \{[^}]*align-items:\s*center[^}]*justify-content:\s*space-between/);
    expect(cssSrc).toMatch(/\.cta h2 \{[^}]*font-size:\s*28px/);
    expect(cssSrc).toMatch(/\.cta p \{[^}]*font-size:\s*14px/);
    expect(cssSrc).toMatch(/\.cta \.cta-action \{[^}]*min-width:\s*172px[^}]*height:\s*50px/);
    expect(cssSrc).toMatch(/\.cta \.cta-action \{[^}]*background:\s*var\(--ivory\)[^}]*color:\s*var\(--navy\)/);
  });

  it('footer stays a subtle neutral background (the CTA owns the navy)', () => {
    expect(cssSrc).toMatch(/\.site-footer \{[^}]*background:\s*var\(--soft\)/);
    expect(cssSrc).not.toMatch(/\.site-footer \{[^}]*background:\s*var\(--navy\)/);
  });

  it('the 4-column footer grid can never overflow its container', () => {
    const m = cssSrc.match(
      /\.footer-main \{[^}]*grid-template-columns:\s*minmax\((\d+)px, 1\.3fr\) minmax\((\d+)px, \.9fr\) minmax\((\d+)px, \.8fr\) minmax\((\d+)px, 1fr\)/
    );
    expect(m).toBeTruthy();
    const gap = Number(cssSrc.match(/\.footer-main \{[^}]*column-gap:\s*(\d+)px/)[1]);
    const minTotal = m.slice(1, 5).map(Number).reduce((a, b) => a + b, 0) + gap * 3;
    // The 4-column layout is used above the 2-column breakpoint (1024px).
    // It must fit: container = viewport - 40px gutters - ~15px scrollbar.
    expect(minTotal).toBeLessThanOrEqual(1025 - 40 - 15);
  });

  it('responsive: 2 columns <=1024px, 1 column <=640px, stacked CTA + legal row on mobile', () => {
    expect(cssSrc).toMatch(/@media \(max-width: 1024px\) \{[^@]*\.footer-main \{ grid-template-columns: 1fr 1fr;/);
    expect(cssSrc).toMatch(/@media \(max-width: 640px\) \{[^@]*\.footer-main \{ grid-template-columns: 1fr;/);
    expect(cssSrc).toMatch(/@media \(max-width: 640px\) \{[^@]*\.cta-box \{ flex-direction: column;/);
    expect(cssSrc).toMatch(/@media \(max-width: 640px\) \{[^@]*\.cta \.cta-action \{ width: 100%;/);
    expect(cssSrc).toMatch(/@media \(max-width: 640px\) \{[^@]*\.footer-bottom \{[^}]*flex-direction: column;/);
  });

  it('legal row keeps clear of the floating chatbot button', () => {
    expect(cssSrc).toMatch(/\.footer-bottom \{[^}]*padding-right:\s*88px/);
  });

  it('source contains no dead-link patterns in the CTA/footer', () => {
    const block = landingSrc.slice(landingSrc.indexOf('<section className="cta">'));
    expect(block).not.toMatch(/href="#"/);
    expect(block).not.toMatch(/to="#"/);
    expect(block).not.toMatch(/javascript:/);
    expect(block).not.toMatch(/onClick=\{\(\) => \{\}\}/);
    expect(block).not.toMatch(/TODO/);
  });
});
