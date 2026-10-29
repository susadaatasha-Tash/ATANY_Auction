// frontend/src/roles/shop-owner/subscription/SubscriptionPaymentSummary.jsx
// Left panel of the Update-payment-method modal — the seller subscription only
// (never jewelry/auction/order data). Values come from the real
// GET /billing/me/subscription response with the payable record as fallback.
// Layout matches the approved reference: plan card → fee rows → Total Due →
// billing metadata panel → bottom note.
import { CalendarDays, Crown, ReceiptText, RefreshCw } from 'lucide-react';
import { SUBSCRIPTION_PLANS, intervalLabel } from '../../../shared/lib/subscriptionPlans';
import { formatBillingReference } from './sellerSubscriptionSelectors';

/** Peso with centavos — "₱1,000.00" — display only (backend stays authoritative). */
export function pesoCents(value) {
  const n = Number(value) || 0;
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_BADGES = {
  active: 'Active Plan',
  past_due: 'Past due',
  pending: 'Pending',
  canceled: 'Canceled',
  expired: 'Expired',
  trialing: 'Trial Plan',
};

function catalogDescription(planCode, planName) {
  const byCode = SUBSCRIPTION_PLANS.find((p) => p.code === planCode);
  if (byCode?.description) return byCode.description;
  const byName = SUBSCRIPTION_PLANS.find((p) => p.name === planName);
  return byName?.description || '';
}

export function SubscriptionPaymentSummary({ summary = null, payableRecord = null, planName, billingInterval }) {
  const open = summary?.open_record || null;
  const current = summary?.current_record || null;
  const nextPayment = summary?.next_payment || null;
  const plan = summary?.plan || null;

  const resolvedPlanName = plan?.name || nextPayment?.plan_name || planName || '—';
  const planCode = plan?.code || nextPayment?.plan_code || null;
  const interval = nextPayment?.billing_interval || summary?.billing_interval || billingInterval || 'monthly';
  const isAnnual = String(interval).toLowerCase() === 'annual';
  const description = catalogDescription(planCode, resolvedPlanName);

  // Subscription fee = real plan catalog price for the active interval.
  const fee =
    (isAnnual ? plan?.annual_price : plan?.monthly_price) ??
    nextPayment?.amount ??
    open?.amount ??
    current?.amount ??
    (payableRecord?.amount != null ? Number(payableRecord.amount) : 0);
  // Total Due = the backend payable amount when an invoice is open.
  const total = open?.amount ?? payableRecord?.amount ?? nextPayment?.amount ?? fee;
  const statusKey = String(summary?.subscription_status || summary?.status || 'active').toLowerCase();
  const badge = STATUS_BADGES[statusKey] || 'Active Plan';

  const dueDate = nextPayment?.due_date || open?.due_date || current?.current_period_end || payableRecord?.due_date || null;
  const refRecord = open || payableRecord || current;
  const reference = formatBillingReference(refRecord);
  const dateLabel = dueDate
    ? new Date(dueDate).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';

  return (
    <aside className="ssub-pm-summary" data-testid="payment-summary" aria-label="Subscription summary">
      <div className="ssub-sum-plan" data-testid="summary-plan-card">
        <span className="ssub-sum-plan__icon" aria-hidden="true">
          <Crown size={20} strokeWidth={2.2} />
        </span>
        <div className="ssub-sum-plan__body">
          <div className="ssub-sum-plan__titlerow">
            <h4 className="ssub-sum-plan__name" data-testid="summary-plan-name">{resolvedPlanName}</h4>
            <span className="ssub-sum-plan__badge" data-testid="summary-plan-badge">{badge}</span>
          </div>
          <p className="ssub-sum-plan__interval" data-testid="summary-plan-interval">
            {intervalLabel(interval)} Subscription
          </p>
          {description && (
            <p className="ssub-sum-plan__desc" data-testid="summary-plan-description">{description}</p>
          )}
        </div>
      </div>

      <dl className="ssub-sum-rows">
        <div className="ssub-sum-row">
          <dt>Subscription fee</dt>
          <dd data-testid="summary-fee">{pesoCents(fee)}</dd>
        </div>
        <div className="ssub-sum-row">
          <dt>Taxes &amp; fees</dt>
          <dd data-testid="summary-taxes">Free</dd>
        </div>
      </dl>

      <div className="ssub-sum-total">
        <span>Total Due</span>
        <strong data-testid="summary-total">{pesoCents(total)}</strong>
      </div>

      <div className="ssub-sum-meta" data-testid="summary-meta">
        <div className="ssub-sum-meta__item">
          <CalendarDays size={17} strokeWidth={2} aria-hidden="true" />
          <div>
            <span className="ssub-sum-meta__label">Next payment</span>
            <span className="ssub-sum-meta__value" data-testid="summary-date">{dateLabel}</span>
          </div>
        </div>
        <div className="ssub-sum-meta__item">
          <ReceiptText size={17} strokeWidth={2} aria-hidden="true" />
          <div>
            <span className="ssub-sum-meta__label">Reference number</span>
            <span className="ssub-sum-meta__value" data-testid="summary-reference">{reference}</span>
          </div>
        </div>
        <div className="ssub-sum-meta__item">
          <RefreshCw size={17} strokeWidth={2} aria-hidden="true" />
          <div>
            <span className="ssub-sum-meta__label">Billing cycle</span>
            <span className="ssub-sum-meta__value" data-testid="summary-cycle">{intervalLabel(interval)}</span>
          </div>
        </div>
      </div>

      <p className="ssub-sum-note" data-testid="summary-note">
        The amount is charged once when you confirm your payment method.
      </p>
    </aside>
  );
}

export default SubscriptionPaymentSummary;
