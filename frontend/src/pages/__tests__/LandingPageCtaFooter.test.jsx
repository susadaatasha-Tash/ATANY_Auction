// frontend/src/pages/__tests__/LandingPageCtaFooter.test.jsx
//
// CTA + FOOTER — real actions, real routes, no dead controls.
//
// What this locks in (each item is an acceptance criterion):
//   · the CTA renders and "Get Started Now" is a real router <Link>
//   · CTA routing is role-aware: guest → /signup, customer → /customer,
//     shop_owner → /shop, admin → /admin, suspended → /account-suspended
//   · every Quick Link / Account / Contact link has a real href
//   · section links use the real landing hashes, never invented routes
//   · emails are mailto:, branch locations point at the public /branches
//   · the dead /customer/branches route is never referenced
//   · no footer anchor is missing an href, and none uses href="#"
//   · link groups are separate elements (no concatenated "Live AuctionsShop Jewelry")
//   · legal row renders the current year and the pickup-only rule
//   · the chatbot still renders
//   · the responsive footer class contracts exist in CSS

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const apiFetch = vi.fn();
vi.mock('../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock('../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));
vi.mock('../../shared/components/PublicHeader', () => ({ PublicHeader: () => <header data-testid="header" /> }));
vi.mock('../../shared/components/AssistantWidget', () => ({
  AssistantWidget: () => <button data-testid="chatbot">chat</button>,
}));
vi.mock('../../roles/customer/components/BranchMap', () => ({ BranchMap: () => <div data-testid="map" /> }));

let authValue = { user: null, role: null, status: null, suspended: false, loading: false };
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => authValue }));

import LandingPage from '../LandingPage';

function routeFetch() {
  return (path) => {
    if (path === '/api/public/stats') return Promise.resolve({ registeredCustomers: 5, jewelryPieces: 21, completedAuctions: 19, branches: 3 });
    if (path === '/branches') return Promise.resolve([]);
    if (path === '/api/auctions/live') return Promise.resolve([]);
    return Promise.resolve(null);
  };
}

async function renderPage() {
  apiFetch.mockImplementation(routeFetch());
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/signup" element={<div>Signup Page</div>} />
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/branches" element={<div>Branch Locator Page</div>} />
        <Route path="/customer" element={<div>Customer Portal</div>} />
        <Route path="/shop" element={<div>Shop Portal</div>} />
        <Route path="/admin" element={<div>Admin Portal</div>} />
        <Route path="/account-suspended" element={<div>Suspended Page</div>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(apiFetch).toHaveBeenCalled());
  return user;
}

beforeEach(() => {
  apiFetch.mockReset();
  authValue = { user: null, role: null, status: null, suspended: false, loading: false };
});
afterEach(() => cleanup());

const footer = () => document.querySelector('.site-footer');
const cta = () => document.querySelector('.cta-box');

