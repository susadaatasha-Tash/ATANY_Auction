// Won Lots & Orders — focused UI + logic coverage (spec §54).
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const apiFetch = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toast }));

import WonLotsOrders from '../WonLotsOrders';

const now = Date.now();
function mkOrder(over = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    transaction_code: 'TXN-9009',
    item: 'TEST 1',
    item_image: 'https://img.test/watch.jpg',
    category: 'Watches',
    buyer: 'britz Susada',
    amount: 71000,
    commission: 7100,
    payout: 63900,
    status: 'pending',
    payment_status: 'paid',
    payment_method: 'gcash',
    branch_name: 'Gmall',
    paid_at: '2026-10-11T03:00:00Z',
    date: '2026-10-11T02:24:00Z',
    ...over,
  };
}

let orders;
let patchCalls;

function setupApi({ fail = false } = {}) {
  patchCalls = [];
  apiFetch.mockImplementation(async (path, opts = {}) => {
    if (path === '/shop-owner/sales') {
      if (fail) throw new Error('Service unavailable');
      return orders;
    }
    if (opts.method === 'PATCH') {
      patchCalls.push({ path, body: JSON.parse(opts.body) });
      return { id: 'o', status: opts.body ? JSON.parse(opts.body).status : null };
    }
    return [];
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WonLotsOrders />
    </MemoryRouter>
  );
}

beforeEach(() => {
  orders = [
    mkOrder(),
    mkOrder({ id: '22222222-2222-2222-2222-222222222222', transaction_code: 'TXN-9008', item: 'testing 1', category: 'Rings', buyer: 'Britz Atasha', amount: 10000, commission: 1000, payout: 9000, payment_status: null, status: 'preparing' }),
    mkOrder({ id: '33333333-3333-3333-3333-333333333333', transaction_code: 'TXN-9007', item: 'Verification Ring', category: 'Rings', buyer: 'Maria Santos', amount: 41000, commission: 4100, payout: 36900, payment_status: 'pending', status: 'ready_pickup' }),
  ];
  toast.mockClear();
  setupApi();
});

afterEach(() => { apiFetch.mockReset(); });

describe('page + KPI rendering', () => {
  test('1. page renders with real API data', async () => {
    renderPage();
    expect(await screen.findByText('TEST 1')).toBeInTheDocument();
    expect(document.querySelector('.wlo')).not.toBeNull();
  });

  test('2. KPIs render real API values (no hardcoded money)', async () => {
    renderPage();
    await screen.findByText('TEST 1');
    // 71000 + 10000 + 41000
    expect(screen.getByText('₱122,000')).toBeInTheDocument();   // Total Sales
    expect(screen.getByText('₱12,200')).toBeInTheDocument();     // Commission
    expect(screen.getByText('₱109,800')).toBeInTheDocument();    // Payout
    // KPI scope is the full seller dataset, not just the visible page
    expect(screen.getByText('Total Sales')).toBeInTheDocument();
    expect(screen.getByText('Platform Commission (10%)')).toBeInTheDocument();
    expect(screen.getByText('Your Total Payout (90%)')).toBeInTheDocument();
  });

  test('5. rows render order id, item, buyer and amounts', async () => {
    renderPage();
    await screen.findByText('TXN-9009');
    expect(screen.getByText('britz Susada')).toBeInTheDocument();
    expect(screen.getByText('₱71,000')).toBeInTheDocument();
    expect(screen.getByText('₱7,100')).toBeInTheDocument();
    expect(screen.getByText('₱63,900')).toBeInTheDocument();
  });

  test('6. item thumbnail renders; missing image uses the placeholder', async () => {
    orders = [mkOrder(), mkOrder({ id: '44444444-4444-4444-4444-444444444444', item_image: null, item: 'No Image Lot' })];
    renderPage();
    await screen.findByText('TEST 1');
    const withImg = document.querySelector('[data-testid="order-row-11111111-1111-1111-1111-111111111111"]');
    expect(within(withImg).getByRole('presentation', { hidden: true })).toBeTruthy();
    expect(withImg.querySelector('.wlo-item__thumb img')).not.toBeNull();
    const noImg = document.querySelector('[data-testid="order-row-44444444-4444-4444-4444-444444444444"]');
    expect(noImg.querySelector('.wlo-item__thumb img')).toBeNull();
    expect(noImg.querySelector('.wlo-item__ph')).not.toBeNull();
  });
});

describe('search + filter', () => {
  test('3. search works across order id, buyer and item', async () => {
    renderPage();
    await screen.findByText('TXN-9009');
    const search = screen.getByLabelText('Search sales, buyers, items, or order ID');
    fireEvent.change(search, { target: { value: 'TXN-9008' } });
    expect(screen.getByText('TXN-9008')).toBeInTheDocument();
    expect(screen.queryByText('TXN-9009')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'Maria' } });
    expect(screen.getByText('TXN-9007')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'ring' } });
    expect(screen.getByText('TXN-9007')).toBeInTheDocument();
  });

  test('4. status filter works and uses real status values', async () => {
    renderPage();
    await screen.findByText('TXN-9009');
    const filter = screen.getByLabelText('Filter by status');
    expect(within(filter).getByText('All Status')).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: 'ready' } });
    expect(screen.getByText('TXN-9007')).toBeInTheDocument();
    expect(screen.queryByText('TXN-9009')).not.toBeInTheDocument();
    fireEvent.change(filter, { target: { value: 'completed' } });
    expect(screen.getByText('No sales match your filters.')).toBeInTheDocument();
  });
});

