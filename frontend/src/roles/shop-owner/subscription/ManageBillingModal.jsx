// frontend/src/roles/shop-owner/subscription/ManageBillingModal.jsx
// Manage billing / Change plan modal — Monthly|Annual + plan rows with
// Upgrade / Current plan / Downgrade. Preview data comes from the backend.
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../../shared/components/Modal';
import {
  SUBSCRIPTION_PLANS,
  normalizeBillingInterval,
  planActionKind,
  planPriceLabel,
  intervalLabel,
} from '../../../shared/lib/subscriptionPlans';
import { peso } from '../../admin/lib/currency';

export function ManageBillingModal({
  open,
  onClose,
  currentState,
  onPlanAction,
  busyPlanCode,
  scheduledChange,
  activeListings,
  error,
}) {
  const currentInterval = normalizeBillingInterval(
    currentState?.billingInterval || currentState?.record?.billing_interval || 'monthly'
  );
  const [interval, setInterval] = useState(currentInterval);

  useEffect(() => {
    if (open) setInterval(currentInterval);
  }, [open, currentInterval]);

  const currentPlan = currentState?.plan || null;
  const plans = useMemo(() => SUBSCRIPTION_PLANS, []);

  const handleAction = (plan, kind) => {
    if (kind === 'current') return;
    onPlanAction?.({ plan, kind, interval });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage billing"
      className="ssub-manage-modal"
    >
      <div className="ssub-manage" data-testid="manage-billing-modal">
        <div className="ssub-manage__intro">
          <p>
            Switch plans anytime — upgrades are instant and downgrades apply at the next cycle.
          </p>
          <div className="ssub-toggle" role="group" aria-label="Billing interval">
            <button
              type="button"
              className={`ssub-toggle__btn ${interval === 'monthly' ? 'is-active' : ''}`}
              data-testid="interval-monthly"
              onClick={() => setInterval('monthly')}
            >
              Monthly
            </button>
            <button
              type="button"
              className={`ssub-toggle__btn ${interval === 'annual' ? 'is-active' : ''}`}
              data-testid="interval-annual"
              onClick={() => setInterval('annual')}
            >
              Annual · -17%
            </button>
          </div>
        </div>

        {error && (
          <div className="ssub-error" data-testid="modal-error" role="alert">
            {error}
          </div>
        )}

        {scheduledChange && (
          <div className="ssub-manage__scheduled" data-testid="scheduled-change-banner">
            Scheduled: {scheduledChange.target_plan_code} effective{' '}
            {scheduledChange.effective_at}
          </div>
        )}

        <ul className="ssub-manage__list" data-testid="manage-plan-list">
          {plans.map((plan) => {
            const kind = planActionKind(currentPlan, plan, currentInterval, interval);
            const isCurrent = kind === 'current';
            const busy = busyPlanCode === plan.code;
            return (
              <li
                key={plan.code}
                className={`ssub-manage__row ${isCurrent ? 'is-current' : ''}`}
                data-testid={`manage-plan-${plan.code}`}
              >
                <div className="ssub-manage__info">
                  <div className="ssub-manage__name-row">
                    <span className={`ssub-plan-tone--${plan.tone}`} aria-hidden="true">
                      {plan.tone === 'bronze' ? 'B' : plan.tone === 'gold' ? 'G' : 'P'}
                    </span>
                    <strong>{plan.name}</strong>
                    {isCurrent && (
                      <span className="ssub-chip ssub-chip--active" data-testid="current-plan-badge">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="ssub-manage__desc">{plan.description}</p>
                </div>
                <div className="ssub-manage__price">
                  <div className="ssub-manage__amount" data-testid={`manage-plan-price-${plan.code}`}>
                    {planPriceLabel(plan, interval)}
                  </div>
                  <div className="ssub-manage__period">/{interval === 'annual' ? 'year' : 'month'}</div>
                </div>
                <div className="ssub-manage__action">
                  {isCurrent ? (
                    <span className="ssub-btn ssub-btn--outline" data-testid={`manage-plan-action-${plan.code}`}>
                      Current plan
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`ssub-btn ${kind === 'upgrade' ? 'ssub-btn--gold' : 'ssub-btn--outline'}`}
                      data-testid={`manage-plan-action-${plan.code}`}
                      data-action={kind}
                      disabled={!!busy}
                      onClick={() => handleAction(plan, kind)}
                    >
                      {busy
                        ? 'Working…'
                        : kind === 'upgrade'
                          ? 'Upgrade ↑'
                          : 'Downgrade ↓'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="ssub-manage__note">
          Plan changes are pro-rated against your current billing cycle — you only pay the
          difference for the days remaining. Downgrades never charge immediately.
        </div>

        {activeListings != null && (
          <div className="ssub-manage__usage" data-testid="manage-usage">
            You currently have {activeListings} active listings.
          </div>
        )}
      </div>
    </Modal>
  );
}

export default ManageBillingModal;
