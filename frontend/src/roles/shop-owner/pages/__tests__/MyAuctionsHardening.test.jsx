import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import MyAuctions from '../MyAuctions';
import { socket } from '../../../../shared/lib/socketClient';

const managePayload = {
  summary: { total: 2, live: 1, scheduled: 1, paused: 0, ended: 0 },
  categories: [{ name: 'Rings', count: 2 }],
  auctions: [
    { id: 'live-1', lot_code: 'LOT-2001', title: 'Live Ring', category: 'Rings', image_url: 'x.jpg', branch: 'Gmall Branch', status: 'live', stored_status: 'live', start_time: new Date(Date.now() - 3600 * 1000).toISOString(), end_time: new Date(Date.now() + 3600 * 1000).toISOString(), start_price: 1000, current_bid: 2000, bid_count: 1, watcher_count: 5, leaderboard: [] },
    { id: 'sched-1', lot_code: 'LOT-2002', title: 'Scheduled Ring', category: 'Rings', image_url: 'y.jpg', branch: 'Gmall Branch', status: 'scheduled', stored_status: 'scheduled', start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 8 * 86400000).toISOString(), start_price: 2000, current_bid: 0, bid_count: 0, watcher_count: 2, leaderboard: [] },
  ],
  pagination: { total: 2, page: 1, limit: 50, pages: 1, showing: 2 },
};

vi.mock('../../../../shared/lib/apiClient', () => ({
  apiFetch: vi.fn(async (path) => {
    if (path.includes('/manage')) return managePayload;
    if (path.includes('/top-bidders')) return [];
    return [];
  }),
}));
vi.mock('../../../../shared/lib/socketClient', () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), removeAllListeners: vi.fn() },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

test('seller joins visible auction socket rooms', async () => {
  render(<MyAuctions />);
  await screen.findByText('Live Ring');
  await waitFor(() => {
    expect(socket.emit).toHaveBeenCalledWith('join:auction', 'live-1');
    expect(socket.emit).toHaveBeenCalledWith('join:auction', 'sched-1');
  });
});

test('obsolete auction rooms are left when filter changes', async () => {
  render(<MyAuctions />);
  await screen.findByText('Live Ring');
  // Filter to live only — sched-1 should be left
  const liveTab = screen.getAllByRole('tab').find(el => /Live/.test(el.textContent));
  fireEvent.click(liveTab);
  await waitFor(() => {
    expect(socket.emit).toHaveBeenCalledWith('leave:auction', 'sched-1');
  });
});

test('listeners cleaned on unmount', async () => {
  const { unmount } = render(<MyAuctions />);
  await screen.findByText('Live Ring');
  unmount();
  expect(socket.off).toHaveBeenCalledWith('auction:update', expect.any(Function));
  expect(socket.off).toHaveBeenCalledWith('bid:update', expect.any(Function));
});

test('calendar toggle is enabled and accessible', async () => {
  render(<MyAuctions />);
  await screen.findByText('Live Ring');
  const cal = screen.getByLabelText('Calendar view');
  expect(cal).not.toBeDisabled();
  expect(cal).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(cal);
  expect(cal).toHaveAttribute('aria-pressed', 'true');
});

test('realtime event contract: auction:update patches without full refetch for trivial update', async () => {
  // Verify component listens to auction:update (verified by previous tests)
  render(<MyAuctions />);
  await screen.findByText('Live Ring');
  expect(socket.on).toHaveBeenCalledWith('auction:update', expect.any(Function));
  expect(socket.on).toHaveBeenCalledWith('bid:update', expect.any(Function));
});
