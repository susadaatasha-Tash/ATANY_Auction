// frontend/src/roles/customer/pages/__tests__/BranchLocatorScroll.test.jsx
//
// PUBLIC BRANCH LOCATOR (/branches) — scroll/layout regression guard.
//
// Background: `body { overflow: hidden; height: 100% }` is a deliberate global
// lock for the app-shell portals (customer/seller/admin), whose layouts scroll
// internally. A standalone public page therefore has to unlock the document —
// which /branches did not, so everything below the fold was unreachable.
//
// These tests lock the CONTRACTS (markup, props, CSS). JSDOM has no layout
// engine and cannot prove real scrolling; that is verified in a real browser.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
const toast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toast }));

// The real Leaflet map is replaced with a stub that records the props the page
// hands it, so map behaviour can be asserted without a WebGL/canvas renderer.
const mapProps = [];
vi.mock('../../components/BranchMap', () => ({
  BranchMap: (props) => { mapProps.push(props); return <div data-testid="branch-map" />; },
}));

import BranchLocator from '../BranchLocator';

const BRANCHES = [
  { id: 'b1', name: 'Abreeza Branch', address: 'Abreeza Mall, JP Laurel Ave, Davao City', lat: 7.09, lng: 125.61, hours: 'Mon–Sun', phone: '(082) 221-5200', status: 'Open' },
  { id: 'b2', name: 'Gmall Branch', address: 'Gmall Davao, J.P. Laurel Ave, Davao City', lat: 7.07, lng: 125.61, hours: 'Mon–Sat', phone: '(082) 224-6500', status: 'Open' },
  { id: 'b3', name: 'SM Lanang Branch', address: 'SM City Lanang, JP Laurel Ave, Davao City', lat: 7.09, lng: 125.63, hours: 'Mon–Sun', phone: '(082) 222-5555', status: 'Open' },
];

const css = () => fs.readFileSync(path.join(__dirname, '../../../../index.css'), 'utf8');
const src = () => fs.readFileSync(path.join(__dirname, '../BranchLocator.jsx'), 'utf8');

function renderPage() {
  apiFetch.mockResolvedValue(BRANCHES);
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/', '/branches']}>
      <Routes>
        <Route path="/branches" element={<BranchLocator />} />
        <Route path="/" element={<div>Landing Page</div>} />
      </Routes>
    </MemoryRouter>
  );
  return user;
}

beforeEach(() => { apiFetch.mockReset(); mapProps.length = 0; toast.mockReset(); });
afterEach(() => cleanup());

