// frontend/src/pages/__tests__/LandingPageRealData.test.jsx
//
// LANDING PAGE — real data, real routes, honest states.
//
// What this locks in (each item was a confirmed audit finding):
//   · statistics come from GET /api/public/stats, never invented numbers
//   · a failed stats request shows "—", never a fake total
//   · "Find a Branch" goes to the PUBLIC /branches route
//   · branch blocks render REAL branch data; the fictional Cebu/Manila rows are gone
//   · a guest "Place Bid" redirects to the REAL auction route after login
//   · an active customer is sent straight to the auction and is never told to sign in
//   · a suspended customer cannot bid from the landing page
//   · a seller/admin is not offered bidding
//   · the certification image actually loads
//   · Home is active on first paint
//   · the footer location is a real link, not a dead anchor
//   · How It Works explains the real 7-day payment rule

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const apiFetch = vi.fn();
vi.mock('../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
const toast = vi.fn();
vi.mock('../../shared/components/Toast', () => ({ useToast: () => toast }));
vi.mock('../../shared/components/PublicHeader', () => ({
  PublicHeader: () => <header data-testid="header" />,
}));
vi.mock('../../shared/components/AssistantWidget', () => ({ AssistantWidget: () => null }));
vi.mock('../../roles/customer/components/BranchMap', () => ({
  BranchMap: ({ branches }) => <div data-testid="branch-map">{branches.map((b) => b.name).join(',')}</div>,
}));

let authValue = { user: null, role: null, status: null, suspended: false, loading: false };
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => authValue }));

import LandingPage from '../LandingPage';

const BRANCHES = [
  { id: 'b1', name: 'Gmall Branch', address: 'Gmall Davao, J.P. Laurel Ave, Davao City', lat: 7.07, lng: 125.61, hours: 'Mon–Sat · 9:00 AM – 6:00 PM', phone: '(082) 224-6500', status: 'Open', branch_image_url: null },
  { id: 'b2', name: 'Abreeza Branch', address: 'Abreeza Mall, JP Laurel Ave, Davao City', lat: 7.09, lng: 125.61, hours: 'Mon–Sun · 10:00 AM – 9:00 PM', phone: '(082) 221-5200', status: 'Open', branch_image_url: null },
];

const STATS = { registeredCustomers: 5, jewelryPieces: 21, completedAuctions: 19, branches: 3, source: 'database' };

const AUCTION = {
  id: 'a1', name: 'Rose Gold Bangle', img: 'https://img/x.png', currentBid: 71000,
  minimum_bid_increment: 500, status: 'live', endsInSec: 3600, startsInSec: 0,
  shop_name: 'Golden Heritage — Gmall', branch_name: 'Gmall Branch', karat_weight: '14K 3.2g',
};

function routeFetch(overrides = {}) {
  return (path, opts = {}) => {
    if (path === '/api/public/stats') {
      if (overrides.statsError) return Promise.reject(new Error('stats down'));
      return Promise.resolve(overrides.stats || STATS);
    }
    if (path === '/branches') {
      if (overrides.branchesError) return Promise.reject(new Error('branches down'));
      return Promise.resolve(overrides.branches || BRANCHES);
    }
    if (path === '/api/auctions/live') {
      if (overrides.auctionsError) return Promise.reject(new Error('feed down'));
      return Promise.resolve(overrides.auctions || [AUCTION]);
    }
    if (path === '/api/public/contact') {
      if (overrides.contactError) return Promise.reject(new Error('contact down'));
      return Promise.resolve({ ok: true, id: 'sr-1' });
    }
    return Promise.reject(new Error(`unmocked ${path}`));
  };
}

async function renderPage(overrides = {}) {
  apiFetch.mockImplementation(routeFetch(overrides));
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/branches" element={<div>Branch Locator Page</div>} />
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/customer/auctions" element={<div>Customer Auctions</div>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(apiFetch).toHaveBeenCalled());
  return user;
}

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
  authValue = { user: null, role: null, status: null, suspended: false, loading: false };
});
afterEach(() => cleanup());

describe('statistics come from real data', () => {
  it('1. renders real database counts, not invented totals', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getAllByText('5').length).toBeGreaterThan(0));
    expect(screen.getByText('Registered Customers')).toBeTruthy();
    expect(screen.getByText('Jewelry Pieces')).toBeTruthy();
    expect(screen.getByText('Completed Auctions')).toBeTruthy();
    expect(screen.getByText('ATANY Branches')).toBeTruthy();
    expect(screen.getByText('21')).toBeTruthy();
  });

  it('2. no hardcoded marketing statistics remain', async () => {
    await renderPage();
    const body = document.body.textContent;
    ['2,450', '1,250', '320+', 'Satisfaction Rate', 'Happy Customers'].forEach((t) => {
      expect(body).not.toContain(t);
    });
  });

  it('3. a stats failure shows a dash, never a fake number', async () => {
    await renderPage({ statsError: true });
    await waitFor(() => expect(screen.getAllByText('—').length).toBe(4));
    expect(screen.queryByText('2,450')).toBeNull();
  });

  it('4. the stats request is public (no session required)', async () => {
    await renderPage();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/public/stats', { public: true }));
  });
});

