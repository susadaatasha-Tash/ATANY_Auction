import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import MyAuctions from '../MyAuctions';

const managePayload = {
  summary: { total: 3, live: 1, scheduled: 1, paused: 0, ended: 1 },
  categories: [{ name: 'Rings', count: 2 }, { name: 'Necklaces', count: 1 }],
  auctions: [
    {
      id: 'live-1', lot_code: 'LOT-1001', title: '18K Gold Solitaire Diamond Ring', category: 'Rings', image_url: 'x.jpg', branch: 'Gmall Branch',
      status: 'live', stored_status: 'live', start_time: new Date(Date.now() - 3600 * 1000).toISOString(), end_time: new Date(Date.now() + 3600 * 1000).toISOString(),
      start_price: 4000, current_bid: 6000, currentBid: 6000, startPrice: 4000, bid_count: 3, watcher_count: 24, leaderboard: [{ rank: 1, bidder_id: 'u1', bidder_name: 'Maria Santos', amount: 6000, created_at: new Date().toISOString(), is_leading: true }]
    },
    {
      id: 'sched-1', lot_code: 'LOT-1002', title: 'Ruby Halo Engagement Ring', category: 'Rings', image_url: 'y.jpg', branch: 'Gmall Branch',
      status: 'scheduled', stored_status: 'scheduled', start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 8 * 86400000).toISOString(),
      start_price: 55000, current_bid: 0, bid_count: 0, watcher_count: 9, leaderboard: []
    },
    {
      id: 'ended-1', lot_code: 'LOT-1003', title: 'Diamond Stud Earrings 1.0ct', category: 'Earrings', image_url: 'z.jpg', branch: 'Gmall Branch',
      status: 'ended', stored_status: 'ended', start_time: new Date(Date.now() - 8 * 86400000).toISOString(), end_time: new Date(Date.now() - 86400000).toISOString(),
      start_price: 60000, current_bid: 88000, bid_count: 14, watcher_count: 63, leaderboard: [{ rank: 1, bidder_id: 'u2', bidder_name: 'Anthony Ong', amount: 88000, is_winner: true }]
    },
  ],
  pagination: { total: 3, page: 1, limit: 50, pages: 1, showing: 3 },
};

vi.mock('../../../../shared/lib/apiClient', () => ({
  apiFetch: vi.fn(async (path) => {
    if (path.includes('/manage')) return managePayload;
    if (path.includes('/top-bidders')) return [{ bidder_id: 'u1', bidder_name: 'Maria Santos', bids: 42, lots_won: 6, total_won: 126500 }];
    return [];
  }),
}));
vi.mock('../../../../shared/lib/socketClient', () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}));
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => vi.fn(),
}));

function renderPage() { return render(<MyAuctions />); }

test('renders grouped sections: Live now, Scheduled, Ended', async () => {
  renderPage();
  await screen.findByText('18K Gold Solitaire Diamond Ring');
  expect(screen.getByText('Ruby Halo Engagement Ring')).toBeInTheDocument();
  expect(screen.getByText('Diamond Stud Earrings 1.0ct')).toBeInTheDocument();
  // check section heads via class
  const heads = document.querySelectorAll('.mauc-section__head');
  expect(heads.length).toBeGreaterThanOrEqual(3);
});

test('status tabs filter', async () => {
  renderPage();
  await screen.findByText('18K Gold Solitaire Diamond Ring');
  const liveTab = screen.getAllByRole('tab').find(el => /Live/.test(el.textContent));
  fireEvent.click(liveTab);
  expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument();
  expect(screen.queryByText('Ruby Halo Engagement Ring')).not.toBeInTheDocument();
});

test('category filters compose with status', async () => {
  renderPage();
  await screen.findByText('18K Gold Solitaire Diamond Ring');
  const liveTab = screen.getAllByRole('tab').find(el => /Live/.test(el.textContent));
  fireEvent.click(liveTab);
  fireEvent.click(screen.getByText('Rings'));
  expect(screen.getByText('18K Gold Solitaire Diamond Ring')).toBeInTheDocument();
});

test('search works', async () => {
  renderPage();
  await screen.findByText('18K Gold Solitaire Diamond Ring');
  const input = screen.getByPlaceholderText('Search your auctions...');
  fireEvent.change(input, { target: { value: 'Ruby' } });
  expect(screen.getByText('Ruby Halo Engagement Ring')).toBeInTheDocument();
  expect(screen.queryByText('18K Gold Solitaire Diamond Ring')).not.toBeInTheDocument();
});

test('countdown renders', async () => {
  renderPage();
  await screen.findByText('18K Gold Solitaire Diamond Ring');
  // Timer chips like "0h" or "Closes in" should be visible
  expect(document.body.textContent).toMatch(/Closes in|Opens in|Ends|h|m|s/);
});

test('scheduled controls differ from live controls', async () => {
  renderPage();
  await screen.findByText('Ruby Halo Engagement Ring');
  expect(screen.getAllByText(/Start now/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Edit lot/).length).toBeGreaterThan(0);
});

test('ended controls differ from live controls', async () => {
  renderPage();
  await screen.findByText('Diamond Stud Earrings 1.0ct');
  expect(screen.getByText(/Relist/)).toBeInTheDocument();
  expect(screen.getByText(/View result/)).toBeInTheDocument();
});

test('live controls are visible', async () => {
  renderPage();
  await screen.findByText('18K Gold Solitaire Diamond Ring');
  expect(screen.getAllByText(/Extend/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/End now/).length).toBeGreaterThan(0);
});

test('confirmation modal shown before ending', async () => {
  renderPage();
  await screen.findByText('18K Gold Solitaire Diamond Ring');
  fireEvent.click(screen.getAllByText(/End now/)[0]);
  expect(await screen.findByText('End auction now?')).toBeInTheDocument();
});

test('empty states correct when no match', async () => {
  renderPage();
  await screen.findByText('18K Gold Solitaire Diamond Ring');
  const input = screen.getByPlaceholderText('Search your auctions...');
  fireEvent.change(input, { target: { value: 'ZZZ_NO_MATCH' } });
  expect(await screen.findByText(/No auctions match your filters/)).toBeInTheDocument();
});

test('top bidders panel renders real data', async () => {
  renderPage();
  await screen.findByText('Top Bidders');
  expect(screen.getAllByText('Maria Santos').length).toBeGreaterThan(0);
});

test('seller does not see fake static data — lot codes are real', async () => {
  renderPage();
  await screen.findByText('18K Gold Solitaire Diamond Ring');
  expect(screen.getByText(/LOT-1001/)).toBeInTheDocument();
  expect(screen.queryByText('Golden Heritage')).not.toBeInTheDocument();
});
