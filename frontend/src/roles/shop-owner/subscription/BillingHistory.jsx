// frontend/src/roles/shop-owner/subscription/BillingHistory.jsx
import { BillingStatusChip } from './BillingStatusBadge';

export function BillingHistory({ rows, onPay, payingId, loading, error }) {
  return (
    <div className="ssub-card ssub-history" data-testid="billing-history">
      <div className="ssub-card__head">
        <div>
          <h2 className="ssub-card__title">Billing history</h2>
          <p className="ssub-card__subtitle">Invoices and subscription payments</p>
        </div>
      </div>

      {error && <div className="ssub-error">{error}</div>}

      <div className="ssub-table-wrap">
        <table className="ssub-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Date</th>
              <th>Plan</th>
              <th>Billing period</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 28, color: '#7B8493' }}>
                  Loading billing history…
                </td>
              </tr>
            ) : rows.length ? (
              rows.map((row) => (
                <tr key={row.id} data-testid="billing-row">
                  <td>
                    <div className="ssub-ref">{row.referenceLabel}</div>
                  </td>
                  <td>{row.date}</td>
                  <td>{row.planName}</td>
                  <td>{row.billingPeriod}</td>
                  <td className="ssub-amount-cell">{row.amountLabel}</td>
                  <td>
                    <BillingStatusChip statusKey={row.chip || row.statusKey} statusLabel={row.statusLabel} />
                  </td>
                  <td>
                    {row.payable && onPay ? (
                      <button
                        type="button"
                        className="ssub-btn ssub-btn--outline ssub-btn--sm"
                        data-testid={`billing-pay-${row.id}`}
                        disabled={payingId === row.id}
                        onClick={() => onPay(row.record)}
                      >
                        {payingId === row.id ? 'Redirecting…' : row.statusKey === 'past_due' ? 'Retry payment' : 'Pay now'}
                      </button>
                    ) : (
                      <span style={{ color: '#7B8493', fontSize: 12 }}>—</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>
                  <div className="ssub-empty">
                    <p className="ssub-empty__title">No billing records yet</p>
                    <p className="ssub-empty__text">Subscription invoices will appear here once billing starts.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: '#7B8493' }}>
        {rows.length} record{rows.length === 1 ? '' : 's'}
      </div>
    </div>
  );
}

export default BillingHistory;