describe('branch data is real and public', () => {
  it('5. the pickup section shows a real branch and a real map', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getAllByText('Gmall Branch').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/J\.P\. Laurel Ave/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\(082\) 224-6500/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('branch-map')).toBeTruthy();
  });

  it('6. the fictional Victoria Plaza / Cebu / Manila content is gone', async () => {
    await renderPage();
    const body = document.body.textContent;
    ['Victoria Plaza', 'Cebu', 'Manila', 'Ayala Center', 'Greenbelt', '(082) 123-4567', '(02) 8888-1234']
      .forEach((t) => expect(body).not.toContain(t));
  });

  it('7. the branch request is public', async () => {
    await renderPage();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/branches', { public: true }));
  });

  it('8. a branch failure degrades gracefully instead of showing fake data', async () => {
    await renderPage({ branchesError: true });
    await waitFor(() => expect(screen.getAllByText(/temporarily unavailable/i).length).toBeGreaterThan(0));
  });

  it('9. "Find a Branch" points at the PUBLIC /branches route', async () => {
    const user = await renderPage();
    const cta = screen.getAllByRole('link', { name: /find a branch/i })[0];
    expect(cta.getAttribute('href')).toBe('/branches');
    await user.click(cta);
    expect(await screen.findByText('Branch Locator Page')).toBeTruthy();
  });

  it('10. "View All Branches" also uses the public route', async () => {
    await renderPage();
    const link = screen.getByRole('link', { name: /view all branches/i });
    expect(link.getAttribute('href')).toBe('/branches');
  });
});

describe('auction bid flow', () => {
  it('11. a guest is redirected to login carrying the REAL auction route', async () => {
    const user = await renderPage();
    await screen.findByText('Rose Gold Bangle');
    await user.click(screen.getByRole('button', { name: /place bid/i }));
    const modal = await screen.findByRole('link', { name: /login \/ create account/i });
    const href = modal.getAttribute('href');
    expect(href).toBe(`/login?redirect=${encodeURIComponent('/customer/auctions?auction=a1')}`);
    expect(href).not.toContain('/auction/a1');
  });

  it('12. an active customer goes straight to the auction and is never asked to sign in', async () => {
    authValue = { user: { id: 'c1' }, role: 'customer', status: 'active', suspended: false, loading: false };
    const user = await renderPage();
    await screen.findByText('Rose Gold Bangle');
    await user.click(screen.getByRole('button', { name: /place bid/i }));
    expect(await screen.findByText('Customer Auctions')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sign in to bid/i })).toBeNull();
    expect(screen.queryByText(/sign in to bid/i)).toBeNull();
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('sign in'));
  });

  it('13. a suspended customer cannot bid from the landing page', async () => {
    authValue = { user: { id: 'c1' }, role: 'customer', status: 'suspended', suspended: true, loading: false };
    const user = await renderPage();
    await screen.findByText('Rose Gold Bangle');
    await user.click(screen.getByRole('button', { name: /place bid/i }));
    expect(screen.queryByText('Customer Auctions')).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/suspended/i));
  });

  it('14. a shop owner or admin is not offered a bidding path', async () => {
    for (const role of ['shop_owner', 'admin']) {
      authValue = { user: { id: 'x' }, role, status: 'active', suspended: false, loading: false };
      const user = await renderPage();
      await screen.findByText('Rose Gold Bangle');
      await user.click(screen.getByRole('button', { name: /place bid/i }));
      expect(screen.queryByText('Customer Auctions')).toBeNull();
      expect(toast).toHaveBeenCalledWith(expect.stringMatching(/customer account/i));
      cleanup();
    }
  });

  it('15. the card shows the server-driven minimum next bid', async () => {
    await renderPage();
    // 71,000 + 500 increment — exactly what the backend enforces
    expect(screen.getByText(/Min next bid: ₱71,500/)).toBeTruthy();
  });

  it('16. featured auctions remain backed by the real public feed', async () => {
    await renderPage();
    expect(apiFetch).toHaveBeenCalledWith('/api/auctions/live', { public: true });
    expect(screen.getByText('Rose Gold Bangle')).toBeTruthy();
  });

  it('17. the genuine empty state is preserved', async () => {
    await renderPage({ auctions: [] });
    expect(await screen.findByText(/No live auctions at the moment/i)).toBeTruthy();
  });

  it('18. category links send guests through login and customers straight to the filter', async () => {
    let user = await renderPage();
    const guestRing = screen.getAllByRole('link', { name: /Rings/i })[0];
    expect(guestRing.getAttribute('href')).toBe(`/login?redirect=${encodeURIComponent('/customer/auctions?category=Rings')}`);
    cleanup();

    authValue = { user: { id: 'c1' }, role: 'customer', status: 'active', suspended: false, loading: false };
    user = await renderPage();
    const memberRing = screen.getAllByRole('link', { name: /Rings/i })[0];
    expect(memberRing.getAttribute('href')).toBe('/customer/auctions?category=Rings');
  });
});

