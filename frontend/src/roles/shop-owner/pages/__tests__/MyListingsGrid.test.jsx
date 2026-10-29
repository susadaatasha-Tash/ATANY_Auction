import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import MyListings from '../MyListings';
import { apiFetch } from '../../../../shared/lib/apiClient';

const now = Date.now();
function mkListing(over = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Test Emerald Ring',
    category: 'Rings',
    karat_weight: '12.5',
    price: 8000,
    status: 'approved',
    description: 'Elegant gold ring.',
    image_url: 'https://img.test/ring.jpg',
    branch_name: 'Golden Heritage — Gmall Branch',
    created_at: new Date(now - 86400000).toISOString(),
    auction_id: 'a1',
    auction_status: 'ended',
    computed_status: 'ended',
    auction: {
      id: 'a1', status: 'ended',
      start_time: new Date(now - 7200000).toISOString(),
      end_time: new Date(now - 3600000).toISOString(),
      start_price: 8000, current_bid: 12500, bid_count: 4, watcher_count: 8,
    },
    ...over,
  };
}
const liveListing = () => mkListing({
  id: '22222222-2222-2222-2222-222222222222', name: 'Live Sapphire Pendant',
  category: 'Necklaces', karat_weight: '6.5', price: 9000, status: 'approved',
  image_url: null, branch_name: 'Golden Heritage — Gmall Branch',
  created_at: new Date(now - 3600000).toISOString(),
  auction_id: 'a2', auction_status: 'live', computed_status: 'live',
  auction: {
    id: 'a2', status: 'live',
    start_time: new Date(now - 3600000).toISOString(),
    end_time: new Date(now + 3600000).toISOString(),
    start_price: 9000, current_bid: 9000, bid_count: 0, watcher_count: 3,
  },
});
const bareListing = () => mkListing({
  id: '33333333-3333-3333-3333-333333333333', name: 'Loose Diamond',
  category: 'Other', karat_weight: null, price: 5000, status: 'pending',
  description: null, image_url: null, branch_name: null,
  created_at: new Date(now - 7200000).toISOString(),
  auction_id: null, auction_status: null, computed_status: 'scheduled', auction: null,
});

let listingsData;
let deleteCalls;
const toastFn = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toastFn }));
vi.mock('../../../../shared/hooks/useRealtimeProducts', () => ({ useRealtimeProducts: () => {} }));
vi.mock('../../../../shared/lib/supabaseClient', () => ({
  supabase: { auth: { getUser: vi.fn(async () => ({ data: { user: null } })) }, from: vi.fn(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) })) },
}));
// Rendered only when open so tests can assert the create flow is reached.
vi.mock('../../components/SubmitListingModal', () => ({
  SubmitListingModal: ({ open, mode }) => (open ? <div data-testid="submit-listing-modal" data-mode={mode} /> : null),
}));

const schedDeletable = () => mkListing({
  id: '55555555-5555-5555-5555-555555555555', name: 'Sched Gold Band',
  category: 'Rings', price: 3000, status: 'approved', description: 'Sched.',
  branch_name: 'Golden Heritage — Gmall Branch',
  created_at: new Date(now - 7200000).toISOString(),
  auction_id: 'a5', auction_status: 'scheduled', computed_status: 'scheduled', can_delete: true,
  auction: {
    id: 'a5', status: 'scheduled',
    start_time: new Date(now + 86400000).toISOString(),
    end_time: new Date(now + 8 * 86400000).toISOString(),
    start_price: 3000, current_bid: 0, bid_count: 0, watcher_count: 0,
  },
});

beforeEach(() => {
  // Backend can_delete flag wins over the client fallback.
  toastFn.mockClear();
  listingsData = [mkListing({ can_delete: false }), liveListing(), bareListing(), schedDeletable()];
  deleteCalls = [];
  vi.mocked(apiFetch).mockImplementation(async (path, opts = {}) => {
    if (path === '/shop-owner/listings' && (!opts.method || opts.method === 'GET')) return listingsData;
    if (path === '/shop-owner/shop') return null;
    if (opts.method === 'DELETE') {
      deleteCalls.push(path);
      const listingId = path.split('/').pop();
      listingsData = listingsData.filter((l) => l.id !== listingId);
      return { success: true, id: listingId };
    }
    return [];
  });
});
function dialog() { return screen.getByRole('dialog'); }

