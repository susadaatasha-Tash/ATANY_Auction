// frontend/src/roles/shop-owner/subscription/DowngradeConfirmModal.jsx
// Downgrade confirmation — effective at next billing cycle, no charge now.
import { Modal } from '../../../shared/components/Modal';
import { peso } from '../../admin/lib/currency';
import { intervalSuffix } from '../../../shared/lib/subscriptionPlans';

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return String(d);
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function DowngradeConfirmModal({
  open,
  onClose,
  preview,
  onConfirm,
  confirming,
  error,
  lostFeatures,
}) {
  if (!preview) return null;
  const current = preview.current_plan;
  const target = preview.target_plan;
  const effectiveAt = preview.effective_at && preview.effective_at !== 'immediate'
    ? preview.effective_at
    : preview.period?.end;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Downgrade to ${target?.name || 'plan'}`}
      className="ssub-downgrade-modal"
      footer={
        <>
          <button type="button" className="ssub-btn ssub-btn--outline" onClick={onClose} disabled={confirming}>
            Cancel
          </button>
          <button
            type="button"
            className="ssub-btn ssub-btn--gold"
            data-testid="confirm-downgrade-btn"
            disabled={confirming}
            onClick={onConfirm}
          >
            {confirming ? 'Scheduling…' : 'Schedule downgrade'}
          </button>
        </>
      }
    >
      <div className="ssub-downgrade" data-testid="downgrade-confirm-modal">
        <p>
          Your <strong>{current?.name || 'current plan'}</strong> will remain active until:{' '}
          <strong data-testid="downgrade-effective-date">{formatDate(effectiveAt)}</strong>
        </p>

        <div className="ssub-downgrade__start">
          <div className="ssub-upgrade__plan-label">STARTING</div>
          <div className="ssub-upgrade__plan-name">{target?.name}</div>
          <div className="ssub-upgrade__plan-price">
            {peso(target?.period_price ?? target?.monthlyPrice)}
            {intervalSuffix(target?.billing_interval || preview.billing_interval)}
          </div>
        </div>

        <div className="ssub-downgrade__charge">
          Charged today: <strong data-testid="downgrade-charge">{peso(0)}</strong> — no immediate payment for downgrades.
        </div>

        {lostFeatures?.length > 0 && (
          <div className="ssub-downgrade__lost">
            <div className="ssub-upgrade__unlock-title">YOU WILL LOSE</div>
            <ul className="ssub-feature-list">
              {lostFeatures.map((f) => (
                <li key={f}>
                  <span aria-hidden="true">−</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="ssub-error" data-testid="downgrade-error">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default DowngradeConfirmModal;
