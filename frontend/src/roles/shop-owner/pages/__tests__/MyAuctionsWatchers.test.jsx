import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { vi, afterEach, beforeEach } from 'vitest';
import MyAuctions from '../MyAuctions';
import { apiFetch } from '../../../../shared/lib/apiClient';

const handlers = new Map();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../shared/lib/socketClient', () => ({
  socket: {
    emit: vi.fn(),
    on: (e, fn) => { handlers.set(e, fn); },
    off: (e) => { handlers.delete(e); },
  },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

const now = Date.now();
const liveAuction = {
  id: 'live-7', lot_code: 'LOT-7007', title: 'Watched Ring', category: 'Rings',
  image_url: null, branch: 'B', status: 'live', stored_status: 'live',
  start_time: new Date(now - 3600000).toISOString(), end_time: new Date(now + 3600000).toISOString(),
  start_price: 1000, current_bid: 2000, bid_count: 0, watcher_count: 0, watchers: 0, leaderboard: [],
};

beforeEach(() => {
  handlers.clear();
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path.includes('/manage')) {
      return {
        summary: { total: 1, live: 1, scheduled: 0, paused: 0, ended: 0 },
        categories: [{ name: 'Rings', count: 1 }],
        auctions: [liveAuction],
      };
    }
    if (path.includes('/top-bidders')) return [];
    return [];
  });
});
afterEach(() => cleanup());

test('seller card receives realtime watcher count without reload', async () => {
  const { container } = render(<MyAuctions />);
  await screen.findByText('Watched Ring');
  expect(container.querySelector('.mauc-page').textContent).toMatch(/Watchers/);
  const watcherValue = () => {
    const card = container.querySelector('[data-testid="auction-card-live-7"]');
    const stats = Array.from(card.querySelectorAll('.mauc-stat'));
    const w = stats.find((s) => s.textContent.startsWith('Watchers'));
    return w.querySelector('.mauc-stat__value').textContent;
  };
  handlers.get('auction:watchers')?.({ auctionId: 'live-7', watcherCount: 2 });
  await waitFor(() => {
    expect(watcherValue()).toBe('2');
  });
  // Further updates stay in sync
  handlers.get('auction:watchers')?.({ auctionId: 'live-7', watcherCount: 1 });
  await waitFor(() => {
    expect(watcherValue()).toBe('1');
  });
});
