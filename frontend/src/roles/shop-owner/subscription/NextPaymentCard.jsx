// frontend/src/roles/shop-owner/subscription/NextPaymentCard.jsx
import { normalizeBillingInterval, intervalLabel } from '../../../shared/lib/subscriptionPlans';

export function NextPaymentCard({
  nextPayment,
  currentPlanName,
  onPayNow,
  paying,
  onUpdatePaymentMethod,
  billingInterval,
  paymentMethodLabel,
}) {
  if (!nextPayment) {
    return (
      <div className="ssub-card" data-testid="next-payment-card">
        <div className="ssub-card__head">
          <div>
            <h2 className="ssub-card__title">Next payment</h2>
            <p className="ssub-card__subtitle">No upcoming billing entry</p>
          </div>
        </div>
        <div className="ssub-empty" style={{ padding: '12px 0 4px' }}>
          <p className="ssub-empty__text">Payment schedule will appear here when billing is generated.</p>
          {paymentMethodLabel ? (
            <p className="ssub-empty__text" data-testid="next-payment-method-note">
              Payment method <strong data-testid="next-payment-method">{paymentMethodLabel}</strong>
            </p>
          ) : null}
        </div>
        {onUpdatePaymentMethod && (
          <button
            type="button"
            className="ssub-btn ssub-btn--light"
            style={{ width: '100%', marginTop: 12, height: 42 }}
            data-testid="update-payment-method-btn"
            onClick={onUpdatePaymentMethod}
          >
            Update payment method
          </button>
        )}
      </div>
    );
  }

  const isOpenInvoice = nextPayment.mode === 'open_invoice';
  const interval = normalizeBillingInterval(
    nextPayment.billing_interval || billingInterval || 'monthly'
  );
  const subtitle = isOpenInvoice
    ? (nextPayment.statusKey === 'past_due' ? 'Payment past due' : 'Payment pending')
    : 'Next billing date';

  return (
    <div className="ssub-card" data-testid="next-payment-card" data-mode={nextPayment.mode}>
      <div className="ssub-card__head">
        <div>
          <h2 className="ssub-card__title">Next payment</h2>
          <p className="ssub-card__subtitle" data-testid="next-payment-subtitle">{subtitle}</p>
        </div>
      </div>

      <div className="ssub-nextpay__amount-box">
        <div className="ssub-nextpay__amount" data-testid="next-payment-amount">{nextPayment.amountLabel}</div>
        <div className="ssub-nextpay__plan" data-testid="next-payment-plan">
          {nextPayment.planName || currentPlanName} · {intervalLabel(interval)}
        </div>
      </div>

      <div className="ssub-nextpay__rows">
        <div className="ssub-nextpay__row">
          <span className="ssub-nextpay__row-icon" aria-hidden="true">▣</span>
          <span data-testid="next-payment-date">
            {isOpenInvoice ? 'Due ' : 'Billing date '}<strong>{nextPayment.date}</strong>
          </span>
        </div>
        <div className="ssub-nextpay__row">
          <span className="ssub-nextpay__row-icon" aria-hidden="true">◈</span>
          <span>
            Payment reference <strong data-testid="next-payment-ref">{nextPayment.reference || '—'}</strong>
          </span>
        </div>
        <div className="ssub-nextpay__row">
          <span className="ssub-nextpay__row-icon" aria-hidden="true">↻</span>
          <span data-testid="next-payment-method-note" className="ssub-nextpay__method">
            {paymentMethodLabel ? (
              <>
                <span className="ssub-nextpay__method-label">Payment method</span>
                <strong className="ssub-nextpay__method-value" data-testid="next-payment-method">
                  {paymentMethodLabel}
                </strong>
                <span className="ssub-nextpay__hint">
                  You&rsquo;ll use {paymentMethodLabel} for your next subscription payment.
                </span>
              </>
            ) : (
              <>
                <span className="ssub-nextpay__method-label">Payment method</span>
                <strong className="ssub-nextpay__method-value" data-testid="next-payment-method">
                  Not selected yet
                </strong>
                <span className="ssub-nextpay__hint">
                  Choose a payment method before paying for your subscription.
                </span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* A payable invoice needs a payment method BEFORE it can be paid. */}
      {isOpenInvoice && !paymentMethodLabel && onUpdatePaymentMethod && (
        <button
          type="button"
          className="ssub-btn ssub-btn--gold"
          style={{ width: '100%', marginTop: 16 }}
          data-testid="next-payment-select-method-btn"
          onClick={onUpdatePaymentMethod}
        >
          Select payment method
        </button>
      )}

      {isOpenInvoice && paymentMethodLabel && onPayNow && (
        <button
          type="button"
          className="ssub-btn ssub-btn--gold"
          style={{ width: '100%', marginTop: 16 }}
          data-testid="next-payment-pay-btn"
          disabled={paying}
          onClick={onPayNow}
        >
          {paying ? 'Redirecting…' : nextPayment.statusKey === 'past_due' ? 'Retry payment' : 'Pay now'}
        </button>
      )}

      {onUpdatePaymentMethod && (
        <button
          type="button"
          className="ssub-btn ssub-btn--light"
          style={{ width: '100%', marginTop: 12, height: 42 }}
          data-testid="update-payment-method-btn"
          onClick={onUpdatePaymentMethod}
        >
          Update payment method
        </button>
      )}
    </div>
  );
}

export default NextPaymentCard;
