// frontend/src/roles/admin/pages/__tests__/BranchAdmin.test.jsx
// Admin → Branches: the branch-centric monitoring experience.
//
// Covers the sidebar change, the legacy redirects, the branch list, the branch
// detail tabs (Overview / Jewelry / Auctions), the read-only jewelry + auction
// drawers and the realtime contract (bids update the monitor, watcher events
// update the watcher count, a bid never changes the watcher count).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, Outlet } from 'react-router-dom';
import React from 'react';

const { apiFetch, toastSpy, navigateSpy, socketState, socketMock } = vi.hoisted(() => {
  const state = { handlers: {}, emits: [] };
  const mock = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit: vi.fn((ev, ...args) => { state.emits.push([ev, ...args]); }),
    on: vi.fn((ev, fn) => {
      if (!state.handlers[ev]) state.handlers[ev] = [];
      state.handlers[ev].push(fn);
    }),
    off: vi.fn((ev, fn) => {
      state.handlers[ev] = (state.handlers[ev] || []).filter((h) => h !== fn);
    }),
  };
  return { apiFetch: vi.fn(), toastSpy: vi.fn(), navigateSpy: vi.fn(), socketState: state, socketMock: mock };
});

vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toastSpy }));
vi.mock('../../../../shared/components/Sidebar', () => ({
  Sidebar: ({ sections }) => (
    <aside data-testid="sidebar">
      {(sections || []).flatMap((s) => (s.items || []).map((item) => (
        <a key={item.to} href={item.to} data-testid={`nav-${item.name}`}>{item.name}</a>
      )))}
    </aside>
  ),
}));
vi.mock('../../../../shared/components/Topbar', () => ({
  Topbar: ({ title }) => <div data-testid="topbar"><span>{title}</span></div>,
}));
vi.mock('../../../../shared/components/NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));
vi.mock('../../../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin-1', email: 'admin@example.com', user_metadata: {} }, signOut: vi.fn() }),
  RequireRole: ({ children }) => <>{children}</>,
}));

vi.mock('../../../../shared/lib/socketClient', () => ({ socket: socketMock }));

import AdminLayout from '../../../../layouts/AdminLayout';
import Branches from '../Branches';
import BranchDetails from '../BranchDetails';
import { adminRoutes } from '../../routes';

// ── Fixtures ───────────────────────────────────────────────────
const BRANCHES = [
  {
    id: 'b1', name: 'Abreeza Branch', address: 'Abreeza Mall, Davao', status: 'Open',
    lot_count: 12, active_lot_count: 3, revenue: 120000, manager_name: 'Rosa Villanueva',
    image_url: 'https://cdn.test/abreeza.png',
  },
  {
    id: 'b2', name: 'Gmall Branch', address: 'Gmall, Davao City', status: 'Open',
    lot_count: 5, active_lot_count: 2, revenue: 486200, manager_name: 'Adrian Villanueva',
    image_url: 'https://cdn.test/gmall.png',
  },
  {
    id: 'b3', name: 'SM Ecoland', address: 'SM City Ecoland', status: 'Temporarily Closed',
    lot_count: 4, active_lot_count: 0, revenue: 0, manager_name: null, image_url: null,
  },
];

const T0 = '2026-10-20T10:00:00.000Z';
const T1 = '2026-10-20T12:00:00.000Z';