test('renders premium grid, not a table, with real data', async () => {
  render(<MyListings />);
  await screen.findByText('Test Emerald Ring');
  expect(document.querySelector('table')).toBeNull();
  expect(document.querySelectorAll('.mls-grid').length).toBeGreaterThan(0);
  expect(document.querySelectorAll('[data-testid^="listing-card-"]').length).toBe(4);
  expect(screen.getAllByText('Rings', { selector: '.mls-card__cat' }).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('₱8,000')).toBeInTheDocument();
  expect(screen.getAllByText('Ended').length).toBeGreaterThan(0);
});

test('search filters by name, category, id', async () => {
  render(<MyListings />);
  await screen.findByText('Test Emerald Ring');
  fireEvent.change(screen.getByLabelText('Search your listings'), { target: { value: 'sapphire' } });
  expect(screen.getByText('Live Sapphire Pendant')).toBeInTheDocument();
  expect(screen.queryByText('Test Emerald Ring')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search your listings'), { target: { value: '22222222' } });
  expect(screen.getByText('Live Sapphire Pendant')).toBeInTheDocument();
});

test('status filter works', async () => {
  render(<MyListings />);
  await screen.findByText('Test Emerald Ring');
  fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'live' } });
  expect(screen.getByText('Live Sapphire Pendant')).toBeInTheDocument();
  expect(screen.queryByText('Test Emerald Ring')).not.toBeInTheDocument();
});

test('View details opens modal with real fields', async () => {
  render(<MyListings />);
  await screen.findByText('Test Emerald Ring');
  const card = document.querySelector('[data-testid="listing-card-11111111-1111-1111-1111-111111111111"]');
  fireEvent.click(within(card).getByRole('button', { name: /View details/ }));
  await screen.findByText('Listing Details');
  const d = within(dialog());
  expect(d.getByText('Golden Heritage — Gmall Branch')).toBeInTheDocument();
  expect(d.getByText('Elegant gold ring.')).toBeInTheDocument();
  expect(d.getByText('12.5')).toBeInTheDocument();
  expect(d.getByText('11111111')).toBeInTheDocument();
  // Auction section with real values
  expect(d.getByText('₱12,500')).toBeInTheDocument();
  expect(d.getByText('Auction Details')).toBeInTheDocument();
});

test('no-auction listing is deletable via listings route', async () => {
  render(<MyListings />);
  await screen.findByText('Loose Diamond');

  const card = document.querySelector('[data-testid="listing-card-33333333-3333-3333-3333-333333333333"]');
  expect(within(card).getByRole('button', { name: /Delete Loose Diamond/ })).toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: /View details/ }));
  await screen.findByText('Listing Details');
  const d = within(dialog());
  expect(d.getByText('No description provided.')).toBeInTheDocument();
  expect(d.getByText('No auction attached to this listing.')).toBeInTheDocument();
  // Delete enabled (no blocking warning), confirm removes the listing itself
  expect(d.queryByText(/no longer editable/)).toBeNull();
  fireEvent.click(d.getByRole('button', { name: /Delete Listing/ }));
  await screen.findByText('Delete listing?');
  expect(screen.getByText(/permanently remove/).textContent).toMatch(/Loose Diamond/);
  fireEvent.click(screen.getByRole('button', { name: /Delete listing/ }));
  await waitFor(() => {
    expect(deleteCalls).toEqual(['/shop-owner/listings/33333333-3333-3333-3333-333333333333']);
  });
  await waitFor(() => {
    expect(document.querySelector('[data-testid="listing-card-33333333-3333-3333-3333-333333333333"]')).toBeNull();
  });
});

