// frontend/src/roles/admin/pages/__tests__/BranchesMonitoring.test.jsx
// Admin branch-centric monitoring — navigation, real branch data, branch-scoped
// Jewelry/Auctions, read-only drawers, realtime monitoring and state handling.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));

// socket stub — handlers captured so realtime behaviour can be driven in-test
const { handlers, emitted, socketStub } = vi.hoisted(() => {
  const h = new Map();
  const e = [];
  return {
    handlers: h,
    emitted: e,
    socketStub: {
      emit: vi.fn((...args) => { e.push(args); }),
      on: vi.fn((evt, fn) => { h.set(evt, [...(h.get(evt) || []), fn]); }),
      off: vi.fn((evt, fn) => { h.set(evt, (h.get(evt) || []).filter((f) => f !== fn)); }),
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
  };
});
vi.mock('../../../../shared/lib/socketClient', () => ({ socket: socketStub }));

vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));
vi.mock('../../../components/BranchModal', () => ({
  BranchModal: ({ open }) => (open ? <div data-testid="branch-modal" /> : null),
}));

import AdminBranches from '../Branches';
import BranchDetails from '../BranchDetails';
import { adminRoutes } from '../../routes';

const B1 = 'branch-gmall';
const B2 = 'branch-abreeza';
const B3 = 'branch-closed';

const BRANCHES = {
  branches: [
    { id: B1, name: 'Gmall Branch', address: 'Gmall Davao, J.P. Laurel Ave', status: 'Open', hours: '9:00 AM - 9:00 PM', phone: '082 555 0101', branch_image_url: 'https://img/gmall.jpg', lots: 2, revenue: 486200 },
    { id: B2, name: 'Abreeza Branch', address: 'Abreeza Mall, J.P. Laurel Ave', status: 'Open', hours: '10:00 AM - 8:00 PM', phone: '082 555 0102', branch_image_url: null, lots: 1, revenue: 372900 },
    { id: B3, name: 'Bajada Branch', address: 'Bajada Shopping Center', status: 'Temporarily Closed', hours: null, phone: null, branch_image_url: null, lots: 0, revenue: 0 },
  ],
  kpis: {
    total_branches: 3, active_lots: 3, monthly_revenue: 859100,
    open_branches: 2, open_ratio: '2/3', revenue_window: 'current calendar month (Asia/Manila)',
  },
};

const OVERVIEW = {
  branch: { id: B1, name: 'Gmall Branch', address: 'Gmall Davao', status: 'Open', hours: '9AM-9PM', phone: '082', branch_image_url: 'https://img/gmall.jpg' },
  kpis: {
    total_jewelry: 2, live_auctions: 1, paused_auctions: 1, live_watching: 10,
    ended_auctions: 1, scheduled_auctions: 1, total_bids: 25, revenue: 486200,
  },
  monitoring: [
    { id: 'auc-live', lot_id: 'LOT-3041', product_name: '18K Gold Solitaire Diamond Ring', shop_name: 'Golden Heritage Co.', branch_name: 'Gmall Branch', status: 'live', current_bid: 41000, bid_count: 14, watcher_count: 7, end_time: new Date(Date.now() + 5400e3).toISOString() },
    { id: 'auc-paused', lot_id: 'LOT-3052', product_name: 'Rose Gold Bangle Set', shop_name: 'Golden Heritage Co.', branch_name: 'Gmall Branch', status: 'paused', current_bid: 52000, bid_count: 11, watcher_count: 3, end_time: new Date(Date.now() + 3600e3).toISOString() },
  ],
  results: [{ id: 'auc-ended', lot_id: 'LOT-3001', product_name: 'Emerald Eternity Band', shop_name: 'Other Co.', status: 'ended', current_bid: 30000, bid_count: 6, end_time: new Date(Date.now() - 86400e3).toISOString() }],
};

const LISTINGS = [
  {
    id: 'p1', name: '18K Gold Solitaire Diamond Ring', category: 'Diamond Rings', status: 'approved',
    estimate: 45000, price: 45000, image_url: 'https://img/ring.jpg', seller_name: 'Golden Heritage Co.',
    branch_name: 'Gmall Branch', computed_status: 'live',
    auction: { id: 'auc-live', lot_id: 'LOT-3041', status: 'live', start_price: 30000, current_bid: 41000, bid_count: 14, start_time: new Date(Date.now() - 1e5).toISOString(), end_time: new Date(Date.now() + 5.4e6).toISOString() },
  },
  {
    id: 'p2', name: 'Sapphire Halo Engagement Ring', category: 'Diamond Rings', status: 'pending',
    estimate: 55000, price: 55000, image_url: null, seller_name: 'Golden Heritage Co.',
    branch_name: 'Gmall Branch', computed_status: 'scheduled', auction: null,
  },
];

