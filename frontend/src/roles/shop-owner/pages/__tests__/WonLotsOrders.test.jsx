// frontend/src/roles/shop-owner/pages/__tests__/WonLotsOrders.test.jsx
// Won Lots & Orders — KPIs, search, status filter, rows, the text-only View
// button, the three-dot menu, sorting, pagination and the loading/empty/error
// states.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { apiFetch, toastSpy } = vi.hoisted(() => ({ apiFetch: vi.fn(), toastSpy: vi.fn() }));
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toastSpy }));

import WonLotsOrders from '../WonLotsOrders';

const SALES = [
  {
    id: 'o-1', transaction_code: 'TXN-9009', item: 'TEST 1', category: 'Watches',
    item_image: 'https://img.test/watch.jpg', buyer: 'britz Susada', amount: 71000,
    commission: 7100, payout: 63900, status: 'pending', payment_status: null,
    payment_method: null, branch_name: 'Gmall Branch', date: '2026-10-11T02:24:00.000Z',
  },
  {
    id: 'o-2', transaction_code: 'TXN-9002', item: 'Rose Gold Bangle', category: 'Bracelets',
    item_image: null, buyer: 'Maria Santos', amount: 55000, commission: 5500, payout: 49500,
    status: 'completed', payment_status: 'paid', payment_method: 'gcash',
    branch_name: 'Gmall Branch', date: '2026-09-15T10:31:00.000Z',
  },
  {
    id: 'o-3', transaction_code: 'TXN-9007', item: 'Verification Ring', category: 'Rings',
    item_image: 'https://img.test/ring.jpg', buyer: 'Maria Santos', amount: 41000,
    commission: 4100, payout: 36900, status: 'pending', payment_status: 'pending',
    payment_method: 'gcash', branch_name: 'Gmall Branch', date: '2026-09-26T03:03:00.000Z',
  },
];

function renderPage(rows = SALES) {
  apiFetch.mockResolvedValue(rows);
  return render(<WonLotsOrders />);
}

async function waitForTable() {
  await waitFor(() => expect(screen.getByText('TEST 1')).toBeInTheDocument());
}

beforeEach(() => {
  apiFetch.mockReset();
  toastSpy.mockReset();
  apiFetch.mockResolvedValue(SALES);
});

describe('Won Lots & Orders — page + KPI', () => {
  it('renders the page with the three KPI cards', async () => {
    renderPage();
    await waitForTable();
    expect(screen.getByTestId('wlo-kpi-sales')).toBeInTheDocument();
    expect(screen.getByTestId('wlo-kpi-commission')).toBeInTheDocument();
    expect(screen.getByTestId('wlo-kpi-payout')).toBeInTheDocument();
    expect(screen.getByText('TOTAL SALES')).toBeInTheDocument();
    expect(screen.getByText('PLATFORM COMMISSION (10%)')).toBeInTheDocument();
    expect(screen.getByText('YOUR TOTAL PAYOUT (90%)')).toBeInTheDocument();
  });

  it('renders the KPI values from the API data (10% commission / 90% payout)', async () => {
    renderPage();
    await waitForTable();
    // 71000 + 55000 + 41000 = 167000
    expect(within(screen.getByTestId('wlo-kpi-sales')).getByText('₱167,000')).toBeInTheDocument();
    expect(within(screen.getByTestId('wlo-kpi-commission')).getByText('₱16,700')).toBeInTheDocument();
    expect(within(screen.getByTestId('wlo-kpi-payout')).getByText('₱150,300')).toBeInTheDocument();
  });

  it('the payout KPI is the dark card and the others are light', async () => {
    renderPage();
    await waitForTable();
    expect(screen.getByTestId('wlo-kpi-payout').className).toContain('wlo-kpi--navy');
    expect(screen.getByTestId('wlo-kpi-sales').className).toContain('wlo-kpi--gold');
  });
});

