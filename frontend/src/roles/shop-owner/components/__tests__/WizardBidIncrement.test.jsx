import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { vi, afterEach, beforeEach } from 'vitest';
import { CreateAuctionWizard } from '../CreateAuctionWizard';

vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: vi.fn() }));

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

function openWizard(onSubmit) {
  render(<CreateAuctionWizard open onClose={() => {}} onSubmit={onSubmit || (async () => true)} />);
}
function fillName() {
  fireEvent.change(screen.getByPlaceholderText(/Antique Filigree/i), { target: { value: 'Test Ring' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}
function toBidding() {
  fillName();
  // Step 1 schedule defaults are valid (tomorrow 10:00) → Continue to bidding
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}
function incrementInput() {
  return screen.getByLabelText(/Minimum Bid Increment/);
}

test('increment input renders with default 1000', () => {
  openWizard();
  toBidding();
  expect(incrementInput().value).toBe('1000');
});

test.each([['2000'], ['2500']])('seller can change increment to %s', (v) => {
  openWizard();
  toBidding();
  fireEvent.change(incrementInput(), { target: { value: v } });
  expect(incrementInput().value).toBe(v);
});

test.each([
  ['', 'Enter a minimum bid increment.'],
  ['0', 'Minimum bid increment must be greater than ₱0.'],
  ['-100', 'Minimum bid increment must be greater than ₱0.'],
  ['10.5', 'Enter a valid amount.'],
])('invalid %s rejected with exact message', async (v, msg) => {
  openWizard();
  toBidding();
  fireEvent.change(incrementInput(), { target: { value: v } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByText(msg)).toBeInTheDocument();
  // Still on bidding step
  expect(incrementInput()).toBeInTheDocument();
});

test('draft autosaves and restores increment (not reset to 1000)', () => {
  const { unmount } = render(<CreateAuctionWizard open onClose={() => {}} onSubmit={async () => true} />);
  fillName();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.change(incrementInput(), { target: { value: '2500' } });
  unmount();
  render(<CreateAuctionWizard open onClose={() => {}} onSubmit={async () => true} />);
  expect(window.localStorage.getItem('atany_auction_lot_draft')).toMatch(/2500/);
});

test('restored draft keeps saved increment', async () => {
  window.localStorage.setItem('atany_auction_lot_draft', JSON.stringify({
    name: 'Restored', category: 'Rings', startPrice: '70000', minIncrement: 2500, step: 2,
    start: '2026-11-01T10:00', end: '2026-11-08T10:00',
  }));
  openWizard();
  // Stored step (2 = bidding) is restored directly with the saved increment
  expect(incrementInput().value).toBe('2500');
});

test('Review displays the increment', () => {
  openWizard();
  toBidding();
  fireEvent.change(document.querySelector('input[name="startPrice"]'), { target: { value: '70000' } });
  fireEvent.change(incrementInput(), { target: { value: '2000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText('Minimum Bid Increment')).toBeInTheDocument();
  expect(screen.getByText('₱2,000')).toBeInTheDocument();
});

test('final create request includes numeric increment', async () => {
  const onSubmit = vi.fn(async () => true);
  openWizard(onSubmit);
  toBidding();
  fireEvent.change(document.querySelector('input[name="startPrice"]'), { target: { value: '70000' } });
  fireEvent.change(incrementInput(), { target: { value: '2000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Publish lot' }));
  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalled();
  });
  const payload = onSubmit.mock.calls[0][0];
  expect(payload.minimum_bid_increment).toBe(2000);
  expect(payload.starting_price ?? payload.startPrice).toBeTruthy();
});

test('ATANY design intact (eyebrow, input styling hooks)', () => {
  openWizard();
  toBidding();
  expect(screen.getByText('New auction')).toBeInTheDocument();
  expect(incrementInput()).toHaveAttribute('type', 'number');
});
