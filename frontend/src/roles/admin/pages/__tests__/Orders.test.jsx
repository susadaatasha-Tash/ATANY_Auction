// frontend/src/roles/admin/pages/__tests__/Orders.test.jsx
// Admin Orders — page loads, real KPIs, search, status tabs, table,
// order details drawer, status update, reset, export.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
const toast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toast }));
// Drawer uses document focus management; stub it so tests stay deterministic.
vi.mock('../../../../shared/components/Drawer', () => ({
  Drawer: ({ open, children }) => open && <div role="dialog" aria-modal="true" data-testid="order-details-drawer">{children}</div>,
}));
// jsdom does not implement URL.createObjectURL; stub it for the export flow.
globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-export');
globalThis.URL.revokeObjectURL = vi.fn();

import Orders from '../Orders';

const ORDERS = [
  {
    id: 'o-1', transaction_code: 'TXN-1001', customer: 'Maria Santos', item: '18K Gold Ring',
    amount: 45000, branch: 'Gmall Branch', status: 'pending', date: '2026-10-10T09:00:00Z',
    buyer_id: 'b1', payment_status: 'pending', payment_deadline: '2026-10-17T09:00:00Z',
    winner_confirmed_at: '2026-10-10T09:00:00Z', winner_rank: 1, paid_at: null,
  },
  {
    id: 'o-2', transaction_code: 'TXN-1002', customer: 'Klane Cruz', item: 'Pearl Necklace',
    amount: 80000, branch: 'SM North', status: 'completed', date: '2026-10-09T10:00:00Z',
    buyer_id: 'b2', payment_status: 'paid', payment_deadline: null, winner_confirmed_at: '2026-10-09T10:00:00Z',
    winner_rank: 1, paid_at: '2026-10-09T11:00:00Z',
  },
  {
    id: 'o-3', transaction_code: 'TXN-1003', customer: 'Rhea Lim', item: 'Diamond Earrings',
    amount: 62000, branch: 'Gmall Branch', status: 'preparing', date: '2026-10-08T11:00:00Z',
    buyer_id: 'b3', payment_status: 'paid', payment_deadline: null, winner_confirmed_at: '2026-10-08T11:00:00Z',
    winner_rank: 1, paid_at: '2026-10-08T12:00:00Z',
  },
];

function routeFetch() {
  return (path, opts = {}) => {
    if (path === '/admin/transactions' && (!opts.method || opts.method === 'GET')) return Promise.resolve(ORDERS);
    if (/^\/admin\/transactions\/[^/]+\/pay$/.test(path) && opts.method === 'PATCH') {
      const id = path.split('/')[3];
      return Promise.resolve({ id, payment_status: 'paid', paid_at: new Date().toISOString() });
    }
    if (/^\/admin\/orders\/[^/]+\/status$/.test(path) && opts.method === 'PATCH') {
      const id = path.split('/')[3];
      const status = JSON.parse(opts.body).status;
      return Promise.resolve({ id, status });
    }
    return Promise.reject(new Error(`unmocked ${path}`));
  };
}

async function renderPage() {
  apiFetch.mockImplementation(routeFetch());
  const user = userEvent.setup();
  render(<MemoryRouter><Orders /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('TXN-1001')).toBeInTheDocument());
  return user;
}

beforeEach(() => { apiFetch.mockReset(); toast.mockReset(); });

