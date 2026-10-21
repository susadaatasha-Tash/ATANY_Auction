// frontend/src/roles/shop-owner/pages/__tests__/MyAuctionsRelistFlow.test.jsx
// Integration: Seller → My Auctions → Relist opens the shared wizard, submits
// to the existing relist endpoint, refreshes the list and keeps the original
// ended lot visible.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MyAuctions from '../MyAuctions';

const now = Date.now();
const endedAuction = {
  id: 'ended-1', lot_code: 'A-812', auction_code: 'A-812', title: 'Rose Gold Bangle', category: 'Bracelets',
  image_url: 'bangle.jpg', branch: 'Gmall Branch', status: 'ended', stored_status: 'ended',
  start_time: new Date(now - 8 * 86400000).toISOString(),
  end_time: new Date(now - 86400000).toISOString(),
  start_price: 50000, current_bid: 55000, minimum_bid_increment: 2500,
  bid_count: 1, watcher_count: 4,
  karat_weight: '18K', description: 'Real description',
  leaderboard: [{ rank: 1, bidder_id: 'u1', bidder_name: 'Anthony Ong', amount: 55000, is_winner: true, is_top_bidder: true }],
};

let managePayload;
let relistCalls;
let manageCalls;

vi.mock('../../../../shared/lib/apiClient', () => ({
  apiFetch: vi.fn(async (path, opts) => {
    if (path.includes('/top-bidders')) return [];
    if (path.includes('/relist')) {
      relistCalls.push({ path, opts });
      return { id: 'new-auc', status: 'scheduled' };
    }
    if (path.includes('/result')) return { auction: { id: 'ended-1' } };
    if (path.includes('/manage')) {
      manageCalls++;
      return managePayload;
    }
    return [];
  }),
}));
vi.mock('../../../../shared/lib/socketClient', () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

beforeEach(() => {
  relistCalls = [];
  manageCalls = 0;
  managePayload = {
    summary: { total: 1, live: 0, scheduled: 0, paused: 0, ended: 1 },
    categories: [{ name: 'Bracelets', count: 1 }],
    auctions: [endedAuction],
    pagination: { total: 1, page: 1, limit: 50, pages: 1, showing: 1 },
  };
});

test('Relist opens the shared 4-step wizard (not the old two-field form)', async () => {
  render(<MyAuctions />);
  await screen.findByText('Rose Gold Bangle');
  fireEvent.click(screen.getByText(/Relist/));
  await waitFor(() => expect(screen.getByText('Relist Auction — Rose Gold Bangle')).toBeInTheDocument());
  ['Lot Details', 'Schedule', 'Bidding Rules', 'Review'].forEach((l) => {
    expect(screen.getByText(l)).toBeInTheDocument();
  });
  expect(screen.getByText('Step 1 of 4 · Lot Details')).toBeInTheDocument();
  // The old plain datetime-local form is gone.
  expect(document.querySelectorAll('input[type="datetime-local"]').length).toBe(0);
});

test('the relist wizard prefills the real lot data from the ended auction', async () => {
  render(<MyAuctions />);
  await screen.findByText('Rose Gold Bangle');
  fireEvent.click(screen.getByText(/Relist/));
  await waitFor(() => expect(screen.getByText('Relist Auction — Rose Gold Bangle')).toBeInTheDocument());
  expect(screen.getByText(/Original lot A-812/)).toBeInTheDocument();
  expect(screen.getAllByText(/Bracelets/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Gmall Branch/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/18K/).length).toBeGreaterThan(0);
});

test('27. a successful relist calls the existing endpoint and refreshes the list', async () => {
  render(<MyAuctions />);
  await screen.findByText('Rose Gold Bangle');
  fireEvent.click(screen.getByText(/Relist/));
  await waitFor(() => expect(screen.getByText('Step 1 of 4 · Lot Details')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.getByText('Step 2 of 4 · Schedule')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.getByText('Step 3 of 4 · Bidding Rules')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.getByText('Step 4 of 4 · Review')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Relist Auction' }));

  await waitFor(() => expect(relistCalls.length).toBe(1));
  expect(relistCalls[0].path).toBe('/shop-owner/auctions/ended-1/relist');
  expect(relistCalls[0].opts.method).toBe('POST');
  const body = JSON.parse(relistCalls[0].opts.body);
  expect(body.start_time).toBeTruthy();
  expect(body.end_time).toBeTruthy();
  expect(body.start_price).toBe(50000);
  expect(body.minimum_bid_increment).toBe(2500);
  // The list is refetched so the new auction shows up.
  await waitFor(() => expect(manageCalls).toBeGreaterThanOrEqual(2));
});

test('28. the original ended lot stays listed after relisting', async () => {
  render(<MyAuctions />);
  await screen.findByText('Rose Gold Bangle');
  fireEvent.click(screen.getByText(/Relist/));
  await waitFor(() => expect(screen.getByText('Step 1 of 4 · Lot Details')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.getByText('Step 2 of 4 · Schedule')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.getByText('Step 3 of 4 · Bidding Rules')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.getByText('Step 4 of 4 · Review')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Relist Auction' }));

  await waitFor(() => expect(screen.queryByText('Relist Auction — Rose Gold Bangle')).not.toBeInTheDocument());
  // The ended lot is still in the list, still in the Ended group.
  expect(screen.getByText('Rose Gold Bangle')).toBeInTheDocument();
  const heads = [...document.querySelectorAll('.mauc-section__head')].map((h) => h.textContent);
  expect(heads.some((h) => /Ended/.test(h))).toBe(true);
});