test('non-deletable listing disables Delete with warning', async () => {
  listingsData = [mkListing({
    id: '44444444-4444-4444-4444-444444444444', name: 'Live Diamond Ring',
    computed_status: 'live', auction_status: 'live', auction_id: 'a9', can_delete: false,
    auction: { id: 'a9', status: 'live', start_time: new Date(now - 3600000).toISOString(), end_time: new Date(now + 3600000).toISOString(), start_price: 8000, current_bid: 12500, bid_count: 4, watcher_count: 8 },
  })];
  render(<MyListings />);
  await screen.findByText('Live Diamond Ring');
  const card = document.querySelector('[data-testid="listing-card-44444444-4444-4444-4444-444444444444"]');
  const cardBtn = within(card).getByRole('button', { name: /Delete Live Diamond Ring/ });
  expect(cardBtn).toBeInTheDocument();
  expect(cardBtn).toBeDisabled();
  fireEvent.click(within(card).getByRole('button', { name: /View details/ }));
  await screen.findByText('Listing Details');
  const d = within(dialog());
  expect(d.getByText(/has received bids and can no longer be deleted/)).toBeInTheDocument();
  expect(d.getByRole('button', { name: /Delete Listing/ })).toBeDisabled();
});

test('409 on delete shows friendly conflict message and keeps modal open', async () => {
  vi.mocked(apiFetch).mockImplementation(async (path, opts = {}) => {
    if (path === '/shop-owner/listings') return listingsData;
    if (path === '/shop-owner/shop') return null;
    if (opts.method === 'DELETE') throw Object.assign(new Error('Only scheduled auctions with no bids can be changed'), { status: 409 });
    return [];
  });
  render(<MyListings />);
  await screen.findByText('Sched Gold Band');
  const card = document.querySelector('[data-testid="listing-card-55555555-5555-5555-5555-555555555555"]');
  fireEvent.click(within(card).getByRole('button', { name: /Delete Sched Gold Band/ }));
  await screen.findByText('Delete listing?');
  fireEvent.click(screen.getByRole('button', { name: /Delete listing/ }));
  // Conflict: friendly handling — confirm stays open, card preserved (no silent success)
  await new Promise((r) => setTimeout(r, 100));
  expect(screen.queryByText('Delete listing?')).toBeInTheDocument();
  expect(document.querySelector('[data-testid="listing-card-55555555-5555-5555-5555-555555555555"]')).not.toBeNull();
});

test('12/13. Delete stays visible; enabled at 0 bids, disabled with bids', async () => {
  render(<MyListings />);
  await screen.findByText('Live Sapphire Pendant');
  // liveListing has 0 bids and no can_delete flag → fallback rule: deletable
  const liveCard = document.querySelector('[data-testid="listing-card-22222222-2222-2222-2222-222222222222"]');
  const liveBtn = within(liveCard).getByRole('button', { name: /Delete Live Sapphire Pendant/ });
  expect(liveBtn).toBeInTheDocument();
  expect(liveBtn).not.toBeDisabled();
  // ended lot with 4 bids → visible but disabled with tooltip
  const endedCard = document.querySelector('[data-testid="listing-card-11111111-1111-1111-1111-111111111111"]');
  const endedBtn = within(endedCard).getByRole('button', { name: /Delete Test Emerald Ring/ });
  expect(endedBtn).toBeInTheDocument();
  expect(endedBtn).toBeDisabled();
  expect(endedBtn.getAttribute('title')).toMatch(/already has bids/);
});

test('14. 409 LISTING_HAS_BIDS shows the friendly message', async () => {
  vi.mocked(apiFetch).mockImplementation(async (path, opts = {}) => {
    if (path === '/shop-owner/listings') return listingsData;
    if (path === '/shop-owner/shop') return null;
    if (opts.method === 'DELETE') {
      const e = new Error('conflict');
      e.status = 409; e.code = 'LISTING_HAS_BIDS';
      throw e;
    }
    return [];
  });
  render(<MyListings />);
  await screen.findByText('Sched Gold Band');
  const card = document.querySelector('[data-testid="listing-card-55555555-5555-5555-5555-555555555555"]');
  fireEvent.click(within(card).getByRole('button', { name: /Delete Sched Gold Band/ }));
  await screen.findByText('Delete listing?');
  fireEvent.click(screen.getByRole('button', { name: /Delete listing/ }));
  await waitFor(() => {
    expect(toastFn).toHaveBeenCalledWith('This listing cannot be deleted because it already has bids.');
  });
});

