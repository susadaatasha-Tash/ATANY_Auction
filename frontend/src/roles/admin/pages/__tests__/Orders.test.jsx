// frontend/src/roles/admin/pages/__tests__/Orders.test.jsx
// Admin → Orders — page rendering, KPI values, filters, search, status tabs,
// sorting, pagination, page size and the loading / empty / error states.
// It also locks in the "monitoring only" contract: no Actions column, no
// order details drawer and no dead row-selection checkboxes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

import Orders from '../Orders';

const BRANCHES = [
  { id: 'b1', name: 'Abreeza Branch', status: 'Open' },
  { id: 'b2', name: 'Gmall Branch', status: 'Open' },
  { id: 'b3', name: 'SM Lanang Branch', status: 'Open' },
];

const ITEMS = [
  {
    id: 'o1', transaction_code: 'TXN-9009', customer: 'Britz Atasha', item: 'Rose Gold Bangle',
    amount: 70500, branch: 'Gmall Branch', branch_id: 'b2', status: 'pending', date: '2026-10-19T13:21:42.319Z',
  },
  {
    id: 'o2', transaction_code: 'TXN-9002', customer: 'Maria Santos', item: 'SM Lanang Tennis Bracelet',
    amount: 82000, branch: 'SM Lanang Branch', branch_id: 'b3', status: 'completed', date: '2026-09-14T14:35:00.000Z',
  },
];

const SUMMARY = {
  total_orders: 9,
  branches_in_scope: 3,
  total_sales: 137000,
  paid_orders: 2,
  pending: 3,
  preparing: 0,
  ready_pickup: 0,
  completed: 2,
  expired: 4,
  completion_rate: 22,
  status_counts: {
    all: 9, pending: 3, preparing: 0, ready_pickup: 0, completed: 2, expired: 4,
  },
};

const PAGINATION = { page: 1, limit: 10, total: 9, total_pages: 1 };

function installApi({ items = ITEMS, pagination = PAGINATION, summary = SUMMARY, fail = false } = {}) {
  apiFetch.mockImplementation(async (url) => {
    const u = String(url);
    if (u.startsWith('/admin/branches')) return BRANCHES;
    if (u.startsWith('/admin/transactions')) {
      if (fail) throw new Error('Network down');
      return { items, pagination, summary };
    }
    return [];
  });
}

function renderOrders(entry = '/admin/transactions') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/transactions" element={<Orders />} />
        <Route path="/admin/orders" element={<Orders />} />
      </Routes>
    </MemoryRouter>
  );
}

function lastQuery() {
  const call = [...apiFetch.mock.calls].reverse().find(([u]) => String(u).startsWith('/admin/transactions'));
  return new URLSearchParams(String(call?.[0] || '').split('?')[1] || '');
}

beforeEach(() => {
  apiFetch.mockReset();
  installApi();
});

describe('Admin Orders — rendering', () => {
  it('renders the page with the real response values', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('TXN-9009')).toBeInTheDocument());
    const table = screen.getByRole('table');
    expect(within(table).getByText('Britz Atasha')).toBeInTheDocument();
    expect(within(table).getByText('Rose Gold Bangle')).toBeInTheDocument();
    expect(within(table).getByText('Gmall Branch')).toBeInTheDocument();
    expect(within(table).getByText('₱70,500')).toBeInTheDocument();
    expect(within(table).getByText('Pending')).toBeInTheDocument();
  });

  it('renders the KPI cards from the summary payload', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('Total Orders')).toBeInTheDocument());
    expect(screen.getByText('Total Sales')).toBeInTheDocument();
    expect(screen.getByText('Pending Orders')).toBeInTheDocument();
    expect(screen.getByText('Completed Orders')).toBeInTheDocument();
    expect(screen.getByText('₱137,000')).toBeInTheDocument();
    expect(screen.getByText('22% completion rate')).toBeInTheDocument();
    expect(screen.getByText('Recognized · 2 paid orders')).toBeInTheDocument();
  });

  it('shows the pagination summary from the backend total', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('Showing 1 to 9 of 9 orders')).toBeInTheDocument());
  });

  it('renders the status tabs with the real counts', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('Showing 1 to 9 of 9 orders')).toBeInTheDocument());
    const tab = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
    expect(within(tab('All')).getByText('9')).toBeInTheDocument();
    expect(within(tab('Pending')).getByText('3')).toBeInTheDocument();
    expect(within(tab('Completed')).getByText('2')).toBeInTheDocument();
    expect(within(tab('Expired')).getByText('4')).toBeInTheDocument();
  });
});

