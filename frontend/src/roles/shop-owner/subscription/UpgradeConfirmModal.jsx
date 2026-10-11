// frontend/src/roles/shop-owner/subscription/UpgradeConfirmModal.jsx
// Upgrade confirmation — displays backend preview only (amounts from server).
import { Modal } from '../../../shared/components/Modal';
import { peso } from '../../admin/lib/currency';
import { intervalSuffix } from '../../../shared/lib/subscriptionPlans';

export function UpgradeConfirmModal({
  open,
  onClose,
  preview,
  onConfirm,
  confirming,
  error,
}) {
  if (!preview) return null;
  const current = preview.current_plan;
  const target = preview.target_plan;
  const amountDue = Number(preview.amount_due_now) || 0;
  const nextAmount = Number(preview.next_billing_amount) || 0;
  const proration = preview.proration || {};

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Upgrade to ${target?.name || 'plan'}`}
      className="ssub-upgrade-modal"
      footer={
        <>
          <button type="button" className="ssub-btn ssub-btn--outline" onClick={onClose} disabled={confirming}>
            Cancel
          </button>
          <button
            type="button"
            className="ssub-btn ssub-btn--gold"
            data-testid="confirm-upgrade-btn"
            disabled={confirming}
            onClick={onConfirm}
          >
            {confirming
              ? 'Preparing checkout…'
              : amountDue > 0
                ? `Confirm upgrade · ${peso(amountDue)}`
                : 'Confirm upgrade'}
          </button>
        </>
      }
    >
      <div className="ssub-upgrade" data-testid="upgrade-confirm-modal">
        <p className="ssub-upgrade__lead">Here&apos;s exactly what happens the moment you confirm.</p>

        <div className="ssub-upgrade__plans">
          <div className="ssub-upgrade__plan-box">
            <div className="ssub-upgrade__plan-label">CURRENT</div>
            <div className="ssub-upgrade__plan-name">{current?.name || '—'}</div>
            <div className="ssub-upgrade__plan-price">
              {current ? `${peso(current.period_price ?? current.monthly_price)}${intervalSuffix(current.billing_interval)}` : '—'}
            </div>
          </div>
          <div className="ssub-upgrade__arrow" aria-hidden="true">→</div>
          <div className="ssub-upgrade__plan-box is-new">
            <div className="ssub-upgrade__plan-label">NEW PLAN</div>
            <div className="ssub-upgrade__plan-name">{target?.name}</div>
            <div className="ssub-upgrade__plan-price">
              {peso(target?.period_price ?? nextAmount)}
              {intervalSuffix(target?.billing_interval || preview.billing_interval)}
            </div>
          </div>
        </div>

        <div className="ssub-upgrade__summary">
          <div className="ssub-upgrade__row">
            <span>Charged today (pro-rated)</span>
            <strong data-testid="upgrade-amount-due">{peso(amountDue)}</strong>
          </div>
          <div className="ssub-upgrade__row">
            <span>Next billing amount</span>
            <strong>
              {peso(nextAmount)}
              {intervalSuffix(preview.next_billing_interval || preview.billing_interval)}
            </strong>
          </div>
          <div className="ssub-upgrade__row">
            <span>Takes effect</span>
            <strong className="ssub-upgrade__instant" data-testid="upgrade-effective">
              {preview.effective_at === 'immediate' ? 'Instantly' : preview.effective_at}
            </strong>
          </div>
          {proration.remaining_fraction != null && amountDue > 0 && (
            <div className="ssub-upgrade__row ssub-upgrade__row--muted">
              <span>Remaining in current cycle</span>
              <span>{Math.round(Number(proration.remaining_fraction) * 100)}%</span>
            </div>
          )}
        </div>

        {target?.features?.length > 0 && (
          <div className="ssub-upgrade__unlock">
            <div className="ssub-upgrade__unlock-title">WHAT YOU UNLOCK</div>
            <ul className="ssub-feature-list">
              {target.features.map((f) => (
                <li key={f}>
                  <span className="ssub-feature-list__check" aria-hidden="true">+</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="ssub-upgrade__payment">
          <span>Payment method</span>
          <strong>PayMongo checkout</strong>
        </div>

        {error && (
          <div className="ssub-error" data-testid="upgrade-error">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default UpgradeConfirmModal;