describe('badges', () => {
  test('12. payment badge mapping (No Payment / Pending / Paid)', async () => {
    renderPage();
    await screen.findByText('TXN-9009');
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No Payment').length).toBeGreaterThan(0);
    expect(document.querySelector('.wlo-badge--paid')).not.toBeNull();
    expect(document.querySelector('.wlo-badge--pending')).not.toBeNull();
  });

  test('13. order status badge mapping (Processing / Completed)', async () => {
    orders = [
      mkOrder(),
      mkOrder({ id: '55555555-5555-5555-5555-555555555555', transaction_code: 'TXN-9002', status: 'completed' }),
    ];
    renderPage();
    await screen.findByText('TXN-9002');
    expect(screen.getAllByText('Processing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(document.querySelector('.wlo-badge--completed')).not.toBeNull();
  });
});

describe('View button (text only — no eye icon)', () => {
  test('7. View button text equals "View"', async () => {
    renderPage();
    await screen.findByText('TXN-9009');
    const btn = screen.getAllByRole('button', { name: /^View TXN-/ })[0];
    expect(btn.textContent).toBe('View');
  });

  test('8. View button contains no eye icon', async () => {
    const { container } = renderPage();
    await screen.findByText('TXN-9009');
    const viewBtn = container.querySelector('.wlo-btn-view');
    expect(viewBtn).not.toBeNull();
    expect(viewBtn.querySelector('svg')).toBeNull();   // no icon element
    expect(viewBtn.textContent.trim()).toBe('View');
    expect(viewBtn.innerHTML).not.toMatch(/eye|👁|<svg/i);
  });

  test('9. View opens the exact clicked order', async () => {
    renderPage();
    await screen.findByText('TXN-9009');
    fireEvent.click(screen.getByRole('button', { name: 'View TXN-9008' }));
    const dialogEl = await screen.findByRole('dialog');
    const dialog = within(dialogEl);
    expect(dialog.getByText('Britz Atasha')).toBeInTheDocument();
    expect(dialog.getByText('₱9,000')).toBeInTheDocument();
  });

  test('10. clicking a second order updates the details (no stale record)', async () => {
    renderPage();
    await screen.findByText('TXN-9009');
    fireEvent.click(screen.getByRole('button', { name: 'View TXN-9009' }));
    expect(within(await screen.findByRole('dialog')).getByText('britz Susada')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'View TXN-9007' }));
    expect(within(await screen.findByRole('dialog')).getByText('Maria Santos')).toBeInTheDocument();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByText('britz Susada')).toBeNull();
    expect(dialog.getByText('₱36,900')).toBeInTheDocument();
  });
});