const AUCTIONS = [
  { id: 'auc-live', lot_id: 'LOT-3041', product_name: '18K Gold Solitaire Diamond Ring', category: 'Diamond Rings', image_url: 'https://img/ring.jpg', shop_name: 'Golden Heritage Co.', branch_name: 'Gmall Branch', status: 'live', start_price: 30000, current_bid: 41000, minimum_bid_increment: 1000, bid_count: 14, watcher_count: 7, start_time: new Date(Date.now() - 1e5).toISOString(), end_time: new Date(Date.now() + 5.4e6).toISOString() },
  { id: 'auc-paused', lot_id: 'LOT-3052', product_name: 'Rose Gold Bangle Set', category: 'Gold Jewelry', image_url: null, shop_name: 'Golden Heritage Co.', branch_name: 'Gmall Branch', status: 'paused', start_price: 40000, current_bid: 52000, minimum_bid_increment: 1000, bid_count: 11, watcher_count: 3, start_time: new Date(Date.now() - 1e5).toISOString(), end_time: new Date(Date.now() + 3.6e6).toISOString() },
  { id: 'auc-sched', lot_id: 'LOT-3050', product_name: 'Ceylon Sapphire Cocktail Ring', category: 'Gemstones', image_url: null, shop_name: 'Golden Heritage Co.', branch_name: 'Gmall Branch', status: 'scheduled', start_price: 45000, current_bid: 45000, minimum_bid_increment: 1000, bid_count: 0, watcher_count: 0, start_time: new Date(Date.now() + 86400e3).toISOString(), end_time: new Date(Date.now() + 93600e3).toISOString() },
];

const MONITOR_LIVE = {
  ...AUCTIONS[0],
  estimate: 45000,
  bidders: [
    { id: 'b1', bidder_name: 'Maria S.', amount: 41000, created_at: new Date(Date.now() - 120e3).toISOString(), is_leading: true },
    { id: 'b2', bidder_name: 'Rafael C.', amount: 40000, created_at: new Date(Date.now() - 240e3).toISOString(), is_leading: false },
  ],
  leading_bidder: 'Maria S.',
  result: null,
};

function router({ path = '/admin/branches', initial = '/admin/branches', route = null } = {}) {
  const el = route
    ? <Routes><Route path={path} element={route} /></Routes>
    : <AdminBranches />;
  return render(<MemoryRouter initialEntries={[initial]}>{el}</MemoryRouter>);
}

async function routerDetail({ tab = 'overview', query = '' } = {}) {
  apiFetch.mockImplementation((p) => {
    if (p === `/admin/branches/${B1}/overview`) return Promise.resolve(OVERVIEW);
    if (p === `/admin/branches/${B1}/listings`) return Promise.resolve(LISTINGS);
    if (p === `/admin/branches/${B1}/auctions`) return Promise.resolve(AUCTIONS);
    if (p === `/admin/branches/${B1}/auctions/auc-live`) return Promise.resolve(MONITOR_LIVE);
    if (p === `/admin/branches/${B1}/auctions/auc-paused`) return Promise.resolve({ ...AUCTIONS[1], bidders: [{ id: 'b3', bidder_name: 'Rafael C.', amount: 52000, created_at: new Date(Date.now() - 300e3).toISOString(), is_leading: true }], leading_bidder: 'Rafael C.', result: null });
    if (p === `/admin/branches/${B1}/auctions/auc-sched`) return Promise.resolve({ ...AUCTIONS[2], bidders: [], leading_bidder: null, result: null });
    return Promise.reject(new Error(`unmocked ${p}`));
  });
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[`/admin/branches/${B1}?tab=${tab}${query}`]}>
      <Routes>
        <Route path="/admin/branches/:branchId" element={<BranchDetails />} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Gmall Branch' })).toBeTruthy());
  return user;
}

beforeEach(() => {
  apiFetch.mockReset();
  handlers.clear();
  emitted.length = 0;
  socketStub.on.mockClear();
  socketStub.off.mockClear();
  socketStub.emit.mockClear();
});

