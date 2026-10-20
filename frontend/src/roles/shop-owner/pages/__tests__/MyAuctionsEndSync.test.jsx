import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import MyAuctions from '../MyAuctions';
import { LiveAuctionCard } from '../../components/LiveAuctionCard';
import { apiFetch } from '../../../../shared/lib/apiClient';
import { socket } from '../../../../shared/lib/socketClient';

const now = Date.now();
const liveAuction = {
  id: 'live-9', lot_code: 'LOT-9001', title: 'Live Emerald Ring', category: 'Rings',
  image_url: 'x.jpg', branch: 'Gmall Branch', status: 'live', stored_status: 'live',
  start_time: new Date(now - 3600 * 1000).toISOString(),
  end_time: new Date(now + 3600 * 1000).toISOString(),
  start_price: 1000, current_bid: 2000, bid_count: 1, watcher_count: 5, leaderboard: [],
};
const endedAuction = {
  ...liveAuction, status: 'ended', stored_status: 'ended', paused_at: null,
  leaderboard: [{ rank: 1, bidder_id: 'u9', bidder_name: 'Buyer Nine', amount: 2000, created_at: new Date().toISOString(), is_winner: true }],
};
const manageLive = {
  summary: { total: 1, live: 1, scheduled: 0, paused: 0, ended: 0 },
  categories: [{ name: 'Rings', count: 1 }],
  auctions: [liveAuction],
};
const manageEnded = {
  summary: { total: 1, live: 0, scheduled: 0, paused: 0, ended: 1 },
  categories: [{ name: 'Rings', count: 1 }],
  auctions: [endedAuction],
};

let manageCalls;
let socketHandlers;
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../shared/lib/socketClient', () => ({
  socket: {
    on: vi.fn((evt, fn) => { socketHandlers.set(evt, fn); }),
    off: vi.fn((evt) => { socketHandlers.delete(evt); }),
    emit: vi.fn(),
  },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

beforeEach(() => {
  manageCalls = 0;
  socketHandlers = new Map();
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path.includes('/top-bidders')) return [];
    if (path.endsWith('/end')) return endedAuction;
    if (path.includes('/manage')) return manageCalls++ === 0 ? managePayloadLive() : manageEnded;
    return [];
  });
});
function managePayloadLive() {
  return manageLive;
}
function auctionUpdate(payload) {
  socketHandlers.get('auction:update')?.(payload);
}

test('End moves card Live→Ended immediately, closes modal, refreshes', async () => {
  render(<MyAuctions />);
  await screen.findByText('Live Emerald Ring');
  fireEvent.click(screen.getByRole('button', { name: 'End auction now' }));
  await screen.findByText('End auction now?');
  fireEvent.click(screen.getByRole('button', { name: 'End auction' }));
  // Modal closes without waiting for refetch
  await waitFor(() => {
    expect(screen.queryByText('End auction now?')).not.toBeInTheDocument();
  });
  // Ended controls replace live controls (optimistic patch, then authoritative)
  await waitFor(() => {
    expect(screen.getByText(/View result/)).toBeInTheDocument();
  });
  expect(screen.getByText(/Relist/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Extend bidding by 5 minutes')).not.toBeInTheDocument();
  // Counts: Live 1→0, Ended 0→1, total unchanged
  const tabs = screen.getAllByRole('tab');
  expect(tabs.find((el) => el.textContent.startsWith('Live')).textContent).toMatch(/0/);
  expect(tabs.find((el) => el.textContent.startsWith('Ended')).textContent).toMatch(/1/);
  expect(tabs.find((el) => el.textContent.startsWith('All status')).textContent).toMatch(/1/);
  // fetchAll ran after mutation (initial + refetch)
  expect(vi.mocked(apiFetch).mock.calls.filter(([p]) => p.includes('/manage')).length).toBeGreaterThanOrEqual(2);
});

test('socket auction:update status=ended moves card to Ended', async () => {
  render(<MyAuctions />);
  await screen.findByText('Live Emerald Ring');
  auctionUpdate({ auction_id: 'live-9', status: 'ended', current_bid: 2000, bid_count: 1, start_time: liveAuction.start_time, end_time: liveAuction.end_time, paused_at: null });
  await waitFor(() => {
    expect(screen.getByText(/View result/)).toBeInTheDocument();
  });
  expect(document.querySelector('.mauc-section__head')?.textContent).toMatch(/Ended/);
});

test('stale live event cannot resurrect an ended auction', async () => {
  render(<MyAuctions />);
  await screen.findByText('Live Emerald Ring');
  auctionUpdate({ auction_id: 'live-9', status: 'ended', current_bid: 2000, bid_count: 1, end_time: liveAuction.end_time, paused_at: null });
  await screen.findByText(/View result/);
  // Late/duplicate live payload (HTTP/socket race) must be ignored
  auctionUpdate({ auction_id: 'live-9', status: 'live', current_bid: 2000, bid_count: 2, end_time: liveAuction.end_time });
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.getByText(/View result/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Extend bidding by 5 minutes')).not.toBeInTheDocument();
});

test('sidebar live card disappears when the lot ends', () => {
  const { rerender } = render(
    <MemoryRouter><LiveAuctionCard auctions={[liveAuction]} loading={false} /></MemoryRouter>
  );
  expect(screen.getByText('LIVE NOW')).toBeInTheDocument();
  rerender(<MemoryRouter><LiveAuctionCard auctions={[endedAuction]} loading={false} /></MemoryRouter>);
  expect(screen.getByText('No live auction')).toBeInTheDocument();
  expect(screen.queryByText('LIVE NOW')).not.toBeInTheDocument();
});
