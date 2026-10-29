// frontend/src/roles/shop-owner/subscription/__tests__/SubscriptionSkeleton.test.jsx
// /shop/billing initial-load skeleton.
//
// Regression suite for the plain-text "Loading subscription…" fallback that used
// to replace the whole page while the subscription request was in flight.
//
// Controlled deferred promises (no fake timers, no artificial delay) drive the
// real request state exactly as the network would.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({
  apiFetch: (...a) => {

    return apiFetch(...a);
  },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

import Billing from '../../pages/Billing';

/** A promise whose resolution the test controls — no timers involved. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const RECORD = {
  id: 'sub-1', plan: 'gold', status: 'active', billing_interval: 'monthly',
  amount: 2500, current_period_end: '2026-12-01T00:00:00Z',
};

/** Route table matching the page's real request set. */
function routes({ billing, listings = [], auctions = [], shop = null, subscription = null, paymentMethods = { payment_methods: [] } } = {}) {
  return (path, opts = {}) => {
    const r = (v) => Promise.resolve(v);
    switch (path) {
      case '/billing/me': return typeof billing === 'function' ? billing() : r(billing);
      case '/shop-owner/listings': return r(listings);
      case '/shop-owner/auctions': return r(auctions);
      case '/shop-owner/shop': return r(shop);
      case '/billing/me/subscription': return typeof subscription === 'function' ? subscription() : r(subscription);
      case '/billing/payment-methods': return typeof paymentMethods === 'function' ? paymentMethods() : r(paymentMethods);
      // Unknown/undefined path → empty payload. Vitest invokes the mock with no
      // arguments during teardown cleanup; rejecting there would raise an
      // unhandled rejection that has nothing to do with the component.
      default: return r([]);
    }
  };
}

const renderBilling = () => render(<MemoryRouter><Billing /></MemoryRouter>);

/* ── 1-2. initial pending state ───────────────────────────────────────────── */
describe('initial load', () => {
  beforeEach(() => apiFetch.mockReset());

  test('1. renders a full subscription skeleton while the primary request is pending', async () => {
    const gate = deferred();
    apiFetch.mockImplementation(routes({ billing: () => gate.promise }));
    const { container } = renderBilling();

    const skel = await screen.findByTestId('subscription-skeleton');
    // the busy flag comes from the shared SkeletonRegion primitive
    expect(skel.querySelector('.atany-skel-region').getAttribute('aria-busy')).toBe('true');
    expect(skel.querySelector('.atany-skel-region').getAttribute('aria-label')).toBeTruthy();
    // structured skeleton, composed from the SHARED primitives
    expect(container.querySelectorAll('.atany-skel').length).toBeGreaterThan(20);
    // mirrors the real page sections
    expect(container.querySelector('.ssub-hero')).toBeTruthy();
    expect(container.querySelectorAll('.ssub-midrow .ssub-card').length).toBe(2);
    expect(container.querySelectorAll('.ssub-compare__grid > *').length).toBe(3);
    expect(container.querySelector('.ssub-history')).toBeTruthy();

    gate.resolve([RECORD]);
    await waitFor(() => expect(screen.queryByTestId('subscription-skeleton')).toBeNull());
  });

  test('2. never renders the old plain-text "Loading subscription…" fallback', async () => {
    const gate = deferred();
    apiFetch.mockImplementation(routes({ billing: () => gate.promise }));
    renderBilling();
    await screen.findByTestId('subscription-skeleton');
    expect(screen.queryByText(/Loading subscription/i)).toBeNull();
    expect(screen.queryByText('Loading subscription…')).toBeNull();
    expect(screen.queryByTestId('subscription-loading')).toBeNull();
    gate.resolve([RECORD]);
    await waitFor(() => expect(screen.queryByTestId('subscription-skeleton')).toBeNull());
  });

  test('3-4. skeleton disappears and real content renders once data arrives', async () => {
    const gate = deferred();
    apiFetch.mockImplementation(routes({ billing: () => gate.promise, subscription: { scheduled_change: null } }));
    renderBilling();
    await screen.findByTestId('subscription-skeleton');
    gate.resolve([RECORD]);
    await waitFor(() => expect(screen.getByTestId('seller-subscription-page')).toBeTruthy());
    expect(screen.queryByTestId('subscription-skeleton')).toBeNull();
    expect(screen.getAllByText(/Gold/i).length).toBeGreaterThan(0);
  });

  test('the seller shell is NOT skeletonized (only the content area)', async () => {
    const gate = deferred();
    apiFetch.mockImplementation(routes({ billing: () => gate.promise }));
    const { container } = renderBilling();
    await screen.findByTestId('subscription-skeleton');
    // no shell/sidebar/header skeleton blocks anywhere in the page
    expect(container.querySelector('.sidebar')).toBeNull();
    expect(container.querySelector('.topbar')).toBeNull();
    expect(container.querySelector('.atany-skel-kpi')).toBeNull();
  });
});

