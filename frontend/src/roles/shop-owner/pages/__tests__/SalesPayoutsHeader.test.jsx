// frontend/src/roles/shop-owner/pages/__tests__/SalesPayoutsHeader.test.jsx
// Sales & Payouts — the page body must not duplicate the portal topbar, and
// the earnings table must not pretend that money was disbursed to the seller.
//
// The topbar already renders "SELLER PORTAL / Sales & Payouts" and the
// authoritative active-listing count, so the body must NOT render a second
// heading, a subtitle, or a (hardcoded) listing counter.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  LineChart: ({ children }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ReferenceLine: () => null,
}));

import SalesPayouts from '../SalesPayouts';

// Mirrors the REAL backend summary shape (one paid order → one earnings row).
const SUMMARY = {
  summary: {
    gross_sales_ytd: 55000,
    net_earnings_ytd: 49500,
    pending_earnings: 0,
    sales_this_month: 0,
    lots_sold_this_month: 0,
    commission_rate: 0.1,
  },
  revenue_trend: [
    { month: 'SEP 2026', gross: 55000, net: 49500 },
    { month: 'OCT 2026', gross: 0, net: 0 },
  ],
  top_categories: [{ category: 'Bracelets', revenue: 55000, percentage: 100 }],
  earnings_history: [
    {
      id: 'TXN-9002',
      date: '2026-09-15T10:34:48.890Z',
      item: 'Rose Gold Bangle',
      buyer: 'Britz Susada',
      gross: 55000,
      commission: 5500,
      net: 49500,
      status: 'Earned',
      order_status: 'Completed',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockImplementation((p) => {
    if (p === '/shop-owner/sales/summary') return Promise.resolve(SUMMARY);
    return Promise.resolve([]);
  });
});

describe('Sales & Payouts — no duplicate body heading', () => {
  it('does not render EARNINGS / a second title / the subtitle in the body', async () => {
    render(<SalesPayouts />);
    await waitFor(() => expect(screen.getByText('Gross Sales')).toBeInTheDocument());
    expect(screen.queryByText('EARNINGS')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sales & Payouts' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('Track your sales performance and payout history')
    ).not.toBeInTheDocument();
  });

  it('does not render an active-listing counter in the body', async () => {
    render(<SalesPayouts />);
    await waitFor(() => expect(screen.getByText('Gross Sales')).toBeInTheDocument());
    expect(screen.queryByText(/active listings/i)).not.toBeInTheDocument();
  });

  it('starts the content with the KPI cards', async () => {
    render(<SalesPayouts />);
    await waitFor(() => expect(screen.getByText('Gross Sales')).toBeInTheDocument());
    const kpi = within(document.querySelector('.sp-kpi'));
    for (const label of ['Gross Sales', 'Net Earnings', 'Pending Earnings', 'This Month']) {
      expect(kpi.getByText(label)).toBeInTheDocument();
    }
  });

  it('the loading and error states do not re-add the removed heading', async () => {
    let resolveSummary;
    apiFetch.mockImplementation((p) => {
      if (p === '/shop-owner/sales/summary') {
        return new Promise((res) => { resolveSummary = res; });
      }
      return Promise.resolve([]);
    });
    render(<SalesPayouts />);
    await waitFor(() => expect(screen.getByText(/Loading sales and earnings data/i)).toBeInTheDocument());
    expect(screen.queryByText('EARNINGS')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sales & Payouts' })).not.toBeInTheDocument();

    // Now an error state
    resolveSummary?.(Promise.reject(new Error('boom')));
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
    expect(screen.queryByText('EARNINGS')).not.toBeInTheDocument();
  });
});

describe('Sales & Payouts — no hardcoded counters', () => {
  it('the source has no hardcoded listing count', () => {
    const src = fs.readFileSync(path.join(__dirname, 'SalesPayouts.jsx'), 'utf8');
    expect(src).not.toMatch(/>35</);
    expect(src).not.toMatch(/sp-count/);
    expect(src).not.toMatch(/sp-active-pill/);
    // The page must not introduce a second listing counter.
    expect(src).not.toMatch(/active listings/i);
  });

  it('the page still renders the real revenue trend + earnings history', async () => {
    render(<SalesPayouts />);
    await waitFor(() => expect(screen.getByText('Gross Sales')).toBeInTheDocument());
    // The trend chart is rendered by Recharts (the month labels live inside the
    // chart); the earnings history is plain DOM.
    expect(screen.getByText('Revenue Trend')).toBeInTheDocument();
    expect(screen.getByText('Earnings History')).toBeInTheDocument();
    expect(screen.getByText('TXN-9002')).toBeInTheDocument();
  });
});

describe('Sales & Payouts — truthful earnings history', () => {
  it('shows the earned row with gross, commission and net earnings', async () => {
    render(<SalesPayouts />);
    await waitFor(() => expect(screen.getByText('TXN-9002')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Rose Gold Bangle')).toBeInTheDocument();
    expect(table.getByText('Britz Susada')).toBeInTheDocument();
    expect(table.getByText('₱55,000')).toBeInTheDocument();
    expect(table.getByText('₱5,500')).toBeInTheDocument();
    expect(table.getByText('₱49,500')).toBeInTheDocument();
    expect(table.getAllByText('Earned').length).toBeGreaterThan(0);
    // The fulfillment state is separate from the earnings state.
    expect(table.getByText('Completed')).toBeInTheDocument();
  });

  it('never claims the seller was paid out', async () => {
    render(<SalesPayouts />);
    await waitFor(() => expect(screen.getByText('TXN-9002')).toBeInTheDocument());
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
    expect(screen.queryByText('Scheduled')).not.toBeInTheDocument();
    expect(screen.queryByText(/payout history/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Payout History')).not.toBeInTheDocument();
  });

  it('has no payout-method column', async () => {
    render(<SalesPayouts />);
    await waitFor(() => expect(screen.getByText('Earnings History')).toBeInTheDocument());
    expect(within(screen.getByRole('table')).queryByText('Method')).not.toBeInTheDocument();
    expect(screen.queryByText(/Subscription preference/i)).not.toBeInTheDocument();
  });
});
