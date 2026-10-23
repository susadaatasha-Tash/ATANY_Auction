// frontend/src/roles/shop-owner/subscription/PaymentMethodModal.jsx
// "Update payment method" — the seller subscription payment-method PREFERENCE.
//
// Architecture (PayMongo Hosted Checkout):
//   The modal ONLY selects and saves the preferred method. It NEVER creates a
//   PayMongo session, never renders a card form and never generates a QR.
//   The actual payment happens later, when the seller clicks "Pay now": the
//   backend creates a real PayMongo Hosted Checkout Session restricted to the
//   selected method and PayMongo owns the sensitive payment UI.
//
//   Supported: QR Ph, Card, GCash, Maya.
//   Removed:  GrabPay, ShopeePay, UnionBank, BillEase, Buy Now Pay Later.
//
// SECURITY: ATANY never receives or stores a card number, CVC or QR secret —
// only the safe preference value (card | gcash | maya | qrph) is stored.
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { apiFetch } from '../../../shared/lib/apiClient';
import {
  SUBSCRIPTION_PAYMENT_METHOD,
  TOP_LEVEL_METHODS,
  EWALLET_PROVIDERS,
  subscriptionMethodLabel,
  subscriptionMethodDescription,
} from './subscriptionPaymentMethods';
import {
  GCashMark,
  MayaMark,
  QRPhMark,
  CardGlyph,
  CardNetworkMarks,
} from './PaymentMethodMarks';
import './payment-method-modal.css';

const STEP = {
  METHOD_SELECT: 'METHOD_SELECT',
  CARD: 'CARD',
  EWALLET_SELECT: 'EWALLET_SELECT',
  QRPH: 'QRPH',
  REVIEW: 'REVIEW',
  SUCCESS: 'SUCCESS',
};

const BACK_FROM = {
  [STEP.CARD]: STEP.METHOD_SELECT,
  [STEP.EWALLET_SELECT]: STEP.METHOD_SELECT,
  [STEP.QRPH]: STEP.METHOD_SELECT,
  [STEP.REVIEW]: STEP.METHOD_SELECT,
};