describe('three-dot menu + fulfillment rules', () => {
  test('11. three-dot opens the correct row menu', async () => {
    orders = [orders[0], { ...orders[2], payment_status: 'paid' }];
    setupApi();
    renderPage();
    await screen.findByText('TXN-9009');
    fireEvent.click(screen.getByRole('button', { name: 'More actions for TXN-9007' }));
    const menu = screen.getByRole('menu');
    // ready_pickup + paid → Confirm Pickup
    expect(within(menu).getByRole('menuitem', { name: 'Confirm Pickup' })).toBeInTheDocument();
  });

  test('17. payment-before-preparing: unpaid order action is disabled with a reason', async () => {
    // TXN-9007 is ready_pickup but UNPAID → the backend would reject it.
    renderPage();
    await screen.findByText('TXN-9009');
    fireEvent.click(screen.getByRole('button', { name: 'More actions for TXN-9007' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Confirm Pickup' })).toBeNull();
    expect(menu.textContent).toMatch(/Payment must be paid first/i);
  });

  test('16. valid order action calls the backend and refreshes', async () => {
    renderPage();
    await screen.findByText('TXN-9009');
    fireEvent.click(screen.getByRole('button', { name: 'More actions for TXN-9009' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Start Preparing' }));
    await screen.findByText('Start preparing this order?');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
      expect(patchCalls[0].path).toBe('/shop-owner/orders/11111111-1111-1111-1111-111111111111/status');
      expect(patchCalls[0].body.status).toBe('preparing');
    });
    expect(toast).toHaveBeenCalledWith('Order is now preparing');
    // refetched in the background (no full skeleton swap)
    await waitFor(() => expect(apiFetch.mock.calls.filter(([p]) => p === '/shop-owner/sales').length).toBeGreaterThan(1));
  });

  test('18. invalid transition blocked by the backend surfaces a safe error', async () => {
    apiFetch.mockImplementation(async (path, opts = {}) => {
      if (path === '/shop-owner/sales') return orders;
      if (opts.method === 'PATCH') throw Object.assign(new Error('Invalid transition pending → completed'), { status: 400 });
      return [];
    });
    renderPage();
    await screen.findByText('TXN-9009');
    fireEvent.click(screen.getByRole('button', { name: 'More actions for TXN-9009' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Start Preparing' }));
    await screen.findByText('Start preparing this order?');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Invalid transition pending → completed'));
    // button is released, no stuck spinner
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });
});

describe('sorting + pagination', () => {
  test('14. sorting toggles direction on ORDER ID', async () => {
    renderPage();
    await screen.findByText('TXN-9009');
    const header = screen.getByRole('button', { name: /Order Id/ });
    const ids = () => Array.from(document.querySelectorAll('.wlo-orderid')).map((n) => n.textContent);
    const ascFirst = ids();
    fireEvent.click(header);
    await waitFor(() => expect(ids()[0]).not.toBe(ascFirst[0]));
    const asc = ids();
    fireEvent.click(header);
    await waitFor(() => expect(ids()[0]).toBe(ascFirst[0]));
  });

  test('15. pagination splits rows and disables prev on the first page', async () => {
    orders = Array.from({ length: 14 }).map((_, i) =>
      mkOrder({ id: `aaaaaaaa-0000-0000-0000-00000000000${i}`, transaction_code: `TXN-90${String(i).padStart(2, '0')}`, amount: 1000, commission: 100, payout: 900 })
    );
    renderPage();
    await screen.findByText('14 sales');
    expect(document.querySelectorAll('[data-testid^="order-row-"]')).toHaveLength(10);
    const prev = screen.getByRole('button', { name: 'Previous page' });
    const next = screen.getByRole('button', { name: 'Next page' });
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();
    fireEvent.click(next);
    await waitFor(() => expect(document.querySelectorAll('[data-testid^="order-row-"]')).toHaveLength(4));
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });

  test('32. result count uses the real filtered total', async () => {
    renderPage();
    await screen.findByText('3 sales');
    fireEvent.change(screen.getByLabelText('Search sales, buyers, items, or order ID'), { target: { value: 'TXN-9008' } });
    await waitFor(() => expect(screen.getByText('1 sale')).toBeInTheDocument());
  });

  test('page-size select changes rows per page', async () => {
    orders = Array.from({ length: 12 }).map((_, i) =>
      mkOrder({ id: `bbbbbbbb-0000-0000-0000-00000000000${i}`, transaction_code: `TXN-80${String(i).padStart(2, '0')}`, amount: 1000, commission: 100, payout: 900 })
    );
    renderPage();
    await screen.findByText('12 sales');
    expect(document.querySelectorAll('[data-testid^="order-row-"]')).toHaveLength(10);
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '25' } });
    await waitFor(() => expect(document.querySelectorAll('[data-testid^="order-row-"]')).toHaveLength(12));
  });
});

describe('loading / empty / error', () => {
  test('17. loading skeleton mirrors the final UI (KPIs + table rows)', async () => {
    let release;
    apiFetch.mockImplementation((path) =>
      path === '/shop-owner/sales' ? new Promise((res) => { release = () => res(orders); }) : Promise.resolve([])
    );
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(container.querySelectorAll('.wlo-kpi')).toHaveLength(3);
    expect(container.querySelectorAll('.wlo-table tbody tr')).toHaveLength(6);
    expect(container.querySelectorAll('.atany-skel').length).toBeGreaterThan(20);
    // no false empty state while loading
    expect(screen.queryByText('No sales yet.')).not.toBeInTheDocument();

    release();
    await screen.findByText('TEST 1');
    expect(document.querySelectorAll('.atany-skel').length).toBe(0);
  });

  test('18. empty state only after a confirmed empty response', async () => {
    orders = [];
    renderPage();
    await screen.findByText('No sales yet.');
  });

  test('19. error state stops loading and offers retry', async () => {
    setupApi({ fail: true });
    renderPage();
    await screen.findByText('Unable to load your orders.');
    expect(screen.queryByText('No sales yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});