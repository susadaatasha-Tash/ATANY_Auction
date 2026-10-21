// frontend/src/roles/customer/pages/__tests__/BranchLocator.test.jsx
// Public Branch Locator (/branches):
//  - the page must be a normal scrolling document (no fixed-viewport lock)
//  - real branches from the public endpoint, search, geolocation, Back
//  - the map must not trap the page scroll (scrollWheelZoom off)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssSrc = fs.readFileSync(path.join(__dirname, '../../../../index.css'), 'utf8');

// Extracts a single CSS rule block by selector (first match, brace-balanced).
function cssBlock(selector, { containing } = {}) {
  let from = 0;
  for (;;) {
    const start = cssSrc.indexOf(selector, from);
    if (start === -1) return '';
    const open = cssSrc.indexOf('{', start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < cssSrc.length; i++) {
      if (cssSrc[i] === '{') depth++;
      else if (cssSrc[i] === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    const block = end === -1 ? '' : cssSrc.slice(start, end);
    if (!containing || block.includes(containing)) return block;
    from = start + selector.length;
  }
}

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));

const toastSpy = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toastSpy }));

const mapProps = [];
vi.mock('../../components/BranchMap', () => ({
  BranchMap: (props) => {
    mapProps.push(props);
    return <div data-testid="branch-map" />;
  },
}));

import BranchLocator from '../BranchLocator';

const BRANCHES = [
  { id: 'b1', name: 'Abreeza Branch', address: 'Abreeza Mall, JP Laurel Ave, Davao City', hours: 'Mon–Sun · 10:00 AM – 9:00 PM', phone: '(082) 221-5200', status: 'Open', lat: 7.09144, lng: 125.61094 },
  { id: 'b2', name: 'Gmall Branch', address: 'Gmall Davao, J.P. Laurel Ave, Davao City', hours: 'Mon–Sat · 9:00 AM – 6:00 PM', phone: '(082) 224-6500', status: 'Open', lat: 7.07782, lng: 125.61413 },
  { id: 'b3', name: 'SM Lanang Branch', address: 'SM City Lanang, JP Laurel Ave, Davao City', hours: 'Mon–Sun · 10:00 AM – 9:00 PM', phone: '(082) 285-1100', status: 'Open', lat: 7.0989, lng: 125.631 },
];

function renderLocator() {
  // Two history entries so the Back button (navigate(-1)) has a target.
  return render(
    <MemoryRouter initialEntries={['/', '/branches']}>
      <Routes>
        <Route path="/branches" element={<BranchLocator />} />
        <Route path="/" element={<div data-testid="home-page">HOME</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Branch Locator — public data + functionality', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    toastSpy.mockReset();
    mapProps.length = 0;
    apiFetch.mockResolvedValue(BRANCHES);
  });

  it('fetches branches from the public endpoint with { public: true }', async () => {
    renderLocator();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/branches', { public: true }));
  });

  it('renders a card for every real branch returned by the API', async () => {
    renderLocator();
    await waitFor(() => expect(screen.getByText('Abreeza Branch')).toBeInTheDocument());
    expect(screen.getByText('Gmall Branch')).toBeInTheDocument();
    expect(screen.getByText('SM Lanang Branch')).toBeInTheDocument();
    expect(screen.getByText(/Abreeza Mall, JP Laurel Ave/)).toBeInTheDocument();
    expect(screen.getByText('(082) 221-5200')).toBeInTheDocument();
  });

  it('renders the BranchMap component', async () => {
    renderLocator();
    await waitFor(() => expect(screen.getByTestId('branch-map')).toBeInTheDocument());
  });

  it('passes scrollWheelZoom={false} so the map never traps the page scroll', async () => {
    renderLocator();
    await waitFor(() => expect(screen.getByTestId('branch-map')).toBeInTheDocument());
    expect(mapProps[0].scrollWheelZoom).toBe(false);
  });

  it('search filters real branch records and restores them when cleared', async () => {
    renderLocator();
    await waitFor(() => expect(screen.getByText('Abreeza Branch')).toBeInTheDocument());
    const search = screen.getByPlaceholderText(/Search by city or branch name/);

    fireEvent.change(search, { target: { value: 'lanang' } });
    await waitFor(() => expect(screen.queryByText('Abreeza Branch')).not.toBeInTheDocument());
    expect(screen.getByText('SM Lanang Branch')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'zzzz' } });
    await waitFor(() => expect(screen.getByText(/No branches match your search/)).toBeInTheDocument());

    fireEvent.change(search, { target: { value: '' } });
    await waitFor(() => expect(screen.getByText('Abreeza Branch')).toBeInTheDocument());
  });

  it('Use My Location stays wired and surfaces a denied-permission message', async () => {
    const err = Object.assign(new Error('User denied Geolocation'), { code: 1 });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok, fail) => fail(err) },
    });
    renderLocator();
    await waitFor(() => expect(screen.getByText('Abreeza Branch')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Use My Location/ }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('User denied Geolocation'));
  });

  it('Back button navigates back in history', async () => {
    renderLocator();
    await waitFor(() => expect(screen.getByText('Abreeza Branch')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    await waitFor(() => expect(screen.getByTestId('home-page')).toBeInTheDocument());
  });
});

describe('Branch Locator — scroll/layout contract (source level)', () => {
  it('page wrapper uses min-height, never a fixed viewport height', () => {
    const block = cssBlock('.locator-page {');
    expect(block).toMatch(/min-height:\s*100dvh/);
    // a bare `height:` (not min-height) of a viewport unit would clip content
    expect(block).not.toMatch(/(?<![-\w])height:\s*100vh/);
    expect(block).not.toMatch(/(?<![-\w])height:\s*100dvh/);
    expect(block).toMatch(/(?<![-\w])height:\s*auto/);
  });

  it('the public locator opts out of the app shell body overflow lock', () => {
    expect(cssSrc).toContain('body:has(#root > .locator-page)');
    expect(cssSrc).toMatch(/body:has\(#root > \.locator-page\)[^}]*overflow-y:\s*auto/);
    expect(cssSrc).toMatch(/body:has\(#root > \.locator-page\) #root[^}]*height:\s*auto/);
  });

  it('the global body scroll lock is left intact for the dashboards', () => {
    const bodyRule = cssBlock('body {', { containing: 'overflow: hidden' });
    expect(bodyRule).toMatch(/overflow:\s*hidden/);
    expect(bodyRule).toMatch(/height:\s*100%/);
  });

  it('branch list grows with the page instead of scrolling internally', () => {
    const block = cssBlock('.branch-list {');
    expect(block).not.toMatch(/overflow-y:\s*auto/);
    expect(block).not.toMatch(/max-height:\s*\d/);
    // the dashboard shell keeps its own bounded list scroll
    expect(cssBlock('.app .branch-list {')).toMatch(/max-height:\s*620px/);
    expect(cssBlock('.app .branch-list {')).toMatch(/overflow-y:\s*auto/);
  });

  it('locator columns align at the top and the map keeps a finite height', () => {
    const block = cssBlock('.locator-layout {');
    expect(block).toMatch(/align-items:\s*start/);
    // map height is driven by a CSS custom property so media queries can shrink it
    expect(cssSrc).toContain('--branch-map-min-h');
    expect(cssBlock('.branch-map-canvas {')).toMatch(/min-height:\s*var\(--branch-map-min-h/);
    // a finite mobile height for the stacked layout
    expect(cssSrc).toMatch(/\.locator-page \.branch-map-canvas,/);
    expect(cssSrc).toMatch(/\.locator-page \.map-loading \{ min-height: 380px; \}/);
  });
});
