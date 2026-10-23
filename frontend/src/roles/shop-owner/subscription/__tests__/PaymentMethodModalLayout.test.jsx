// frontend/src/roles/shop-owner/subscription/__tests__/PaymentMethodModalLayout.test.jsx
// Layout regression guard for the "Update payment method" flow.
//
// jsdom has no layout engine, so the browser-truth assertions are made
// against the CSS CONTRACT (the shipped stylesheet) plus the rendered DOM
// structure. These assert the fix itself — not just that a class exists.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));

import { PaymentMethodModal } from '../PaymentMethodModal';
import { NextPaymentCard } from '../NextPaymentCard';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const CSS_DIR = path.join(__dirname, '..');
const modalCss = fs.readFileSync(path.join(CSS_DIR, 'payment-method-modal.css'), 'utf8');
const pageCss = fs.readFileSync(path.join(CSS_DIR, 'seller-subscription.css'), 'utf8');

/** Extract the declaration block for a selector. */
function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
}

const SUBSCRIPTION = {
  planName: 'Platinum Vault',
  planDescription: 'Access to premium features.',
  amount: 12000,
  billingDate: 'Nov 16, 2026',
  reference: 'SUB-20261115-9087',
  billingCycle: 'Monthly',
  statusLabel: 'Active',
};

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockImplementation((p) => {
    if (p === '/billing/subscription/payment-methods') {
      return Promise.resolve({
        methods: [
          { value: 'qrph', label: 'QR Ph', group: 'qrph' },
          { value: 'card', label: 'Card', group: 'card' },
          { value: 'gcash', label: 'GCash', group: 'ewallet' },
          { value: 'paymaya', label: 'Maya', group: 'ewallet' },
        ],
        saved_cards: [],
        preference: null,
        provider_ready: true,
      });
    }
    return Promise.resolve({});
  });
});

