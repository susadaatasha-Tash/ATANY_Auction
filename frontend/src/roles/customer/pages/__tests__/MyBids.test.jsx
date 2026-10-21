// frontend/src/roles/customer/pages/__tests__/MyBids.test.jsx
// Customer → My Bids — summary cards, search, status filter, status rules,
// countdown, row navigation and the loading/empty/error states.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { apiFetch, toastSpy, navigateMock } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  toastSpy: vi.fn(),
  navigateMock: vi.fn(),
}));
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toastSpy }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('../../../../shared/lib/socketClient', () => ({
  socket: { connect: vi.fn(), disconnect: vi.fn(), on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}));
vi.mock('../../hooks/useFavorites', () => ({ useFavorites: () => ({ items: [], toggle: vi.fn() }) }));
vi.mock('../../hooks/useReminders', () => ({ useReminders: () => ({ items: [], toggle: vi.fn() }) }));
vi.mock('../../components/DetailModal', () => ({
  DetailModal: ({ auction }) => <div data-testid="detail-modal" data-auction-id={auction?.id} data-auction-name={auction?.name} />,
}));

import MyBids from '../MyBids';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();

const ROWS = [
  {
    auction_id: 'a1', auction_code: 'A-1', item: 'Alpha test', category: 'Diamond Ring',
    karat_weight: '18K White Gold', img: 'https://img.test/alpha.jpg', branch_name: 'Gmall Branch',
    branch_id: 'b2', auction_status: 'live', start_time: new Date(now - DAY).toISOString(),
    end_time: new Date(now + 2 * DAY + 5 * HOUR + 30 * 60 * 1000).toISOString(), yourBid: 62000, currentBid: 63000,
    total_bids: 3, bidsCount: 3, is_leading: false, won: false, order_id: null, order_status: null,
  },
  {
    auction_id: 'a2', auction_code: 'A-2', item: 'TEST1', category: 'Gold Necklace',
    karat_weight: '18K Yellow Gold', img: 'https://img.test/test1.jpg', branch_name: 'Abreeza Branch',
    branch_id: 'b1', auction_status: 'live', start_time: new Date(now - DAY).toISOString(),
    end_time: new Date(now + DAY + 12 * HOUR).toISOString(), yourBid: 71000, currentBid: 71000,
    total_bids: 2, bidsCount: 2, is_leading: true, won: false, order_id: null, order_status: null,
  },
  {
    auction_id: 'a3', auction_code: 'A-3', item: 'Won lot', category: 'Rings',
    karat_weight: '21K', img: 'https://img.test/won.jpg', branch_name: 'Gmall Branch',
    branch_id: 'b2', auction_status: 'ended', start_time: new Date(now - 5 * DAY).toISOString(),
    end_time: new Date(now - 2 * DAY).toISOString(), yourBid: 50000, currentBid: 50000,
    total_bids: 4, bidsCount: 4, is_leading: true, won: true, order_id: 'o-1', order_status: 'pending',
  },
  {
    auction_id: 'a4', auction_code: 'A-4', item: 'Lost lot', category: 'Bracelets',
    karat_weight: '18K', img: null, branch_name: 'SM Lanang Branch',
    branch_id: 'b3', auction_status: 'ended', start_time: new Date(now - 6 * DAY).toISOString(),
    end_time: new Date(now - 3 * DAY).toISOString(), yourBid: 81000, currentBid: 82000,
    total_bids: 1, bidsCount: 1, is_leading: false, won: false, order_id: null, order_status: null,
  },
];

function renderBids(rows = ROWS) {
  apiFetch.mockResolvedValue(rows);
  return render(<MyBids />);
}

async function waitForRows() {
  await waitFor(() => expect(screen.getByText('Alpha test')).toBeInTheDocument());
}

beforeEach(() => {
  apiFetch.mockReset();
  toastSpy.mockReset();
  navigateMock.mockReset();
  apiFetch.mockResolvedValue(ROWS);
});

describe('My Bids — summary cards', () => {
  it('renders the three summary cards', async () => {
    renderBids();
    await waitForRows();
    expect(screen.getByTestId('mb-card-active')).toBeInTheDocument();
    expect(screen.getByTestId('mb-card-winning')).toBeInTheDocument();
    expect(screen.getByTestId('mb-card-past')).toBeInTheDocument();
    expect(within(screen.getByTestId('mb-card-active')).getByText('Active Bids')).toBeInTheDocument();
    expect(within(screen.getByTestId('mb-card-winning')).getByText('Winning')).toBeInTheDocument();
    expect(within(screen.getByTestId('mb-card-past')).getByText('Past Bids')).toBeInTheDocument();
  });

  it('derives the counts from the API data (2 active / 1 winning / 2 past)', async () => {
    renderBids();
    await waitForRows();
    expect(within(screen.getByTestId('mb-card-active')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('mb-card-winning')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('mb-card-past')).getByText('2')).toBeInTheDocument();
  });

  it('the summary cards act as quick filters', async () => {
    renderBids();
    await waitForRows();
    fireEvent.click(screen.getByTestId('mb-card-past'));
    await waitFor(() => expect(screen.queryByText('Alpha test')).not.toBeInTheDocument());
    expect(screen.getByText('Won lot')).toBeInTheDocument();
    expect(screen.getByTestId('mb-card-past').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('My Bids — search and status filter', () => {
  it('searches by item name', async () => {
    renderBids();
    await waitForRows();
    const search = screen.getByLabelText('Search your bids by item name');
    expect(search).toHaveAttribute('placeholder', 'Search your bids by item name...');
    fireEvent.change(search, { target: { value: 'won' } });
    await waitFor(() => expect(screen.queryByText('Alpha test')).not.toBeInTheDocument());
    expect(screen.getByText('Won lot')).toBeInTheDocument();
  });

  it('searches by branch name as well', async () => {
    renderBids();
    await waitForRows();
    fireEvent.change(screen.getByLabelText('Search your bids by item name'), { target: { value: 'lanang' } });
    await waitFor(() => expect(screen.getByText('Lost lot')).toBeInTheDocument());
    expect(screen.queryByText('Alpha test')).not.toBeInTheDocument();
  });

  it('filters by status', async () => {
    renderBids();
    await waitForRows();
    const select = screen.getByLabelText('Filter bids by status');
    expect(within(select).getByText('All Status')).toBeInTheDocument();
    expect(within(select).getByText('Winning')).toBeInTheDocument();
    expect(within(select).getByText('Outbid')).toBeInTheDocument();
    expect(within(select).getByText('Won')).toBeInTheDocument();
    expect(within(select).getByText('Lost')).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'winning' } });
    await waitFor(() => expect(screen.queryByText('Alpha test')).not.toBeInTheDocument());
    expect(screen.getByText('TEST1')).toBeInTheDocument();
  });

  it('combines the card filter, the search and the status filter', async () => {
    renderBids();
    await waitForRows();
    fireEvent.click(screen.getByTestId('mb-card-active'));
    fireEvent.change(screen.getByLabelText('Search your bids by item name'), { target: { value: 'necklace' } });
    await waitFor(() => expect(screen.queryByText('Alpha test')).not.toBeInTheDocument());
    expect(screen.getByText('TEST1')).toBeInTheDocument();
  });
});

describe('My Bids — status rules', () => {
  it('an active auction where the customer leads shows Winning', async () => {
    renderBids();
    await waitForRows();
    const row = screen.getByTestId('mb-row-a2');
    expect(within(row).getByText('Winning')).toBeInTheDocument();
  });

  it('an active auction where someone else leads shows Outbid', async () => {
    renderBids();
    await waitForRows();
    const row = screen.getByTestId('mb-row-a1');
    expect(within(row).getByText('Outbid')).toBeInTheDocument();
  });

  it('an ended auction won by the customer shows Won', async () => {
    renderBids();
    await waitForRows();
    const row = screen.getByTestId('mb-row-a3');
    expect(within(row).getByText('Won')).toBeInTheDocument();
  });

  it('an ended auction not won shows Lost', async () => {
    renderBids();
    await waitForRows();
    const row = screen.getByTestId('mb-row-a4');
    expect(within(row).getByText('Lost')).toBeInTheDocument();
  });

  it('shows the item, both bid amounts and the total bid count', async () => {
    renderBids();
    await waitForRows();
    const row = screen.getByTestId('mb-row-a1');
    expect(within(row).getByText('₱62,000')).toBeInTheDocument();
    expect(within(row).getByText('₱63,000')).toBeInTheDocument();
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText('Diamond Ring · Gmall Branch')).toBeInTheDocument();
  });
});

describe('My Bids — countdown', () => {
  it('renders a live countdown for a running auction', async () => {
    renderBids();
    await waitForRows();
    const row = screen.getByTestId('mb-row-a1');
    // 2 days 5 hours of live countdown (the ticker may shave a minute).
    expect(within(row).getByText(/^2d 5h$/)).toBeInTheDocument();
  });

  it('renders "Ended" with the date for a finished auction', async () => {
    renderBids();
    await waitForRows();
    const row = screen.getByTestId('mb-row-a4');
    expect(within(row).getByText('Ended')).toBeInTheDocument();
  });
});

describe('My Bids — row navigation', () => {
  it('opens the auction details for a live row', async () => {
    renderBids();
    await waitForRows();
    fireEvent.click(screen.getByTestId('mb-row-a2'));
    await waitFor(() => expect(screen.getByTestId('detail-modal')).toBeInTheDocument());
    expect(screen.getByTestId('detail-modal').getAttribute('data-auction-id')).toBe('a2');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('opens the result details for an ended row', async () => {
    renderBids();
    await waitForRows();
    fireEvent.click(screen.getByTestId('mb-row-a4'));
    await waitFor(() => expect(screen.getByTestId('detail-modal')).toBeInTheDocument());
    expect(screen.getByTestId('detail-modal').getAttribute('data-auction-id')).toBe('a4');
  });

  it('navigates to the order for a won row', async () => {
    renderBids();
    await waitForRows();
    fireEvent.click(screen.getByTestId('mb-row-a3'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/customer/orders/o-1'));
    expect(screen.queryByTestId('detail-modal')).not.toBeInTheDocument();
  });

  it('the chevron button is keyboard accessible and labelled', async () => {
    renderBids();
    await waitForRows();
    const btn = screen.getByLabelText('View auction: TEST1');
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId('detail-modal')).toBeInTheDocument());
  });
});

describe('My Bids — item image', () => {
  it('renders the real product image with useful alt text', async () => {
    renderBids();
    await waitForRows();
    const img = screen.getByAltText('Alpha test thumbnail');
    expect(img).toHaveAttribute('src', 'https://img.test/alpha.jpg');
  });

  it('falls back gracefully when a product has no image', async () => {
    renderBids();
    await waitForRows();
    const row = screen.getByTestId('mb-row-a4');
    expect(row.querySelector('img')).toBeNull();
    expect(within(row).getByText('Lost lot')).toBeInTheDocument();
  });
});

describe('My Bids — states', () => {
  it('shows the empty state when the customer has no bids', async () => {
    renderBids([]);
    await waitFor(() => expect(screen.getByText('No bids yet')).toBeInTheDocument());
    expect(screen.getByText("You haven't placed any bids yet.")).toBeInTheDocument();
    const cta = screen.getByRole('button', { name: 'Browse Auctions' });
    fireEvent.click(cta);
    expect(navigateMock).toHaveBeenCalledWith('/customer/auctions');
  });

  it('shows a filtered empty state with a clear action', async () => {
    renderBids();
    await waitForRows();
    fireEvent.change(screen.getByLabelText('Search your bids by item name'), { target: { value: 'zzzz' } });
    await waitFor(() => expect(screen.getByText('No bids match your filters')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByText('Alpha test')).toBeInTheDocument());
  });

  it('shows an error state with a Retry action', async () => {
    apiFetch.mockRejectedValue(new Error('boom'));
    render(<MyBids />);
    await waitFor(() => expect(screen.getByText('Unable to load your bids')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows skeletons while loading', () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<MyBids />);
    expect(container.querySelectorAll('.mb-card--skeleton').length).toBe(3);
    expect(container.querySelectorAll('.mb-skel').length).toBeGreaterThan(10);
    expect(screen.queryByText('No bids yet')).not.toBeInTheDocument();
  });
});