describe('CTA', () => {
  it('1. renders the approved title, copy and action', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: /join atany today/i })).toBeTruthy();
    expect(screen.getByText(/start your journey to owning timeless beauty/i)).toBeTruthy();
    expect(within(cta()).getByRole('link', { name: /get started now/i })).toBeTruthy();
  });

  it('2. the action is a real router link, not a click-only element', async () => {
    await renderPage();
    const btn = within(cta()).getByRole('link', { name: /get started now/i });
    expect(btn.tagName).toBe('A');
    expect(btn.getAttribute('href')).toBeTruthy();
  });

  it('3. a guest is sent to the real customer signup route', async () => {
    const user = await renderPage();
    const btn = within(cta()).getByRole('link', { name: /get started now/i });
    expect(btn.getAttribute('href')).toBe('/signup');
    await user.click(btn);
    expect(await screen.findByText('Signup Page')).toBeTruthy();
  });

  it('4. an authenticated customer is NOT sent back to signup', async () => {
    authValue = { user: { id: 'c1' }, role: 'customer', status: 'active', suspended: false, loading: false };
    const user = await renderPage();
    const btn = within(cta()).getByRole('link', { name: /get started now/i });
    expect(btn.getAttribute('href')).toBe('/customer');
    await user.click(btn);
    expect(await screen.findByText('Customer Portal')).toBeTruthy();
  });

  it('5. a shop owner is sent to the seller portal', async () => {
    authValue = { user: { id: 's1' }, role: 'shop_owner', status: 'active', suspended: false, loading: false };
    const user = await renderPage();
    expect(screen.getByRole('link', { name: /get started now/i }).getAttribute('href')).toBe('/shop');
    await user.click(screen.getByRole('link', { name: /get started now/i }));
    expect(await screen.findByText('Shop Portal')).toBeTruthy();
  });

  it('6. an admin is sent to the admin portal', async () => {
    authValue = { user: { id: 'a1' }, role: 'admin', status: 'active', suspended: false, loading: false };
    const user = await renderPage();
    expect(screen.getByRole('link', { name: /get started now/i }).getAttribute('href')).toBe('/admin');
    await user.click(screen.getByRole('link', { name: /get started now/i }));
    expect(await screen.findByText('Admin Portal')).toBeTruthy();
  });

  it('7. a suspended customer cannot use the CTA to bypass /account-suspended', async () => {
    authValue = { user: { id: 'c1' }, role: 'customer', status: 'suspended', suspended: true, loading: false };
    const user = await renderPage();
    const btn = within(cta()).getByRole('link', { name: /get started now/i });
    expect(btn.getAttribute('href')).toBe('/account-suspended');
    expect(btn.getAttribute('href')).not.toBe('/signup');
    expect(btn.getAttribute('href')).not.toBe('/customer');
    await user.click(btn);
    expect(await screen.findByText('Suspended Page')).toBeTruthy();
  });
});

describe('footer structure', () => {
  it('8. renders a semantic footer with the four approved columns', async () => {
    await renderPage();
    const f = footer();
    expect(f.tagName).toBe('FOOTER');
    expect(within(f).getByRole('link', { name: 'ATANY' })).toBeTruthy();
    expect(within(f).getByText(/premier jewelry auction platform/i)).toBeTruthy();
    ['Quick Links', 'Account', 'Contact'].forEach((h) => {
      expect(within(f).getByRole('heading', { name: h })).toBeTruthy();
    });
  });

  it('9. no footer anchor is missing an href', async () => {
    await renderPage();
    const anchors = [...footer().querySelectorAll('a')];
    expect(anchors.length).toBeGreaterThan(0);
    anchors.forEach((a) => {
      expect(a.hasAttribute('href')).toBe(true);
      expect(a.getAttribute('href')).toBeTruthy();
    });
  });

  it('10. no placeholder destinations anywhere in the footer', async () => {
    await renderPage();
    const hrefs = [...footer().querySelectorAll('a')].map((a) => a.getAttribute('href'));
    ['#', '', 'javascript:void(0)', 'javascript:void', 'TODO'].forEach((bad) => {
      expect(hrefs).not.toContain(bad);
    });
    const html = footer().innerHTML;
    expect(html).not.toMatch(/href="#"/);
    expect(html).not.toMatch(/onClick=\{\(\)\s*=>\s*\{\s*\}\}/);
    expect(html).not.toMatch(/placeholder/i);
  });

  it('11. the previously dead /customer/branches route is never referenced', async () => {
    await renderPage();
    const html = footer().innerHTML + cta().outerHTML;
    expect(html).not.toContain('/customer/branches');
  });

  it('12. links are separate elements, never concatenated inline text', async () => {
    await renderPage();
    const quickLinks = [...footer().querySelectorAll('.footer-col')][0];
    const items = [...quickLinks.querySelectorAll('li a')];
    expect(items.map((a) => a.textContent.trim())).toEqual(['Live Auctions', 'Shop Jewelry', 'How It Works', 'Find a Branch']);
    // Each entry is its own <li> holding exactly one anchor, so the group can
    // never render as one run-together string.
    items.forEach((a) => {
      const li = a.closest('li');
      expect(li).toBeTruthy();
      expect(li.children).toHaveLength(1);
    });
    const lis = [...quickLinks.querySelectorAll(':scope > ul > li')];
    expect(lis).toHaveLength(4);
    lis.forEach((li) => expect(li.querySelectorAll('a')).toHaveLength(1));
  });
});

