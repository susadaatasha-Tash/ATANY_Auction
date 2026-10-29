import { render, screen, cleanup } from '@testing-library/react';
import { vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WonLotsOrders from '../WonLotsOrders';
import { apiFetch } from '../../../../shared/lib/apiClient';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

afterEach(() => cleanup());

test('Won Lots & Orders renders the fulfillment table (distinct from dashboard)', async () => {
  vi.mocked(apiFetch).mockImplementation(async (p) => {
    if (p === '/shop-owner/sales') {
      return [{
        id: 'o1', transaction_code: 'TXN-1', item: 'Ring', buyer: 'Buyer',
        amount: 55000, commission: 5500, payout: 49500,
        status: 'pending', payment_status: 'paid', date: new Date().toISOString(),
      }];
    }
    return [];
  });
  render(<WonLotsOrders />);
  expect(await screen.findByText('Ring')).toBeInTheDocument();
  expect(screen.getByText('TXN-1')).toBeInTheDocument();
  expect(screen.queryByText('Revenue Trend')).toBeNull();
});

test('route collision fixed: distinct routes, sidebar, titles', () => {
  const routesSrc = fs.readFileSync(path.join(__dirname, '../../routes.jsx'), 'utf8');
  expect(routesSrc).toMatch(/path:\s*'sales'.*SalesPayouts/s);
  expect(routesSrc).toMatch(/path:\s*'orders'.*WonLotsOrders/s);
  const layoutSrc = fs.readFileSync(path.join(__dirname, '../../../../layouts/ShopOwnerLayout.jsx'), 'utf8');
  expect(layoutSrc).toMatch(/to:\s*'\/shop\/orders'.*Won Lots/s);
  expect(layoutSrc).toMatch(/to:\s*'\/shop\/sales'.*Sales & Payouts/s);
  expect(layoutSrc).toMatch(/'\/shop\/sales':\s*\['Sales & Payouts'\]/);
  expect(layoutSrc).toMatch(/'\/shop\/orders':\s*\['Won Lots & Orders'\]/);
});
