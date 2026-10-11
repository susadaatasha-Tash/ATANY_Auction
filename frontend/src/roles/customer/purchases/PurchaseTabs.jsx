// frontend/src/roles/customer/purchases/PurchaseTabs.jsx
const TABS = [
  { key: 'all', label: 'All purchases' },
  { key: 'awaiting', label: 'Awaiting pickup' },
  { key: 'ready', label: 'Ready for pickup' },
  { key: 'collected', label: 'Collected' },
];

export function PurchaseTabs({ counts, active, onChange }) {
  return (
    <div className="mp-tabs" role="tablist" aria-label="Purchase filters">
      {TABS.map((t) => {
        const isActive = active === t.key;
        const count = counts?.[t.key] ?? 0;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`mp-tab${isActive ? ' is-active' : ''}`}
            onClick={() => onChange(t.key)}
          >
            {t.label}
            <span className="mp-tab-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
