import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { vi, afterEach, beforeEach } from 'vitest';
import { DetailModal } from '../DetailModal';

const handlers = new Map();
const emitted = [];
vi.mock('../../../../shared/lib/socketClient', () => ({
  socket: {
    emit: (...a) => { emitted.push(a); },
    on: (e, fn) => { handlers.set(e, fn); },
    off: (e) => { handlers.delete(e); },
  },
}));

const now = Date.now();
const liveAuction = (over = {}) => ({
  id: 'a1', name: 'Ring', category: 'Rings', img: 'x.jpg', branch_name: 'B',
  status: 'live',
  startTime: new Date(now - 3600000).toISOString(), start_time: new Date(now - 3600000).toISOString(),
  endTime: new Date(now + 3600000).toISOString(), end_time: new Date(now + 3600000).toISOString(),
  startPrice: 70000, currentBid: 70000, minimum_bid_increment: 500,
  bids: 0, bidders: [], desc: 'd',
  ...over,
});
const base = { isFavorited: false, isNotifying: false, onClose: () => {}, onToggleFavorite: () => {}, onToggleNotify: () => {}, onPlaceBid: async () => ({}) };

beforeEach(() => { handlers.clear(); emitted.length = 0; });
afterEach(() => cleanup());

test('1. opening live modal joins room + watcher presence', () => {
  render(<DetailModal auction={liveAuction()} {...base} />);
  expect(emitted).toContainEqual(['join:auction', 'a1']);
  expect(emitted).toContainEqual(['auction:watch', { auctionId: 'a1' }]);
});

test('2. closing modal leaves presence and room', () => {
  const { unmount } = render(<DetailModal auction={liveAuction()} {...base} />);
  emitted.length = 0;
  unmount();
  expect(emitted).toContainEqual(['auction:unwatch', { auctionId: 'a1' }]);
  expect(emitted).toContainEqual(['leave:auction', 'a1']);
});

test('3. scheduled modal joins room but not presence', () => {
  render(<DetailModal auction={liveAuction({ status: 'scheduled', startTime: new Date(now + 3600000).toISOString(), start_time: new Date(now + 3600000).toISOString() })} {...base} />);
  expect(emitted).toContainEqual(['join:auction', 'a1']);
  expect(emitted.filter(([e]) => e === 'auction:watch').length).toBe(0);
});

test('4. watcher event updates the watching indicator without reload', async () => {
  render(<DetailModal auction={liveAuction()} {...base} />);
  expect(screen.queryByText(/watching/)).toBeNull();
  handlers.get('auction:watchers')?.({ auctionId: 'a1', watcherCount: 2 });
  await waitFor(() => {
    expect(document.querySelector('.detail-sub').textContent).toMatch(/2 watching/);
  });
});

test('5. bidding does not emit extra watcher events', async () => {
  const onPlaceBid = vi.fn(async () => ({}));
  render(<DetailModal auction={liveAuction()} {...base} onPlaceBid={onPlaceBid} />);
  const watches = () => emitted.filter(([e]) => e === 'auction:watch').length;
  expect(watches()).toBe(1);
  fireEvent.change(screen.getByLabelText('Your bid amount'), { target: { value: '70500' } });
  fireEvent.click(screen.getByRole('button', { name: 'Place Bid' }));
  await waitFor(() => expect(onPlaceBid).toHaveBeenCalledWith('a1', 70500));
  expect(watches()).toBe(1);
});