function peso(amount) {
  const n = Number(amount || 0);
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Map an API failure to a SAFE, specific message.
 *
 * Not every failure is a provider outage — an expired session, a missing
 * role, a suspended account, a route bug and a provider timeout are all
 * different problems and must not all read as "provider unavailable".
 */
export function describeError(err, fallback = 'Something went wrong. Please try again.') {
  const status = err?.status || null;
  const code = err?.code || null;
  const raw = String(err?.message || '').trim();

  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (code === 'ACCOUNT_SUSPENDED') return 'Your ATANY account has been suspended.';
  if (status === 403) return 'You do not have access to this payment option.';
  if (status === 404) return 'This payment option is unavailable right now.';
  if (code === 'PROVIDER_CONFIG_MISSING') {
    return 'This payment method is temporarily unavailable. Please try another method.';
  }
  if (code === 'PROVIDER_UNAVAILABLE') {
    return 'The payment provider is temporarily unavailable. Please try again.';
  }
  if (code === 'PAYMENT_METHOD_UNAVAILABLE') {
    return 'This payment method is currently unavailable. Please choose another method.';
  }
  if (code === 'UNSUPPORTED_PAYMENT_METHOD') {
    return 'This payment method is not supported.';
  }
  if (!status && /network|failed to fetch|timeout/i.test(raw)) {
    return 'Unable to reach the payment provider. Please check your connection.';
  }
  return raw || fallback;
}

/** Radio row used across the method / e-wallet steps. */
function MethodRow({ selected, onSelect, name, value, mark, title, subtitle, trailing, testId }) {
  return (
    <label
      className={`spm-row ${selected ? 'is-selected' : ''}`}
      data-testid={testId}
      htmlFor={`${name}-${value}`}
    >
      <input
        id={`${name}-${value}`}
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={() => onSelect(value)}
        className="spm-row__radio"
      />
      <span className="spm-row__mark">{mark}</span>
      <span className="spm-row__text">
        <span className="spm-row__title">{title}</span>
        {subtitle ? <span className="spm-row__sub">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="spm-row__trailing">{trailing}</span> : null}
    </label>
  );
}

export function PaymentMethodModal({ open, onClose, showToast, subscription, onSaved }) {
  const [step, setStep] = useState(STEP.METHOD_SELECT);
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // A TOTAL failure of the capability request (the whole modal cannot load).
  const [fatalError, setFatalError] = useState(null);
  const [selected, setSelected] = useState(null); // the chosen preference value
  const [saved, setSaved] = useState(false);

  // Real subscription data (never hardcoded) — supplied by the Subscription page.
  const plan = subscription?.planName || subscription?.plan_name || null;
  const planDescription = subscription?.planDescription || null;
  const amount = subscription?.amount ?? subscription?.amountLabel ?? 0;
  const amountValue = Number(subscription?.amount ?? 0) || 0;
  const billingDate = subscription?.date || subscription?.billingDate || null;
  const reference = subscription?.reference || null;
  const billingCycle = subscription?.billingCycle || 'Monthly';
  const statusLabel = subscription?.statusLabel || null;

  /**
   * Load the local catalog + the seller's current preference.
   * NO PayMongo call happens here — opening the selector must not create or
   * consume a provider session.
   */
  const loadOptions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/billing/subscription/payment-methods');
      setOptions(res || null);
      setFatalError(null);
    } catch (e) {
      setFatalError({
        message: describeError(e, 'Unable to load payment options.'),
        code: e?.code || null,
        status: e?.status || null,
      });
      setOptions(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setStep(STEP.METHOD_SELECT);
    setSelected(null);
    setSaved(false);
    setError('');
    setFatalError(null);
    loadOptions();
  }, [open, loadOptions]);

  const goBack = () => {
    setError('');
    setStep(BACK_FROM[step] || STEP.METHOD_SELECT);
  };

  const handleContinueFromMethod = () => {
    if (!selected) return;
    setError('');
    if (selected === SUBSCRIPTION_PAYMENT_METHOD.CARD) {
      setStep(STEP.CARD);
      return;
    }
    if (selected === 'ewallet') {
      // E-Wallet opens the provider list (GCash / Maya only).
      setSelected(null);
      setStep(STEP.EWALLET_SELECT);
      return;
    }
    // QR Ph — the QR itself is provided by PayMongo at payment time.
    setStep(STEP.QRPH);
  };

  const handleContinueFromEwallet = () => {
    setError('');
    if (!selected) {
      setError('Select an e-wallet to continue.');
      return;
    }
    setStep(STEP.REVIEW);
  };

  /**
   * Confirm — saves the PREFERENCE only.
   * It does NOT create a PayMongo session, does NOT mark a billing paid and
   * does NOT recognise revenue. The actual payment happens on "Pay now".
   */
  const handleConfirm = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch('/billing/subscription/payment-method', {
        method: 'POST',
        body: JSON.stringify({ method: selected }),
      });
      setSaved(true);
      setStep(STEP.SUCCESS);
      showToast?.('Payment method updated.');
      onSaved?.();
    } catch (e) {
      setError(describeError(e, 'Unable to save your payment method.'));
    } finally {
      setSaving(false);
    }
  };

  const selectedLabel = selected ? subscriptionMethodLabel(selected) : '';
  const selectedDescription = selected ? subscriptionMethodDescription(selected) : '';

  // ── Render helpers ────────────────────────────────────────────────
  const renderPlanCard = (compact = false) => (
    <div className="spm-plan" data-testid="spm-plan-card">
      <span className="spm-plan__crown" aria-hidden="true">♛</span>
      <div className="spm-plan__body">
        <div className="spm-plan__name" data-testid="spm-plan-name">
          {plan || 'Subscription'}
        </div>
        <div className="spm-plan__interval">
          {billingCycle === 'Annual' ? 'Annual Subscription' : 'Monthly Subscription'}
        </div>
        {!compact && planDescription ? (
          <p className="spm-plan__desc">{planDescription}</p>
        ) : null}
      </div>
      {statusLabel ? <span className="spm-plan__chip">{statusLabel}</span> : null}
    </div>
  );

  const renderInfoBox = () => (
    <div className="spm-info" data-testid="spm-info-box">
      <div className="spm-info__row">
        <span className="spm-info__icon" aria-hidden="true">▣</span>
        <span className="spm-info__label">Billing date</span>
        <span className="spm-info__value" data-testid="spm-billing-date">
          {billingDate || 'Not generated yet'}
        </span>
      </div>
      <div className="spm-info__row">
        <span className="spm-info__icon" aria-hidden="true">◈</span>
        <span className="spm-info__label">Reference number</span>
        <span className="spm-info__value" data-testid="spm-reference">
          {reference || 'Not generated yet'}
        </span>
      </div>
      <div className="spm-info__row">
        <span className="spm-info__icon" aria-hidden="true">↻</span>
        <span className="spm-info__label">Billing cycle</span>
        <span className="spm-info__value" data-testid="spm-billing-cycle">
          {billingCycle}
        </span>
      </div>
    </div>
  );

  const renderMethodSelect = () => (
    <div className="spm-split">
      <div className="spm-split__left">
        {renderPlanCard()}
        <div className="spm-fees">
          <div className="spm-fees__row">
            <span>Subscription fee</span>
            <strong data-testid="spm-fee-amount">{peso(amountValue)}</strong>
          </div>
          <div className="spm-fees__row">
            <span>Taxes &amp; fees</span>
            <strong>Free</strong>
          </div>
        </div>
        <div className="spm-total">
          <span>Total Due</span>
          <strong data-testid="spm-total-due">{peso(amountValue)}</strong>
        </div>
        {renderInfoBox()}
      </div>

      <div className="spm-split__right">
        <h3 className="spm-section__title">Payment method</h3>
        <p className="spm-section__sub">Select a payment method to continue.</p>

        {loading && <div className="spm-loading">Loading payment options…</div>}

        {!loading && (
          <div
            className="spm-options"
            role="radiogroup"
            aria-label="Payment method"
            data-testid="spm-method-options"
          >
            {TOP_LEVEL_METHODS.map((opt) => (
              <MethodRow
                key={opt.value}
                name="spm-method"
                value={opt.value}
                selected={selected === opt.value}
                onSelect={(value) => setSelected(value)}
                mark={
                  opt.group === 'qrph' ? <QRPhMark size={26} /> :
                  opt.group === 'card' ? <CardGlyph size={26} /> :
                  <span className="spm-row__marks">
                    <GCashMark size={24} />
                    <MayaMark size={24} />
                  </span>
                }
                title={opt.label}
                subtitle={opt.description}
                trailing={
                  opt.group === 'card' ? <CardNetworkMarks size={16} /> :
                  opt.group === 'ewallet' ? <span className="spm-chevron" aria-hidden="true">›</span> : null
                }
                testId={`spm-method-${opt.value}`}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          className="spm-btn spm-btn--primary"
          data-testid="spm-continue"
          disabled={!selected || loading}
          onClick={handleContinueFromMethod}
        >
          Continue <span aria-hidden="true">→</span>
        </button>

        <p className="spm-secure">
          <span aria-hidden="true">🔒</span>
          Payments are securely processed through PayMongo. ATANY does not store your complete card details.
        </p>
      </div>
    </div>
  );

  /** Card — the actual card entry happens on PayMongo's hosted checkout. */
  const renderCard = () => (
    <div className="spm-step">
      <div className="spm-step__head">
        <button type="button" className="spm-back" onClick={goBack} data-testid="spm-back">
          <span aria-hidden="true">←</span> Card
        </button>
        <p className="spm-step__sub">Pay using a debit or credit card securely through PayMongo.</p>
        <CardNetworkMarks size={18} />
      </div>

      <div className="spm-secure-card" data-testid="spm-card-info">
        <span className="spm-secure-card__icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="M2 10h20" />
          </svg>
        </span>
        <h3 className="spm-secure-card__title">Use a debit or credit card securely through PayMongo</h3>
        <p className="spm-secure-card__text">
          Your complete card details are entered securely during checkout on the payment
          provider and are never stored by ATANY.
        </p>
      </div>

      <button
        type="button"
        className="spm-btn spm-btn--primary spm-btn--block"
        data-testid="spm-continue"
        disabled={saving}
        onClick={() => setStep(STEP.REVIEW)}
      >
        Continue <span aria-hidden="true">→</span>
      </button>
    </div>
  );

  /** QR Ph — the QR is provided by PayMongo when the payment is due. */
  const renderQrph = () => (
    <div className="spm-step">
      <div className="spm-step__head">
        <button type="button" className="spm-back" onClick={goBack} data-testid="spm-back">
          <span aria-hidden="true">←</span> QR Ph
        </button>
        <p className="spm-step__sub">Pay using QR Ph securely through PayMongo.</p>
      </div>

      <div className="spm-secure-card" data-testid="spm-qrph-info">
        <span className="spm-secure-card__icon" aria-hidden="true">
          <QRPhMark size={26} />
        </span>
        <h3 className="spm-secure-card__title">Pay using QR Ph securely through PayMongo</h3>
        <p className="spm-secure-card__text">
          Your QR code will be provided during the secure payment checkout when your
          subscription payment is due. Scan it with your banking or e-wallet app.
        </p>
      </div>

      <button
        type="button"
        className="spm-btn spm-btn--primary spm-btn--block"
        data-testid="spm-continue"
        disabled={saving}
        onClick={() => setStep(STEP.REVIEW)}
      >
        Continue <span aria-hidden="true">→</span>
      </button>
    </div>
  );

  const renderEwalletSelect = () => (
    <div className="spm-step">
      <div className="spm-step__head">
        <button type="button" className="spm-back" onClick={goBack} data-testid="spm-back">
          <span aria-hidden="true">←</span> E-Wallet
        </button>
        <p className="spm-step__sub">Select your e-wallet provider.</p>
      </div>

      <div
        className="spm-options"
        role="radiogroup"
        aria-label="E-wallet provider"
        data-testid="spm-ewallet-options"
      >
        {EWALLET_PROVIDERS.map((opt) => (
          <MethodRow
            key={opt.value}
            name="spm-ewallet"
            value={opt.value}
            selected={selected === opt.value}
            onSelect={(value) => setSelected(value)}
            mark={opt.value === SUBSCRIPTION_PAYMENT_METHOD.GCASH ? <GCashMark size={30} /> : <MayaMark size={30} />}
            title={opt.label}
            subtitle={opt.description}
            trailing={<span className="spm-chevron" aria-hidden="true">›</span>}
            testId={`spm-ewallet-${opt.value}`}
          />
        ))}
      </div>

      <button
        type="button"
        className="spm-btn spm-btn--primary"
        data-testid="spm-continue"
        disabled={!selected || saving}
        onClick={handleContinueFromEwallet}
      >
        Continue <span aria-hidden="true">→</span>
      </button>
    </div>
  );

  const renderReview = () => (
    <div className="spm-step">
      <div className="spm-step__head spm-step__head--plain">
        <h3 className="spm-section__title">Review and continue</h3>
        <p className="spm-step__sub">Make sure your payment method is correct.</p>
      </div>

      {renderPlanCard(true)}
      <div className="spm-review__amount" data-testid="spm-review-amount">
        {peso(amountValue)} / {billingCycle === 'Annual' ? 'year' : 'month'}
      </div>

      <div className="spm-review__method">
        <div className="spm-review__method-head">
          <span className="spm-section__label">Payment method</span>
          <button
            type="button"
            className="spm-link"
            data-testid="spm-edit"
            onClick={() => setStep(BACK_FROM[STEP.REVIEW] || STEP.METHOD_SELECT)}
          >
            Edit
          </button>
        </div>
        <div className="spm-review__method-card" data-testid="spm-review-method">
          <span className="spm-review__mark">
            {selected === SUBSCRIPTION_PAYMENT_METHOD.GCASH ? <GCashMark size={30} /> : null}
            {selected === SUBSCRIPTION_PAYMENT_METHOD.MAYA ? <MayaMark size={30} /> : null}
            {selected === SUBSCRIPTION_PAYMENT_METHOD.QRPH ? <QRPhMark size={30} /> : null}
            {selected === SUBSCRIPTION_PAYMENT_METHOD.CARD ? <CardGlyph size={30} /> : null}
          </span>
          <span className="spm-review__method-text">
            <span className="spm-review__method-title" data-testid="spm-review-method-label">
              {selectedLabel}
            </span>
            <span className="spm-review__method-sub">{selectedDescription}</span>
          </span>
        </div>
      </div>

      {renderInfoBox()}

      <button
        type="button"
        className="spm-btn spm-btn--primary spm-btn--block"
        data-testid="spm-confirm"
        disabled={saving}
        onClick={handleConfirm}
      >
        {saving ? 'Saving…' : 'Confirm payment method'}
      </button>
    </div>
  );

  const renderSuccess = () => (
    <div className="spm-step spm-step--center" data-testid="spm-success">
      <span className="spm-success__icon" aria-hidden="true">✓</span>
      <h3 className="spm-success__title">Payment method updated</h3>
      <p className="spm-success__text">
        You&rsquo;ll use <strong>{selectedLabel}</strong> for your next subscription payment.
      </p>
      <button
        type="button"
        className="spm-btn spm-btn--primary spm-btn--block"
        data-testid="spm-done"
        onClick={() => onClose?.()}
      >
        Done
      </button>
    </div>
  );

  /**
   * The fatal screen is only for a TOTAL failure of the catalog request.
   * "Retry" re-issues the real request — it does not just reset the view.
   */
  const renderError = () => (
    <div className="spm-step spm-step--center" data-testid="spm-error">
      <h3 className="spm-section__title">Something went wrong</h3>
      <p className="spm-error__text" data-testid="spm-error-message">
        {fatalError?.message || error || 'Unable to load payment options.'}
      </p>
      <div className="spm-error__actions">
        <button
          type="button"
          className="spm-btn spm-btn--primary"
          data-testid="spm-retry"
          disabled={loading}
          onClick={() => loadOptions()}
        >
          {loading ? 'Checking…' : 'Retry'}
        </button>
        <button type="button" className="ssub-btn ssub-btn--light" onClick={() => onClose?.()}>
          Close
        </button>
      </div>
    </div>
  );

  const renderBody = () => {
    // A catalog failure replaces the modal content (with a real Retry).
    if (fatalError && !options) return renderError();
    if (step === STEP.METHOD_SELECT) return renderMethodSelect();
    if (step === STEP.CARD) return renderCard();
    if (step === STEP.EWALLET_SELECT) return renderEwalletSelect();
    if (step === STEP.QRPH) return renderQrph();
    if (step === STEP.REVIEW) return renderReview();
    if (step === STEP.SUCCESS) return renderSuccess();
    return renderError();
  };

  const headerTitle =
    step === STEP.METHOD_SELECT ? 'Update payment method'
    : step === STEP.CARD ? 'Card'
    : step === STEP.EWALLET_SELECT ? 'E-Wallet'
    : step === STEP.QRPH ? 'QR Ph'
    : step === STEP.REVIEW ? 'Review and continue'
    : 'Update payment method';

  const headerSubtitle =
    step === STEP.METHOD_SELECT ? 'Choose how you want to pay for your subscription.'
    : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={headerTitle}
      subtitle={headerSubtitle}
      size="wide"
      className="spm-modal"
    >
      <div className="spm" data-testid="payment-method-modal" data-step={step}>
        {error && !fatalError ? (
          <div className="spm-alert" role="alert" data-testid="spm-alert">{error}</div>
        ) : null}
        {renderBody()}
      </div>
    </Modal>
  );
}

export default PaymentMethodModal;