describe('footer links point at real destinations', () => {
  it('13. Live Auctions targets the real auctions section', async () => {
    await renderPage();
    expect(within(footer()).getByRole('link', { name: 'Live Auctions' }).getAttribute('href')).toBe('/#auctions');
  });

  it('14. Shop Jewelry targets the real jewelry section (no /jewelry route)', async () => {
    await renderPage();
    expect(within(footer()).getByRole('link', { name: 'Shop Jewelry' }).getAttribute('href')).toBe('/#jewelry');
    expect(footer().innerHTML).not.toContain('"/jewelry"');
  });

  it('15. How It Works targets the real section', async () => {
    await renderPage();
    expect(screen.getByRole('link', { name: 'How It Works' }).getAttribute('href')).toBe('/#how-it-works');
  });

  it('16. Find a Branch reaches the public branch locator', async () => {
    const user = await renderPage();
    const link = within(footer()).getByRole('link', { name: 'Find a Branch' });
    expect(link.getAttribute('href')).toBe('/branches');
    await user.click(link);
    expect(await screen.findByText('Branch Locator Page')).toBeTruthy();
  });

  it('17. Sign In reaches the real login page', async () => {
    const user = await renderPage();
    expect(within(footer()).getByRole('link', { name: 'Sign In' }).getAttribute('href')).toBe('/login');
    await user.click(within(footer()).getByRole('link', { name: 'Sign In' }));
    expect(await screen.findByText('Login Page')).toBeTruthy();
  });

  it('18. Create Account reaches the real signup page', async () => {
    const user = await renderPage();
    expect(within(footer()).getByRole('link', { name: 'Create Account' }).getAttribute('href')).toBe('/signup');
    await user.click(within(footer()).getByRole('link', { name: 'Create Account' }));
    expect(await screen.findByText('Signup Page')).toBeTruthy();
  });

  it('19. Branch locations reaches the same public locator', async () => {
    const user = await renderPage();
    const link = within(footer()).getByRole('link', { name: 'Branch locations' });
    expect(link.getAttribute('href')).toBe('/branches');
    await user.click(link);
    expect(await screen.findByText('Branch Locator Page')).toBeTruthy();
  });

  it('20. email links are real mailto links, not plain text or JS handlers', async () => {
    await renderPage();
    const f = footer();
    expect(within(f).getAllByRole('link', { name: 'goldjewelryauction@gmail.com' }).length).toBeGreaterThan(0);
    within(f).getAllByRole('link', { name: 'goldjewelryauction@gmail.com' }).forEach((l) => {
      expect(l.getAttribute('href')).toBe('mailto:goldjewelryauction@gmail.com');
    });
    // the retired general/support addresses must no longer be advertised
    expect(f.innerHTML).not.toContain('hello@atany.ph');
    expect(f.innerHTML).not.toContain('support@atany.ph');
    const mailtos = [...f.querySelectorAll('a[href^="mailto:"]')];
    mailtos.forEach((a) => expect(a.tagName).toBe('A'));
  });

  it('21. contact items each sit on their own row', async () => {
    await renderPage();
    const cols = [...footer().querySelectorAll('.footer-col')];
    const contact = cols[cols.length - 1];
    const rows = [...contact.querySelectorAll('li')];
    // General and Support share one mailbox, so they are ONE row (not two).
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent.trim()).toBe('goldjewelryauction@gmail.com');
    expect(rows[1].textContent.trim()).toBe('Branch locations');
    rows.forEach((li) => expect(li.querySelector('a')).toBeTruthy());
  });

  it('21b. the shared General/Support mailbox is listed exactly once', async () => {
    await renderPage();
    const gmail = [...footer().querySelectorAll('a[href^="mailto:"]')]
      .filter((a) => a.textContent.trim() === 'goldjewelryauction@gmail.com');
    expect(gmail).toHaveLength(1);
    expect(gmail[0].getAttribute('href')).toBe('mailto:goldjewelryauction@gmail.com');
  });

  it('21c. contact lists are keyed by stable semantic id, never by address', async () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../LandingPage.jsx'), 'utf8');
    expect(src).toMatch(/id: 'general-support-email'/);
    expect(src).toMatch(/id: 'branch-locations'/);
    expect(src).toMatch(/id: 'general-support'/);
    expect(src).toMatch(/id: 'partnerships'/);
    // the duplicate-key design: sibling keyed purely by a shared value
    expect(src).not.toMatch(/key=\{addr\}/);
    expect(src).not.toMatch(/key=\{email\}/);
    expect(src).not.toMatch(/key=\{index\}|key=\{i\}/);
  });
});

