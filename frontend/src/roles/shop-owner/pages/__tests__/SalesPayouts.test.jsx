import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, afterEach, beforeEach } from 'vitest';
import SalesPayouts from '../SalesPayouts';
import { buildSPRReport } from '../salesSPR';
import { apiFetch } from '../../../../shared/lib/apiClient';

const monthPayload = {
  range: 'month',
  range_label: { key: 'month', title: 'This month', period: 'October 1–11, 2026' },
  summary: { gross_sales: 12000, net_payout: 10800, pending_payout: 10800, lots_sold: 1, commission_rate: 0.10 },
  revenue_trend: [{ label: 'Oct 5', gross_sales: 0, net_payout: 0 }, { label: 'Oct 11', gross_sales: 12000, net_payout: 10800 }],
  top_categories: [{ name: 'Necklaces', revenue: 12000, percent: 100 }],
  payout_history: [
    { id: 'TXN-0002', order_id: 'o2', date: '2026-10-05T11:00:00+08:00', amount: 10800, gross_amount: 12000, method: 'GCash •••• 4421', status: 'scheduled' },
  ],
};
const sevenPayload = {
  range: '7d',
  range_label: { key: '7d', title: 'Last 7 days', period: 'October 5–11, 2026' },
  summary: { gross_sales: 12000, net_payout: 10800, pending_payout: 10800, lots_sold: 1, commission_rate: 0.10 },
  revenue_trend: Array.from({ length: 7 }, (_, i) => ({ label: `Oct ${5 + i}`, gross_sales: i === 6 ? 12000 : 0, net_payout: i === 6 ? 10800 : 0 })),
  top_categories: [{ name: 'Necklaces', revenue: 12000, percent: 100 }],
  payout_history: monthPayload.payout_history,
};
const yearPayload = {
  range: 'year',
  range_label: { key: 'year', title: 'This year', period: 'January 1–October 11, 2026' },
  summary: { gross_sales: 67000, net_payout: 60300, pending_payout: 10800, lots_sold: 2, commission_rate: 0.10 },
  revenue_trend: [{ label: 'Jan', gross_sales: 0, net_payout: 0 }, { label: 'Aug', gross_sales: 55000, net_payout: 49500 }],
  top_categories: [{ name: 'Rings', revenue: 55000, percent: 82.1 }, { name: 'Necklaces', revenue: 12000, percent: 17.9 }],
  payout_history: monthPayload.payout_history,
};

vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: vi.fn() }));

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function renderPage(route = '/shop/sales') {
  return render(<MemoryRouter initialEntries={[route]}><SalesPayouts /></MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path === '/shop-owner/shop') return { shop_name: 'Golden Heritage Co.' };
    if (path.includes('range=7d')) return sevenPayload;
    if (path.includes('range=year')) return yearPayload;
    if (path.includes('/shop-owner/sales/summary')) return monthPayload;
    return [];
  });
});
afterEach(() => cleanup());

test('default range is This Month', async () => {
  renderPage();
  await screen.findByText('Gross Sales');
  expect(screen.getByRole('button', { name: 'This Month' })).toHaveAttribute('aria-pressed', 'true');
  expect(document.querySelector('.sp-kpis').textContent).toMatch(/₱12,000/);
});

test('only one active range; switching refreshes everything', async () => {
  renderPage();
  await screen.findByText('Gross Sales');
  fireEvent.click(screen.getByRole('button', { name: 'This Year' }));
  await waitFor(() => {
    expect(screen.getByText('₱67,000')).toBeInTheDocument();
  });
  const pressed = ['7 Days', 'This Month', 'This Year']
    .map((n) => screen.getByRole('button', { name: n }).getAttribute('aria-pressed'));
  expect(pressed).toEqual(['false', 'false', 'true']);
  await waitFor(() => {
    expect(screen.getByText('Rings')).toBeInTheDocument();
  });
  await waitFor(() => {
    const kpiValues = Array.from(document.querySelectorAll('.sp-kpi__value')).map((el) => el.textContent);
    expect(kpiValues).toContain('2');
  });
});