describe('content accuracy', () => {
  it('19. the certification image actually loads', async () => {
    await renderPage();
    const img = document.querySelector('img[alt="Jewelry being inspected before it is listed"]');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).not.toContain('photo-1586878341523'); // the 404 id
    expect(img.getAttribute('src')).toMatch(/^https:\/\//);
  });

  it('20. How It Works states the real 7-day payment rule', async () => {
    await renderPage();
    const section = document.getElementById('how-it-works');
    const text = section.textContent;
    expect(text).toMatch(/7 days/i);
    expect(text).toMatch(/next highest eligible bidder/i);
    expect(text).not.toMatch(/cron/i);
  });

  it('21. certification claims no longer promise records ATANY does not store', async () => {
    await renderPage();
    const body = document.body.textContent;
    expect(body).not.toMatch(/Every Piece Certified/);
    expect(body).toMatch(/Karat & Weight Recorded/);
  });

  it('22. the email panel is clickable mailto', async () => {
    await renderPage();
    ['goldjewelryauction@gmail.com', 'partnerships@atany.ph'].forEach((a) => {
      const links = screen.getAllByRole('link', { name: a });
      expect(links.length).toBeGreaterThan(0);
      links.forEach((l) => expect(l.getAttribute('href')).toBe(`mailto:${a}`));
    });
    // General + Support resolve to one mailbox: it must appear once in the panel,
    // under a combined label, never duplicated.
    const panel = [...document.querySelectorAll('#contact a[href^="mailto:"]')];
    const gmailRows = panel.filter((a) => a.textContent.trim() === 'goldjewelryauction@gmail.com');
    expect(gmailRows).toHaveLength(1);
    expect(gmailRows[0].parentElement.textContent.replace(/\s+/g, ' ')).toMatch(/General & Support:/);
    // retired addresses gone; the live destination is present
    const body = document.body.textContent;
    expect(body).not.toContain('hello@atany.ph');
    expect(body).not.toContain('support@atany.ph');
    expect(body).toContain('goldjewelryauction@gmail.com');
  });

  it('23. the footer location is a real link, not a dead anchor', async () => {
    await renderPage();
    const link = screen.getByRole('link', { name: /branch locations/i });
    expect(link.getAttribute('href')).toBe('/branches');
    expect(document.querySelectorAll('footer a:not([href])')).toHaveLength(0);
  });
});

describe('contact form still works', () => {
  it('24. submits through the backend endpoint', async () => {
    const user = await renderPage();
    const form = document.querySelector('#contact form');
    const inputs = form.querySelectorAll('input');
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(inputs[0], 'Maria Santos');
    set(inputs[1], 'maria@example.com');
    set(form.querySelector('textarea'), 'A question about a bid.');
    await user.click(form.querySelector('button[type=submit]'));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/public/contact',
      expect.objectContaining({ method: 'POST', public: true })
    ));
    const body = JSON.parse(apiFetch.mock.calls.find(([p]) => p === '/api/public/contact')[1].body);
    expect(body).toMatchObject({ name: 'Maria Santos', email: 'maria@example.com', subject: 'General Inquiry' });
    expect(await screen.findByText(/Message Received/i)).toBeTruthy();
  });

  it('25. a submit failure keeps the form usable and explains itself', async () => {
    const user = await renderPage({ contactError: true });
    const form = document.querySelector('#contact form');
    const inputs = form.querySelectorAll('input');
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(inputs[0], 'Maria Santos');
    set(inputs[1], 'maria@example.com');
    set(form.querySelector('textarea'), 'A question about a bid.');
    await user.click(form.querySelector('button[type=submit]'));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(screen.queryByText(/Message Received/i)).toBeNull();
    expect(document.querySelector('#contact form')).toBeTruthy();
  });
});

describe('navigation polish', () => {
  it('26. the dead /customer/branches route is no longer referenced', async () => {
    await renderPage();
    expect(document.body.innerHTML).not.toContain('/customer/branches');
  });

  it('27. landing sections declare a sticky-header scroll offset', async () => {
    // CSS contract (asserted on source so a regression is visible in CI)
    const fs = await import('node:fs');
    const path = await import('node:path');
    const css = fs.readFileSync(path.join(__dirname, '../../index.css'), 'utf8');
    expect(css).toMatch(/main section\[id\]\s*\{\s*scroll-margin-top/);
  });

  it('28. Home is active on first paint without scrolling', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, '../LandingPage.jsx'), 'utf8');
    // the spy is invoked immediately on mount, not only on scroll
    expect(src).toMatch(/syncActive\(\);\s*\n\s*window\.addEventListener\('scroll'/);
  });
});