// frontend/src/roles/shop-owner/subscription/SubscriptionUsage.jsx
function UsageMetricRow({ metric }) {
  const displayValue = metric.unlimited || metric.limit == null
    ? String(metric.used)
    : `${metric.used} / ${metric.limit}`;
  const widthPct = Math.round((metric.ratio || 0) * 100);

  return (
    <div className="ssub-usage-row" data-testid={`usage-${metric.id}`}>
      <div className="ssub-usage-row__top">
        <span className="ssub-usage-row__label">{metric.label}</span>
        <span className="ssub-usage-row__value" data-testid={`usage-value-${metric.id}`}>{displayValue}</span>
      </div>
      <div className="ssub-usage-row__bar" aria-hidden="true">
        <span style={{ width: `${widthPct}%` }} />
      </div>
      <div className="ssub-usage-row__foot">
        <span data-testid={`usage-percent-${metric.id}`}>{metric.percentLabel}</span>
        {metric.remainingLabel && <span>{metric.remainingLabel}</span>}
        {metric.note && <span>{metric.note}</span>}
      </div>
    </div>
  );
}

export function SubscriptionUsage({ metrics, resetLabel }) {
  if (!metrics?.length) return null;

  return (
    <div className="ssub-card" data-testid="usage-this-cycle">
      <div className="ssub-card__head">
        <div>
          <h2 className="ssub-card__title">Usage this cycle</h2>
          <p className="ssub-card__subtitle">
            {resetLabel ? `Resets on ${resetLabel}` : 'Based on your current plan catalog limits'}
          </p>
        </div>
      </div>
      <div className="ssub-usage-list">
        {metrics.map((m) => (
          <UsageMetricRow key={m.id} metric={m} />
        ))}
      </div>
    </div>
  );
}

export default SubscriptionUsage;
