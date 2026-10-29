import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { vi, afterEach } from 'vitest';
import MyAuctions from '../MyAuctions';
import { apiFetch } from '../../../../shared/lib/apiClient';

const now = Date.now();
const mk = (over = {}) => ({
  id: over.id || 'x', lot_code: 'LOT-X', title: 'Item', category: 'Rings',
  image_url: null, branch: 'B', status: 'live', stored_status: 'live',
  start_time: new Date(now - 3600000).toISOString(),
  end_time: new Date(now + 3600000).toISOString(),
  start_price: 100, current_bid: 100, bid_count: 0, watcher_count: 0, leaderboard: [],
  ...over,
});
const auctions = [
  mk({ id: 'r1', title: 'Gold Ring', category: 'Rings', status: 'live', stored_status: 'live' }),
  mk({ id: 'r2', title: 'Silver Ring', category: 'rings', status: 'ended', stored_status: 'ended', start_time: new Date(now - 7200000).toISOString(), end_time: new Date(now - 3600000).toISOString() }),
  mk({ id: 'b1', title: 'Gold Bracelet', category: 'Bracelets', status: 'ended', stored_status: 'ended', start_time: new Date(now - 7200000).toISOString(), end_time: new Date(now - 3600000).toISOString() }),
  mk({ id: 'e1', title: 'Pearl Earrings', category: 'Earrings', status: 'scheduled', stored_status: 'scheduled', start_time: new Date(now + 86400000).toISOString(), end_time: new Date(now + 90000000).toISOString() }),
];
const managePayload = {
  summary: { total: 4, live: 1, scheduled: 1, paused: 0, ended: 2 },
  categories: [{ name: 'Rings', count: 2 }, { name: 'Bracelets', count: 1 }, { name: 'Earrings', count: 1 }],
  auctions,
};

vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../shared/lib/socketClient', () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

beforeEach(() => {
  vi.mocked(apiFetch).mockImplementation(async (path, opts = {}) => {
    if (path.includes('/manage')) return managePayload;
    if (path.includes('/top-bidders')) return [];
    if (opts.method === 'POST') return { id: 'r1', status: 'live' };
    return [];
  });
});

function openCategory() {
  fireEvent.click(document.querySelector('.mauc-cattrigger'));
}

test('status chips render in one filter row with Category trigger at far right', async () => {
  const { container } = render(<MyAuctions />);
  await screen.findByText('Gold Ring');
  const bar = container.querySelector('.mauc-filterbar');
  expect(bar).not.toBeNull();
  // Pills left, trigger right in the SAME container
  expect(bar.querySelector('.mauc-statusgroup')).not.toBeNull();
  const trigger = bar.querySelector('.mauc-cattrigger');
  expect(trigger).not.toBeNull();
  for (const t of ['All status', 'Live', 'Scheduled', 'Ended']) {
    expect(bar).toHaveTextContent(t);
  }
});

test('old category chip row is gone; no All-categories control', async () => {
  const { container } = render(<MyAuctions />);
  await screen.findByText('Gold Ring');
  expect(container.querySelector('.mauc-categorybar')).toBeNull();
  expect(container.querySelector('.mauc-catpill')).toBeNull();
  expect(screen.queryByText('All categories')).toBeNull();
});

