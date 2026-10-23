// frontend/src/pages/__tests__/LandingPage.test.jsx
// Public landing page: real branch/stats data, correct bid routing for
// guest / customer / staff / suspended account, and no fake business data.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const apiFetch = vi.fn();
vi.mock('../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));

const authState = { user: null, role: null, status: null, loading: false };
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => authState }));

vi.mock('../../shared/components/Toast', () => ({
  useToast: () => vi.fn(),
  ToastProvider: ({ children }) => children,
}));

vi.mock('../../shared/components/AssistantWidget', () => ({
  AssistantWidget: () => <div data-testid="assistant-widget" />,
}));

vi.mock('../../roles/customer/components/BranchMap', () => ({
  BranchMap: ({ branches }) => <div data-testid="branch-map">{(branches || []).map((b) => b.name).join(',')}</div>,
}));

import LandingPage from '../LandingPage';

const BRANCHES = [
  { id: 'b1', name: 'Abreeza Branch', address: 'Abreeza Mall, JP Laurel Ave, Davao City', hours: 'Mon–Sun · 10:00 AM – 9:00 PM', phone: '(082) 221-5200', status: 'Open', lat: 7.09144, lng: 125.61094 },
  { id: 'b2', name: 'Gmall Branch', address: 'Gmall Davao, J.P. Laurel Ave, Davao City', hours: 'Mon–Sat · 9:00 AM – 6:00 PM', phone: '(082) 224-6500', status: 'Open', lat: 7.07782, lng: 125.61413 },
  { id: 'b3', name: 'SM Ecoland', address: 'Ecoland Subdivision', hours: null, phone: null, status: 'Temporarily Closed', lat: 7.04917, lng: 125.58833 },
  { id: 'b4', name: 'SM Lanang Branch', address: 'SM City Lanang, JP Laurel Ave, Davao City', hours: 'Mon–Sun · 10:00 AM – 9:00 PM', phone: '(082) 285-1100', status: 'Open', lat: 7.0989, lng: 125.631 },
];

const STATS = { customers: 6, jewelryPieces: 25, completedAuctions: 25, branches: 3 };

const AUCTION = {
  id: 'auc-1', name: 'Gold Ring', shop_name: 'Golden Heritage', branch_name: 'Abreeza Branch',
  status: 'live', currentBid: 60000, minimum_bid_increment: 2000, bids: 2, img: 'x.jpg',
  endsInSec: 3600, startsInSec: 0, karat_weight: '18K',
};