describe('payment method modal — CSS layout contract (no horizontal/vertical scroll)', () => {
  it('the modal root has a responsive, viewport-bounded width', () => {
    const r = rule(modalCss, '.spm-modal.modal-box');
    expect(r).toMatch(/width:\s*min\(760px,\s*calc\(100vw - 48px\)\)/);
    expect(r).toMatch(/max-width:\s*calc\(100vw - 48px\)/);
    // Never a fixed width that can exceed the viewport.
    expect(r).not.toMatch(/width:\s*100vw/);
    expect(r).not.toMatch(/width:\s*\d{3,}px/);
  });

  it('the modal root is box-sizing border-box and cannot scroll sideways', () => {
    const r = rule(modalCss, '.spm-modal.modal-box');
    expect(r).toMatch(/box-sizing:\s*border-box/);
    expect(r).toMatch(/overflow-x:\s*hidden/);
    // Height is content-driven with a viewport cap (not a forced 90vh).
    expect(r).toMatch(/max-height:\s*calc\(100vh - 80px\)/);
    expect(r).not.toMatch(/height:\s*90vh/);
  });

  it('the modal BODY is not a scroll container on desktop', () => {
    const r = rule(modalCss, '.spm-modal .modal-box-body');
    expect(r).toMatch(/overflow:\s*visible/);
    expect(r).not.toMatch(/overflow-y:\s*auto/);
  });

  it('the payment grid uses shrinkable tracks and children may shrink', () => {
    const grid = rule(modalCss, '.spm-split');
    expect(grid).toMatch(/grid-template-columns:\s*minmax\(0,/);
    expect(grid).toMatch(/minmax\(0,/);
    expect(grid).toMatch(/min-width:\s*0/);
    for (const sel of ['.spm-split__left', '.spm-split__right']) {
      const r = rule(modalCss, sel);
      expect(r, `${sel} must be allowed to shrink`).toMatch(/min-width:\s*0/);
    }
  });

  it('every nav row stays inside its panel', () => {
    const r = rule(modalCss, '.spm-row');
    expect(r).toMatch(/width:\s*100%/);
    expect(r).toMatch(/max-width:\s*100%/);
    expect(r).toMatch(/min-width:\s*0/);
    expect(r).toMatch(/box-sizing:\s*border-box/);
  });

  it('the card-brand logo group can shrink instead of widening the row', () => {
    const r = rule(modalCss, '.spm-row__trailing');
    expect(r).toMatch(/flex-shrink:\s*1/);
    expect(r).not.toMatch(/flex-shrink:\s*0/);
    expect(r).toMatch(/min-width:\s*0/);
  });

  it('the info rows use shrinkable tracks', () => {
    const r = rule(modalCss, '.spm-info__row');
    expect(r).toMatch(/minmax\(0,\s*1fr\)/);
    expect(r).toMatch(/minmax\(0,\s*auto\)/);
  });

  it('the QR frame is responsive and has no fixed min width', () => {
    const r = rule(modalCss, '.spm-qr__frame');
    expect(r).toMatch(/max-width:\s*100%/);
    expect(r).not.toMatch(/min-width:\s*\d+px/);
  });

  it('mobile keeps horizontal scrolling impossible but allows vertical', () => {
    const mobile = modalCss.match(/@media \(max-width: 700px\) \{([\s\S]*?)\n\}/);
    expect(mobile).toBeTruthy();
    expect(mobile[1]).toMatch(/\.spm-split\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(mobile[1]).toMatch(/overflow-x:\s*hidden/);
    expect(mobile[1]).toMatch(/overflow-y:\s*auto/);
  });
});

describe('Next payment card — the Update payment method action', () => {
  it('uses the visible light-surface button variant (not the dark-surface ghost)', () => {
    render(
      <NextPaymentCard
        nextPayment={{
          amount: 12000,
          amountLabel: '₱12,000.00',
          date: 'Nov 16, 2026',
          planName: 'Platinum Vault',
          statusKey: 'active',
          statusLabel: 'Active',
          reference: 'SUB-1',
          mode: 'next_billing_date',
        }}
        currentPlanName="Platinum Vault"
        onUpdatePaymentMethod={vi.fn()}
        paymentMethodLabel="GCash"
      />
    );
    const btn = screen.getByTestId('update-payment-method-btn');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveClass('ssub-btn--light');
    expect(btn).not.toHaveClass('ssub-btn--ghost');
    expect(btn).toHaveTextContent(/update payment method/i);
    // Never visually disabled.
    expect(btn).not.toBeDisabled();
    expect(btn).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('the light variant is readable on a light surface (navy text, visible border)', () => {
    const r = rule(pageCss, '.ssub-btn--light');
    expect(r).toMatch(/color:\s*#142A4A/);
    expect(r).toMatch(/background:\s*#fff/);
    expect(r).toMatch(/border-color:/);
    // The old ghost variant used near-white text (invisible on a cream card).
    const ghost = rule(pageCss, '.ssub-btn--ghost');
    expect(ghost).toMatch(/color:\s*#E8EDF7/);
  });

  it('shows the saved payment method in a clear, separate block', () => {
    render(
      <NextPaymentCard
        nextPayment={{
          amount: 12000,
          amountLabel: '₱12,000.00',
          date: 'Nov 16, 2026',
          planName: 'Platinum Vault',
          statusKey: 'active',
          statusLabel: 'Active',
          reference: 'SUB-1',
          mode: 'next_billing_date',
        }}
        currentPlanName="Platinum Vault"
        onUpdatePaymentMethod={vi.fn()}
        paymentMethodLabel="GCash"
      />
    );
    expect(screen.getByTestId('next-payment-method')).toHaveTextContent('GCash');
    expect(screen.getByTestId('next-payment-method-note')).toHaveTextContent(/payment method/i);
    expect(screen.getByTestId('next-payment-method-note')).toHaveTextContent(
      /use GCash for your next subscription payment/i
    );
  });

  it('clicking it opens the payment method modal', async () => {
    const onUpdate = vi.fn();
    render(
      <NextPaymentCard
        nextPayment={{
          amount: 12000,
          amountLabel: '₱12,000.00',
          date: 'Nov 16, 2026',
          planName: 'Platinum Vault',
          statusKey: 'active',
          statusLabel: 'Active',
          reference: 'SUB-1',
          mode: 'next_billing_date',
        }}
        currentPlanName="Platinum Vault"
        onUpdatePaymentMethod={onUpdate}
      />
    );
    fireEvent.click(screen.getByTestId('update-payment-method-btn'));
    expect(onUpdate).toHaveBeenCalled();
  });
});

describe('payment method modal — the visible controls', () => {
  it('keeps the Close button, Continue, plan summary and all 3 methods visible', async () => {
    render(
      <PaymentMethodModal open onClose={vi.fn()} showToast={vi.fn()} subscription={SUBSCRIPTION} />
    );
    await waitFor(() => expect(screen.getByTestId('spm-method-options')).toBeInTheDocument());
    // Close (the shared Modal renders it)
    expect(screen.getByLabelText('Close dialog')).toBeInTheDocument();
    // Plan summary
    expect(screen.getByTestId('spm-plan-card')).toBeInTheDocument();
    // All three methods
    expect(screen.getByTestId('spm-method-qrph')).toBeInTheDocument();
    expect(screen.getByTestId('spm-method-card')).toBeInTheDocument();
    expect(screen.getByTestId('spm-method-ewallet')).toBeInTheDocument();
    // Continue is present and only disabled until a choice is made
    const cont = screen.getByTestId('spm-continue');
    expect(cont).toBeInTheDocument();
    expect(cont).toBeDisabled();
    fireEvent.click(screen.getByTestId('spm-method-qrph'));
    await waitFor(() => expect(screen.getByTestId('spm-continue')).not.toBeDisabled());
  });

  it('the security footer names the real provider', async () => {
    render(
      <PaymentMethodModal open onClose={vi.fn()} showToast={vi.fn()} subscription={SUBSCRIPTION} />
    );
    await waitFor(() => expect(screen.getByTestId('spm-method-options')).toBeInTheDocument());
    expect(document.body.textContent).toMatch(/securely processed through PayMongo/i);
    expect(document.body.textContent).toMatch(/does not store your complete card details/i);
  });
});
