// frontend/src/roles/shop-owner/subscription/__tests__/PaymentMethodModal.test.jsx
// "Update payment method" — the seller subscription payment-method PREFERENCE.
//
// The modal ONLY selects and saves the preferred method. It never creates a
// PayMongo session, never renders a card form and never generates a QR —
// PayMongo Hosted Checkout owns the actual payment UI.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));

import { PaymentMethodModal } from '../PaymentMethodModal';

const REMOVED = /GrabPay|ShopeePay|UnionBank|BillEase|Buy Now|Pay Later|BNPL/i;

const SUBSCRIPTION = {
  planName: 'Platinum Vault',
  planDescription: 'Access to premium features.',
  amount: 12000,
  billingDate: 'Nov 16, 2026',
  reference: 'SUB-20261115-9087',
  billingCycle: 'Monthly',
  statusLabel: 'Active',
};

function optionsResponse(preference = null) {
  return {
    methods: [
      { value: 'qrph', label: 'QR Ph', group: 'qrph' },
      { value: 'card', label: 'Card', group: 'card' },
      { value: 'gcash', label: 'GCash', group: 'ewallet' },
      { value: 'maya', label: 'Maya', group: 'ewallet' },
    ],
    supported: ['qrph', 'card', 'gcash', 'maya'],
    preference: preference ? { method: preference } : null,
    availability: {
      qrph: { enabled: true, reason: null },
      card: { enabled: true, reason: null },
      gcash: { enabled: true, reason: null },
      maya: { enabled: true, reason: null },
    },
    provider_ready: true,
  };
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

describe('PaymentMethodModal — the initial step', () => {
  it('offers EXACTLY QR Ph, Card and E-Wallet', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-method-options')).toBeInTheDocument());
    expect(screen.getByTestId('spm-method-qrph')).toBeInTheDocument();
    expect(screen.getByTestId('spm-method-card')).toBeInTheDocument();
    expect(screen.getByTestId('spm-method-ewallet')).toBeInTheDocument();
    expect(screen.getByTestId('spm-method-options').querySelectorAll('.spm-row').length).toBe(3);
  });

  it('never renders a removed payment method', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-method-options')).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(REMOVED);
  });

  it('keeps Continue disabled until a method is selected', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-continue')).toBeInTheDocument());
    expect(screen.getByTestId('spm-continue')).toBeDisabled();
    fireEvent.click(screen.getByTestId('spm-method-qrph'));
    await waitFor(() => expect(screen.getByTestId('spm-continue')).not.toBeDisabled());
  });

  it('shows the REAL plan summary (never hardcoded values)', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-plan-card')).toBeInTheDocument());
    expect(screen.getByTestId('spm-plan-name')).toHaveTextContent('Platinum Vault');
    expect(screen.getByTestId('spm-total-due')).toHaveTextContent('12,000');
    expect(screen.getByTestId('spm-billing-date')).toHaveTextContent('Nov 16, 2026');
    expect(screen.getByTestId('spm-reference')).toHaveTextContent('SUB-20261115-9087');
    expect(screen.getByTestId('spm-billing-cycle')).toHaveTextContent('Monthly');
  });
});

describe('PaymentMethodModal — the Card step', () => {
  it('explains that PayMongo hosts the card entry and shows NO card inputs', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-method-card')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-method-card'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-card-info')).toBeInTheDocument());
    expect(screen.getByTestId('spm-card-info')).toHaveTextContent(/securely through PayMongo/i);
    expect(screen.getByTestId('spm-card-info')).toHaveTextContent(/never stored by ATANY/i);
    // No raw card fields anywhere.
    expect(document.querySelector('input[autocomplete="cc-number"]')).toBeNull();
    expect(document.querySelector('input[autocomplete="cc-csc"]')).toBeNull();
  });

  it('shows NO saved cards and no Add-new-card vault flow', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-method-card')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-method-card'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-card-info')).toBeInTheDocument());
    expect(screen.queryByTestId('spm-add-new-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('spm-saved-cards')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/4242|8888/);
  });
});

describe('PaymentMethodModal — the QR Ph step', () => {
  it('explains that PayMongo provides the QR and generates NO QR locally', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-method-qrph')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-method-qrph'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-qrph-info')).toBeInTheDocument());
    expect(screen.getByTestId('spm-qrph-info')).toHaveTextContent(/securely through PayMongo/i);
    expect(screen.getByTestId('spm-qrph-info')).toHaveTextContent(/when your subscription payment is due/i);
    // No QR was generated and no provider session was created.
    expect(screen.queryByTestId('spm-qr-frame')).not.toBeInTheDocument();
    expect(apiFetch.mock.calls.some(([p]) => /session/i.test(p))).toBe(false);
  });
});