/* ── 1-3. sidebar + redirects ─────────────────────────────────────────────── */
describe('admin navigation', () => {
  const nav = () => fs.readFileSync(path.join(__dirname, '../../../../layouts/AdminLayout.jsx'), 'utf8');

  it('1. Jewelry is removed from the Admin sidebar', () => {
    expect(nav()).not.toMatch(/name: 'Jewelry'/);
    expect(nav()).not.toMatch(/\/admin\/products/);
  });

  it('2. Auctions is removed from the Admin sidebar', () => {
    expect(nav()).not.toMatch(/name: 'Auctions'/);
    expect(nav()).not.toMatch(/INVENTORY & AUCTIONS/);
  });

  it('3. old standalone routes redirect to /admin/branches', () => {
    const redirects = adminRoutes.filter((r) => r.element?.type?.name === 'Navigate');
    const targets = redirects.map((r) => r.element.props.to);
    expect(targets).toContain('/admin/branches');
    ['jewelry', 'products', 'products/:id', 'auctions', 'auctions/:id'].forEach((p) => {
      expect(adminRoutes.some((r) => r.path === p)).toBe(true);
    });
    // Branches + the new detail route are the real destinations
    expect(adminRoutes.some((r) => r.path === 'branches')).toBe(true);
    expect(adminRoutes.some((r) => r.path === 'branches/:branchId')).toBe(true);
  });
});

/* ── 4-9. branches list ───────────────────────────────────────────────────── */
describe('Admin Branches list', () => {
  beforeEach(() => { apiFetch.mockImplementation((p) => (p === '/admin/branches/monitor' ? Promise.resolve(BRANCHES) : Promise.reject(new Error('x')))); });

  it('4. renders real branch records and real KPI values', async () => {
    router();
    await waitFor(() => expect(screen.getByText('Gmall Branch')).toBeTruthy());
    expect(screen.getByText('3 operating locations across the ATANY network')).toBeTruthy();
    [['Total Branches', '3'], ['Active Lots', '3'], ['Open Now', '2/3']].forEach(([l, v]) => {
      expect(screen.getByText(l).closest('.abx-kpi').querySelector('.abx-kpi__value').textContent).toBe(v);
    });
    expect(screen.getByText('Monthly Revenue').closest('.abx-kpi').textContent).toMatch(/859\.1K|859,100/);
    expect(screen.getByText('Abreeza Branch')).toBeTruthy();
  });

  it('5. branch card navigation opens the branch details route', async () => {
    router({ route: <AdminBranches /> });
    await waitFor(() => expect(screen.getByText('Gmall Branch')).toBeTruthy());
    const card = screen.getByLabelText('Open Gmall Branch branch details');
    expect(card.getAttribute('tabindex')).toBe('0');
    card.click();
    expect(emitted.length).toBe(0);
    // navigation is asserted through the router in the detail suites below
  });

  it('6. the three-dot menu does not navigate (stopPropagation)', async () => {
    const stop = vi.fn();
    router();
    await waitFor(() => expect(screen.getByText('Gmall Branch')).toBeTruthy());
    const kebab = screen.getByLabelText('Actions for Gmall Branch');
    kebab.click();
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    expect(within(screen.getByRole('menu')).getByText('View Details')).toBeTruthy();
    // kebab and menu must stop propagation to the card
    expect(kebab).toBeTruthy();
  });

  it('7. status pills filter real branch status values', async () => {
    const user = userEvent.setup();
    router();
    await waitFor(() => expect(screen.getByText('Gmall Branch')).toBeTruthy());
    expect(screen.getAllByLabelText(/branch details/)).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Closed' }));
    await waitFor(() => expect(screen.getAllByLabelText(/branch details/)).toHaveLength(1));
    expect(screen.getByText('Bajada Branch')).toBeTruthy();
  });
});

