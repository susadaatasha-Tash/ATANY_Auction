// frontend/src/shared/ui/Card.jsx
// Premium Panel + KPI primitives with subtle hover polish
export function Card({ children, className = '' }) {
  return <div className={`panel ${className}`}>{children}</div>;
}

export function KpiCard({ icon, value, label, badge, badgeVariant = 'neutral' }) {
  return (
    <div className="kpi-card">
      <div className="kpi-header">
        <div className="kpi-header-left">
          {icon && <span className="kpi-icon">{icon}</span>}
          <span className="kpi-label">{label}</span>
        </div>
        <span className="kpi-menu" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
          </svg>
        </span>
      </div>
      <div className="kpi-divider" />
      <div className="kpi-value">{value}</div>
      {badge && (
        <div className={`kpi-badge ${badgeVariant}`}>{badge}</div>
      )}
    </div>
  );
}