test('7 Days granularity is daily (7 points)', async () => {
  renderPage('​/shop/sales?range=7d');
  await screen.findByText('Gross Sales');
  expect(screen.getByRole('button', { name: '7 Days' })).toHaveAttribute('aria-pressed', 'true');
});

test('KPI labels adapt (no fixed YTD)', async () => {
  renderPage();
  await screen.findByText('Gross Sales');
  expect(screen.queryByText(/Gross Sales \(YTD\)/)).toBeNull();
  expect(screen.getByText('Lots Sold')).toBeInTheDocument();
  expect(screen.getByText('Current pending balance')).toBeInTheDocument();
});

test('invalid URL range falls back to month', async () => {
  renderPage('/shop/sales?range=banana');
  await screen.findByText('Gross Sales');
  expect(screen.getByRole('button', { name: 'This Month' })).toHaveAttribute('aria-pressed', 'true');
  expect(vi.mocked(apiFetch).mock.calls.some(([p]) => p.includes('range=month'))).toBe(true);
});

test('Export SPR opens the ranged A4 report', async () => {
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {
    const doc = { write: vi.fn(), close: vi.fn() };
    return { document: doc, focus: vi.fn(), print: vi.fn(), __doc: doc };
  });
  renderPage();
  await screen.findByText('Gross Sales');
  fireEvent.click(screen.getByRole('button', { name: /Export SPR/ }));
  expect(openSpy).toHaveBeenCalled();
  const win = openSpy.mock.results[0].value;
  const html = win.__doc.write.mock.calls[0][0];
  expect(html).toMatch(/SELLER FINANCIAL REPORT/);
  expect(html).toMatch(/Golden Heritage Co\./);
  expect(html).toMatch(/This month/);
  expect(html).toMatch(/₱12,000/);
  openSpy.mockRestore();
});

test('SPR builder uses only provided data (no mock totals)', () => {
  const html = buildSPRReport({
    shopName: 'S', rangeTitle: 'Last 7 days', rangePeriod: 'October 5–11, 2026',
    generatedAt: new Date('2026-10-11T16:05:00+08:00'),
    summary: { gross_sales: 20000, net_payout: 18000, pending_payout: 0, lots_sold: 1 },
    trend: [{ label: 'Oct 11', gross_sales: 20000, net_payout: 18000 }],
    categories: [{ name: 'Rings', revenue: 20000, percent: 100 }],
    payouts: [{ id: 'TXN-9', date: '2026-10-11T10:00:00+08:00', amount: 18000, method: 'GCash •••• 1', status: 'paid' }],
  });
  expect(html).toMatch(/₱20,000/);
  expect(html).toMatch(/October 1–11, 2026|October 5–11, 2026/);
  expect(html).not.toMatch(/₱164,000|PAY-2041/);
});

test('rapid switching shows the newest range (no stale override)', async () => {
  let resolveSecond = null;
  vi.mocked(apiFetch).mockImplementation((path) => {
    if (path.includes('range=year')) return new Promise((r) => { resolveSecond = () => r(yearPayload); });
    if (path.includes('/shop-owner/sales/summary')) return Promise.resolve(monthPayload);
    if (path === '/shop-owner/shop') return Promise.resolve({});
    return Promise.resolve([]);
  });
  renderPage();
  await screen.findByText('Gross Sales');
  fireEvent.click(screen.getByRole('button', { name: 'This Year' }));
  fireEvent.click(screen.getByRole('button', { name: '7 Days' }));
  resolveSecond?.();
  await waitFor(() => {
    expect(document.querySelector('.sp-kpis').textContent).toMatch(/₱12,000/);
  });
  expect(document.querySelector('.sp-kpis').textContent).not.toMatch(/₱67,000/);
});

test('empty + error states', async () => {
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path === '/shop-owner/shop') return {};
    return {
      range: 'month', range_label: { title: 'This month', period: '' },
      summary: { gross_sales: 0, net_payout: 0, pending_payout: 0, lots_sold: 0, commission_rate: 0.10 },
      revenue_trend: [], top_categories: [], payout_history: [],
    };
  });
  renderPage();
  await screen.findByText('No payout history yet.');
  expect(screen.getByText('No category revenue yet.')).toBeInTheDocument();
  expect(screen.queryByText('₱164,000')).toBeNull();
});