describe('PaymentMethodModal — the e-wallet step', () => {
  it('shows ONLY GCash and Maya', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-method-ewallet')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-method-ewallet'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-ewallet-options')).toBeInTheDocument());
    expect(screen.getByTestId('spm-ewallet-gcash')).toBeInTheDocument();
    expect(screen.getByTestId('spm-ewallet-maya')).toBeInTheDocument();
    expect(screen.getByTestId('spm-ewallet-options').querySelectorAll('.spm-row').length).toBe(2);
    expect(document.body.textContent).not.toMatch(REMOVED);
  });

  it('keeps Continue disabled until a provider is selected', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-method-ewallet')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-method-ewallet'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-ewallet-options')).toBeInTheDocument());
    expect(screen.getByTestId('spm-continue')).toBeDisabled();
    fireEvent.click(screen.getByTestId('spm-ewallet-gcash'));
    await waitFor(() => expect(screen.getByTestId('spm-continue')).not.toBeDisabled());
  });
});

describe('PaymentMethodModal — review and confirmation', () => {
  it('shows the plan, amount, method and billing details', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-method-ewallet')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-method-ewallet'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-ewallet-gcash')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-ewallet-gcash'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-review-method')).toBeInTheDocument());
    expect(screen.getByTestId('spm-plan-name')).toHaveTextContent('Platinum Vault');
    expect(screen.getByTestId('spm-review-amount')).toHaveTextContent('12,000');
    expect(screen.getByTestId('spm-review-method-label')).toHaveTextContent('GCash');
    expect(screen.getByTestId('spm-billing-date')).toHaveTextContent('Nov 16, 2026');
    expect(screen.getByTestId('spm-billing-cycle')).toHaveTextContent('Monthly');
  });

  it('Edit returns to the method selection without closing the modal', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await waitFor(() => expect(screen.getByTestId('spm-method-qrph')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-method-qrph'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-qrph-info')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-edit')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-edit'));
    await waitFor(() => expect(screen.getByTestId('spm-method-options')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Confirm saves the PREFERENCE only — no PayMongo session, no paid state', async () => {
    const onSaved = vi.fn();
    const showToast = vi.fn();
    renderModal({ onSaved, showToast });
    await waitFor(() => expect(screen.getByTestId('spm-method-card')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-method-card'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-card-info')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-confirm')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-confirm'));
    await waitFor(() => expect(screen.getByTestId('spm-success')).toBeInTheDocument());

    // The preference was saved with the canonical value.
    const call = apiFetch.mock.calls.find(([p]) => p === '/billing/subscription/payment-method');
    expect(call).toBeTruthy();
    expect(JSON.parse(call[1].body)).toEqual({ method: 'card' });
    // NO PayMongo checkout/session was created by the preference flow.
    expect(apiFetch.mock.calls.some(([p]) => /session|checkout/i.test(p))).toBe(false);
    expect(showToast).toHaveBeenCalledWith('Payment method updated.');
    expect(onSaved).toHaveBeenCalled();
  });

  it('saves maya (not paymaya) as the stored preference', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-method-ewallet')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-method-ewallet'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-ewallet-maya')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-ewallet-maya'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-confirm')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-confirm'));
    await waitFor(() => expect(screen.getByTestId('spm-success')).toBeInTheDocument());
    const call = apiFetch.mock.calls.find(([p]) => p === '/billing/subscription/payment-method');
    expect(JSON.parse(call[1].body).method).toBe('maya');
    // The provider identifier never reaches the customer copy.
    expect(document.body.textContent).not.toMatch(/paymaya/i);
  });

  it('saves qrph as the stored preference', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-method-qrph')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-method-qrph'));
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-qrph-info')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-continue'));
    await waitFor(() => expect(screen.getByTestId('spm-confirm')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-confirm'));
    await waitFor(() => expect(screen.getByTestId('spm-success')).toBeInTheDocument());
    const call = apiFetch.mock.calls.find(([p]) => p === '/billing/subscription/payment-method');
    expect(JSON.parse(call[1].body).method).toBe('qrph');
  });
});

describe('PaymentMethodModal — capability failure and Retry', () => {
  it('shows the error screen and Retry really re-issues the request', async () => {
    let attempt = 0;
    apiFetch.mockImplementation((p) => {
      if (p === '/billing/subscription/payment-methods') {
        attempt += 1;
        if (attempt === 1) return Promise.reject(Object.assign(new Error('boom'), { status: 500 }));
        return Promise.resolve(optionsResponse());
      }
      return Promise.resolve({});
    });
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-error')).toBeInTheDocument());
    expect(screen.getByTestId('spm-retry')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('spm-retry'));
    await waitFor(() => expect(attempt).toBe(2));
    await waitFor(() => expect(screen.getByTestId('spm-method-options')).toBeInTheDocument());
    expect(screen.queryByTestId('spm-error')).not.toBeInTheDocument();
  });

  it('Retry is disabled while the request is in flight', async () => {
    let attempt = 0;
    apiFetch.mockImplementation((p) => {
      if (p === '/billing/subscription/payment-methods') {
        attempt += 1;
        if (attempt === 1) return Promise.reject(Object.assign(new Error('boom'), { status: 500 }));
        return new Promise(() => {});
      }
      return Promise.resolve({});
    });
    renderModal();
    await waitFor(() => expect(screen.getByTestId('spm-error')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('spm-retry'));
    await waitFor(() => expect(screen.getByTestId('spm-retry')).toBeDisabled());
    expect(screen.getByTestId('spm-retry')).toHaveTextContent(/checking/i);
  });
});
