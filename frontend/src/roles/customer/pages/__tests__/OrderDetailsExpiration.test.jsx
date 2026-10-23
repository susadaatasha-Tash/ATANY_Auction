// frontend/src/roles/customer/pages/__tests__/OrderDetailsExpiration.test.jsx
// The customer Order Details screen around the 7-day payment window:
//   • the active winner sees the amount, the exact deadline and a live Pay Now
//   • when the window closes the payment action disappears immediately
//   • a terminally expired order says "Payment Expired" (never "Payment Pending")
//   • the expired state links to the REAL support flow with safe context
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

import OrderDetails from '../OrderDetails';

const ORDER_ID = 'o-1';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function orderPayload(overrides = {}) {
  return {
    order: {
      id: ORDER_ID,
      transaction_code: 'TXN-1234',
      item: '18K Diamond Ring',
      amount: 65000,
      status: 'pending',
      payment_deadline: new Date(Date.now() + 3 * DAY).toISOString(),
      winner_confirmed_at: new Date(Date.now() - 4 * DAY).toISOString(),
      winner_rank: 2,
      is_expired: false,
      ...overrides,
    },
    payment: { status: 'pending' },
    product: { name: '18K Diamond Ring', img: 'ring.jpg', category: 'Rings' },
    branch: { name: 'Gmall Branch' },
  };
}

function renderOrder(payload = orderPayload()) {
  apiFetch.mockResolvedValue(payload);
  return render(
    <MemoryRouter initialEntries={[`/customer/orders/${ORDER_ID}`]}>
      <Routes>
        <Route path="/customer/orders/:id" element={<OrderDetails />} />
        <Route path="/customer/messages" element={<div data-testid="support-page">support</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe('OrderDetails — the active winner', () => {
  it('shows the winning amount, the exact deadline and a live Pay Now', async () => {
    renderOrder();
    await waitFor(() => expect(screen.getByText('Congratulations — You Won')).toBeInTheDocument());
    expect(screen.getAllByText('₱65,000').length).toBeGreaterThan(0);
    expect(screen.getByText('Payment deadline')).toBeInTheDocument();
    expect(screen.getAllByText(/day/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Pay Now/ })).toBeInTheDocument();
  });

  it('hides the payment action the moment the deadline has passed (the server still owns the rotation)', async () => {
    renderOrder(orderPayload({ payment_deadline: new Date(Date.now() - HOUR).toISOString(), is_expired: false }));
    await waitFor(() => expect(screen.getByText('PAYMENT ELIGIBILITY EXPIRED')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Pay Now/ })).toBeNull();
    expect(screen.getAllByText(/next eligible bidder/i).length).toBeGreaterThan(0);
  });
});

describe('OrderDetails — the terminal expired order', () => {
  it('shows Payment Expired, not Payment Pending', async () => {
    renderOrder(orderPayload({ status: 'expired', is_expired: false, amount: 58000 }));
    await waitFor(() => expect(screen.getAllByText('Payment Expired').length).toBeGreaterThan(0));
    // The payment status pill must not fall back to "Payment Pending".
    const badge = document.querySelector('.order-payment-status .purchase-status-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('Payment Expired');
    expect(badge.textContent).not.toContain('Payment Pending');
    expect(screen.getAllByText(/no remaining eligible bidders/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Pay Now/ })).toBeNull();
  });

  it('opens the REAL support pipeline with safe context (not the buyer↔seller thread)', async () => {
    renderOrder(orderPayload({ status: 'expired' }));
    await waitFor(() => expect(screen.getAllByText('Payment Expired').length).toBeGreaterThan(0));
    const link = screen.getAllByRole('link', { name: /Contact ATANY Support/i })[0];
    const href = link.getAttribute('href');
    // The expired-winner action now opens the persisted support request flow.
    expect(href).toContain('/customer/account');
    expect(href).toContain('support=expired-payment');
    expect(href).toContain('order=TXN-1234');
    // The customer's own safe context is carried across.
    expect(decodeURIComponent(href)).toContain('deadline=');
    expect(decodeURIComponent(href)).toContain('amount=');
    // No other bidder's data may leak into the support context.
    expect(href).not.toMatch(/Britz|Maria|Juan/i);
  });
});
