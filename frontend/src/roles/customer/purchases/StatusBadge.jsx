// frontend/src/roles/customer/purchases/StatusBadge.jsx
export function StatusBadge({ label, tone = 'pending' }) {
  return (
    <span className={`mp-badge mp-badge-${tone}`}>
      <span className="mp-badge-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
