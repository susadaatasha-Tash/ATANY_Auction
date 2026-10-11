// frontend/src/roles/admin/subscriptions/SubscriptionMetricsGrid.jsx
import { peso } from '../lib/currency';

function MetricCard({ icon, label, value, pill, pillTone, subtext, testId }) {
  return (
    <article className="sub-kpi" data-testid={testId}>
      <div className="sub-kpi__top">
        <span className={`sub-kpi__icon sub-kpi__icon--${pillTone || 'navy'}`} aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="sub-kpi__label">{label}</div>
      <div className="sub-kpi__value">{value}</div>
      <div className="sub-kpi__foot">
        {pill ? <span className={`sub-kpi__pill sub-kpi__pill--${pillTone || 'navy'}`}>{pill}</span> : <span />}
        {subtext ? <span className="sub-kpi__sub">{subtext}</span> : <span />}
      </div>
    </article>
  );
}

export function SubscriptionMetricsGrid({ metrics }) {
  if (!metrics) {
    return (
      <div className="sub-kpi-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="sub-kpi sub-kpi--skeleton">
            <div className="sub-skel" style={{ width: 36, height: 36, borderRadius: 10 }} />
            <div className="sub-skel" style={{ width: '40%', height: 12, marginTop: 14 }} />
            <div className="sub-skel" style={{ width: '70%', height: 28, marginTop: 8 }} />
            <div className="sub-skel" style={{ width: '50%', height: 12, marginTop: 12 }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="sub-kpi-grid">
      <MetricCard
        testId="kpi-mrr"
        icon={<span>₱</span>}
        label="Monthly Recurring"
        value={metrics.mrrLabel}
        pill={metrics.mrr > 0 ? 'MRR' : 'No paid MRR'}
        pillTone="gold"
        subtext={`ARR ${metrics.arrLabel}`}
      />
      <MetricCard
        testId="kpi-active"
        icon={<span>◎</span>}
        label="Active Subscribers"
        value={metrics.activeCount}
        pill="Renewing"
        pillTone="green"
        subtext="paid accounts"
      />
      <MetricCard
        testId="kpi-past-due"
        icon={<span>⚠</span>}
        label="Past Due"
        value={metrics.pastDueCount}
        pill={metrics.pastDueMrr > 0 ? metrics.pastDueCompact : '—'}
        pillTone="blue"
        subtext="at risk MRR"
      />
      <MetricCard
        testId="kpi-pending"
        icon={<span>◷</span>}
        label="Pending Payments"
        value={metrics.pendingCount}
        pill={metrics.pendingCount > 0 ? 'Unresolved' : 'None'}
        pillTone="amber"
        subtext="current pending only"
      />
    </div>
  );
}

export default SubscriptionMetricsGrid;
