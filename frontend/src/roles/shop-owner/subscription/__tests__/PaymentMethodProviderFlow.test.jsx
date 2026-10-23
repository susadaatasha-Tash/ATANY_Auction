// frontend/src/roles/shop-owner/subscription/__tests__/PaymentMethodProviderFlow.test.jsx
// Provider-boundary rules for the seller subscription payment-method flow.
//
//  - opening/using the preference modal NEVER calls PayMongo
//  - the preference is ALWAYS selectable (the actual payment happens later)
//  - errors are classified (401/403/404 are NOT "provider unavailable")
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));

import { PaymentMethodModal, describeError } from '../PaymentMethodModal';

const SUBSCRIPTION = {
  planName: 'Platinum Vault',
  planDescription: 'Access to premium features.',
  amount: 12000,
  billingDate: 'Nov 16, 2026',
  reference: 'SUB-20261115-9087',
  billingCycle: 'Monthly',
  statusLabel: 'Active',
};

function optionsResponse({ availability = null, preference = null } = {}) {
  return {
    methods: [
      { value: 'qrph', label: 'QR Ph', group: 'qrph' },
      { value: 'card', label: 'Card', group: 'card' },
      { value: 'gcash', label: 'GCash', group: 'ewallet' },
      { value: 'maya', label: 'Maya', group: 'ewallet' },
    ],
    supported: ['qrph', 'card', 'gcash', 'maya'],
    preference: preference ? { method: preference } : null,
    availability: availability || {
      qrph: { enabled: true, reason: null },
      card: { enabled: true, reason: null },
      gcash: { enabled: true, reason: null },
      maya: { enabled: true, reason: null },
    },
    provider_ready: true,
  };
}

function apiError(message, status, code) {
  const e = new Error(message);
  e.status = status;
  e.code = code || null;
  return e;
}

function renderModal(props = {}) {
  return render(
    <PaymentMethodModal
      open
      onClose={props.onClose || vi.fn()}
      showToast={props.showToast || vi.fn()}
      subscription={SUBSCRIPTION}
      onSaved={props.onSaved}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockImplementation((p) => {
    if (p === '/billing/subscription/payment-methods') return Promise.resolve(optionsResponse());
    if (p === '/billing/subscription/payment-method') {
      return Promise.resolve({ success: true, payment_method: { method: 'gcash' } });
    }
    return Promise.resolve({});
  });
});

describe('the preference flow never talks to PayMongo', () => {
  it('makes NO provider call when the modal opens', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-method-options')).toBeInTheDocument());
    const calls = apiFetch.mock.calls.map(([p]) => p);
    expect(calls).toEqual(['/billing/subscription/payment-methods']);
    expect(calls.some((p) => /session|checkout|paymongo/i.test(p))).toBe(false);
  });

  it('makes NO provider call when the method is selected and reviewed', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-method-ewallet')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-method-ewallet'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-ewallet-gcash')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-ewallet-gcash'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-review-method')).toBeInTheDocument());
    const calls = apiFetch.mock.calls.map(([p]) => p);
    expect(calls.some((p) => /session|checkout|paymongo/i.test(p))).toBe(false);
  });

  it('makes NO provider call when the preference is confirmed', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-method-qrph')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-method-qrph'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-qrph-info')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-confirm')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-confirm'));
    await waitFor(() => expect(screen.getByTestId('spm-success')).toBeInTheDocument());
    const calls = apiFetch.mock.calls.map(([p]) => p);
    expect(calls.some((p) => /session|checkout|paymongo/i.test(p))).toBe(false);
  });
});

describe('the preference is always selectable', () => {
  it('keeps every method selectable even when the provider is unavailable', async () => {
    // The provider is down — but a PREFERENCE is still a valid choice.
    apiFetch.mockImplementation((p) => {
      if (p === '/billing/subscription/payment-methods') {
        return Promise.resolve(
          optionsResponse({
            availability: {
              qrph: { enabled: false, reason: 'This payment method is temporarily unavailable.' },
              card: { enabled: false, reason: 'This payment method is temporarily unavailable.' },
              gcash: { enabled: false, reason: 'This payment method is temporarily unavailable.' },
              maya: { enabled: false, reason: 'This payment method is temporarily unavailable.' },
            },
          })
        );
      }
      return Promise.resolve({});
    });
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-method-options')).toBeInTheDocument());
    for (const id of ['spm-method-qrph', 'spm-method-card', 'spm-method-ewallet']) {
      expect(screen.getByTestId(id).querySelector('input')).not.toBeDisabled();
    }
    // And the selection still works.
    fireEvent.click(screen.getByTestId('spm-method-qrph'));
    await waitFor(() => expect(screen.getByTestId('spm-continue')).not.toBeDisabled());
  });
});

describe('error classification', () => {
  it('401 is an auth problem, not a provider outage', () => {
    expect(describeError(apiError('Invalid token', 401, 'AUTH_REQUIRED'))).toMatch(/session has expired/i);
  });

  it('403 ACCOUNT_SUSPENDED is not a provider outage', () => {
    expect(describeError(apiError('suspended', 403, 'ACCOUNT_SUSPENDED'))).toMatch(/suspended/i);
  });

  it('a plain 403 is an authorization problem', () => {
    expect(describeError(apiError('Forbidden', 403, null))).toMatch(/do not have access/i);
  });

  it('404 is a route/integration problem, not a provider outage', () => {
    expect(describeError(apiError('Not found', 404, null))).toMatch(/unavailable right now/i);
  });

  it('a provider outage IS reported as a provider problem', () => {
    expect(describeError(apiError('x', 502, 'PROVIDER_UNAVAILABLE'))).toMatch(/payment provider is temporarily unavailable/i);
  });

  it('a missing provider configuration is reported as a configuration problem', () => {
    expect(describeError(apiError('x', 503, 'PROVIDER_CONFIG_MISSING'))).toMatch(/temporarily unavailable/i);
  });

  it('a network failure is reported as connectivity', () => {
    expect(describeError(apiError('Failed to fetch', 0, null))).toMatch(/unable to reach/i);
  });
});