describe('legal row', () => {
  it('22. renders the current year and the pickup-only rule', async () => {
    await renderPage();
    const bottom = footer().querySelector('.footer-bottom');
    const year = new Date().getFullYear();
    expect(bottom.textContent).toContain(`© ${year} ATANY. All rights reserved.`);
    expect(bottom.textContent).toContain('Pickup-only');
    expect(bottom.textContent).toContain('No delivery');
    expect(bottom.querySelectorAll('span')).toHaveLength(2);
  });

  it('23. the year is computed, not a literal in the markup', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, '../LandingPage.jsx'), 'utf8');
    expect(src).toMatch(/new Date\(\)\.getFullYear\(\)/);
    expect(src).not.toMatch(/&copy; 20\d\d ATANY/);
  });
});

describe('chatbot is preserved', () => {
  it('24. the assistant widget still renders alongside the new footer', async () => {
    await renderPage();
    expect(screen.getByTestId('chatbot')).toBeTruthy();
  });
});

describe('responsive + accessibility contracts', () => {
  it('25. footer columns use a real grid and the footer carries its class', async () => {
    await renderPage();
    // The previous markup shipped a bare <footer> with no class, which made every
    // `.footer h3` / `.footer a` rule dead and collapsed the link groups inline.
    expect(footer().classList.contains('site-footer')).toBe(true);
    expect(footer().querySelector('.footer-main')).toBeTruthy();
  });

  it('26. CSS declares the 4 / 2 / 1 column footer breakpoints', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const css = fs.readFileSync(path.join(__dirname, '../../index.css'), 'utf8');
    expect(css).toMatch(/\.footer-main\s*\{[^}]*grid-template-columns:\s*\n?\s*minmax\(260px, 1\.3fr\)/);
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.footer-main \{ grid-template-columns: 1fr 1fr/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.footer-main \{ grid-template-columns: 1fr;/);
  });

  it('27. CSS stacks the CTA and widens its button on small screens', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const css = fs.readFileSync(path.join(__dirname, '../../index.css'), 'utf8');
    const block = css.slice(css.indexOf('@media (max-width: 640px)'));
    expect(block).toMatch(/\.cta-box \{[^}]*flex-direction: column/);
    expect(block).toMatch(/\.cta-btn \{ width: 100%/);
  });

  it('28. focus styles are preserved for keyboard users', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const css = fs.readFileSync(path.join(__dirname, '../../index.css'), 'utf8');
    expect(css).toMatch(/\.cta-btn:focus-visible/);
    expect(css).toMatch(/\.footer-list a:focus-visible/);
    expect(css).not.toMatch(/\.site-footer[^{]*\{[^}]*outline:\s*none/);
  });

  it('29. link groups use nav/list semantics', async () => {
    await renderPage();
    const navs = [...footer().querySelectorAll('nav')];
    expect(navs.length).toBeGreaterThanOrEqual(2);
    navs.forEach((n) => expect(n.getAttribute('aria-label')).toBeTruthy());
    expect(footer().querySelectorAll('ul.footer-list').length).toBeGreaterThanOrEqual(3);
  });
});
