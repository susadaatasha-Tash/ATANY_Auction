import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { vi, afterEach, beforeEach } from 'vitest';
import { RelistWizard } from '../RelistWizard';

vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

const now = Date.now();
const source = {
  id: 'ended-1', title: 'Rose Gold Bangle', name: 'Rose Gold Bangle', category: 'Bracelets',
  karat_weight: 'Good Quality', image_url: 'x.jpg', branch: 'Gmall Branch', branch_name: 'Gmall Branch',
  description: 'Same as original', lot_code: 'A-702', auction_code: 'A-702',
  status: 'ended', start_time: new Date(now - 8 * 86400000).toISOString(),
  end_time: new Date(now - 86400000).toISOString(),
  start_price: 54000, startPrice: 54000, minimum_bid_increment: 500,
  current_bid: 55000, bid_count: 1, watcher_count: 0, leaderboard: [],
};

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

function openWizard(props = {}) {
  const onSubmit = props.onSubmit || (async () => ({ id: 'new-1', status: 'scheduled' }));
  render(<RelistWizard open sourceAuction={source} onClose={() => {}} onSubmit={onSubmit} {...props} />);
  return onSubmit;
}

test('exactly 2 steps: Schedule then Review (no Lot Details/Bidding Rules)', () => {
  openWizard();
  expect(screen.getByText('Schedule')).toBeInTheDocument();
  expect(screen.getByText('Review')).toBeInTheDocument();
  expect(screen.queryByText('Lot Details')).toBeNull();
  expect(screen.queryByText('Bidding Rules')).toBeNull();
  expect(document.querySelectorAll('.step-connector').length).toBe(1);
  expect(document.querySelector('.wizard-steps').textContent).not.toMatch(/Lot Details/);
});

test('Schedule reuses calendar (Today/prev/next) and time pickers', () => {
  openWizard();
  expect(screen.getAllByRole('button', { name: 'Go to today' }).length).toBe(2);
  expect(screen.getAllByRole('button', { name: 'Previous month' }).length).toBe(2);
  expect(screen.getAllByRole('button', { name: 'Next month' }).length).toBe(2);
  expect(screen.getByText('Auction start date')).toBeInTheDocument();
  expect(screen.getByText('Auction end date')).toBeInTheDocument();
});

test('Today selects today in the wizard calendar', () => {
  openWizard();
  const startCal = screen.getByRole('group', { name: 'Auction start date' });
  const scope = within(startCal);
  fireEvent.click(scope.getByRole('button', { name: 'Next month' }));
  fireEvent.click(scope.getByRole('button', { name: 'Go to today' }));
  const sel = startCal.querySelector('.sched-cal-day.is-selected');
  expect(sel).not.toBeNull();
  expect(sel.classList.contains('is-today')).toBe(true);
});

test('Continue with valid schedule moves to Review', () => {
  openWizard();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText('Minimum Bid Increment')).toBeInTheDocument();
});

test('Review shows inherited item, price, increment; Edit schedule only', () => {
  openWizard();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText('Rose Gold Bangle')).toBeInTheDocument();
  expect(screen.getByText('₱54,000')).toBeInTheDocument();
  expect(screen.getByText('₱500')).toBeInTheDocument();
  expect(screen.getByText(/inherited from the original auction/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Edit schedule' })).toBeInTheDocument();
  // No lot/bidding edit affordances
  expect(screen.queryByText(/Edit lot details/)).toBeNull();
  expect(screen.queryByText(/Edit bidding rules/)).toBeNull();
});

test('Edit schedule returns to Step 1 preserving values', () => {
  openWizard();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit schedule' }));
  expect(screen.getByText('Auction start date')).toBeInTheDocument();
});

test('submit shows Relisting… and blocks duplicates', async () => {
  let resolveSubmit;
  const onSubmit = vi.fn(() => new Promise((r) => { resolveSubmit = r; }));
  openWizard({ onSubmit });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Relist auction' }));
  expect(screen.getByRole('button', { name: 'Relisting…' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Relisting…' }));
  resolveSubmit({ id: 'new-1', status: 'scheduled' });
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
});

test('failure keeps wizard open with schedule preserved', async () => {
  const onSubmit = vi.fn(async () => false);
  openWizard({ onSubmit });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Relist auction' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(screen.getByText('Minimum Bid Increment')).toBeInTheDocument();
});

test('success clears the namespaced draft (not create draft)', async () => {
  window.localStorage.setItem('atany_auction_lot_draft', JSON.stringify({ name: 'X' }));
  const onSubmit = vi.fn(async () => ({ id: 'new-1' }));
  openWizard({ onSubmit });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Relist auction' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(window.localStorage.getItem('relist-draft:ended-1')).toBeNull();
  expect(JSON.parse(window.localStorage.getItem('atany_auction_lot_draft')).name).toBe('X');
});

test('draft saves on edit and restores per-source schedule', async () => {
  const { unmount } = render(<RelistWizard open sourceAuction={source} onClose={() => {}} onSubmit={async () => true} />);
  // Fresh untouched session writes no junk key
  expect(window.localStorage.getItem('relist-draft:ended-1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(window.localStorage.getItem('relist-draft:ended-1')).not.toBeNull();
  unmount();
  // Reopen restores the in-progress Review step
  render(<RelistWizard open sourceAuction={source} onClose={() => {}} onSubmit={async () => true} />);
  expect(screen.getByText('Minimum Bid Increment')).toBeInTheDocument();
});