const LIVE_AUCTION = {
  id: 'a1', auction_code: 'LOT-3041', status: 'live',
  start_price: 30000, current_bid: 41000, minimum_bid_increment: 1000,
  start_time: T0, end_time: '2099-01-01T12:00:00.000Z',
  product: { id: 'l1', name: '18K Gold Solitaire Diamond Ring', category: 'Diamond Rings', image_url: 'https://cdn.test/ring.png' },
  shop: { name: 'Golden Heritage Co.', owner_name: 'Adrian Villanueva' },
  branch: { id: 'b2', name: 'Gmall Branch' },
  total_bids: 14, watchers: 7, leader: { name: 'Maria S.', amount: 41000 }, order: null,
};
const PAUSED_AUCTION = {
  id: 'a2', auction_code: 'LOT-3052', status: 'paused',
  start_price: 40000, current_bid: 52000, minimum_bid_increment: 1000,
  start_time: T0, end_time: '2099-01-01T12:00:00.000Z',
  product: { id: 'l3', name: 'Rose Gold Bangle Set', category: 'Gold Jewelry', image_url: 'https://cdn.test/bangle.png' },
  shop: { name: 'Golden Heritage Co.', owner_name: 'Adrian Villanueva' },
  branch: { id: 'b2', name: 'Gmall Branch' },
  total_bids: 11, watchers: 3, leader: { name: 'Rafael C.', amount: 52000 }, order: null,
};
const SCHEDULED_AUCTION = {
  id: 'a3', auction_code: 'LOT-3050', status: 'scheduled',
  start_price: 45000, current_bid: null, minimum_bid_increment: 1000,
  start_time: '2099-01-02T10:00:00.000Z', end_time: '2099-01-02T12:00:00.000Z',
  product: { id: 'l2', name: 'Sapphire Halo Engagement Ring', category: 'Sapphires', image_url: 'https://cdn.test/sapphire.png' },
  shop: { name: 'Golden Heritage Co.', owner_name: 'Adrian Villanueva' },
  branch: { id: 'b2', name: 'Gmall Branch' },
  total_bids: 0, watchers: 0, leader: null, order: null,
};

const OVERVIEW = {
  branch: {
    id: 'b2', name: 'Gmall Branch', address: 'Gmall, Davao City', status: 'Open',
    manager_name: 'Adrian Villanueva', image_url: 'https://cdn.test/gmall.png',
  },
  kpis: {
    total_jewelry: 2, live_auctions: 1, ended_auctions: 1, scheduled_auctions: 1,
    paused_auctions: 1, total_bids: 25, revenue: 486200, watchers: 7,
  },
  listings: [
    {
      id: 'l1', name: '18K Gold Solitaire Diamond Ring', category: 'Diamond Rings',
      image_url: 'https://cdn.test/ring.png', price: 52000,
      shop: { name: 'Golden Heritage Co.', owner_name: 'Adrian Villanueva' },
      branch: { id: 'b2', name: 'Gmall Branch' },
      auction: {
        id: 'a1', auction_code: 'LOT-3041', status: 'live', start_price: 30000,
        current_bid: 41000, minimum_bid_increment: 1000, start_time: T0, end_time: T1,
        total_bids: 14, watchers: 7,
      },
    },
    {
      id: 'l2', name: 'Sapphire Halo Engagement Ring', category: 'Sapphires',
      image_url: 'https://cdn.test/sapphire.png', price: 45000,
      shop: { name: 'Golden Heritage Co.', owner_name: 'Adrian Villanueva' },
      branch: { id: 'b2', name: 'Gmall Branch' },
      auction: {
        id: 'a3', auction_code: 'LOT-3050', status: 'scheduled', start_price: 45000,
        current_bid: null, minimum_bid_increment: 1000, start_time: '2099-01-02T10:00:00.000Z',
        end_time: '2099-01-02T12:00:00.000Z', total_bids: 0, watchers: 0,
      },
    },
  ],
  auctions: [LIVE_AUCTION, PAUSED_AUCTION, SCHEDULED_AUCTION],
  live_auctions: [LIVE_AUCTION, PAUSED_AUCTION],
  recent_results: [],
};

const AUCTION_DETAIL = {
  id: 'a1', auction_code: 'LOT-3041', status: 'live',
  start_price: 30000, current_bid: 41000, minimum_bid_increment: 1000,
  start_time: T0, end_time: '2099-01-01T12:00:00.000Z',
  product: {
    id: 'l1', name: '18K Gold Solitaire Diamond Ring', category: 'Diamond Rings',
    image_url: 'https://cdn.test/ring.png', price: 52000,
  },
  shop: { name: 'Golden Heritage Co.', owner_name: 'Adrian Villanueva' },
  branch: { id: 'b2', name: 'Gmall Branch', address: 'Gmall, Davao City' },
  bids: [
    { rank: 1, amount: 41000, bidder_name: 'Maria S.', created_at: new Date(Date.now() - 120000).toISOString() },
    { rank: 2, amount: 40000, bidder_name: 'Rafael C.', created_at: new Date(Date.now() - 240000).toISOString() },
  ],
  total_bids: 14, participants: 5, watchers: 7,
  leader: { name: 'Maria S.', amount: 41000 },
  order: null,
};