describe('Admin Orders — filters', () => {
  it('searches (debounced) and resets the page', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('TXN-9009')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Search orders by transaction ID/), { target: { value: '  TXN-9009 ' } });
    await waitFor(() => expect(lastQuery().get('search')).toBe('TXN-9009'), { timeout: 2000 });
    // A new search always returns to the first page.
    expect(lastQuery().get('page')).toBe('1');
  });

  it('filters by branch', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('TXN-9009')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Filter orders by branch'), { target: { value: 'b2' } });
    await waitFor(() => expect(lastQuery().get('branch_id')).toBe('b2'));
  });

  it('filters by status through the dropdown', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('TXN-9009')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Filter orders by status'), { target: { value: 'completed' } });
    await waitFor(() => expect(lastQuery().get('status')).toBe('completed'));
  });

  it('filters by the status tabs', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('Showing 1 to 9 of 9 orders')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Expired/ }));
    await waitFor(() => expect(lastQuery().get('status')).toBe('expired'));
  });

  it('filters by a date preset', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('TXN-9009')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Filter orders by date'), { target: { value: '30d' } });
    await waitFor(() => {
      expect(lastQuery().get('date_from')).toBeTruthy();
      expect(lastQuery().get('date_to')).toBeTruthy();
    });
  });

  it('sends a custom date range', async () => {
    renderOrders('/admin/transactions?date=custom&from=2026-10-01&to=2026-10-31');
    await waitFor(() => expect(screen.getByText('TXN-9009')).toBeInTheDocument());
    expect(lastQuery().get('date_from')).toBeTruthy();
    expect(lastQuery().get('date_to')).toBeTruthy();
  });

  it('resets every filter', async () => {
    renderOrders('/admin/transactions?search=Britz&status=pending&branch_id=b2');
    await waitFor(() => expect(screen.getByText('TXN-9009')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    await waitFor(() => {
      expect(lastQuery().get('search')).toBeNull();
      expect(lastQuery().get('status')).toBeNull();
      expect(lastQuery().get('branch_id')).toBeNull();
    });
  });
});

describe('Admin Orders — sorting + pagination', () => {
  it('sorts by a whitelisted column', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('TXN-9009')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Sort by amount' }));
    await waitFor(() => expect(lastQuery().get('sort')).toBe('amount'));
    expect(lastQuery().get('order')).toBe('desc');
  });

  it('changes the page size', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('TXN-9009')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Orders per page'), { target: { value: '25' } });
    await waitFor(() => expect(lastQuery().get('limit')).toBe('25'));
  });

  it('requests a specific page', async () => {
    renderOrders('/admin/transactions?page=2');
    await waitFor(() => expect(screen.getByText('TXN-9009')).toBeInTheDocument());
    expect(lastQuery().get('page')).toBe('2');
  });
});

describe('Admin Orders — states', () => {
  it('shows a loading skeleton instead of fake values', () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = renderOrders();
    expect(container.querySelectorAll('.adm-ord-skel').length).toBeGreaterThan(0);
    expect(screen.queryByText('₱0')).toBeNull();
  });

  it('shows the empty state when nothing matches', async () => {
    installApi({ items: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 1 } });
    renderOrders();
    await waitFor(() => expect(screen.getByText('No orders match the current filters.')).toBeInTheDocument());
    expect(screen.getByText('Try adjusting your search, branch, date, or status filters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear filters/ })).toBeInTheDocument();
  });

  it('shows the error state with a retry action', async () => {
    installApi({ fail: true });
    renderOrders();
    await waitFor(() => expect(screen.getByText('Unable to load orders.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('Admin Orders — monitoring only', () => {
  it('does not render an actions column', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('TXN-9009')).toBeInTheDocument());
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent.trim().toLowerCase());
    expect(headers).not.toContain('actions');
    expect(headers.some((h) => /^actions\b/.test(h))).toBe(false);
    expect(headers).toEqual(expect.arrayContaining([
      expect.stringContaining('transaction id'),
      expect.stringContaining('customer'),
      expect.stringContaining('item'),
      expect.stringContaining('amount'),
      expect.stringContaining('branch'),
      expect.stringContaining('status'),
      expect.stringContaining('date'),
    ]));
  });

  it('does not render an order details drawer or panel', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('TXN-9009')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/order details/i)).toBeNull();
  });

  it('does not render dead row-selection controls', async () => {
    const { container } = renderOrders();
    await waitFor(() => expect(screen.getByText('TXN-9009')).toBeInTheDocument());
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(0);
  });

  it('never renders a customer bid / buy / favourite control', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('TXN-9009')).toBeInTheDocument());
    expect(screen.queryByText(/place bid/i)).toBeNull();
    expect(screen.queryByText(/buy now/i)).toBeNull();
    expect(screen.queryByText(/reserve/i)).toBeNull();
    expect(screen.queryByText(/favou?rite/i)).toBeNull();
  });
});
