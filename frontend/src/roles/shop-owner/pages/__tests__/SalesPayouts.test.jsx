import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import SalesPayouts from '../SalesPayouts';
import { apiFetch } from '../../../../shared/lib/apiClient';

// jsdom does not implement ResizeObserver, which Recharts' ResponsiveContainer needs.
global.ResizeObserver = vi.fn((cb) => ({
  observe: vi.fn((el) => cb([{ entry: el, contentRect: { width: 600, height: 260 } }])),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

const summaryPayload = {
  summary: {
    gross_sales_ytd: 164000,
    net_payout_ytd: 141200,
    pending_payout: 0,
    sales_this_month: 12000,
    lots_sold_this_month: 4,
    commission_rate: 0.10
  },
  revenue_trend: [
    { month: 'Oct', gross: 8000, net: 7200 },
    { month: 'Nov', gross: 12000, net: 10800 },
    { month: 'Dec', gross: 15000, net: 13500 },
    { month: 'Jan', gross: 11000, net: 9900 },
    { month: 'Feb', gross: 13000, net: 11700 },
    { month: 'Mar', gross: 14000, net: 12600 },
    { month: 'Apr', gross: 16000, net: 14400 },
    { month: 'May', gross: 18000, net: 16200 },
    { month: 'Jun', gross: 20000, net: 18000 },
    { month: 'Jul', gross: 22000, net: 19800 },
    { month: 'Aug', gross: 24000, net: 21600 },
    { month: 'Sep', gross: 26000, net: 23400 }
  ],
  top_categories: [
    { category: 'Rings', revenue: 62400, percentage: 38 },
    { category: 'Necklaces', revenue: 48900, percentage: 30 },
    { category: 'Watches', revenue: 26300, percentage: 16 },
    { category: 'Earrings', revenue: 16400, percentage: 10 },
    { category: 'Bracelets', revenue: 10000, percentage: 6 }
  ],
  payout_history: [
    { id: 'PAY-2041', date: '2026-10-05T10:00:00Z', amount: 24000, method: 'GCash •••• 4421', status: 'Scheduled' },
    { id: 'PAY-2038', date: '2026-09-28T10:00:00Z', amount: 18500, method: 'BPI •••• 9021', status: 'Paid' },
    { id: 'PAY-2034', date: '2026-09-14T10:00:00Z', amount: 42000, method: 'BPI •••• 9021', status: 'Paid' },
    { id: 'PAY-2031', date: '2026-08-30T10:00:00Z', amount: 31500, method: 'GCash •••• 4421', status: 'Paid' },
    { id: 'PAY-2027', date: '2026-08-16T10:00:00Z', amount: 12800, method: 'BPI •••• 9021', status: 'Paid' },
    { id: 'PAY-2022', date: '2026-08-02T10:00:00Z', amount: 26400, method: 'GCash •••• 4421', status: 'Failed' }
  ]
};

vi.mock('../../../../shared/lib/apiClient', () => ({
  apiFetch: vi.fn(async (path) => {
    if (path.includes('/sales/summary')) return summaryPayload;
    return [];
  }),
}));
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => vi.fn(),
}));

function renderPage() { return render(<SalesPayouts />); }

test('SalesPayouts renders page header and KPI cards', async () => {
  renderPage();
  await screen.findByText('Sales & Payouts');
  expect(screen.getByText('EARNINGS')).toBeInTheDocument();
  expect(screen.getByText('Gross Sales')).toBeInTheDocument();
  expect(screen.getByText('Net Payout')).toBeInTheDocument();
  expect(screen.getByText('Pending Payout')).toBeInTheDocument();
  expect(screen.getByText('This Month')).toBeInTheDocument();
});

test('KPI values come from real API data (not hardcoded)', async () => {
  renderPage();
  await screen.findByText('₱164,000');
  expect(screen.getByText('₱141,200')).toBeInTheDocument();
  expect(screen.getByText('₱0')).toBeInTheDocument();
  expect(screen.getByText('₱12,000')).toBeInTheDocument();
});

test('KPI wording uses recognized-sales language (not completed-sales)', async () => {
  renderPage();
  await screen.findByText('Sales & Payouts');
  expect(screen.getByText('Year-to-date recognized sales')).toBeInTheDocument();
  expect(screen.queryByText('Year-to-date completed sales')).not.toBeInTheDocument();
});

test('Revenue Trend chart renders 12 months', async () => {
  renderPage();
  await screen.findByText('Revenue Trend');
  expect(screen.getByText('Gross sales vs net payout over 12 months')).toBeInTheDocument();
  expect(screen.getByText('Oct')).toBeInTheDocument();
  expect(screen.getByText('Sep')).toBeInTheDocument();
});

test('Top Categories renders category revenue', async () => {
  renderPage();
  await screen.findByText('Top Categories');
  expect(screen.getByText('Share of revenue by category')).toBeInTheDocument();
  expect(screen.getByText('Rings')).toBeInTheDocument();
  expect(screen.getByText('₱62,400')).toBeInTheDocument();
  expect(screen.getByText('Necklaces')).toBeInTheDocument();
  expect(screen.getByText('₱48,900')).toBeInTheDocument();
});

test('Payout History renders table with Export CSV', async () => {
  renderPage();
  await screen.findByText('Payout History');
  expect(screen.getByText('Recent releases to your preferred accounts')).toBeInTheDocument();
  expect(screen.getByText('PAY-2041')).toBeInTheDocument();
  expect(screen.getByText('Oct 5, 2026')).toBeInTheDocument();
  expect(screen.getByText('₱24,000')).toBeInTheDocument();
  expect(screen.getAllByText('GCash •••• 4421').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
  const exportBtn = screen.getByRole('button', { name: /Export CSV/ });
  expect(exportBtn).toBeInTheDocument();
});

test('Payout status badges map correctly', async () => {
  renderPage();
  await screen.findByText('PAY-2041');
  expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
  expect(screen.getByText('Failed')).toBeInTheDocument();
});

test('Export CSV triggers download', async () => {
  renderPage();
  await screen.findByText('Payout History');
  const exportBtn = screen.getByRole('button', { name: /Export CSV/ });
  const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(exportBtn);
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});

test('empty state when no sales data', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({
    summary: { gross_sales_ytd: 0, net_payout_ytd: 0, pending_payout: 0, sales_this_month: 0, lots_sold_this_month: 0, commission_rate: 0.10 },
    revenue_trend: [],
    top_categories: [],
    payout_history: []
  });
  renderPage();
  await screen.findByText('Sales & Payouts');
  expect(screen.getByText('No category revenue yet.')).toBeInTheDocument();
  expect(screen.getByText('No payout history yet.')).toBeInTheDocument();
});
