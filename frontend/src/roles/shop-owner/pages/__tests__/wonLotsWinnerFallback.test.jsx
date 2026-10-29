// frontend/src/roles/shop-owner/pages/__tests__/wonLotsWinnerFallback.test.jsx
// SELLER view of the 7-day winner fallback.
//
// The seller must always see the CURRENT eligible buyer, the amount that buyer
// actually owes, the live payment deadline, and a small marker when the item
// was reassigned. There is no seller control for picking a fallback bidder.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
const toast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toast }));

import WonLotsOrders from '../WonLotsOrders';

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

function sale(over = {}) {
  return {
    id: 'o1',
    transaction_code: 'TXN-9001',
    item: 'Rose Gold Bangle',
    category: 'Rings',
    buyer: 'Britz Susada',
    buyer_id: 'user-b',
    amount: 65000,
    commission: 6500,
    payout: 58500,
    status: 'pending',
    payment_status: 'unpaid',
    payment_method: null,
    branch_name: 'Gmall',
    date: iso(-8 * DAY),
    winner_confirmed_at: iso(-1 * DAY),
    payment_deadline: iso(6 * DAY),
    winner_rank: 2,
    ...over,
  };
}

function routeFetch(rows) {
  return (path) => {
    if (path === '/shop-owner/sales') return Promise.resolve(rows);
    return Promise.resolve([]);
  };
}

async function renderPage(rows) {
  apiFetch.mockImplementation(routeFetch(rows));
  render(<WonLotsOrders />);
  await waitFor(() => expect(screen.getByText(/Rose Gold Bangle/i)).toBeTruthy());
}

beforeEach(() => { apiFetch.mockReset(); toast.mockReset(); });
// Vitest runs without globals here, so Testing Library's auto-cleanup is not
// registered — unmount explicitly between cases.
afterEach(() => cleanup());

describe('seller — current reassigned winner', () => {
  it('1. renders the CURRENT eligible buyer, not the expired winner', async () => {
    await renderPage([sale()]);
    expect(screen.getByText('Britz Susada')).toBeTruthy();
    expect(screen.queryByText('Maria Santos')).toBeNull();
  });

  it('2. renders the amount that buyer actually owes (their own bid)', async () => {
    await renderPage([sale({ amount: 65000 })]);
    expect(screen.getAllByText(/65,000/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/71,000/)).toBeNull();
  });

  it('3. renders the live payment deadline from the backend', async () => {
    await renderPage([sale()]);
    expect(screen.getByText(/Payment due/i)).toBeTruthy();
  });

  it('4. shows the "Reassigned winner" marker when winner_rank > 1', async () => {
    await renderPage([sale({ winner_rank: 2 })]);
    expect(screen.getByText('Reassigned winner')).toBeTruthy();
  });

  it('5. shows no reassignment marker for the original winner', async () => {
    await renderPage([sale({ winner_rank: 1 })]);
    expect(screen.queryByText('Reassigned winner')).toBeNull();
  });

  it('6. hides the deadline once the order is paid', async () => {
    await renderPage([sale({ payment_status: 'paid', status: 'ready_pickup' })]);
    expect(screen.queryByText(/Payment due/i)).toBeNull();
  });

  it('7. the seller cannot choose or trigger a fallback bidder', async () => {
    await renderPage([sale()]);
    const calls = apiFetch.mock.calls.map(([p]) => String(p));
    expect(calls.some((p) => /winner|reassign|expire/i.test(p))).toBe(false);
    expect(screen.queryByRole('button', { name: /next bidder|reassign to|rotate/i })).toBeNull();
  });

  it('8. after a refetch the seller sees the new buyer (reassignment propagates)', async () => {
    apiFetch.mockImplementation((path) => Promise.resolve(
      path === '/shop-owner/sales'
        ? [sale({ buyer: 'John Doe', amount: 58000, winner_rank: 3, transaction_code: 'TXN-9002' })]
        : []
    ));
    render(<WonLotsOrders />);
    await waitFor(() => expect(screen.getByText('John Doe')).toBeTruthy());
    expect(screen.queryByText('Britz Susada')).toBeNull();
    expect(screen.getByText('Reassigned winner')).toBeTruthy();
  });
});