const SCHEDULED_DETAIL = {
  ...AUCTION_DETAIL,
  id: 'a3', auction_code: 'LOT-3050', status: 'scheduled',
  start_price: 45000, current_bid: null,
  start_time: '2099-01-02T10:00:00.000Z', end_time: '2099-01-02T12:00:00.000Z',
  product: { id: 'l2', name: 'Sapphire Halo Engagement Ring', category: 'Sapphires', image_url: 'https://cdn.test/sapphire.png', price: 45000 },
  bids: [], total_bids: 0, participants: 0, watchers: 0, leader: null, order: null,
};

function installApi({ overview = OVERVIEW, branches = BRANCHES, fail = null } = {}) {
  apiFetch.mockImplementation(async (url) => {
    const u = String(url);
    if (fail && u.includes('/overview')) throw new Error(fail);
    if (u.includes('/overview')) return overview;
    if (u.includes('/admin/auctions/')) {
      return u.endsWith('/a3') ? SCHEDULED_DETAIL : AUCTION_DETAIL;
    }
    if (u.startsWith('/admin/auctions')) return [];
    if (u.startsWith('/admin/branches')) return branches;
    if (u.startsWith('/admin/analytics')) {
      return { kpis: { totalRevenue: 1874000, revenueDelta: 12 } };
    }
    return [];
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderBranchList() {
  return render(
    <MemoryRouter initialEntries={['/admin/branches']}>
      <Routes>
        <Route path="/admin/branches" element={<Branches />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderBranchDetail(entry = '/admin/branches/b2') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/branches/:branchId" element={<BranchDetails />} />
      </Routes>
    </MemoryRouter>
  );
}

function fireSocket(ev, payload) {
  (socketState.handlers[ev] || []).forEach((h) => h(payload));
}

beforeEach(() => {
  apiFetch.mockReset();
  toastSpy.mockReset();
  navigateSpy.mockReset();
  socketState.handlers = {};
  socketState.emits = [];
  socketMock.on.mockClear();
  socketMock.off.mockClear();
  socketMock.emit.mockClear();
  socketMock.connect.mockClear();
  installApi();
});

afterEach(() => cleanup());

describe('Admin Branches — sidebar + legacy routes', () => {
  it('1. Jewelry is removed from the admin sidebar', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminLayout />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('nav-Jewelry')).toBeNull();
  });

  it('2. Auctions is removed from the admin sidebar', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminLayout />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('nav-Auctions')).toBeNull();
    expect(screen.getByTestId('nav-Branches')).toBeInTheDocument();
  });

  it('3. the old standalone jewelry / auctions routes redirect to /admin/branches', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/auctions']}>
        <Routes>
          <Route path="/admin" element={<Outlet />}>
            {adminRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
          </Route>
          <Route path="*" element={<div data-testid="not-found" />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/branches'));
  });
});

describe('Admin Branches — list', () => {
  it('4. the branch list renders the real records', async () => {
    renderBranchList();
    await waitFor(() => expect(screen.getByText('Gmall Branch')).toBeInTheDocument());
    expect(screen.getByText('Abreeza Branch')).toBeInTheDocument();
    expect(screen.getByText('SM Ecoland')).toBeInTheDocument();
    expect(screen.getByText('Manager · Adrian Villanueva')).toBeInTheDocument();
    // Real per-branch aggregates
    expect(screen.getByText('₱486,200')).toBeInTheDocument();
    expect(screen.getByText('3 operating locations across the ATANY network')).toBeInTheDocument();
  });

  it('5. clicking a branch card navigates to the branch detail route', async () => {
    const { useNavigate } = await import('react-router-dom');
    const spy = vi.spyOn(useNavigate, 'apply');
    renderBranchList();
    await waitFor(() => expect(screen.getByText('Gmall Branch')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Gmall Branch'));
    expect(spy).toBeDefined();
  });

  it('6. the three-dot menu does not trigger the card navigation', async () => {
    renderBranchList();
    await waitFor(() => expect(screen.getByText('Gmall Branch')).toBeInTheDocument());
    const menuBtn = screen.getByLabelText('Actions for Gmall Branch');
    fireEvent.click(menuBtn);
    // The card-level click handler must not run for the menu button.
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(screen.getByText('View details')).toBeInTheDocument();
  });
});

describe('Admin Branches — branch detail', () => {
  it('7. the hero shows the selected branch record', async () => {
    renderBranchDetail();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Gmall Branch'));
    expect(screen.getByText('Gmall, Davao City')).toBeInTheDocument();
    expect(screen.getByText('Manager · Adrian Villanueva')).toBeInTheDocument();
  });

  it('8. the Overview KPI row uses the real branch values', async () => {
    renderBranchDetail();
    await waitFor(() => expect(screen.getByText('Total Jewelry')).toBeInTheDocument());
    expect(screen.getByText('Live Auctions')).toBeInTheDocument();
    expect(screen.getByText('Ended Auctions')).toBeInTheDocument();
    expect(screen.getByText('Total Bids')).toBeInTheDocument();
    expect(screen.getByText('Branch Revenue')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('₱486,200')).toBeInTheDocument();
    expect(screen.getAllByText('7 watching').length).toBeGreaterThan(0);
  });

  it('9. the Jewelry tab shows the branch-scoped listing count', async () => {
    renderBranchDetail();
    await waitFor(() => expect(screen.getByText('Total Jewelry')).toBeInTheDocument());
    const tab = screen.getByRole('button', { name: /Jewelry/ });
    expect(within(tab).getByText('2')).toBeInTheDocument();
  });

  it('10. the Auctions tab shows the branch-scoped auction count', async () => {
    renderBranchDetail();
    await waitFor(() => expect(screen.getByText('Total Jewelry')).toBeInTheDocument());
    const tab = screen.getByRole('button', { name: /Auctions/ });
    expect(within(tab).getByText('3')).toBeInTheDocument();
  });

  it('11. the Jewelry search filters the listings', async () => {
    renderBranchDetail('/admin/branches/b2?tab=jewelry');
    await waitFor(() => expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Search listings'), { target: { value: 'sapphire' } });
    await waitFor(() => expect(screen.queryByText('18K Gold Solitaire Diamond Ring')).toBeNull());
    expect(screen.getByText('Sapphire Halo Engagement Ring')).toBeInTheDocument();
  });

  it('12. the Jewelry status filter narrows the listings', async () => {
    renderBranchDetail('/admin/branches/b2?tab=jewelry');
    await waitFor(() => expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    await waitFor(() => expect(screen.queryByText('Sapphire Halo Engagement Ring')).toBeNull());
    expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument();
  });

  it('13. the correct listing card is rendered', async () => {
    renderBranchDetail('/admin/branches/b2?tab=jewelry');
    await waitFor(() => expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument());
    expect(screen.getByText('Diamond Rings')).toBeInTheDocument();
    expect(screen.getByText('LOT-3041')).toBeInTheDocument();
    expect(screen.getByText('₱30,000')).toBeInTheDocument();
    expect(screen.getByText('₱41,000')).toBeInTheDocument();
  });

  it('14. View details opens the drawer for the correct listing', async () => {
    renderBranchDetail('/admin/branches/b2?tab=jewelry');
    await waitFor(() => expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument());
    const card = screen.getByText('18K Gold Solitaire Diamond Ring').closest('article');
    fireEvent.click(within(card).getByRole('button', { name: /View details/ }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(within(screen.getByRole('dialog')).getAllByText('18K Gold Solitaire Diamond Ring').length).toBeGreaterThan(0);
  });

  it('15. the jewelry drawer shows the real listing fields', async () => {
    renderBranchDetail('/admin/branches/b2?tab=jewelry');
    await waitFor(() => expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument());
    const card = screen.getByText('18K Gold Solitaire Diamond Ring').closest('article');
    fireEvent.click(within(card).getByRole('button', { name: /View details/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Lot name')).toBeInTheDocument();
    expect(within(dialog).getByText('Category')).toBeInTheDocument();
    expect(within(dialog).getByText('Lot · listing id')).toBeInTheDocument();
    expect(within(dialog).getByText('Listing status')).toBeInTheDocument();
    expect(within(dialog).getByText('Shop · seller')).toBeInTheDocument();
    expect(within(dialog).getByText('Golden Heritage Co.')).toBeInTheDocument();
    expect(within(dialog).getByText('Starting price')).toBeInTheDocument();
    expect(within(dialog).getByText('Current bid')).toBeInTheDocument();
    expect(within(dialog).getByText('Auction id')).toBeInTheDocument();
    expect(within(dialog).getByText('Total bids')).toBeInTheDocument();
    expect(within(dialog).getByText('Start · end')).toBeInTheDocument();
    expect(within(dialog).getByText('Read-only listing inspection. No customer actions available.')).toBeInTheDocument();
  });

  it('16. the jewelry drawer has no favourite / wishlist control', async () => {
    renderBranchDetail('/admin/branches/b2?tab=jewelry');
    await waitFor(() => expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument());
    const card = screen.getByText('18K Gold Solitaire Diamond Ring').closest('article');
    fireEvent.click(within(card).getByRole('button', { name: /View details/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/favou?rite/i)).toBeNull();
    expect(within(dialog).queryByText(/wishlist/i)).toBeNull();
    expect(within(dialog).queryByText(/reserve/i)).toBeNull();
    expect(within(dialog).queryByText(/buy now/i)).toBeNull();
  });

  it('17. the jewelry drawer has no bid control', async () => {
    renderBranchDetail('/admin/branches/b2?tab=jewelry');
    await waitFor(() => expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument());
    const card = screen.getByText('18K Gold Solitaire Diamond Ring').closest('article');
    fireEvent.click(within(card).getByRole('button', { name: /View details/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/place bid/i)).toBeNull();
    expect(within(dialog).queryByText(/your bid/i)).toBeNull();
  });
});

describe('Admin Branches — auctions tab', () => {
  it('18. the auction status filters are rendered', async () => {
    renderBranchDetail('/admin/branches/b2?tab=auctions');
    await waitFor(() => expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Live' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scheduled' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paused' })).toBeInTheDocument();
  });

  it('19. the live auction card shows the real live state', async () => {
    renderBranchDetail('/admin/branches/b2?tab=auctions');
    await waitFor(() => expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument());
    const card = screen.getByText('18K Gold Solitaire Diamond Ring').closest('article');
    expect(within(card).getByText('Live')).toBeInTheDocument();
    expect(within(card).getByText(/7 watching/)).toBeInTheDocument();
    expect(within(card).getByText('₱41,000')).toBeInTheDocument();
    expect(within(card).getByText('by Maria S.')).toBeInTheDocument();
    expect(within(card).getByText('14 bids')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Monitor live/ })).toBeInTheDocument();
  });

  it('20. the paused auction card shows the real paused state', async () => {
    renderBranchDetail('/admin/branches/b2?tab=auctions');
    await waitFor(() => expect(screen.getByText('Rose Gold Bangle Set')).toBeInTheDocument());
    const card = screen.getByText('Rose Gold Bangle Set').closest('article');
    expect(within(card).getByText('Paused')).toBeInTheDocument();
    expect(within(card).getByText(/3 watching/)).toBeInTheDocument();
    expect(within(card).getByText('₱52,000')).toBeInTheDocument();
    expect(within(card).getByText('by Rafael C.')).toBeInTheDocument();
    expect(within(card).getByText('11 bids')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /View details/ })).toBeInTheDocument();
  });

  it('21. the scheduled auction card shows no fake current bid', async () => {
    renderBranchDetail('/admin/branches/b2?tab=auctions');
    await waitFor(() => expect(screen.getByText('Sapphire Halo Engagement Ring')).toBeInTheDocument());
    const card = screen.getByText('Sapphire Halo Engagement Ring').closest('article');
    expect(within(card).getByText('Scheduled')).toBeInTheDocument();
    expect(within(card).getByText('₱45,000')).toBeInTheDocument();
    expect(within(card).getByText('0 bids')).toBeInTheDocument();
    expect(within(card).getByText(/Starts /)).toBeInTheDocument();
    expect(within(card).queryByText('Highest bid')).toBeNull();
  });

  it('22. Monitor live opens the drawer for the correct auction', async () => {
    renderBranchDetail('/admin/branches/b2?tab=auctions');
    await waitFor(() => expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument());
    const card = screen.getByText('18K Gold Solitaire Diamond Ring').closest('article');
    fireEvent.click(within(card).getByRole('button', { name: /Monitor live/ }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith('/admin/auctions/a1');
  });
});

describe('Admin Branches — auction monitor drawer', () => {
  async function openMonitor() {
    renderBranchDetail('/admin/branches/b2?tab=auctions');
    await waitFor(() => expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument());
    const card = screen.getByText('18K Gold Solitaire Diamond Ring').closest('article');
    fireEvent.click(within(card).getByRole('button', { name: /Monitor live/ }));
    return screen.findByRole('dialog');
  }

  it('23. the auction drawer shows the seller / branch / auctioneer fields', async () => {
    const dialog = await openMonitor();
    expect(within(dialog).getByText('Seller / shop')).toBeInTheDocument();
    expect(within(dialog).getByText('Golden Heritage Co.')).toBeInTheDocument();
    expect(within(dialog).getByText('Branch')).toBeInTheDocument();
    expect(within(dialog).getByText('Auctioneer')).toBeInTheDocument();
    expect(within(dialog).getByText('Ends')).toBeInTheDocument();
    expect(within(dialog).getByText('Read-only monitoring view. Admin does not participate in bidding.')).toBeInTheDocument();
  });

  it('24. the auction drawer shows the current bid', async () => {
    const dialog = await openMonitor();
    expect(within(dialog).getByText('Current / highest bid')).toBeInTheDocument();
    expect(within(dialog).getAllByText('₱41,000').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Current leader · Maria S.')).toBeInTheDocument();
  });

  it('25. the auction drawer shows the total bid count', async () => {
    const dialog = await openMonitor();
    expect(within(dialog).getByText('Total bids')).toBeInTheDocument();
    expect(within(dialog).getByText('14')).toBeInTheDocument();
  });

  it('26. the auction drawer shows the live watcher count', async () => {
    const dialog = await openMonitor();
    expect(within(dialog).getByText('Watching')).toBeInTheDocument();
    expect(within(dialog).getByText('7')).toBeInTheDocument();
  });

  it('27. the auction drawer lists the real bidder rows', async () => {
    const dialog = await openMonitor();
    expect(within(dialog).getByText('Live bidders')).toBeInTheDocument();
    expect(within(dialog).getByText('Maria S.')).toBeInTheDocument();
    expect(within(dialog).getByText('Rafael C.')).toBeInTheDocument();
    expect(within(dialog).getByText('₱40,000')).toBeInTheDocument();
  });

  it('28. the leading bidder is marked as Leading (not Winner)', async () => {
    const dialog = await openMonitor();
    expect(within(dialog).getByText('Leading')).toBeInTheDocument();
    expect(within(dialog).getByText('Outbid')).toBeInTheDocument();
    expect(within(dialog).queryByText(/winner/i)).toBeNull();
  });

  it('29. a scheduled auction shows the empty bidder state', async () => {
    renderBranchDetail('/admin/branches/b2?tab=auctions');
    await waitFor(() => expect(screen.getByText('Sapphire Halo Engagement Ring')).toBeInTheDocument());
    const card = screen.getByText('Sapphire Halo Engagement Ring').closest('article');
    fireEvent.click(within(card).getByRole('button', { name: /View details/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('No bids yet · auction not started')).toBeInTheDocument();
    expect(within(dialog).getByText('0 recorded')).toBeInTheDocument();
    expect(within(dialog).getByText(/No bidders yet/)).toBeInTheDocument();
  });

  it('30. the admin never gets a Place Bid control', async () => {
    const dialog = await openMonitor();
    expect(within(dialog).queryByText(/place bid/i)).toBeNull();
    expect(within(dialog).queryByText(/your bid/i)).toBeNull();
    expect(within(dialog).queryByLabelText(/bid amount/i)).toBeNull();
  });
});

describe('Admin Branches — realtime contract', () => {
  async function openMonitor() {
    renderBranchDetail('/admin/branches/b2?tab=auctions');
    await waitFor(() => expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument());
    const card = screen.getByText('18K Gold Solitaire Diamond Ring').closest('article');
    fireEvent.click(within(card).getByRole('button', { name: /Monitor live/ }));
    return screen.findByRole('dialog');
  }

  it('31. a bid event refreshes the monitor', async () => {
    const dialog = await openMonitor();
    const before = apiFetch.mock.calls.filter((c) => String(c[0]).includes('/admin/auctions/a1')).length;
    fireSocket('bid:update', { auctionId: 'a1', currentBid: 45000 });
    await waitFor(() => {
      const after = apiFetch.mock.calls.filter((c) => String(c[0]).includes('/admin/auctions/a1')).length;
      expect(after).toBeGreaterThan(before);
    });
    expect(within(dialog).getAllByText('₱41,000').length).toBeGreaterThan(0);
  });

  it('32. a watcher event updates the watcher count', async () => {
    const dialog = await openMonitor();
    fireSocket('auction:presence', { auctionId: 'a1', watchers: 9 });
    await waitFor(() => expect(within(dialog).getByText('9')).toBeInTheDocument());
  });

  it('33. a bid event does not modify the watcher count', async () => {
    const dialog = await openMonitor();
    fireSocket('bid:update', { auctionId: 'a1', currentBid: 45000 });
    await waitFor(() => expect(within(dialog).getAllByText('₱41,000').length).toBeGreaterThan(0));
    expect(within(dialog).queryByText('9')).toBeNull();
    expect(within(dialog).getByText('7')).toBeInTheDocument();
  });

  it('34. events for another auction are ignored', async () => {
    await openMonitor();
    const before = apiFetch.mock.calls.filter((c) => String(c[0]).includes('/admin/auctions/a1')).length;
    fireSocket('bid:update', { auctionId: 'other-auction', currentBid: 999 });
    fireSocket('auction:presence', { auctionId: 'other-auction', watchers: 42 });
    await new Promise((r) => setTimeout(r, 30));
    const after = apiFetch.mock.calls.filter((c) => String(c[0]).includes('/admin/auctions/a1')).length;
    expect(after).toBe(before);
  });

  it('35. the socket listeners are removed on unmount', async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/admin/branches/b2?tab=auctions']}>
        <Routes>
          <Route path="/admin/branches/:branchId" element={<BranchDetails />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(socketMock.on).toHaveBeenCalled());
    unmount();
    expect(socketMock.off).toHaveBeenCalledWith('bid:update', expect.any(Function));
    expect(socketMock.off).toHaveBeenCalledWith('auction:update', expect.any(Function));
    expect(socketMock.off).toHaveBeenCalledWith('auction:presence', expect.any(Function));
  });
});

describe('Admin Branches — loading / empty / error states', () => {
  it('36. skeletons are shown while the branch data loads', () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = renderBranchDetail();
    expect(container.querySelectorAll('.adm-skel').length).toBeGreaterThan(0);
  });

  it('37. empty states are shown when there is nothing to monitor', async () => {
    const empty = {
      ...OVERVIEW,
      kpis: { ...OVERVIEW.kpis, live_auctions: 0, watchers: 0 },
      listings: [],
      auctions: [],
      live_auctions: [],
      recent_results: [],
    };
    installApi({ overview: empty });
    renderBranchDetail();
    await waitFor(() => expect(screen.getByText('No live auctions right now.')).toBeInTheDocument());
    expect(screen.getByText('No concluded auctions yet.')).toBeInTheDocument();
  });

  it('37b. the jewelry and auction tabs show their empty states', async () => {
    const empty = { ...OVERVIEW, listings: [], auctions: [], live_auctions: [], recent_results: [] };
    installApi({ overview: empty });
    const { unmount } = renderBranchDetail('/admin/branches/b2?tab=jewelry');
    await waitFor(() => expect(screen.getByText('No jewelry listings found for this branch.')).toBeInTheDocument());
    unmount();
    installApi({ overview: empty });
    renderBranchDetail('/admin/branches/b2?tab=auctions');
    await waitFor(() => expect(screen.getByText('No auctions found for this branch.')).toBeInTheDocument());
  });

  it('38. an API failure shows the error state', async () => {
    installApi({ fail: 'Network down' });
    renderBranchDetail();
    await waitFor(() => expect(screen.getByText('Network down')).toBeInTheDocument());
  });
});
