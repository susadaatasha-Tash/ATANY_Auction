// frontend/src/roles/shop-owner/subscription/CurrentPlanHero.jsx
import { heroFeatures } from './sellerSubscriptionSelectors';
import { intervalLabel, normalizeBillingInterval } from '../../../shared/lib/subscriptionPlans';

function FeatureList({ plan }) {
  const features = heroFeatures(plan);
  if (!features.length) return null;
  return (
    <div className="ssub-hero__panel" data-testid="plan-features-panel">
      <h3 className="ssub-hero__panel-title">What is included</h3>
      <ul className="ssub-feature-list">
        {features.map((f) => (
          <li key={f}>
            <span className="ssub-feature-list__check" aria-hidden="true">✓</span>
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChoosePlanState({ onChangePlan }) {
  return (
    <div className="ssub-hero ssub-hero--none" data-testid="current-plan-none">
      <div>
        <div className="ssub-hero__eyebrow">Seller subscription</div>
        <div className="ssub-hero__name-row">
          <h1 className="ssub-hero__name">Choose your seller plan</h1>
        </div>
        <div className="ssub-hero__meta">
          Select a plan below to activate your seller subscription.
        </div>
        <div className="ssub-hero__actions">
          <button type="button" className="ssub-btn ssub-btn--gold" onClick={onChangePlan}>
            View plans
          </button>
        </div>
      </div>
      <div className="ssub-hero__panel">
        <h3 className="ssub-hero__panel-title">How it works</h3>
        <ul className="ssub-feature-list">
          <li>
            <span className="ssub-feature-list__check" aria-hidden="true">✓</span>
            Pick Bronze, Gold, or Platinum
          </li>
          <li>
            <span className="ssub-feature-list__check" aria-hidden="true">✓</span>
            Complete PayMongo checkout when payment is due
          </li>
          <li>
            <span className="ssub-feature-list__check" aria-hidden="true">✓</span>
            Track billing history on this page
          </li>
        </ul>
      </div>
    </div>
  );
}

export function CurrentPlanHero({
  state,
  onChangePlan,
  onManageBilling,
  onRetryPayment,
}) {
  if (!state || state.kind === 'none' || !state.record) {
    return <ChoosePlanState onChangePlan={onChangePlan} />;
  }

  const {
    plan,
    statusLabel,
    status,
    kind,
    amountLabel,
    renewalLabel,
    periodLabel,
    nextPayment,
    billingInterval,
  } = state;
  const statusKey = status?.key || 'pending';
  const interval = normalizeBillingInterval(
    billingInterval || state.record?.billing_interval || 'monthly'
  );
  const heroClass = [
    'ssub-hero',
    kind === 'pending' ? 'ssub-hero--pending' : '',
    kind === 'past_due' ? 'ssub-hero--overdue' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const eyebrow =
    kind === 'pending'
      ? 'Payment pending'
      : kind === 'past_due'
        ? 'Payment past due'
        : kind === 'canceled'
          ? 'Subscription canceled'
          : 'Current plan';

  return (
    <div
      className={heroClass}
      data-testid="current-plan-hero"
      data-plan={plan?.id || ''}
      data-status={statusKey}
      data-interval={interval}
    >
      <div>
        <div className="ssub-hero__eyebrow" data-testid="current-plan-eyebrow">
          {eyebrow}
        </div>
        <div className="ssub-hero__name-row">
          <h1 className="ssub-hero__name" data-testid="current-plan-name">
            {plan?.name || state.planName || 'Seller subscription'}
          </h1>
          <span
            className={`ssub-hero__status ssub-hero__status--${statusKey}`}
            data-testid="current-plan-status"
          >
            {statusLabel}
          </span>
        </div>
        <div className="ssub-hero__price">
          <span className="ssub-hero__amount" data-testid="current-plan-price">
            {amountLabel}
          </span>
          <span className="ssub-hero__period">/ {interval === 'annual' ? 'year' : 'month'}</span>
        </div>
        <div className="ssub-hero__meta">
          <span data-testid="current-plan-interval">{intervalLabel(interval)} billing</span>
          {periodLabel && (
            <span>
              Billing period <strong>{periodLabel}</strong>
            </span>
          )}
          {renewalLabel && renewalLabel !== '—' && (
            <span data-testid="current-plan-renewal">
              {kind === 'past_due' ? 'Was due' : 'Next billing date'}{' '}
              <strong>{renewalLabel}</strong>
            </span>
          )}
        </div>

        {kind === 'pending' && (
          <div className="ssub-hero__notice" data-testid="pending-notice">
            Your selected plan is awaiting payment.
            {nextPayment?.amountLabel ? (
              <>
                {' '}
                Amount due <strong>{nextPayment.amountLabel}</strong>.
              </>
            ) : null}
            {nextPayment?.date && nextPayment.date !== '—' ? (
              <>
                {' '}
                Complete payment by <strong>{nextPayment.date}</strong>.
              </>
            ) : null}
          </div>
        )}
        {kind === 'past_due' && (
          <div className="ssub-hero__notice ssub-hero__notice--danger" data-testid="past-due-notice">
            Your latest subscription payment is overdue.
          </div>
        )}

        <div className="ssub-hero__actions">
          <button
            type="button"
            className="ssub-btn ssub-btn--gold"
            data-testid="change-plan-btn"
            onClick={onChangePlan}
          >
            Change plan
          </button>
          <button
            type="button"
            className="ssub-btn ssub-btn--ghost"
            data-testid="manage-billing-btn"
            onClick={onManageBilling}
          >
            Manage billing
          </button>
          {(kind === 'past_due' || kind === 'pending') && onRetryPayment && (
            <button
              type="button"
              className="ssub-btn ssub-btn--ghost"
              data-testid="retry-payment-btn"
              onClick={onRetryPayment}
            >
              Retry payment
            </button>
          )}
        </div>
      </div>
      <FeatureList plan={plan} />
    </div>
  );
}

export default CurrentPlanHero;