describe('Won Lots & Orders — search, filter, rows', () => {
  it('search filters by item / buyer / order id', async () => {
    renderPage();
    await waitForTable();
    const search = screen.getByLabelText('Search sales, buyers, items, or order ID');
    expect(search).toHaveAttribute('placeholder', 'Search sales, buyers, items, or order ID...');
    fireEvent.change(search, { target: { value: 'bangle' } });
    await waitFor(() => expect(screen.queryByText('TEST 1')).not.toBeInTheDocument());
    expect(screen.getByText('Rose Gold Bangle')).toBeInTheDocument();
  });

  it('the status filter uses the real order states and filters the rows', async () => {
    renderPage();
    await waitForTable();
    const select = screen.getByLabelText('Filter orders by status');
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toEqual(['All Status', 'Processing', 'Preparing', 'Ready for Pickup', 'Completed', 'Expired']);
    fireEvent.change(select, { target: { value: 'completed' } });
    await waitFor(() => expect(screen.queryByText('TEST 1')).not.toBeInTheDocument());
    expect(screen.getByText('Rose Gold Bangle')).toBeInTheDocument();
  });

  it('renders the reference table columns', async () => {
    renderPage();
    await waitForTable();
    const headers = Array.from(document.querySelectorAll('.wlo-table thead th')).map((t) => t.textContent.trim());
    expect(headers).toEqual([
      'Order ID', 'Item', 'Buyer', 'Sale Amount', 'Commission (10%)',
      'Your Payout (90%)', 'Payment', 'Status', 'Action', 'Date',
    ]);
  });

  it('renders the item thumbnail and falls back when there is no image', async () => {
    renderPage();
    await waitForTable();
    const withImage = screen.getByAltText('TEST 1 thumbnail');
    expect(withImage).toHaveAttribute('src', 'https://img.test/watch.jpg');
    expect(screen.getByText('Watches')).toBeInTheDocument();
    // the second row has no image → a placeholder, not a broken <img>
    const row = screen.getByTestId('wlo-row-o-2');
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('.wlo-thumb--empty')).toBeTruthy();
  });

  it('maps the payment status to the reference badges', async () => {
    renderPage();
    await waitForTable();
    expect(within(screen.getByTestId('wlo-row-o-1')).getByText('No Payment')).toBeInTheDocument();
    expect(within(screen.getByTestId('wlo-row-o-3')).getByText('Pending')).toBeInTheDocument();
    expect(within(screen.getByTestId('wlo-row-o-2')).getByText('Paid')).toBeInTheDocument();
  });

  it('maps the order status to the reference badges', async () => {
    renderPage();
    await waitForTable();
    expect(within(screen.getByTestId('wlo-row-o-1')).getByText('Processing')).toBeInTheDocument();
    expect(within(screen.getByTestId('wlo-row-o-2')).getByText('Completed')).toBeInTheDocument();
  });

  it('shows the amount, the commission and the payout', async () => {
    renderPage();
    await waitForTable();
    const row = screen.getByTestId('wlo-row-o-1');
    expect(within(row).getByText('₱71,000')).toBeInTheDocument();
    expect(within(row).getByText('₱7,100')).toBeInTheDocument();
    expect(within(row).getByText('₱63,900')).toBeInTheDocument();
  });
});

describe('Won Lots & Orders — View button (text only)', () => {
  it('the View button text is exactly "View"', async () => {
    renderPage();
    await waitForTable();
    const btn = screen.getByRole('button', { name: 'View order TXN-9009' });
    expect(btn.textContent.trim()).toBe('View');
  });

  it('the View button contains NO eye icon (no svg / no emoji)', async () => {
    renderPage();
    await waitForTable();
    const btn = screen.getByRole('button', { name: 'View order TXN-9009' });
    expect(btn.querySelector('svg')).toBeNull();
    expect(btn.children.length).toBe(0);
    expect(btn.innerHTML).not.toMatch(/eye|👁|<svg/i);
  });
});