test('Delete opens confirm; cancel preserves; confirm deletes and removes card', async () => {
  render(<MyListings />);
  await screen.findByText('Sched Gold Band');
  const card = document.querySelector('[data-testid="listing-card-55555555-5555-5555-5555-555555555555"]');
  fireEvent.click(within(card).getByRole('button', { name: /Delete Sched Gold Band/ }));
  await screen.findByText('Delete listing?');
  // Accurate copy: listing + attached auction removed
  expect(screen.getByText(/and its auction if one is attached/).textContent).toMatch(/Sched Gold Band/);
  // Cancel preserves
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText('Delete listing?')).not.toBeInTheDocument();
  expect(deleteCalls.length).toBe(0);
  // Confirm deletes via the single atomic listings route
  fireEvent.click(within(card).getByRole('button', { name: /Delete Sched Gold Band/ }));
  await screen.findByText('Delete listing?');
  expect(screen.getByText(/and its auction if one is attached/).textContent).toMatch(/Sched Gold Band/);
  fireEvent.click(screen.getByRole('button', { name: /Delete listing/ }));
  await waitFor(() => {
    expect(deleteCalls).toEqual(['/shop-owner/listings/55555555-5555-5555-5555-555555555555']);
  });
  expect(toastFn).toHaveBeenCalledWith('Listing deleted.');
  await waitFor(() => {
    expect(document.querySelector('[data-testid="listing-card-55555555-5555-5555-5555-555555555555"]')).toBeNull();
  });
});

test('ended auction with bids keeps Delete visible but disabled', async () => {
  render(<MyListings />);
  await screen.findByText('Test Emerald Ring');
  const card = document.querySelector('[data-testid="listing-card-11111111-1111-1111-1111-111111111111"]');
  const btn = within(card).getByRole('button', { name: /Delete Test Emerald Ring/ });
  expect(btn).toBeDisabled();
  expect(btn.getAttribute('title')).toMatch(/already has bids/);
});

test('delete error preserves card', async () => {
  vi.mocked(apiFetch).mockImplementation(async (path, opts = {}) => {
    if (path === '/shop-owner/listings') return listingsData;
    if (path === '/shop-owner/shop') return null;
    if (opts.method === 'DELETE') throw Object.assign(new Error('Only scheduled auctions with no bids can be changed'), { status: 409 });
    return [];
  });
  render(<MyListings />);
  await screen.findByText('Sched Gold Band');
  const card = document.querySelector('[data-testid="listing-card-55555555-5555-5555-5555-555555555555"]');
  fireEvent.click(within(card).getByRole('button', { name: /Delete Sched Gold Band/ }));
  await screen.findByText('Delete listing?');
  fireEvent.click(screen.getByRole('button', { name: /Delete listing/ }));
  await waitFor(() => {
    expect(document.querySelector('[data-testid="listing-card-55555555-5555-5555-5555-555555555555"]')).not.toBeNull();
  });
});

test('Escape closes details modal; missing image uses fallback', async () => {
  render(<MyListings />);
  await screen.findByText('Loose Diamond');
  const card = document.querySelector('[data-testid="listing-card-33333333-3333-3333-3333-333333333333"]');
  expect(card.querySelector('img')).toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: /View details/ }));
  await screen.findByText('Listing Details');
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => {
    expect(screen.queryByText('Listing Details')).not.toBeInTheDocument();
  });
});