function setupApi(overrides = {}) {
  apiFetch.mockImplementation((p) => {
    if (p === '/api/public/stats') return Promise.resolve(overrides.stats === null ? Promise.reject(new Error('boom')) : STATS);
    if (p === '/branches') return Promise.resolve(overrides.branches === null ? Promise.reject(new Error('boom')) : BRANCHES);
    if (p === '/api/auctions/live') return Promise.resolve(overrides.auctions === null ? Promise.reject(new Error('boom')) : [AUCTION]);
    return Promise.resolve([]);
  });
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<div data-testid="login-page">LOGIN PAGE</div>} />
        <Route path="/customer/auctions" element={<div data-testid="customer-auctions">CUSTOMER AUCTIONS</div>} />
        <Route path="/customer" element={<div data-testid="customer-page">CUSTOMER PAGE</div>} />
        <Route path="/shop" element={<div data-testid="shop-page">SHOP PAGE</div>} />
        <Route path="/admin" element={<div data-testid="admin-page">ADMIN PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Landing page — real public data', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    authState.user = null;
    authState.role = null;
    authState.status = null;
    authState.loading = false;
    setupApi();
  });

  it('renders real statistics from /api/public/stats (no hardcoded 2,450 / 1,250 / 320 / 98%)', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getByText('Registered Customers')).toBeInTheDocument());
    // 6 customers, 25 pieces, 25 completed auctions, 3 branches (25 appears twice)
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getAllByText('25').length).toBe(2);
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Registered Customers')).toBeInTheDocument();
    expect(screen.getByText('Jewelry Pieces')).toBeInTheDocument();
    expect(screen.getByText('Completed Auctions')).toBeInTheDocument();
    expect(screen.getByText('ATANY Branches')).toBeInTheDocument();
    expect(screen.queryByText('2,450+')).not.toBeInTheDocument();
    expect(screen.queryByText('1,250+')).not.toBeInTheDocument();
    expect(screen.queryByText('320+')).not.toBeInTheDocument();
    expect(screen.queryByText('98%')).not.toBeInTheDocument();
    expect(screen.queryByText('Satisfaction Rate')).not.toBeInTheDocument();
  });

  it('stats error state shows "--" instead of fake values', async () => {
    setupApi({ stats: null });
    renderLanding();
    await waitFor(() => expect(screen.getAllByText('--').length).toBe(4));
    expect(screen.queryByText('2,450+')).not.toBeInTheDocument();
  });

  it('renders real branch data and removes fake Victoria Plaza / Cebu / Manila', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getAllByText('Abreeza Branch').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Abreeza Mall, JP Laurel Ave/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SM City Lanang, JP Laurel Ave/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Victoria Plaza Area/)).not.toBeInTheDocument();
    expect(screen.queryByText('Cebu')).not.toBeInTheDocument();
    expect(screen.queryByText('Manila')).not.toBeInTheDocument();
    expect(screen.queryByText('Davao City Branch')).not.toBeInTheDocument();
  });

  it('fetches branches and stats with the public option (anonymous access)', async () => {
    renderLanding();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/branches', { public: true }));
    expect(apiFetch).toHaveBeenCalledWith('/api/public/stats', { public: true });
    expect(apiFetch).toHaveBeenCalledWith('/api/auctions/live', { public: true });
  });

  it('featured branch map shows a real branch marker', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getByTestId('branch-map')).toBeInTheDocument());
    expect(screen.getByTestId('branch-map').textContent).toContain('Abreeza Branch');
  });

  it('Find a Branch links to the public /branches route', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getAllByText('Find a Branch').length).toBeGreaterThan(0));
    const link = screen.getAllByText('Find a Branch').find((el) => el.closest('a')?.getAttribute('href') === '/branches');
    expect(link).toBeTruthy();
  });

  it('View All Branches links to /branches', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getByText('View All Branches →')).toBeInTheDocument());
    expect(screen.getByText('View All Branches →').closest('a')).toHaveAttribute('href', '/branches');
  });

  it('footer location is a real link (no dead anchor)', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getByText('Branch locations')).toBeInTheDocument());
    const el = screen.getByText('Branch locations');
    expect(el.tagName).toBe('A');
    expect(el.closest('a')).toHaveAttribute('href', '/branches');
  });

  it('How It Works explains the 7-day payment window and fallback winner', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getAllByText('How It Works').length).toBeGreaterThan(0));
    expect(screen.getByText(/7 days to complete payment/i)).toBeInTheDocument();
    expect(screen.getByText(/next highest eligible bidder/i)).toBeInTheDocument();
    // No internal implementation detail leaks into public copy
    expect(screen.queryByText(/cron/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/winner_rank/i)).not.toBeInTheDocument();
  });

  it('certification image is a valid URL (previous one 404’d)', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getByAltText('Jewelry certification')).toBeInTheDocument());
    const src = screen.getByAltText('Jewelry certification').getAttribute('src');
    expect(src).toBeTruthy();
    expect(src).not.toContain('1586878341523');
    expect(src.startsWith('http')).toBe(true);
  });

  it('shows the official ATANY support address as a clickable mailto link', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getAllByText('goldjewelryauction@gmail.com').length).toBeGreaterThan(0));
    for (const el of screen.getAllByText('goldjewelryauction@gmail.com')) {
      expect(el.closest('a')).toHaveAttribute('href', 'mailto:goldjewelryauction@gmail.com');
    }
  });

  it('no outdated official support address remains in the landing page', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getAllByText('goldjewelryauction@gmail.com').length).toBeGreaterThan(0));
    for (const old of ['hello@atany.ph', 'support@atany.ph', 'partnerships@atany.ph']) {
      expect(screen.queryByText(old)).not.toBeInTheDocument();
    }
  });

  it('response-time copy does not promise a 1-business-day SLA', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getByText('Response Time')).toBeInTheDocument());
    expect(screen.queryByText(/within 1 business day/i)).not.toBeInTheDocument();
    expect(screen.getByText(/as soon as possible/i)).toBeInTheDocument();
  });

  it('featured auctions remain real records with minimum next bid shown', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());
    expect(screen.getByText(/Min\. increment ₱2,000/)).toBeInTheDocument();
    expect(screen.getByText(/Next bid ≥ ₱62,000/)).toBeInTheDocument();
  });

  it('auction load error keeps the rest of the page usable', async () => {
    setupApi({ auctions: null });
    renderLanding();
    await waitFor(() => expect(screen.getByText('Unable to load live auctions.')).toBeInTheDocument());
    expect(screen.getByText('Featured Auctions')).toBeInTheDocument();
  });
});