describe('page structure', () => {
  it('1. renders a single <main class="locator-page"> wrapper with no fixed viewport lock', async () => {
    renderPage();
    const wrapper = document.querySelector('main.locator-page');
    expect(wrapper).toBeTruthy();
    // The wrapper itself must never pin itself to one viewport.
    expect(wrapper.style.height).toBe('');
    expect(wrapper.style.overflow).toBe('');
    expect(wrapper.style.maxHeight).toBe('');
    expect(wrapper.className).not.toMatch(/h-screen/);
  });

  it('2. the wrapper CSS uses min-height only — never height:100vh or a lock', () => {
    const block = css().slice(css().indexOf('.locator-page {'));
    const decl = block.slice(0, block.indexOf('}'));
    expect(decl).toMatch(/min-height: 100dvh/);
    expect(decl).not.toMatch(/(^|[\s;])height:\s*100/);
    expect(decl).not.toMatch(/max-height/);
    expect(decl).not.toMatch(/overflow/);
  });

  it('3. a scoped rule unlocks the document for this page only', () => {
    const s = css();
    expect(s).toMatch(/body:has\(#root > \.locator-page\)\s*\{[^}]*overflow-y: auto/);
    expect(s).toMatch(/body:has\(#root > \.locator-page\)\s*\{[^}]*height: auto/);
    expect(s).toMatch(/body:has\(#root > \.locator-page\) #root \{ height: auto/);
  });

  it('4. the unlock is scoped to a DIRECT child of #root (protects the portal)', () => {
    const s = css();
    const selectors = s.match(/body:has\(#root > \.locator-page\)[^{]*\{/g) || [];
    expect(selectors.length).toBeGreaterThan(0);
    // A descendant selector would also unlock the document inside the customer
    // shell at /customer/branch-locator and add a second scrollbar there.
    expect(s).not.toMatch(/body:has\(\.locator-page\)/);
    expect(s).not.toMatch(/body:has\(#root \.locator-page\)/);
  });

  it('5. the global body lock itself is left untouched for the app-shell portals', () => {
    const s = css();
    expect(s).toMatch(/body \{[\s\S]*?overflow: hidden;[\s\S]*?\}/);
    expect(s).toMatch(/#root \{ height: 100%; \}/);
  });
});

describe('single primary scroll owner', () => {
  it('6. the branch list is no longer a nested vertical scroller', () => {
    const s = css();
    const start = s.indexOf('.branch-list {');
    const decl = s.slice(start, s.indexOf('}', start));
    expect(decl).not.toMatch(/max-height/);
    expect(decl).not.toMatch(/overflow-y/);
    expect(decl).not.toMatch(/overflow:/);
  });

  it('7. the map panel cannot stretch with a long branch list', () => {
    const s = css();
    const start = s.indexOf('.map-panel {');
    const decl = s.slice(start, s.indexOf('}', start));
    expect(decl).toMatch(/align-self: start/);
  });

  it('8. the branch list has no inline height/overflow lock either', async () => {
    renderPage();
    const list = document.querySelector('.branch-list');
    expect(list.style.maxHeight).toBe('');
    expect(list.style.overflowY).toBe('');
    expect(list.style.overflow).toBe('');
  });
});

describe('map height and wheel behaviour', () => {
  it('9. the map canvas height is delegated to CSS on this page', () => {
    const s = css();
    expect(s).toMatch(/\.locator-page \.branch-map__canvas \{ min-height: clamp\(520px, 68vh, 620px\); \}/);
    expect(s).toMatch(/@media \(max-width: 900px\) \{ \.locator-page \.branch-map__canvas \{ min-height: 380px; \} \}/);
    expect(s).toMatch(/@media \(max-width: 480px\) \{ \.locator-page \.branch-map__canvas \{ min-height: 320px; \} \}/);
  });

  it('10. no map height uses 100vh inside an already-tall page', () => {
    // Strip comments first — the prose explains why 100vh is banned.
    const s = css().replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = s.match(/[^{}]*branch-map__canvas[^{]*\{[^}]*\}/g) || [];
    expect(rules.length).toBeGreaterThan(0);
    rules.forEach((r) => expect(r).not.toMatch(/100vh/));
  });

  it('11. the page passes minHeight={null} so CSS owns the height', async () => {
    renderPage();
    await screen.findByText('Gmall Branch');
    expect(mapProps.at(-1).minHeight).toBeNull();
  });

  it('12. scroll-wheel zoom is disabled so the map cannot trap page scrolling', async () => {
    renderPage();
    await screen.findByText('Gmall Branch');
    expect(mapProps.at(-1).scrollWheelZoom).toBe(false);
    const mapSrc = fs.readFileSync(path.join(__dirname, '../../components/BranchMap.jsx'), 'utf8');
    expect(mapSrc).toMatch(/scrollWheelZoom = false/);
    expect(mapSrc).toMatch(/L\.map\(mapRef\.current, \{ scrollWheelZoom \}\)/);
  });

  it('13. other map interaction props are preserved', async () => {
    renderPage();
    await screen.findByText('Gmall Branch');
    const p = mapProps.at(-1);
    expect(p.branches).toHaveLength(3);
    expect(p.initialCenter).toEqual([7.07, 125.6]);
    expect(typeof p.onSelectBranch).toBe('function');
    expect(typeof p.onMapReady).toBe('function');
  });

  it('14. the map still renders on the page', async () => {
    renderPage();
    expect(await screen.findByTestId('branch-map')).toBeTruthy();
  });
});

describe('functionality is preserved', () => {
  it('15. the public fetch keeps { public: true }', async () => {
    renderPage();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/branches', { public: true }));
  });

  it('16. branch cards render the real database records', async () => {
    renderPage();
    expect(await screen.findByText('Abreeza Branch')).toBeTruthy();
    expect(screen.getByText('Gmall Branch')).toBeTruthy();
    expect(screen.getByText('SM Lanang Branch')).toBeTruthy();
    expect(document.querySelectorAll('.branch-card')).toHaveLength(3);
    // content is data-driven, not hardcoded
    expect(src()).not.toMatch(/Abreeza|Gmall|Lanang/);
  });

  it('17. search still filters the real branch records', async () => {
    const user = renderPage();
    const input = await screen.findByPlaceholderText(/search by city or branch name/i);
    await user.type(input, 'lanang');
    expect(screen.queryByText('Gmall Branch')).toBeNull();
    expect(screen.getByText('SM Lanang Branch')).toBeTruthy();
  });

  it('18. search matches address text too, and clears back', async () => {
    const user = renderPage();
    const input = await screen.findByPlaceholderText(/search by city or branch name/i);
    await user.type(input, 'Laurel');
    expect(document.querySelectorAll('.branch-card').length).toBe(3);
    await user.clear(input);
    expect(document.querySelectorAll('.branch-card')).toHaveLength(3);
  });

  it('19. Use My Location stays wired to the geolocation API', async () => {
    const user = renderPage();
    await screen.findByText('Gmall Branch');
    const getCurrentPosition = vi.fn();
    Object.defineProperty(window.navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    await user.click(screen.getByRole('button', { name: /use my location/i }));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('20. a denied geolocation shows a toast and does not break the page', async () => {
    const user = renderPage();
    await screen.findByText('Gmall Branch');
    Object.defineProperty(window.navigator, 'geolocation', {
      value: { getCurrentPosition: (_ok, err) => err({ code: 1, message: 'User denied Geolocation' }) },
      configurable: true,
    });
    await user.click(screen.getByRole('button', { name: /use my location/i }));
    expect(toast).toHaveBeenCalledWith('User denied Geolocation');
    // the page is still fully rendered afterwards
    expect(document.querySelectorAll('.branch-card')).toHaveLength(3);
  });

  it('21. the Back control is a real button that navigates', async () => {
    const user = renderPage();
    const back = await screen.findByRole('button', { name: /back/i });
    expect(back.tagName).toBe('BUTTON');
    await user.click(back);
    expect(await screen.findByText('Landing Page')).toBeTruthy();
  });

  it('22. the empty state still renders when nothing matches', async () => {
    const user = renderPage();
    const input = await screen.findByPlaceholderText(/search by city or branch name/i);
    await user.type(input, 'zzzz');
    expect(screen.getByText(/no branches match your search/i)).toBeTruthy();
  });

  it('23. selecting a branch still marks the card active', async () => {
    const user = renderPage();
    await screen.findByText('Gmall Branch');
    const cards = document.querySelectorAll('.branch-card');
    await user.click(cards[1]);
    expect(document.querySelectorAll('.branch-card.active')).toHaveLength(1);
  });
});

describe('responsive + a11y contracts', () => {
  it('24. the locator layout stacks to one column at tablet widths', () => {
    const s = css();
    expect(s).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.locator-layout \{ grid-template-columns: 1fr; \}/);
  });

  it('25. search and Back remain real focusable form controls', () => {
    renderPage();
    const input = document.querySelector('.search-box input');
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('placeholder')).toMatch(/search by city or branch name/i);
    expect(document.querySelector('.back-btn').tagName).toBe('BUTTON');
  });

  it('26. no sticky positioning was introduced on the locator', () => {
    const s = css();
    const rules = s.match(/[^{}]*(locator|branch-list|map-panel)[^{]*\{[^}]*\}/g) || [];
    rules.forEach((r) => expect(r).not.toMatch(/position:\s*sticky/));
    expect(src()).not.toMatch(/sticky/);
  });
});