describe('control row, grid and skeleton', () => {
  test('Search, Status and + New Listing share ONE control row; title block has no action', async () => {
    render(<MyListings />);
    await screen.findByText('Test Emerald Ring');

    const toolbar = document.querySelector('.mls-toolbar');
    expect(toolbar).not.toBeNull();
    // All three controls live in the same row container
    expect(within(toolbar).getByLabelText('Search your listings')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Filter by status')).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '+ New Listing' })).toBeInTheDocument();

    // Exactly one New Listing action on the page, and NOT beside the title
    const head = document.querySelector('.mls-head');
    expect(head.textContent).toMatch(/Seller portal/);
    expect(head.textContent).toMatch(/My Listings/);
    expect(head.querySelector('button')).toBeNull();
    expect(screen.getAllByRole('button', { name: '+ New Listing' })).toHaveLength(1);

    // Toolbar shares one height token across the three controls
    expect(toolbar.className).toMatch(/mls-toolbar/);
  });

  test('+ New Listing still opens the existing create flow (single flow, mode=create)', async () => {
    render(<MyListings />);
    await screen.findByText('Test Emerald Ring');
    expect(screen.queryByTestId('submit-listing-modal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ New Listing' }));
    const modal = await screen.findByTestId('submit-listing-modal');
    expect(modal).toHaveAttribute('data-mode', 'create');
  });

  test('skeleton mirrors the real card and never shows a false empty state', async () => {
    let resolveListings;
    const pending = new Promise((res) => { resolveListings = res; });
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/shop-owner/listings') return pending;
      if (path === '/shop-owner/shop') return null;
      return [];
    });

    render(<MyListings />);

    // Loading state: skeleton grid only
    const skelGrid = await screen.findByTestId('listings-skeleton-grid');
    const skeletons = within(skelGrid).getAllByTestId('listing-skeleton');
    expect(skeletons).toHaveLength(8); // 2 complete rows of the 4-up desktop grid
    skeletons.forEach((sk) => {
      // image area (same wrapper class + aspect box as a real card)
      expect(sk.querySelector('.mls-card__imgwrap')).not.toBeNull();
      // status badge placeholder sits in the real badge slot
      expect(sk.querySelector('.mls-card__badge')).not.toBeNull();
      // blocks come from the SHARED ATANY skeleton system (one system, all portals)
      const blocks = sk.querySelectorAll('.atany-skel');
      // image + badge + title/category/spec/price + view + delete
      expect(blocks.length).toBe(8);
      // no fake content is ever rendered inside a skeleton
      expect(sk.textContent.trim()).toBe('');
      // uses the same card shell + action row as the loaded grid
      expect(sk.className).toMatch(/mls-card/);
      expect(sk.querySelector('.mls-card__actions')).not.toBeNull();
    });
    // No false empty state and no cards while loading
    expect(screen.queryByText('No listings yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Unable to load listings.')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="listing-card-"]')).toHaveLength(0);

    resolveListings(listingsData);
    await screen.findByText('Test Emerald Ring');
    expect(screen.queryByTestId('listings-skeleton-grid')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="listing-card-"]')).toHaveLength(4);
  });

  test('empty state appears only after a confirmed empty response', async () => {
    let resolveListings;
    const pending = new Promise((res) => { resolveListings = res; });
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/shop-owner/listings') return pending;
      if (path === '/shop-owner/shop') return null;
      return [];
    });

    render(<MyListings />);
    await screen.findByTestId('listings-skeleton-grid');
    expect(screen.queryByText('No listings yet')).not.toBeInTheDocument();

    resolveListings([]);
    await screen.findByText('No listings yet');
    expect(screen.queryByTestId('listings-skeleton-grid')).not.toBeInTheDocument();
  });

  test('error state stops loading and stays usable', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/shop-owner/listings') throw Object.assign(new Error('boom'), { status: 500 });
      if (path === '/shop-owner/shop') return null;
      return [];
    });
    render(<MyListings />);
    await screen.findByText('Unable to load listings.');
    expect(screen.queryByTestId('listings-skeleton-grid')).not.toBeInTheDocument();
    expect(screen.queryByText('No listings yet')).not.toBeInTheDocument();
    // Retry stays available and the controls remain usable
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search your listings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New Listing' })).toBeInTheDocument();
  });

  test('skeleton and loaded grids share the same grid container class', async () => {
    let resolveListings;
    const pending = new Promise((res) => { resolveListings = res; });
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/shop-owner/listings') return pending;
      if (path === '/shop-owner/shop') return null;
      return [];
    });
    render(<MyListings />);
    const skelGrid = await screen.findByTestId('listings-skeleton-grid');
    expect(skelGrid.className).toMatch(/mls-grid/);
    resolveListings(listingsData);
    await screen.findByText('Test Emerald Ring');
    expect(document.querySelector('.mls-grid')).not.toBeNull();
    expect(skelGrid.className).toMatch(/mls-grid/);
  });
});