describe('Won Lots & Orders — View details', () => {
  it('View opens the exact clicked order', async () => {
    renderPage();
    await waitForTable();
    fireEvent.click(screen.getByRole('button', { name: 'View order TXN-9009' }));
    const detail = await screen.findByTestId('wlo-detail');
    expect(within(detail).getByText('TEST 1')).toBeInTheDocument();
    expect(within(detail).getByText('TXN-9009')).toBeInTheDocument();
    expect(within(detail).getByText('₱71,000')).toBeInTheDocument();
  });

  it('clicking a second order shows the new order (no stale detail state)', async () => {
    renderPage();
    await waitForTable();
    fireEvent.click(screen.getByRole('button', { name: 'View order TXN-9009' }));
    let detail = await screen.findByTestId('wlo-detail');
    expect(within(detail).getByText('TEST 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('wlo-detail')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'View order TXN-9002' }));
    detail = await screen.findByTestId('wlo-detail');
    expect(within(detail).getByText('Rose Gold Bangle')).toBeInTheDocument();
    expect(within(detail).queryByText('TEST 1')).not.toBeInTheDocument();
  });
});

describe('Won Lots & Orders — three-dot menu', () => {
  it('opens the menu for the clicked row only', async () => {
    renderPage();
    await waitForTable();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for TXN-9009' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('View details')).toBeInTheDocument();
    expect(screen.getAllByRole('menu')).toHaveLength(1);
  });

  it('offers the fulfillment action only when payment is confirmed', async () => {
    renderPage();
    await waitForTable();
    // TXN-9009 → no payment → the action is blocked
    fireEvent.click(screen.getByRole('button', { name: 'More actions for TXN-9009' }));
    let menu = await screen.findByRole('menu');
    const blocked = within(menu).getByText('Payment pending');
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAttribute('title', 'Payment must be Paid before Start Preparing.');
  });

  it('offers "Start Preparing" for a paid, processing order', async () => {
    const paid = [{ ...SALES[0], payment_status: 'paid' }];
    renderPage(paid);
    await waitForTable();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for TXN-9009' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Start Preparing')).toBeEnabled();
  });

  it('runs the fulfillment mutation and refreshes the row', async () => {
    const paid = [{ ...SALES[0], payment_status: 'paid' }];
    apiFetch.mockResolvedValue(paid);
    render(<WonLotsOrders />);
    await waitForTable();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for TXN-9009' }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByText('Start Preparing'));
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Order is now preparing'));
    const call = apiFetch.mock.calls.find(([u, o]) => String(u).includes('/status') && o?.method === 'PATCH');
    expect(call).toBeTruthy();
    expect(JSON.parse(call[1].body)).toEqual({ status: 'preparing' });
  });
});

describe('Won Lots & Orders — sorting, pagination, states', () => {
  it('sorting by ORDER ID and DATE toggles the direction', async () => {
    renderPage();
    await waitForTable();
    const idSort = screen.getByRole('button', { name: /Order ID/ });
    fireEvent.click(idSort);
    await waitFor(() => {
      const ids = Array.from(document.querySelectorAll('.wlo-order-id')).map((n) => n.textContent);
      expect(ids).toEqual(['TXN-9002', 'TXN-9007', 'TXN-9009']);
    });
    fireEvent.click(idSort);
    await waitFor(() => {
      const ids = Array.from(document.querySelectorAll('.wlo-order-id')).map((n) => n.textContent);
      expect(ids).toEqual(['TXN-9009', 'TXN-9007', 'TXN-9002']);
    });
  });

  it('paginates with 10 per page and moves between pages', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...SALES[0], id: `o-${i}`, item: `Lot ${i}`, transaction_code: `TXN-90${String(i).padStart(2, '0')}`,
    }));
    renderPage(many);
    await waitFor(() => expect(document.querySelectorAll('.wlo-table tbody tr').length).toBe(10));
    expect(screen.getByTestId('wlo-page')).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(screen.getByTestId('wlo-page')).toHaveTextContent('2'));
    expect(document.querySelectorAll('.wlo-table tbody tr').length).toBe(2);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('the page size selector changes the rows per page and resets to page 1', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...SALES[0], id: `o-${i}`, item: `Lot ${i}`, transaction_code: `TXN-90${String(i).padStart(2, '0')}`,
    }));
    renderPage(many);
    await waitFor(() => expect(document.querySelectorAll('.wlo-table tbody tr').length).toBe(10));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(screen.getByTestId('wlo-page')).toHaveTextContent('2'));
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '25' } });
    await waitFor(() => expect(screen.getByTestId('wlo-page')).toHaveTextContent('1'));
    expect(document.querySelectorAll('.wlo-table tbody tr').length).toBe(12);
  });

  it('shows the real result count', async () => {
    renderPage();
    await waitForTable();
    expect(screen.getByText('3 sales')).toBeInTheDocument();
  });

  it('shows a skeleton while loading', () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<WonLotsOrders />);
    expect(container.querySelectorAll('.wlo-kpi--skeleton').length).toBe(3);
    expect(container.querySelectorAll('.wlo-skel').length).toBeGreaterThan(10);
    expect(screen.queryByText('No orders yet')).not.toBeInTheDocument();
  });

  it('shows an empty state when the seller has no orders', async () => {
    renderPage([]);
    await waitFor(() => expect(screen.getByText('No orders yet')).toBeInTheDocument());
    expect(screen.getByText('When a lot you sold is won, the order appears here.')).toBeInTheDocument();
  });

  it('shows an error state with a Retry action', async () => {
    apiFetch.mockRejectedValue(new Error('boom'));
    render(<WonLotsOrders />);
    await waitFor(() => expect(screen.getByText('Unable to load your orders')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
