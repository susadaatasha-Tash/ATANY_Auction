// frontend/src/roles/customer/purchases/PurchaseSkeleton.jsx
export function PurchaseSkeleton() {
  return (
    <div className="mp-skeleton-card" aria-hidden="true">
      <div className="mp-skeleton-row">
        <div className="mp-skeleton mp-skeleton-img" />
        <div className="mp-skeleton-body">
          <div className="mp-skeleton mp-skeleton-line w-40" />
          <div className="mp-skeleton mp-skeleton-line w-70" />
          <div className="mp-skeleton mp-skeleton-line w-55" />
          <div className="mp-skeleton mp-skeleton-block" />
        </div>
        <div className="mp-skeleton-actions">
          <div className="mp-skeleton mp-skeleton-line w-80" />
          <div className="mp-skeleton mp-skeleton-btn" />
          <div className="mp-skeleton mp-skeleton-btn" />
        </div>
      </div>
      <div className="mp-skeleton mp-skeleton-timeline" />
    </div>
  );
}

export function PurchaseStatsSkeleton() {
  return (
    <div className="mp-stats" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="mp-stat mp-stat-skeleton">
          <div className="mp-skeleton mp-skeleton-line w-40" />
          <div className="mp-skeleton mp-skeleton-line w-50" />
          <div className="mp-skeleton mp-skeleton-line w-60" />
        </div>
      ))}
    </div>
  );
}
