// frontend/src/roles/customer/lib/__tests__/winnerFallbackUI.test.jsx
//
// The 7-day winner fallback, as the CUSTOMER sees it.
//
// Rules under test:
//   · the deadline rendered is the SERVER's payment_deadline, never a
//     created_at + 7 days arithmetic in React
//   · winner_rank > 1 reads as "you are now the eligible winner", not as a
//     lesser kind of winner
//   · the Pay CTA is live before the deadline and disabled after it (UX only —
//     the backend stays authoritative)
//   · the expired state tells the customer what happens next, with no raw
//     server text

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

import {
  formatDeadlineDateTime,
  getFallbackNotice,
  isFallbackWinner,
  isPaymentWindowClosed,
  resolvePaymentDeadline,
  winnerRank,
  PAYMENT_WINDOW_EXPIRED_MESSAGE,
} from '../paymentDeadline';
import { getPurchaseActions } from '../purchaseStatus';
import { PaymentDeadlineAccordion } from '../../purchases/PaymentDeadlineAccordion';

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

const order = (over = {}) => ({
  id: 'o1',
  item: 'Rose Gold Bangle',
  amount: 71000,
  status: 'pending',
  payment_status: 'unpaid',
  payment_method: null,
  created_at: iso(-9 * DAY),      // long past — a naive created_at + 7d would be overdue
  winner_confirmed_at: iso(-1 * DAY),
  payment_deadline: iso(6 * DAY),
  winner_rank: 1,
  ...over,
});

const orderLabels = (o) => getPurchaseActions(o).map((a) => a.label);

beforeEach(() => vi.clearAllMocks());

describe('customer — payment deadline comes from the server', () => {
  it('renders the exact stored deadline (date AND time) without expanding', () => {
    const o = order();
    render(<PaymentDeadlineAccordion order={o} />);
    const trigger = screen.getByRole('button', { name: /payment due/i });
    expect(trigger.textContent).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
    expect(trigger.textContent).not.toMatch(/Payment due\s*$/); // a real date, not just a label
  });

  it('formats the deadline as "Oct 22, 2026 · 3:45 PM"', () => {
    const d = new Date('2026-10-22T15:45:00Z');
    const text = formatDeadlineDateTime(d);
    expect(text).toMatch(/Oct 22, 2026/);
    expect(text).toMatch(/·/);
    expect(text).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
  });

  it('never derives the deadline from created_at when the server sent one', () => {
    const o = order();
    // created_at is 9 days ago (a naive +7d would be OVERDUE)…
    expect(resolvePaymentDeadline(o).getTime()).toBe(new Date(o.payment_deadline).getTime());
    // …and the customer is correctly told time remains
    expect(isPaymentWindowClosed(o)).toBe(false);
  });
});

describe('customer — fallback winner presentation', () => {
  it('winner_rank 1 is a plain winner with no reassignment notice', () => {
    const o = order({ winner_rank: 1 });
    expect(winnerRank(o)).toBe(1);
    expect(isFallbackWinner(o)).toBe(false);
    expect(getFallbackNotice(o)).toBeNull();
  });

  it('winner_rank > 1 is shown as "you are now the eligible winner"', () => {
    const o = order({ winner_rank: 2 });
    expect(winnerRank(o)).toBe(2);
    expect(isFallbackWinner(o)).toBe(true);
    expect(getFallbackNotice(o)).toMatch(/now the eligible winner/i);
    expect(getFallbackNotice(o)).not.toMatch(/second place|runner-?up/i);
  });

  it('a missing winner_rank defaults to 1 (never to a fallback state)', () => {
    expect(winnerRank({})).toBe(1);
    expect(winnerRank({ winner_rank: null })).toBe(1);
  });
});

describe('customer — payment CTA follows the window (UX only)', () => {
  it('Pay now is offered while the window is open', () => {
    const o = order();
    expect(orderLabels(o)).toContain('Pay now');
  });

  it('Pay now is replaced by a disabled control once the deadline passes', () => {
    const o = order({ payment_deadline: iso(-1 * DAY) });
    const labels = orderLabels(o);
    expect(labels).not.toContain('Pay now');
    const closed = getPurchaseActions(o).find((a) => a.key === 'window-closed');
    expect(closed).toBeTruthy();
    expect(closed.disabled).toBe(true);
    expect(closed.note).toBe(PAYMENT_WINDOW_EXPIRED_MESSAGE);
  });

  it('the disabled control cannot be pressed', () => {
    const o = order({ payment_deadline: iso(-1 * DAY) });
    render(<PaymentDeadlineAccordion order={o} />);
    // the accordion still renders, and the page still shows the expired state
    expect(screen.getByRole('button', { name: /payment deadline expired|expired/i })).toBeTruthy();
  });

  it('a paid order never shows a Pay CTA regardless of the window', () => {
    const o = order({ payment_status: 'paid', status: 'preparing' });
    expect(orderLabels(o)).not.toContain('Pay now');
  });
});

describe('customer — expired window messaging', () => {
  it('states the reassignment outcome instead of showing server text', () => {
    expect(PAYMENT_WINDOW_EXPIRED_MESSAGE).toMatch(/payment window expired/i);
    expect(PAYMENT_WINDOW_EXPIRED_MESSAGE).toMatch(/winner reassignment/i);
    expect(PAYMENT_WINDOW_EXPIRED_MESSAGE).not.toMatch(/sql|select |update |error:/i);
  });

  it('an expired order is never marked as paid', () => {
    const o = order({ payment_deadline: iso(-1 * DAY), payment_status: 'unpaid' });
    expect(String(o.payment_status)).not.toBe('paid');
    expect(isPaymentWindowClosed(o)).toBe(true);
  });
});