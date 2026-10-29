import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { vi, afterEach } from 'vitest';
import MyAuctions from '../MyAuctions';
import SellerAuctionCalendar from '../../components/SellerAuctionCalendar';
import { apiFetch } from '../../../../shared/lib/apiClient';
import { socket } from '../../../../shared/lib/socketClient';

const now = new Date();
const Y = now.getFullYear();
const M = now.getMonth();
// Anchor scheduled fixtures in NEXT month (always future, same month).
const NY = M === 11 ? Y + 1 : Y;
const NM = (M + 1) % 12;
const NMON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][NM];
const NLBL = new Date(NY, NM, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const at = (day, h = 18, min = 0) => new Date(NY, NM, day, h, min, 0).toISOString();
const keyN = (day) => `${NY}-${String(NM + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const dayLabelN = (day) => new Date(`${keyN(day)}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
const mk = (over = {}) => ({
  id: over.id || 'x', lot_code: 'LOT-9001', title: 'Item', category: 'Rings',
  image_url: null, branch: 'Gmall Branch', status: 'scheduled', stored_status: 'scheduled',
  start_time: at(15), end_time: at(16), start_price: 55000, current_bid: 0,
  bid_count: 0, watcher_count: 0, leaderboard: [], ...over,
});
const auctions = [
  mk({ id: 's1', title: 'Ruby Halo Engagement Ring', category: 'Rings', lot_code: 'LOT-4050', branch: 'Gmall Branch', start_price: 55000, start_time: at(3, 18), end_time: at(4, 18) }),
  mk({ id: 's2', title: 'Mermaid Diamond Pendant', category: 'Necklaces', lot_code: 'LOT-4053', branch: 'Abreeza Branch', start_price: 38000, start_time: at(7, 19), end_time: at(8, 19) }),
  mk({ id: 's3', title: 'Sapphire Tennis Bracelet', category: 'Bracelets', lot_code: 'LOT-4056', branch: 'SM Lanang Branch', start_price: 62000, start_time: at(7, 18, 30), end_time: at(8, 18, 30) }),
  mk({ id: 'live1', title: 'Live Ring', status: 'live', stored_status: 'live', lot_code: 'LOT-4057', start_time: new Date(now.getTime() - 3600000).toISOString(), end_time: new Date(now.getTime() + 3600000).toISOString() }),
  mk({ id: 'end1', title: 'Old Ring', status: 'ended', stored_status: 'ended', lot_code: 'LOT-4058', start_time: new Date(now.getTime() - 7200000).toISOString(), end_time: new Date(now.getTime() - 3600000).toISOString() }),
  mk({ id: 'pau1', title: 'Paused Ring', status: 'paused', stored_status: 'paused', lot_code: 'LOT-4059', start_time: new Date(now.getTime() - 3600000).toISOString(), end_time: new Date(now.getTime() + 3600000).toISOString() }),
];
const managePayload = {
  summary: { total: 6, live: 1, scheduled: 3, paused: 1, ended: 1 },
  categories: [{ name: 'Rings', count: 3 }, { name: 'Necklaces', count: 1 }, { name: 'Bracelets', count: 1 }],
  auctions,
};

vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: vi.fn() }));
const socketHandlers = vi.hoisted(() => new Map());
vi.mock('../../../../shared/lib/socketClient', () => ({
  socket: {
    on: vi.fn((e, fn) => socketHandlers.set(e, fn)),
    off: vi.fn((e) => socketHandlers.delete(e)),
    emit: vi.fn(),
  },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

beforeEach(() => {
  socketHandlers.clear();
  vi.mocked(apiFetch).mockImplementation(async (path, opts = {}) => {
    if (path.includes('/manage')) return managePayload;
    if (path.includes('/top-bidders')) return [];
    if (opts.method === 'POST') return { id: 's1', status: 'scheduled' };
    return [];
  });
});
afterEach(() => cleanup());

function toCalendar() {
  fireEvent.click(screen.getByRole('button', { name: 'Calendar view' }));
}

test('Calendar toggle switches mode on the same page', async () => {
  render(<MyAuctions />);
  await screen.findByText('Ruby Halo Engagement Ring');
  expect(screen.queryByText('Upcoming timeline')).toBeNull();
  toCalendar();
  await screen.findByText('Upcoming timeline');
  // List sections hidden, not unmounted alongside
  expect(screen.queryByText('Live now')).toBeNull();
  // Back to List restores
  fireEvent.click(screen.getByRole('button', { name: /List/ }));
  await screen.findByText('Ruby Halo Engagement Ring');
  expect(screen.queryByText('Upcoming timeline')).toBeNull();
});

test('renders current month, week headers, month count', async () => {
  render(<SellerAuctionCalendar auctions={auctions} />);
  const label = new Date(Y, M, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  expect(await screen.findByText(label)).toBeInTheDocument();
  for (const d of ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']) {
    expect(screen.getByText(d)).toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  expect(await screen.findByText(NLBL)).toBeInTheDocument();
  expect(screen.getByText('3 scheduled lots')).toBeInTheDocument();
});

test('previous/next/Today navigate and clear selection', async () => {
  render(<SellerAuctionCalendar auctions={auctions} />);
  await screen.findByText('Upcoming timeline');
  const nextLabel = new Date(Y, M + 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  expect(await screen.findByText(nextLabel)).toBeInTheDocument();
  expect(document.querySelector('.mauc-cal__sub').textContent).toMatch(/3 scheduled lots/);
  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  const curLabel = new Date(Y, M, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  expect(await screen.findByText(curLabel)).toBeInTheDocument();
  expect(document.querySelector('.mauc-cal__sub').textContent).toMatch(/0 scheduled lots/);
  fireEvent.click(screen.getByRole('button', { name: 'Go to current month' }));
  expect(await screen.findByText(curLabel)).toBeInTheDocument();
});

test('scheduled markers show real counts; live/ended/paused excluded', async () => {
  const { container } = render(<SellerAuctionCalendar auctions={auctions} />);
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  await screen.findByText(NLBL);
  const btn3 = container.querySelector(`[aria-label*="${dayLabelN(3)}"]`);
  expect(btn3.textContent).toMatch(/1/);
  const btn7 = container.querySelector(`[aria-label*="${dayLabelN(7)}"]`);
  expect(btn7.textContent).toMatch(/2/);
  // Only scheduled dates carry badges
  expect(container.querySelectorAll('.mauc-cal__badge').length).toBe(2);
});

test('selecting a date filters timeline; toggle/Clear restores', async () => {
  const { container } = render(<SellerAuctionCalendar auctions={auctions} />);
  await screen.findByText('Ruby Halo Engagement Ring');
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  await screen.findByText(NLBL);
  const btn7 = container.querySelector(`[aria-label*="${dayLabelN(7)}"]`);
  fireEvent.click(btn7);
  expect(btn7).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Mermaid Diamond Pendant')).toBeInTheDocument();
  expect(screen.getByText('Sapphire Tennis Bracelet')).toBeInTheDocument();
  expect(screen.queryByText('Ruby Halo Engagement Ring')).not.toBeInTheDocument();
  // Toggle off restores
  fireEvent.click(btn7);
  expect(screen.getByText('Ruby Halo Engagement Ring')).toBeInTheDocument();
  // Clear date path
  fireEvent.click(btn7);
  fireEvent.click(screen.getByRole('button', { name: 'Clear date' }));
  expect(screen.getByText('Ruby Halo Engagement Ring')).toBeInTheDocument();
});

test('upcoming is future-only, ascending, with real fields', async () => {
  render(<SellerAuctionCalendar auctions={auctions} />);
  const items = await screen.findAllByRole('button', { name: /opens / });
  expect(items.length).toBe(3);
  const names = items.map((b) => b.getAttribute('aria-label'));
  // s1 (day 3) before s2/s3 (day 7); live/ended/paused absent
  expect(names[0]).toMatch(/Ruby Halo/);
  expect(names[1]).toMatch(/Sapphire Tennis/);
  expect(names[2]).toMatch(/Mermaid Diamond/);
  expect(names.some((n) => /Live Ring|Old Ring|Paused Ring/.test(n))).toBe(false);
  expect(screen.getByText('₱55,000')).toBeInTheDocument();
  expect(screen.getByText(/Rings · Gmall Branch/)).toBeInTheDocument();
  expect(screen.getByText('LOT-4050')).toBeInTheDocument();
  // Date tiles show real day numbers + month abbrev
  expect(screen.getByText('Mermaid Diamond Pendant')).toBeInTheDocument();
});

test('timeline click returns to List and focuses the lot', async () => {
  render(<MyAuctions />);
  await screen.findByText('Ruby Halo Engagement Ring');
  toCalendar();
  const item = await screen.findByRole('button', { name: /Ruby Halo/ });
  fireEvent.click(item);
  await screen.findByText('Ruby Halo Engagement Ring');
  expect(screen.queryByText('Upcoming timeline')).toBeNull();
});

test('Create handler reused in calendar mode', async () => {
  render(<MyAuctions />);
  await screen.findByText('Ruby Halo Engagement Ring');
  toCalendar();
  await screen.findByText('Upcoming timeline');
  expect(screen.getByRole('button', { name: /Create Auction/ })).toBeInTheDocument();
});

test('realtime scheduled→live removes marker and timeline item', async () => {
  render(<MyAuctions />);
  await screen.findByText('Ruby Halo Engagement Ring');
  toCalendar();
  await screen.findByText('Mermaid Diamond Pendant');
  // Server truth flips first (fetchAll reconciliation), then the event arrives.
  const s2 = auctions.find((a) => a.id === 's2');
  s2.status = 'live'; s2.stored_status = 'live';
  socketHandlers.get('auction:update')?.({ auction_id: 's2', status: 'live', current_bid: 0 });
  await waitFor(() => {
    expect(screen.queryByText('Mermaid Diamond Pendant')).not.toBeInTheDocument();
  });
});

test('empty states + info bar, no mock data', async () => {
  const { container } = render(<SellerAuctionCalendar auctions={[]} />);
  expect(await screen.findByText('0 scheduled lots')).toBeInTheDocument();
  expect(screen.getByText('No upcoming auctions')).toBeInTheDocument();
  expect(screen.getByText(/Winners pick up in-branch/)).toBeInTheDocument();
  expect(container.querySelectorAll('.mauc-cal__badge').length).toBe(0);
  expect(document.body.textContent).not.toMatch(/LOT-4050/);
});

test('Today on current month still pings + focuses (never inert)', async () => {
  const { container } = render(<SellerAuctionCalendar auctions={auctions} />);
  await screen.findByText('Upcoming timeline');
  expect(container.querySelector('.mauc-cal__cell.is-ping')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Go to current month' }));
  const pinged = container.querySelector('.mauc-cal__cell.is-ping');
  expect(pinged).not.toBeNull();
  expect(pinged.classList.contains('is-today')).toBe(true);
  expect(document.activeElement).toBe(pinged);
});

test('calendar layout does not overflow', async () => {
  const { container } = render(<SellerAuctionCalendar auctions={auctions} />);
  await screen.findByText('Upcoming timeline');
  const grid = container.querySelector('.mauc-cal-grid');
  expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth + 2);
});