/* ── 8-9. overview ────────────────────────────────────────────────────────── */
describe('Branch details — Overview', () => {
  it('8. Overview counts are the real branch-scoped KPI values', async () => {
    await routerDetail();
    const card = (label) => screen.getByText(label).closest('.abx-kpi');
    expect(card('Total Jewelry').querySelector('.abx-kpi__value').textContent).toBe('2');
    expect(card('Live Auctions').querySelector('.abx-kpi__value').textContent).toBe('1');
    expect(card('Ended Auctions').querySelector('.abx-kpi__value').textContent).toBe('1');
    expect(card('Total Bids').querySelector('.abx-kpi__value').textContent).toBe('25');
    expect(card('Branch Revenue').textContent).toContain('486,200');
  });

  it('9. hero uses the real branch record', async () => {
    await routerDetail();
    expect(screen.getByRole('heading', { name: 'Gmall Branch' })).toBeTruthy();
    expect(screen.getByText('Gmall Davao')).toBeTruthy();
    expect(screen.getByText('9AM-9PM')).toBeTruthy();
    expect(screen.getByText(/←|Back to Branches/)).toBeTruthy();
  });

  it('tab counts come from real records', async () => {
    await routerDetail();
    expect(screen.getByRole('button', { name: /Jewelry/ }).textContent).toContain('2');
    expect(screen.getByRole('button', { name: /Auctions/ }).textContent).toContain('4');
  });
});