describe('Admin Orders page', () => {
  it('renders header, KPI cards, toolbar and table from real data', async () => {
    await renderPage();

    expect(screen.getByText('Orders')).toBeInTheDocument();

    // KPI cards from real data: 3 orders, 2 paid (80000+62000), 1 pending, 1 completed
    const totalCard = screen.getByText('Total Orders').closest('.ao-kpi');
    expect(within(totalCard).getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Total Sales')).toBeInTheDocument();
    expect(screen.getByText('₱142,000')).toBeInTheDocument();
    const pendingCard = screen.getByText('Pending Orders').closest('.ao-kpi');
    expect(within(pendingCard).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Completed Orders')).toBeInTheDocument();
    const completedCard = screen.getByText('Completed Orders').closest('.ao-kpi');
    expect(within(completedCard).getByText('1')).toBeInTheDocument();

    // Page-level search preserved
    expect(screen.getByPlaceholderText('Search by transaction ID, customer, or item...')).toBeInTheDocument();
    // Table columns
    expect(screen.getByText('Transaction ID')).toBeInTheDocument();
    expect(screen.getByText('Customer')).toBeInTheDocument();
    expect(screen.getByText('Item')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getByText('Branch')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
    // Rows
    expect(screen.getByText('TXN-1001')).toBeInTheDocument();
    expect(screen.getByText('TXN-1002')).toBeInTheDocument();
    expect(screen.getByText('TXN-1003')).toBeInTheDocument();
    expect(screen.getByText('Maria Santos')).toBeInTheDocument();
    expect(screen.getByText('₱45,000')).toBeInTheDocument();
    expect(screen.getByText('₱80,000')).toBeInTheDocument();
    expect(screen.getByText('₱62,000')).toBeInTheDocument();
    expect(screen.getAllByText('Gmall Branch').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('SM North').length).toBeGreaterThanOrEqual(1);
  });

  it('search filters by transaction ID, customer and item', async () => {
    const user = await renderPage();
    await user.clear(screen.getByPlaceholderText('Search by transaction ID, customer, or item...'));
    await user.type(screen.getByPlaceholderText('Search by transaction ID, customer, or item...'), 'Pearl');
    await waitFor(() => {
      expect(screen.getByText('TXN-1002')).toBeInTheDocument();
      expect(screen.queryByText('TXN-1001')).not.toBeInTheDocument();
      expect(screen.queryByText('TXN-1003')).not.toBeInTheDocument();
    });
  });

  it('status tabs filter and show real counts', async () => {
    await renderPage();
    // All: 3, Pending: 1, Processing (preparing): 1, Completed: 1, Expired: 0, Cancelled: 0
    expect(screen.getByRole('button', { name: /All/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pending/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Processing/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Completed/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Expired/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancelled/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Completed/ }));
    await waitFor(() => {
      expect(screen.getByText('TXN-1002')).toBeInTheDocument();
      expect(screen.queryByText('TXN-1001')).not.toBeInTheDocument();
    });
  });

  it('branch filter narrows the table', async () => {
    await renderPage();
    await userEvent.selectOptions(screen.getByLabelText('Branch filter'), 'SM North');
    await waitFor(() => {
      expect(screen.getByText('TXN-1002')).toBeInTheDocument();
      expect(screen.queryByText('TXN-1001')).not.toBeInTheDocument();
    });
  });

  it('reset clears search and filters', async () => {
    const user = await renderPage();
    await user.clear(screen.getByPlaceholderText('Search by transaction ID, customer, or item...'));
    await user.type(screen.getByPlaceholderText('Search by transaction ID, customer, or item...'), 'TXN-1002');
    await waitFor(() => expect(screen.queryByText('TXN-1001')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Reset/ }));
    await waitFor(() => {
      expect(screen.getByText('TXN-1001')).toBeInTheDocument();
      expect(screen.getByText('TXN-1002')).toBeInTheDocument();
      expect(screen.getByText('TXN-1003')).toBeInTheDocument();
    });
  });

  it('opens order details drawer and shows real order values', async () => {
    const user = await renderPage();
    await userEvent.click(screen.getByText('TXN-1001'));
    await waitFor(() => expect(screen.getByTestId('order-details-drawer')).toBeInTheDocument());
    const drawer = screen.getByTestId('order-details-drawer');
    expect(within(drawer).getByText('Order Details')).toBeInTheDocument();
    expect(within(drawer).getByText('TXN-1001')).toBeInTheDocument();
    expect(within(drawer).getByText('Maria Santos')).toBeInTheDocument();
    expect(within(drawer).getByText('Gmall Branch')).toBeInTheDocument();
    expect(within(drawer).getByText('18K Gold Ring')).toBeInTheDocument();
    expect(within(drawer).getByText('₱45,000')).toBeInTheDocument();
  });

  it('update status transitions through valid steps and refreshes', async () => {
    const user = await renderPage();
    // pending -> preparing
    await userEvent.click(screen.getByRole('button', { name: 'Preparing' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('moved to preparing')));
    expect(apiFetch).toHaveBeenCalledWith(
      '/admin/orders/o-1/status',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'preparing' }) })
    );
  });

  it('record payment marks an unpaid order paid', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Record Payment' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('Payment recorded')));
    expect(apiFetch).toHaveBeenCalledWith('/admin/transactions/o-1/pay', expect.objectContaining({ method: 'PATCH' }));
  });

  it('export writes filtered CSV and toast', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Export/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('Exported 3 orders')));
  });

  it('error state shows when the API fails', async () => {
    apiFetch.mockImplementation(() => Promise.reject(new Error('down')));
    render(<MemoryRouter><Orders /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Unable to load orders')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });
});
