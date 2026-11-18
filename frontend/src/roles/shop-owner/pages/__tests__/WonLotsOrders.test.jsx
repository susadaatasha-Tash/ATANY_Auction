import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WonLotsOrders from '../WonLotsOrders';
import { apiFetch } from '../../../../shared/lib/apiClient';
import { useToast } from '../../../../shared/components/Toast';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toastFn }));

const toastFn = vi.fn();

afterEach(() => {
  cleanup();
  toastFn.mockClear();
  vi.mocked(apiFetch).mockClear();
});

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

describe('Cancel Order', () => {
  const unpaidOrder = {
    id: 'o-cancel-1', transaction_code: 'TXN-C1', item: 'Gold Ring',
    amount: 45000, buyer: 'Maria Santos', status: 'pending',
    payment_status: 'pending', date: '2026-10-10T09:00:00Z',
  };
  const paidOrder = {
    id: 'o-cancel-2', transaction_code: 'TXN-C2', item: 'Pearl Necklace',
    amount: 80000, buyer: 'Klane Cruz', status: 'pending',
    payment_status: 'paid', date: '2026-10-09T10:00:00Z',
  };

  const renderWithOrders = (orders) => {
    vi.mocked(apiFetch).mockImplementation(async (p) => {
      if (p === '/shop-owner/sales') return orders;
      if (/^\/shop-owner\/orders\/[^/]+\/cancel$/.test(p)) return Promise.resolve({ id: 'o-cancel-1', status: 'cancelled' });
      return [];
    });
    render(<WonLotsOrders />);
  };

  test('Cancel Order appears for eligible unpaid orders', async () => {
    renderWithOrders([unpaidOrder]);
    await screen.findByText('TXN-C1');
    const menuBtn = await screen.findByRole('button', { name: /More actions for/i });
    await menuBtn.click();
    expect(screen.getByRole('menuitem', { name: 'Cancel Order' })).toBeInTheDocument();
  });

  test('Cancel Order does NOT appear for paid orders', async () => {
    renderWithOrders([paidOrder]);
    await screen.findByText('TXN-C2');
    const menuBtn = await screen.findByRole('button', { name: /More actions for/i });
    await menuBtn.click();
    expect(screen.queryByRole('menuitem', { name: 'Cancel Order' })).not.toBeInTheDocument();
  });

  test('Cancellation modal opens and requires a reason', async () => {
    renderWithOrders([unpaidOrder]);
    await screen.findByText('TXN-C1');
    const menuBtn = await screen.findByRole('button', { name: /More actions for/i });
    await menuBtn.click();
    await screen.getByRole('menuitem', { name: 'Cancel Order' }).click();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Reason for Cancellation/)).toBeInTheDocument();
    // Clicking confirm without reason shows a validation toast
    await screen.getByRole('button', { name: 'Confirm Cancellation' }).click();
    expect(toastFn).toHaveBeenCalledWith(expect.stringContaining('reason'));
  });

  test('Whitespace-only reason is rejected', async () => {
    renderWithOrders([unpaidOrder]);
    await screen.findByText('TXN-C1');
    const menuBtn = await screen.findByRole('button', { name: /More actions for/i });
    await menuBtn.click();
    await screen.getByRole('menuitem', { name: 'Cancel Order' }).click();
    const reasonInput = screen.getByPlaceholderText('Explain why you are cancelling this order...');
    fireEvent.change(reasonInput, { target: { value: '   ' } });
    await screen.getByRole('button', { name: 'Confirm Cancellation' }).click();
    expect(toastFn).toHaveBeenCalledWith(expect.stringContaining('reason'));
  });

  test('Keep Order closes modal without cancelling', async () => {
    renderWithOrders([unpaidOrder]);
    await screen.findByText('TXN-C1');
    const menuBtn = await screen.findByRole('button', { name: /More actions for/i });
    await menuBtn.click();
    await screen.getByRole('menuitem', { name: 'Cancel Order' }).click();
    await screen.getByRole('button', { name: 'Keep Order' }).click();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/cancel'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  test('Confirm Cancellation sends the correct request and updates UI', async () => {
    renderWithOrders([unpaidOrder]);
    await screen.findByText('TXN-C1');
    const menuBtn = await screen.findByRole('button', { name: /More actions for/i });
    await menuBtn.click();
    await screen.getByRole('menuitem', { name: 'Cancel Order' }).click();
    const reasonInput = screen.getByPlaceholderText('Explain why you are cancelling this order...');
    fireEvent.change(reasonInput, { target: { value: 'Item no longer available' } });
    await screen.getByRole('button', { name: 'Confirm Cancellation' }).click();
    expect(apiFetch).toHaveBeenCalledWith(
      '/shop-owner/orders/o-cancel-1/cancel',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ reason: 'Item no longer available' }),
      })
    );
  });
});
