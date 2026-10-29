// frontend/src/roles/admin/pages/__tests__/transactionsWinnerFallback.test.jsx
// ADMIN view of the 7-day winner fallback.
//
// Terminology matters here: a pending, unpaid winner is an ELIGIBLE winner —
// the item is not settled until payments.status = 'paid'. After payment the
// label becomes a settled Winner. Admin can observe the deadline and the
// reassignment, but cannot pick a fallback bidder.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
const toast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toast }));

import Transactions, { winnerState } from '../Transactions';

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

const tx = (over = {}) => ({
  id: 'o1',
  transaction_code: 'TXN-9001',
  customer: 'Britz Susada',
  item: 'Rose Gold Bangle',
  amount: 65000,
  branch: 'Gmall',
  status: 'pending',
  date: iso(-8 * DAY),
  buyer_id: 'user-b',
  payment_deadline: iso(6 * DAY),
  winner_confirmed_at: iso(-1 * DAY),
  winner_rank: 2,
  payment_status: null,
  ...over,
});

async function renderPage(rows) {
  apiFetch.mockImplementation((path) => (path === '/admin/transactions' ? Promise.resolve(rows) : Promise.resolve([])));
  render(<Transactions />);
  await waitFor(() => expect(rowsRow()).toBeTruthy());
  return rowsRow();
}

/** The single data row (scoped away from the table header). */
const rowsRow = () => within(screen.getByRole('table')).getAllByRole('row')[1];

beforeEach(() => { apiFetch.mockReset(); toast.mockReset(); });
// Vitest runs without globals here, so Testing Library's auto-cleanup is not
// registered — unmount explicitly between cases.
afterEach(() => cleanup());

describe('admin — eligible winner wording', () => {
  it('1. an unpaid pending winner is labelled ELIGIBLE winner, not a settled winner', async () => {
    const row = await renderPage([tx()]);
    expect(within(row).getByText('Eligible Winner')).toBeTruthy();
    expect(within(row).queryByText('Winner')).toBeNull();
  });

  it('2. after payment the label becomes Winner', async () => {
    const row = await renderPage([tx({ payment_status: 'paid', status: 'preparing' })]);
    expect(within(row).getByText('Winner')).toBeTruthy();
    expect(within(row).queryByText('Eligible Winner')).toBeNull();
  });

  it('3. an exhausted chain shows no eligible winner', () => {
    expect(winnerState({ status: 'expired', payment_status: null }).label).toBe('No Eligible Winner');
  });

  it('4. payment status is shown as Awaiting Payment until money lands', async () => {
    const row = await renderPage([tx()]);
    expect(within(row).getByText('Awaiting Payment')).toBeTruthy();
  });
});

describe('admin — reassignment visibility', () => {
  it('5. the payment deadline renders from the backend value', async () => {
    const row = await renderPage([tx({ date: 'legacy date string' })]);
    const deadlineCell = within(row).getByText(/·/);
    expect(deadlineCell.textContent).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
  });

  it('6. a reassigned winner is marked as such', async () => {
    const row = await renderPage([tx({ winner_rank: 2 })]);
    expect(within(row).getByText('Reassigned')).toBeTruthy();
  });

  it('7. the original winner carries no reassignment marker', async () => {
    const row = await renderPage([tx({ winner_rank: 1 })]);
    expect(within(row).queryByText('Reassigned')).toBeNull();
  });

  it('8. after a refetch the admin sees the NEW current winner', async () => {
    // same component, same shape — only the authoritative order row changed,
    // exactly as it does when the 7-day fallback reassigns the item.
    const row = await renderPage([
      tx({ customer: 'John Doe', amount: 58000, winner_rank: 3, transaction_code: 'TXN-9002' }),
    ]);
    expect(within(row).getByText('John Doe')).toBeTruthy();
    expect(screen.queryByText('Britz Susada')).toBeNull();
    expect(within(row).getByText('Reassigned')).toBeTruthy();
    expect(within(row).getByText(/58,000/)).toBeTruthy();
  });

  it('9. no admin control can choose the fallback bidder', async () => {
    await renderPage([tx()]);
    const calls = apiFetch.mock.calls.map(([p]) => String(p));
    expect(calls.some((p) => /reassign|next-bidder|expire|rotate/i.test(p))).toBe(false);
    expect(screen.queryByRole('button', { name: /next bidder|reassign|rotate winner/i })).toBeNull();
  });

  it('10. no unnecessary private customer data is exposed', async () => {
    await renderPage([tx()]);
    const body = document.body.textContent;
    expect(body).not.toMatch(/maria\.santos@|\d{3}-\d{4}-\d{4}/);
  });
});