describe('Landing page — bid routing by role', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    setupApi();
  });

  it('guest Place Bid opens the login-required modal (not a dead /auction/:id link)', async () => {
    authState.user = null;
    renderLanding();
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Place Bid' }));
    await waitFor(() => expect(screen.getByText('Want to join the bid?')).toBeInTheDocument());
    const cta = screen.getByText('Login / Create Account').closest('a');
    const href = cta.getAttribute('href');
    expect(href).toContain('/login?redirect=');
    expect(decodeURIComponent(href)).toContain('/customer/auctions?auction=auc-1');
    expect(href).not.toContain('/auction/auc-1');
  });

  it('active customer Place Bid goes straight to the real auction route', async () => {
    authState.user = { id: 'u1' };
    authState.role = 'customer';
    authState.status = 'active';
    renderLanding();
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Place Bid' }));
    await waitFor(() => expect(screen.getByTestId('customer-auctions')).toBeInTheDocument());
    expect(screen.queryByText('Want to join the bid?')).not.toBeInTheDocument();
    expect(screen.queryByText('Sign In to Bid')).not.toBeInTheDocument();
  });

  it('signed-in customer is never told to sign in to bid', async () => {
    authState.user = { id: 'u1' };
    authState.role = 'customer';
    authState.status = 'active';
    renderLanding();
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());
    expect(screen.queryByText('Sign In to Bid')).not.toBeInTheDocument();
  });

  it('suspended customer cannot bid (button disabled)', async () => {
    authState.user = { id: 'u1' };
    authState.role = 'customer';
    authState.status = 'suspended';
    renderLanding();
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());
    const btn = screen.getByRole('button', { name: 'Place Bid' });
    expect(btn).toBeDisabled();
  });

  it('shop owner Place Bid does not open a customer bidding flow', async () => {
    authState.user = { id: 'u2' };
    authState.role = 'shop_owner';
    authState.status = 'active';
    renderLanding();
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Place Bid' }));
    await waitFor(() => expect(screen.getByTestId('shop-page')).toBeInTheDocument());
    expect(screen.queryByText('Want to join the bid?')).not.toBeInTheDocument();
  });

  it('admin Place Bid routes to the admin portal', async () => {
    authState.user = { id: 'u3' };
    authState.role = 'admin';
    authState.status = 'active';
    renderLanding();
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Place Bid' }));
    await waitFor(() => expect(screen.getByTestId('admin-page')).toBeInTheDocument());
  });

  it('guest category cards route through login with a category redirect', async () => {
    authState.user = null;
    renderLanding();
    await waitFor(() => expect(screen.getByText('Rings')).toBeInTheDocument());
    const href = screen.getByText('Rings').closest('a').getAttribute('href');
    expect(href).toContain('/login?redirect=');
    expect(decodeURIComponent(href)).toContain('/customer/auctions?category=Rings');
  });

  it('active customer category cards go directly to the auctions page', async () => {
    authState.user = { id: 'u1' };
    authState.role = 'customer';
    authState.status = 'active';
    renderLanding();
    await waitFor(() => expect(screen.getByText('Rings')).toBeInTheDocument());
    expect(screen.getByText('Rings').closest('a').getAttribute('href')).toBe('/customer/auctions?category=Rings');
  });
});
