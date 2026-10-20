// frontend/src/roles/admin/subscriptions/SubscriptionTable.jsx
import { SubscriptionStatusChip } from './SubscriptionStatusChip';
import { canRetryCharge } from '../lib/subscriptionSelectors';
import { peso } from '../lib/currency';

export function SubscriptionTable({ rows, loading, error, onRetry, onOpen, onRetryState, emptyMessage }) {
  if (loading) {
    return (
      <div className="sub-table-wrap" aria-busy="true">
        <table className="sub-table">
          <thead>
            <tr>
              <th>Subscriber</th>
              <th>Plan · Interval · MRR</th>
              <th>Branch</th>
              <th>Billing Status</th>
              <th>MRR</th>
              <th>Renews</th>
              <th>Method</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4].map((i) => (
              <tr key={i} className="sub-row--skeleton">
                <td colSpan={8}>
                  <div className="sub-skel" style={{ height: 28, width: '100%' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sub-state" data-testid="subscription-error">
        <p className="sub-state__title">Unable to load subscriptions</p>
        <p className="sub-state__text">{error}</p>
      </div>
    );
  }

  if (!rows?.length) {
    return (
      <div className="sub-state" data-testid="subscription-empty">
        <p className="sub-state__title">{emptyMessage || 'No subscriptions yet'}</p>
        <p className="sub-state__text">Billing records will appear here once sellers subscribe.</p>
      </div>
    );
  }

  return (
    <div className="sub-table-wrap">
      <table className="sub-table">
        <thead>
          <tr>
            <th>Subscriber</th>
            <th>Plan · Interval · MRR</th>
            <th>Branch</th>
            <th>Billing Status</th>
            <th>MRR</th>
            <th>Renews</th>
            <th>Method</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const retryable = canRetryCharge(r);
            const retrying = onRetryState?.id === r.id && onRetryState?.busy;
            return (
              <tr key={r.id} data-testid="subscription-row" data-status={r.statusChip}>
                <td>
                  <div className="sub-cell-subscriber">
                    <span className="sub-avatar" aria-hidden="true">{r.initials}</span>
                    <div>
                      <div className="sub-cell-name">{r.subscriberName}</div>
                      <div className="sub-cell-id">{r.subscriptionId}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="sub-cell-plan">
                    <span className={`sub-plan-crown sub-plan-tone--${r.planTone}`} aria-hidden="true">♛</span>
                    <div className="sub-cell-plan__body">
                      <div className="sub-cell-plan__name" data-testid="plan-name">{r.planName}</div>
                      <div className="sub-cell-plan__meta" data-testid="plan-billing-interval">
                        {r.billingIntervalLabel || 'Monthly'}
                        {r.periodPriceLabel ? ` · ${r.periodPriceLabel}` : ''}
                      </div>
                      <div className="sub-cell-plan__mrr" data-testid="plan-mrr-label">
                        MRR {r.mrrLabel || peso(r.mrr)}
                      </div>
                      {r.scheduledPlanCode && (
                        <div className="sub-cell-plan__scheduled" data-testid="scheduled-change-indicator">
                          Scheduled:
                          {r.scheduledIsDowngrade ? ' Downgrade' : ' Change'} to{' '}
                          {r.scheduledPlanName || r.scheduledPlanCode}
                          {r.scheduledEffectiveLabel
                            ? ` · Effective ${r.scheduledEffectiveLabel}`
                            : r.scheduledEffectiveAt
                              ? ` · Effective ${r.scheduledEffectiveAt}`
                              : ''}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <span className="sub-cell-branch">
                    <span aria-hidden="true">⌂</span> {r.branchName}
                  </span>
                </td>
                <td>
                  <SubscriptionStatusChip status={r.status} />
                </td>
                <td className="sub-cell-mrr">{peso(r.mrr)}</td>
                <td className="sub-cell-renews">{r.renews}</td>
                <td className="sub-cell-method">{r.method}</td>
                <td>
                  {retryable ? (
                    <button
                      type="button"
                      className="sub-btn sub-btn--gold sub-btn--sm"
                      disabled={retrying}
                      onClick={() => onRetry?.(r)}
                      aria-label={`Retry charge for ${r.subscriberName}`}
                    >
                      {retrying ? 'Retrying…' : 'Retry charge'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="sub-btn sub-btn--ghost sub-btn--sm"
                      onClick={() => onOpen?.(r)}
                      aria-label={`View ${r.subscriberName}`}
                    >
                      ↗
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default SubscriptionTable;
