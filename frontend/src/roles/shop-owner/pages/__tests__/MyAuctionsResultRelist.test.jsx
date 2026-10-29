import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { vi, afterEach } from 'vitest';
import MyAuctions from '../MyAuctions';
import { apiFetch } from '../../../../shared/lib/apiClient';

const now = Date.now();
const endedAuction = {
  id: 'ended-9', lot_code: 'LOT-9009', title: 'Rose Gold Bangle', category: 'Bracelets',
  image_url: 'x.jpg', branch: 'Gmall Branch', status: 'ended', stored_status: 'ended',
  start_time: new Date(now - 86400000).toISOString(), end_time: new Date(now - 3600000).toISOString(),
  start_price: 54000, startPrice: 54000, current_bid: 55000, bid_count: 1, watcher_count: 0,
  minimum_bid_increment: 500,
  leaderboard: [{ rank: 1, bidder_id: 'u9', bidder_name: 'britz Susada', amount: 55000, created_at: new Date().toISOString(), is_winner: true }],
};
const liveAuction = {
  id: 'live-9', lot_code: 'LOT-9010', title: 'Live Ring', category: 'Rings',
  image_url: 'y.jpg', branch: 'Gmall Branch', status: 'live', stored_status: 'live',
  start_time: new Date(now - 3600000).toISOString(), end_time: new Date(now + 3600000).toISOString(),
  start_price: 1000, current_bid: 1000, bid_count: 0, watcher_count: 0, leaderboard: [],
};
let managePayload;
let relistCalls;
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../shared/lib/socketClient', () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

beforeEach(() => {
  window.localStorage.clear();
  managePayload = {
    summary: { total: 2, live: 1, scheduled: 0, paused: 0, ended: 1 },
    categories: [{ name: 'Bracelets', count: 1 }, { name: 'Rings', count: 1 }],
    auctions: [endedAuction, liveAuction],
  };
  relistCalls = [];
  vi.mocked(apiFetch).mockImplementation(async (path, opts = {}) => {
    if (path.includes('/manage')) return managePayload;
    if (path.includes('/top-bidders')) return [];
    if (path.includes('/relist') && opts.method === 'POST') {
      relistCalls.push(JSON.parse(opts.body));
      managePayload = {
        ...managePayload,
        summary: { total: 3, live: 1, scheduled: 1, paused: 0, ended: 1 },
        auctions: [...managePayload.auctions, { ...endedAuction, id: 'new-1', status: 'scheduled', stored_status: 'scheduled', start_time: new Date(now + 86400000).toISOString(), end_time: new Date(now + 8 * 86400000).toISOString() }],
      };
      return { id: 'new-1', status: 'scheduled' };
    }
    return [];
  });
});
afterEach(() => cleanup());

function openResult() {
  const card = document.querySelector('[data-testid="auction-card-ended-9"]');
  const btn = Array.from(card.querySelectorAll('button')).find((b) => /View result/.test(b.textContent));
  fireEvent.click(btn);
}
function openRelist() {
  const card = document.querySelector('[data-testid="auction-card-ended-9"]');
  const btn = Array.from(card.querySelectorAll('button')).find((b) => /Relist/.test(b.textContent));
  fireEvent.click(btn);
}

test('View result opens themed modal with real data', async () => {
  render(<MyAuctions />);
  await screen.findByText('Rose Gold Bangle');
  openResult();
  await screen.findByText('Auction result');
  const d = within(screen.getByRole('dialog'));
  expect(d.getByText('Rose Gold Bangle')).toBeInTheDocument();
  expect(d.getByText('Winner confirmed')).toBeInTheDocument();
  expect(d.getAllByText('britz Susada').length).toBeGreaterThanOrEqual(2);
  expect(d.getAllByText('₱55,000').length).toBeGreaterThanOrEqual(2);
  expect(d.getByText('Top bidders')).toBeInTheDocument();
  expect(d.getByText('Winner', { selector: '.result-board__tag' })).toBeInTheDocument();
  expect(d.getByText('Bids')).toBeInTheDocument();
  expect(d.getByText('Watchers')).toBeInTheDocument();
  fireEvent.click(d.getByRole('button', { name: 'Close' }));
  await waitFor(() => {
    expect(screen.queryByText('Top bidders')).not.toBeInTheDocument();
  });
});

test('Relist opens 2-step wizard; success auto-closes, filters Scheduled, shows new lot', async () => {
  render(<MyAuctions />);
  await screen.findByText('Rose Gold Bangle');
  openRelist();
  await screen.findByText('Relist auction');
  // Exactly 2 steps, no Lot Details / Bidding Rules
  expect(screen.getByText('Schedule')).toBeInTheDocument();
  expect(screen.getByText('Review')).toBeInTheDocument();
  expect(screen.queryByText('Lot Details')).toBeNull();
  expect(screen.queryByText('Bidding Rules')).toBeNull();
  // Default schedule is future-valid: Continue straight to Review
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Minimum Bid Increment');
  // Inherited bidding rules displayed read-only
  const dlg = within(screen.getByRole('dialog'));
  expect(dlg.getByText('₱54,000')).toBeInTheDocument();
  expect(dlg.getByText('₱500')).toBeInTheDocument();
  fireEvent.click(dlg.getByRole('button', { name: 'Relist auction' }));
  await waitFor(() => {
    expect(relistCalls.length).toBe(1);
  });
  expect(Object.keys(relistCalls[0]).sort()).toEqual(['end_time', 'start_time']);
  // Auto-close, success toast, no success modal
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  // Scheduled filter active: only the new lot visible; counts updated
  await waitFor(() => {
    expect(screen.getByText('Rose Gold Bangle')).toBeInTheDocument();
  });
  const tabs = screen.getAllByRole('tab');
  const scheduledTab = tabs.find((el) => el.textContent.startsWith('Scheduled'));
  expect(scheduledTab.getAttribute('aria-selected')).toBe('true');
  expect(scheduledTab.textContent).toMatch(/1/);
  expect(tabs.find((el) => el.textContent.startsWith('Ended')).textContent).toMatch(/1/);
  expect(tabs.find((el) => el.textContent.startsWith('All status')).textContent).toMatch(/3/);
  // Ended original preserved: switch back to All → both lots visible
  fireEvent.click(tabs.find((el) => el.textContent.startsWith('All status')));
  await waitFor(() => {
    expect(screen.getAllByText('Rose Gold Bangle').length).toBe(2);
  });
});

test('Relist failure keeps wizard open', async () => {
  vi.mocked(apiFetch).mockImplementation(async (path, opts = {}) => {
    if (path.includes('/manage')) return managePayload;
    if (path.includes('/top-bidders')) return [];
    if (path.includes('/relist')) throw new Error('Unable to relist auction. Please try again.');
    return [];
  });
  render(<MyAuctions />);
  await screen.findByText('Rose Gold Bangle');
  openRelist();
  await screen.findByText('Relist auction');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Minimum Bid Increment');
  fireEvent.click(screen.getByRole('button', { name: 'Relist auction' }));
  await new Promise((r) => setTimeout(r, 100));
  expect(screen.queryByRole('dialog')).not.toBeNull();
});