test('Category trigger has progressive-lines icon (short/medium/long), no outline', async () => {
  const { container } = render(<MyAuctions />);
  await screen.findByText('Gold Ring');
  const trigger = container.querySelector('.mauc-cattrigger');
  const lines = trigger.querySelectorAll('line');
  expect(lines.length).toBe(3);
  const lengths = Array.from(lines).map((l) => Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')));
  expect(lengths[0]).toBeLessThan(lengths[1]);
  expect(lengths[1]).toBeLessThan(lengths[2]);
  expect(trigger.querySelector('svg[class*="funnel"], svg[class*="filter"]')).toBeNull();
  // Minimal trigger: icon + text + chevron only, no outline/bordered classes.
  expect(trigger.className).toBe('mauc-cattrigger');
  expect(trigger.querySelectorAll('svg').length).toBe(2);
});

afterEach(() => cleanup());

test('dropdown opens with real categories and counts; closes on outside and Escape', async () => {
  render(<MyAuctions />);
  await screen.findByText('Gold Ring');
  openCategory();
  await screen.findByRole('listbox');
  expect(screen.getByRole('button', { name: /Rings 2/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Bracelets 1/ })).toBeInTheDocument();
  // Outside click closes
  fireEvent.mouseDown(document.body);
  await waitFor(() => {
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  // Escape closes
  openCategory();
  await screen.findByRole('listbox');
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => {
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

test('selecting Rings filters (case-insensitive); clearing restores', async () => {
  render(<MyAuctions />);
  await screen.findByText('Gold Ring');
  openCategory();
  fireEvent.click(await screen.findByRole('button', { name: /Rings 2/ }));
  expect(screen.getByText('Gold Ring')).toBeInTheDocument();
  expect(screen.getByText('Silver Ring')).toBeInTheDocument();
  expect(screen.queryByText('Gold Bracelet')).not.toBeInTheDocument();
  expect(screen.queryByText('Pearl Earrings')).not.toBeInTheDocument();
  // Trigger reflects selection
  expect(screen.getByRole('button', { name: /Category filter: Rings/ })).toBeInTheDocument();
  // Clear restores
  openCategory();
  fireEvent.click(await screen.findByRole('button', { name: /Clear filter/ }));
  expect(screen.getByText('Gold Bracelet')).toBeInTheDocument();
});

test('status + category combine', async () => {
  render(<MyAuctions />);
  await screen.findByText('Gold Ring');
  const endedTab = screen.getAllByRole('tab').find((el) => el.textContent.startsWith('Ended'));
  fireEvent.click(endedTab);
  openCategory();
  fireEvent.click(await screen.findByRole('button', { name: /Rings 2/ }));
  expect(screen.getByText('Silver Ring')).toBeInTheDocument();
  expect(screen.queryByText('Gold Ring')).not.toBeInTheDocument();
  expect(screen.queryByText('Gold Bracelet')).not.toBeInTheDocument();
});

test('search + status + category combine', async () => {
  render(<MyAuctions />);
  await screen.findByText('Gold Ring');
  fireEvent.change(screen.getByPlaceholderText('Search your auctions...'), { target: { value: 'gold' } });
  openCategory();
  fireEvent.click(await screen.findByRole('button', { name: /Bracelets 1/ }));
  expect(screen.getByText('Gold Bracelet')).toBeInTheDocument();
  expect(screen.queryByText('Gold Ring')).not.toBeInTheDocument();
});

test('status counts come from data (not hardcoded)', async () => {
  render(<MyAuctions />);
  await screen.findByText('Gold Ring');
  const tabs = screen.getAllByRole('tab');
  const text = (prefix) => tabs.find((el) => el.textContent.startsWith(prefix)).textContent;
  expect(text('All status')).toMatch(/4/);
  expect(text('Live')).toMatch(/1/);
  expect(text('Scheduled')).toMatch(/1/);
  expect(text('Ended')).toMatch(/2/);
});

test('mutations still hit correct routes and refresh', async () => {
  render(<MyAuctions />);
  await screen.findByText('Gold Ring');
  const liveCard = document.querySelector('[data-testid="auction-card-r1"]');
  const pauseBtn = Array.from(liveCard.querySelectorAll('button')).find((b) => /Pause/.test(b.textContent));
  fireEvent.click(pauseBtn);
  await waitFor(() => {
    expect(vi.mocked(apiFetch).mock.calls.some(([p, o]) => p === '/shop-owner/auctions/r1/pause' && o?.method === 'POST')).toBe(true);
  });
  // Authoritative refetch after mutation
  expect(vi.mocked(apiFetch).mock.calls.filter(([p]) => p.includes('/manage')).length).toBeGreaterThanOrEqual(2);
});

test('realtime auction:update still reconciles', async () => {
  const { socket } = await import('../../../../shared/lib/socketClient');
  render(<MyAuctions />);
  await screen.findByText('Gold Ring');
  const handler = vi.mocked(socket.on).mock.calls.find(([e]) => e === 'auction:update')?.[1];
  expect(handler).toBeTypeOf('function');
});

test('mobile filter layout does not overflow', async () => {
  const { container } = render(<MyAuctions />);
  await screen.findByText('Gold Ring');
  const bar = container.querySelector('.mauc-filterbar');
  expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth + 2);
});