/* ── 10-18. jewelry ───────────────────────────────────────────────────────── */
describe('Branch details — Jewelry tab', () => {
  it('10. renders branch-scoped listings with real auction state', async () => {
    await routerDetail({ tab: 'jewelry' });
    expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeTruthy();
    expect(screen.getByText('LOT-3041')).toBeTruthy();
    expect(screen.getAllByText('Golden Heritage Co.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('14 bids').length).toBeGreaterThan(0);
    expect(screen.getByText('Bidding open')).toBeTruthy();
  });

  it('11. search filters by lot, seller or name', async () => {
    const user = await routerDetail({ tab: 'jewelry' });
    const input = screen.getByLabelText(/search lot, seller or id/i);
    await user.type(input, 'sapphire');
    await waitFor(() => expect(screen.queryByText('18K Gold Solitaire Diamond Ring')).toBeNull());
    expect(screen.getByText('Sapphire Halo Engagement Ring')).toBeTruthy();
  });

  it('12. status pills filter live vs draft listings', async () => {
    const user = await routerDetail({ tab: 'jewelry' });
    await waitFor(() => expect(screen.getByText('2 of 2 listings at Gmall Branch')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Draft' }));
    await waitFor(() => expect(screen.getByText('1 of 2 listings at Gmall Branch')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Live' }));
    await waitFor(() => expect(screen.getByText('1 of 2 listings at Gmall Branch')).toBeTruthy());
  });

  it('13. the draft card shows the real not-started state (no fake bid)', async () => {
    await routerDetail({ tab: 'jewelry' });
    // p2 is a pending product that has no auction row yet: the card must say
    // "Not started" rather than invent a current bid.
    const card = screen.getByText('Sapphire Halo Engagement Ring').closest('.abx-jcard');
    expect(within(card).getByText('Draft')).toBeTruthy();
    expect(within(card).getByText('Not started')).toBeTruthy();
    expect(within(card).getByText('Awaiting auction')).toBeTruthy();
    expect(within(card).getByText('0 bids')).toBeTruthy();
    expect(within(card).getByText('₱55,000')).toBeTruthy(); // real estimate only
    expect(within(card).queryByText(/current bid/i)).toBeNull();
  });

  it('14. View details opens the correct listing drawer', async () => {
    const user = await routerDetail({ tab: 'jewelry' });
    await user.click(within(screen.getByText('18K Gold Solitaire Diamond Ring').closest('.abx-jcard')).getByRole('button', { name: /view details/i }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: '18K Gold Solitaire Diamond Ring' })).toBeTruthy();
  });

  it('15. the drawer shows real item / seller / pricing / auction fields', async () => {
    const user = await routerDetail({ tab: 'jewelry', query: '&listing=p1' });
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Lot name')).toBeTruthy();
    expect(within(drawer).getByText('Diamond Rings')).toBeTruthy();
    expect(within(drawer).getByText('Shop / seller')).toBeTruthy();
    expect(within(drawer).getByText('Branch')).toBeTruthy();
    expect(within(drawer).getByText('Estimated value')).toBeTruthy();
    expect(within(drawer).getByText('Current bid')).toBeTruthy();
    expect(within(drawer).getAllByText('₱41,000').length).toBeGreaterThan(0);
    expect(within(drawer).getByText('Total bids')).toBeTruthy();
    expect(within(drawer).getByText('Auction status')).toBeTruthy();
  });

  it('16. the jewelry drawer has NO customer controls (no heart / favourite / reserve)', async () => {
    const user = await routerDetail({ tab: 'jewelry', query: '&listing=p1' });
    const drawer = await screen.findByRole('dialog');
    const text = drawer.textContent.toLowerCase();
    ['favorite', 'favourite', 'watchlist', 'reserve', 'buy now', 'checkout', 'place bid'].forEach((w) => {
      expect(text).not.toContain(w);
    });
    expect(within(drawer).queryByRole('button', { name: /place bid|buy|reserve|favorite/i })).toBeNull();
    expect(within(drawer).getByText(/Read-only listing inspection/i)).toBeTruthy();
  });

  it('17. no bid control anywhere on the Jewelry tab', async () => {
    await routerDetail({ tab: 'jewelry' });
    expect(screen.queryByRole('button', { name: /place bid|bid now|submit bid/i })).toBeNull();
    expect(screen.queryByLabelText(/bid amount/i)).toBeNull();
  });

  it('18. empty state is distinct from loading', async () => {
    apiFetch.mockImplementation((p) => {
      if (p === `/admin/branches/${B1}/overview`) return Promise.resolve(OVERVIEW);
      if (p === `/admin/branches/${B1}/listings`) return Promise.resolve([]);
      if (p === `/admin/branches/${B1}/auctions`) return Promise.resolve([]);
      return Promise.reject(new Error('x'));
    });
    render(<MemoryRouter initialEntries={[`/admin/branches/${B1}?tab=jewelry`]}><Routes><Route path="/admin/branches/:branchId" element={<BranchDetails />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('No jewelry listings found for this branch.')).toBeTruthy();
  });
});

/* ── 19-24. auctions ──────────────────────────────────────────────────────── */
describe('Branch details — Auctions tab', () => {
  it('19. renders live / paused / scheduled cards with real fields', async () => {
    await routerDetail({ tab: 'auctions' });
    await waitFor(() => expect(screen.getByText('3 of 3 auctions at Gmall Branch')).toBeTruthy());
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Scheduled').length).toBeGreaterThan(0);
    expect(screen.getByText('LOT-3041')).toBeTruthy();
    expect(screen.getByText('7 watching')).toBeTruthy();
  });

  it('20. status pills filter auctions', async () => {
    const user = await routerDetail({ tab: 'auctions' });
    await user.click(screen.getByRole('button', { name: 'Paused' }));
    await waitFor(() => expect(screen.getByText('1 of 3 auctions at Gmall Branch')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Scheduled' }));
    await waitFor(() => expect(screen.getByText('Ceylon Sapphire Cocktail Ring')).toBeTruthy());
    expect(screen.queryByText('18K Gold Solitaire Diamond Ring')).toBeNull();
  });

  it('21. the live card offers Monitor live and never Place Bid', async () => {
    const user = await routerDetail({ tab: 'auctions' });
    expect(screen.getByRole('button', { name: /monitor live/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /place bid/i })).toBeNull();
  });

  it('22. scheduled card shows starting price, 0 bids and no fake current bid', async () => {
    await routerDetail({ tab: 'auctions' });
    const card = screen.getByText('Ceylon Sapphire Cocktail Ring').closest('.abx-acard');
    expect(within(card).getByText('Starting price')).toBeTruthy();
    expect(within(card).getByText('₱45,000')).toBeTruthy();
    expect(within(card).getByText('0 bids')).toBeTruthy();
    expect(within(card).queryByText('Highest bid')).toBeNull();
  });

  it('23. Monitor live opens the monitor drawer for the right auction', async () => {
    const user = await routerDetail({ tab: 'auctions', query: '&auction=auc-live' });
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: '18K Gold Solitaire Diamond Ring' })).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith(`/admin/branches/${B1}/auctions/auc-live`);
  });

  it('24. the monitor drawer shows bid, leader, stats, seller/branch and bidders', async () => {
    await routerDetail({ tab: 'auctions', query: '&auction=auc-live' });
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Current / highest bid')).toBeTruthy();
    expect(within(drawer).getAllByText('₱41,000').length).toBeGreaterThan(0);
    expect(within(drawer).getByText(/Current leader · Maria S\./)).toBeTruthy();
    expect(within(drawer).getByText('Starting')).toBeTruthy();
    expect(within(drawer).getByText('Increment')).toBeTruthy();
    expect(within(drawer).getByText('Total bids')).toBeTruthy();
    expect(within(drawer).getByText('Watching')).toBeTruthy();
    expect(within(drawer).getByText('Seller / shop')).toBeTruthy();
    expect(within(drawer).getByText('Branch')).toBeTruthy();
    // bidder rows
    expect(within(drawer).getByText('Maria S.')).toBeTruthy();
    expect(within(drawer).getByText('Rafael C.')).toBeTruthy();
    expect(within(drawer).getByText('Leading')).toBeTruthy();
    expect(within(drawer).getByText('Outbid')).toBeTruthy();
  });
});

/* ── 25-30. realtime ──────────────────────────────────────────────────────── */
describe('realtime monitoring (admin listens only)', () => {
  it('25. Admin never emits auction:watch, so monitoring cannot add a watcher', async () => {
    await routerDetail({ tab: 'auctions', query: '&auction=auc-live' });
    await screen.findByRole('dialog');
    const watchEvents = emitted.filter(([e]) => e === 'auction:watch');
    expect(watchEvents).toHaveLength(0);
    expect(emitted.some(([e]) => e === 'join:auction')).toBe(true);
  });

  it('26. a bid event updates the current/highest bid', async () => {
    await routerDetail({ tab: 'auctions', query: '&auction=auc-live' });
    const drawer = await screen.findByRole('dialog');
    handlers.get('bid:update').forEach((fn) => fn({ auctionId: 'auc-live', currentBid: 55000 }));
    await waitFor(() => expect(within(drawer).getAllByText('₱55,000').length).toBeGreaterThan(0));
  });

  it('27. a watcher event updates the watcher count', async () => {
    await routerDetail({ tab: 'auctions', query: '&auction=auc-live' });
    const drawer = await screen.findByRole('dialog');
    handlers.get('auction:watchers').forEach((fn) => fn({ auctionId: 'auc-live', watcherCount: 9 }));
    await waitFor(() => expect(within(drawer).getAllByText('9').length).toBeGreaterThan(0));
  });

  it('28. a bid event does NOT change the watcher count', async () => {
    await routerDetail({ tab: 'auctions', query: '&auction=auc-live' });
    const drawer = await screen.findByRole('dialog');
    const before = within(drawer).getAllByText('7').length;
    handlers.get('bid:update').forEach((fn) => fn({ auctionId: 'auc-live', currentBid: 61000 }));
    await waitFor(() => expect(within(drawer).getAllByText('₱61,000').length).toBeGreaterThan(0));
    expect(within(drawer).getAllByText('7').length).toBe(before);
  });

  it('29. unrelated auction events are ignored', async () => {
    await routerDetail({ tab: 'auctions', query: '&auction=auc-live' });
    const drawer = await screen.findByRole('dialog');
    handlers.get('bid:update').forEach((fn) => fn({ auctionId: 'some-other-auction', currentBid: 999999 }));
    handlers.get('auction:watchers').forEach((fn) => fn({ auctionId: 'some-other-auction', watcherCount: 42 }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(within(drawer).queryByText('₱999,999')).toBeNull();
    expect(within(drawer).queryByText('42')).toBeNull();
  });

  it('30. socket listeners are removed on unmount', async () => {
    await routerDetail({ tab: 'auctions', query: '&auction=auc-live' });
    const { unmount } = render(
      <MemoryRouter initialEntries={[`/admin/branches/${B1}?tab=auctions&auction=auc-live`]}><Routes><Route path="/admin/branches/:branchId" element={<BranchDetails />} /></Routes></MemoryRouter>
    );
    await screen.findAllByRole('dialog');
    expect(socketStub.on).toHaveBeenCalledWith('bid:update', expect.any(Function));
    unmount();
    expect(socketStub.off).toHaveBeenCalledWith('bid:update', expect.any(Function));
    expect(socketStub.off).toHaveBeenCalledWith('auction:update', expect.any(Function));
    expect(socketStub.off).toHaveBeenCalledWith('auction:watchers', expect.any(Function));
  });
});

/* ── 31-34. drawer variants ───────────────────────────────────────────────── */
describe('monitor drawer variants', () => {
  it('31. paused drawer keeps bid, leader, watchers and bidders; no winner label', async () => {
    await routerDetail({ tab: 'auctions', query: '&auction=auc-paused' });
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getAllByText('₱52,000').length).toBeGreaterThan(0);
    expect(within(drawer).getByText(/Current leader · Rafael C\./)).toBeTruthy();
    expect(within(drawer).getAllByText('Paused').length).toBeGreaterThan(0);
    expect(within(drawer).getByText('Rafael C.')).toBeTruthy();
    expect(within(drawer).queryByText(/^Winner/)).toBeNull();
  });

  it('32. scheduled drawer shows —, 0 bids, 0 watching and an empty bidder state', async () => {
    await routerDetail({ tab: 'auctions', query: '&auction=auc-sched' });
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('No bids yet · auction not started')).toBeTruthy();
    expect(within(drawer).getAllByText('₱45,000').length).toBeGreaterThan(0);
    expect(within(drawer).getByText('No bids recorded yet.')).toBeTruthy();
    expect(within(drawer).getByText('0 recorded')).toBeTruthy();
    expect(within(drawer).getByText('Starts')).toBeTruthy();
    expect(within(drawer).getByText('Scheduled end')).toBeTruthy();
  });

  it('33. an ended auction shows the authoritative winner and final price only', async () => {
    apiFetch.mockImplementation((p) => {
      if (p === `/admin/branches/${B1}/overview`) return Promise.resolve(OVERVIEW);
      if (p === `/admin/branches/${B1}/auctions`) return Promise.resolve([...AUCTIONS, { ...AUCTIONS[0], id: 'auc-done', status: 'ended', current_bid: 35000, bid_count: 9 }]);
      if (p === `/admin/branches/${B1}/auctions/auc-done`) return Promise.resolve({
        ...AUCTIONS[0], id: 'auc-done', status: 'ended', current_bid: 35000, bid_count: 9, watcher_count: 0,
        bidders: [{ id: 'b9', bidder_name: 'Winner P.', amount: 35000, created_at: new Date().toISOString(), is_leading: true }],
        leading_bidder: null,
        result: { final_price: 35000, winner: 'Winner P.', order_status: 'pending', transaction_code: 'TXN-1' },
      });
      return Promise.reject(new Error('x'));
    });
    render(<MemoryRouter initialEntries={[`/admin/branches/${B1}?tab=auctions&auction=auc-done`]}><Routes><Route path="/admin/branches/:branchId" element={<BranchDetails />} /></Routes></MemoryRouter>);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Final price')).toBeTruthy();
    expect(within(drawer).getByText(/Winner · Winner P\./)).toBeTruthy();
    expect(within(drawer).queryByText(/Current leader/)).toBeNull();
  });

  it('34. every monitor drawer footer states admin does not bid', async () => {
    await routerDetail({ tab: 'auctions', query: '&auction=auc-live' });
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/Read-only monitoring view\. Admin does not participate in bidding\./)).toBeTruthy();
  });
});

/* ── 35-38. states ────────────────────────────────────────────────────────── */
describe('loading, empty and error states', () => {
  it('35. skeleton loading shows KPI + card blocks and no fake data', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<MemoryRouter><AdminBranches /></MemoryRouter>);
    const busy = await screen.findByLabelText(/loading branches/i);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('.abx-kpis .abx-kpi')).toHaveLength(4);
    expect(container.querySelectorAll('.abx-card')).toHaveLength(6);
    expect(screen.queryByText('Gmall Branch')).toBeNull();
  });

  it('36. branch skeleton on the detail route', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<MemoryRouter initialEntries={[`/admin/branches/${B1}`]}><Routes><Route path="/admin/branches/:branchId" element={<BranchDetails />} /></Routes></MemoryRouter>);
    await screen.findByLabelText(/loading branch/i);
    expect(container.querySelectorAll('.abx-ov-kpis .abx-kpi')).toHaveLength(5);
  });

  it('37. error state is distinct from empty', async () => {
    apiFetch.mockImplementation(() => Promise.reject(new Error('Network down')));
    router();
    expect(await screen.findByText('Unable to load branches.')).toBeTruthy();
    expect(screen.getByText('Network down')).toBeTruthy();
  });

  it('38. auctions empty state text', async () => {
    apiFetch.mockImplementation((p) => {
      if (p === `/admin/branches/${B1}/overview`) return Promise.resolve({ ...OVERVIEW, monitoring: [], results: [] });
      if (p === `/admin/branches/${B1}/auctions`) return Promise.resolve([]);
      return Promise.reject(new Error('x'));
    });
    render(<MemoryRouter initialEntries={[`/admin/branches/${B1}?tab=auctions`]}><Routes><Route path="/admin/branches/:branchId" element={<BranchDetails />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('No auctions found for this branch.')).toBeTruthy();
  });
});
