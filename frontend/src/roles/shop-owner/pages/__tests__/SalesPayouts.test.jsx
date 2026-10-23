import { render, screen, fireEvent, within } from '@testing-library/react';
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
global.URL.revokeObjectURL = vi.fn();

// The summary payload mirrors the REAL backend shape:
//   summary.net_earnings_ytd / summary.pending_earnings
//   earnings_history[] = { id, date, item, buyer, gross, commission, net, status, order_status }
// There is deliberately NO `method` field — ATANY does not track a seller
// payout destination.
const summaryPayload = {
  summary: {
    gross_sales_ytd: 164000,
    net_earnings_ytd: 141200,
    pending_earnings: 21600,
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
  earnings_history: [
    {
      id: 'TXN-9002',
      date: '2026-10-05T10:00:00Z',
      item: 'Rose Gold Bangle',
      buyer: 'Britz Susada',
      gross: 24000,
      commission: 2400,
      net: 21600,
      status: 'Earned',
      order_status: 'Pending fulfillment'
    },
    {
      id: 'TXN-9001',
      date: '2026-09-28T10:00:00Z',
      item: 'Emerald Ring',
      buyer: 'Maria Santos',
      gross: 18500,
      commission: 1850,
      net: 16650,
      status: 'Earned',
      order_status: 'Completed'
    },
    {
      id: 'TXN-9000',
      date: '2026-09-14T10:00:00Z',
      item: 'Pearl Necklace',
      buyer: 'John Dela Cruz',
      gross: 42000,
      commission: 4200,
      net: 37800,
      status: 'Earned',
      order_status: 'Completed'
    }
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

// The KPI strip and the earnings table reuse some labels ("Gross Sales",
// "Net Earnings"), so each assertion is scoped to its own region.
function kpi() { return within(document.querySelector('.sp-kpi')); }
function table() { return within(screen.getByRole('table')); }

test('SalesPayouts renders the KPI cards (page identity comes from the topbar)', async () => {
  renderPage();
  await screen.findByText('₱164,000');
  // The body must NOT duplicate the topbar heading.
  expect(screen.queryByText('EARNINGS')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Sales & Payouts' })).not.toBeInTheDocument();
  expect(kpi().getByText('Gross Sales')).toBeInTheDocument();
  expect(kpi().getByText('Net Earnings')).toBeInTheDocument();
  expect(kpi().getByText('Pending Earnings')).toBeInTheDocument();
  expect(kpi().getByText('This Month')).toBeInTheDocument();
});

test('KPI wording never calls seller earnings a payout', async () => {
  renderPage();
  await screen.findByText('₱164,000');
  expect(kpi().queryByText('Net Payout')).not.toBeInTheDocument();
  expect(kpi().queryByText('Pending Payout')).not.toBeInTheDocument();
  expect(kpi().queryByText(/payout/i)).not.toBeInTheDocument();
});

test('KPI values come from real API data (not hardcoded)', async () => {
  renderPage();
  await screen.findByText('₱164,000');
  expect(kpi().getByText('₱164,000')).toBeInTheDocument();
  expect(kpi().getByText('₱141,200')).toBeInTheDocument();
  expect(kpi().getByText('₱21,600')).toBeInTheDocument();
  expect(kpi().getByText('₱12,000')).toBeInTheDocument();
});

test('KPI wording uses recognized-sales language (not completed-sales)', async () => {
  renderPage();
  await screen.findByText('₱164,000');
  expect(kpi().getByText('Year-to-date recognized sales')).toBeInTheDocument();
  expect(kpi().queryByText('Year-to-date completed sales')).not.toBeInTheDocument();
});

test('Revenue Trend chart renders 12 months with earnings wording', async () => {
  renderPage();
  await screen.findByText('Revenue Trend');
  expect(screen.getByText('Gross sales vs net earnings over 12 months')).toBeInTheDocument();
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

test('Earnings History renders the truthful earnings table with Export CSV', async () => {
  renderPage();
  await screen.findByText('Earnings History');
  expect(screen.getByText('Your recognized seller earnings from paid auction orders')).toBeInTheDocument();

  // Column headers: transaction, date, item, buyer, gross, commission, net, status.
  for (const header of [
    'Transaction', 'Date', 'Item', 'Buyer',
    'Gross Sale', 'ATANY Commission', 'Net Earnings', 'Status'
  ]) {
    expect(table().getByText(header)).toBeInTheDocument();
  }

  expect(table().getByText('TXN-9002')).toBeInTheDocument();
  expect(table().getByText('Oct 5, 2026')).toBeInTheDocument();
  expect(table().getByText('Rose Gold Bangle')).toBeInTheDocument();
  expect(table().getByText('Britz Susada')).toBeInTheDocument();
  expect(table().getByText('₱24,000')).toBeInTheDocument();
  expect(table().getByText('₱2,400')).toBeInTheDocument();
  expect(table().getByText('₱21,600')).toBeInTheDocument();

  const exportBtn = screen.getByRole('button', { name: /Export CSV/ });
  expect(exportBtn).toBeInTheDocument();
});

test('Earnings History status is "Earned" and never "Paid" (no disbursement record)', async () => {
  renderPage();
  await screen.findByText('TXN-9002');
  expect(table().getAllByText('Earned').length).toBe(3);
  expect(table().queryByText('Paid')).not.toBeInTheDocument();
  expect(table().queryByText('Scheduled')).not.toBeInTheDocument();
  expect(table().queryByText('Failed')).not.toBeInTheDocument();
});

test('the fulfillment state is shown separately from the earnings state', async () => {
  renderPage();
  await screen.findByText('TXN-9002');
  expect(table().getByText('Pending fulfillment')).toBeInTheDocument();
  expect(table().getAllByText('Completed').length).toBe(2);
});

test('Earnings History has no misleading payout-method column', async () => {
  renderPage();
  await screen.findByText('Earnings History');
  expect(table().queryByText('Method')).not.toBeInTheDocument();
  expect(screen.queryByText(/Subscription preference/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/GCash ••••/)).not.toBeInTheDocument();
  expect(screen.queryByText(/BPI ••••/)).not.toBeInTheDocument();
});

test('Export CSV downloads the earnings history with the truthful columns', async () => {
  renderPage();
  await screen.findByText('Earnings History');

  // Capture the CSV body and the download filename.
  const RealBlob = globalThis.Blob;
  let csv = '';
  globalThis.Blob = class {
    constructor(parts) { csv = parts.join(''); }
  };
  let filename = '';
  const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    filename = this.download;
  });

  try {
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    expect(spy).toHaveBeenCalled();
  } finally {
    spy.mockRestore();
    globalThis.Blob = RealBlob;
  }

  // Header row — no payout-method column.
  expect(csv.split('\n')[0]).toBe(
    '"Transaction ID","Date","Item","Buyer","Gross Sale","ATANY Commission","Net Earnings","Status"'
  );
  expect(csv).not.toMatch(/Method/);
  expect(csv).not.toMatch(/Subscription preference/);

  // A real data row: gross, 10% commission, 90% net earnings.
  expect(csv).toContain('"TXN-9002","Oct 5, 2026","Rose Gold Bangle","Britz Susada","₱24,000","₱2,400","₱21,600","Earned"');

  // Filename.
  expect(filename).toMatch(/^atany-earnings-history-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('empty state when no sales data', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({
    summary: { gross_sales_ytd: 0, net_earnings_ytd: 0, pending_earnings: 0, sales_this_month: 0, lots_sold_this_month: 0, commission_rate: 0.10 },
    revenue_trend: [],
    top_categories: [],
    earnings_history: []
  });
  renderPage();
  await screen.findByText('Gross Sales');
  expect(screen.getByText('No category revenue yet.')).toBeInTheDocument();
  expect(screen.getByText('No earnings history yet.')).toBeInTheDocument();
});