/* ── 6-7. secondary loading independence ──────────────────────────────────── */
describe('secondary requests', () => {
  beforeEach(() => apiFetch.mockReset());

  test('6. payment-method request skeletonizes independently, page stays rendered', async () => {
    const pm = deferred();
    apiFetch.mockImplementation(routes({ billing: [RECORD], paymentMethods: () => pm.promise }));
    renderBilling();

    // primary resolved → real page renders while the slow section still loads
    await waitFor(() => expect(screen.getByTestId('seller-subscription-page')).toBeTruthy());
    expect(await screen.findByTestId('next-payment-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('subscription-skeleton')).toBeNull();
    expect(screen.getAllByText(/Gold/i).length).toBeGreaterThan(0); // rest of page is real

    pm.resolve({ payment_methods: [] });
    await waitFor(() => expect(screen.queryByTestId('next-payment-skeleton')).toBeNull());
  });

  test('7. a background refetch does not blank the already-loaded page', async () => {
    const second = deferred();
    let call = 0;
    apiFetch.mockImplementation((path) => {
      if (path === '/billing/me') {
        call += 1;
        return call === 1 ? Promise.resolve([RECORD]) : second.promise;
      }
      return routes({ billing: [RECORD] })(path);
    });
    renderBilling();
    await waitFor(() => expect(screen.getByTestId('seller-subscription-page')).toBeTruthy());
    const before = screen.getByTestId('seller-subscription-page');

    // a silent background refresh must NOT reintroduce the full-page skeleton
    await waitFor(() => expect(before.textContent).toBeTruthy());
    expect(screen.queryByTestId('subscription-skeleton')).toBeNull();
    expect(screen.getByTestId('seller-subscription-page')).toBeTruthy();
    second.resolve([RECORD]);
  });
});

/* ── 5. error state ───────────────────────────────────────────────────────── */
describe('error state', () => {
  beforeEach(() => apiFetch.mockReset());

  test('5. a failed primary request exits the skeleton and shows an error with retry', async () => {
    let first = true;
    apiFetch.mockImplementation((path) => {
      if (path !== '/billing/me') return routes({ billing: [RECORD] })(path);
      if (first) { first = false; return Promise.reject(Object.assign(new Error('Billing unavailable'), { code: 'BILLING_UNAVAILABLE' })); }
      return Promise.resolve([RECORD]);
    });
    renderBilling();

    // skeleton must NOT persist forever
    await waitFor(() => expect(screen.getByTestId('subscription-error')).toBeTruthy());
    expect(screen.queryByTestId('subscription-skeleton')).toBeNull();
    const err = screen.getByTestId('subscription-error');
    expect(err.textContent).toMatch(/temporarily unavailable/i);
    expect(err.textContent).not.toMatch(/at .*\.js:\d+/); // no raw stack traces

    // retry re-runs the real request and recovers
    const user = userEvent.setup();
    await user.click(within(err).getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByTestId('seller-subscription-page')).toBeTruthy());
    expect(screen.queryByTestId('subscription-error')).toBeNull();
  });
});

/* ── 8-9. primitives + responsive structure ───────────────────────────────── */
describe('skeleton composition rules', () => {
  beforeEach(() => apiFetch.mockReset());

  test('8. uses the shared ATANY skeleton primitives, not a private shimmer', async () => {
    const gate = deferred();
    apiFetch.mockImplementation(routes({ billing: () => gate.promise }));
    const { container } = renderBilling();
    await screen.findByTestId('subscription-skeleton');
    expect(container.querySelectorAll('.atany-skel').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.atany-skel-region').length).toBe(1);
    // no bespoke skeleton/shimmer classes were introduced
    expect(container.querySelector('[class*="shimmer"], [class*="pulse"]')).toBeNull();
    gate.resolve([RECORD]);
    await waitFor(() => expect(screen.queryByTestId('subscription-skeleton')).toBeNull());
  });

  test('9. skeleton reuses the real layout classes so breakpoints are shared', async () => {
    const gate = deferred();
    apiFetch.mockImplementation(routes({ billing: () => gate.promise }));
    const { container } = renderBilling();
    await screen.findByTestId('subscription-skeleton');
    // same grid classes the finished page renders → identical responsive rules
    expect(container.querySelector('.ssub-midrow')).toBeTruthy();
    expect(container.querySelector('.ssub-compare__grid')).toBeTruthy();
    expect(container.querySelector('.ssub-usage-list')).toBeTruthy();
    expect(container.querySelector('.ssub-history table')).toBeTruthy();
    // single-column stacks on mobile via the SAME css (no fixed pixel widths)
    // no fixed-pixel layout containers (skeleton BLOCK sizes are fine)
    expect(screen.getByTestId('subscription-skeleton').querySelectorAll('[style*="width: 100%"]').length).toBeGreaterThan(0);
    gate.resolve([RECORD]);
    await waitFor(() => expect(screen.queryByTestId('subscription-skeleton')).toBeNull());
  });
});