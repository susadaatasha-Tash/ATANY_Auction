// frontend/src/roles/shop-owner/components/DashboardEmptyState.jsx
import { Gem } from 'lucide-react';
import { Link } from 'react-router-dom';

export function DashboardEmptyState({
  icon,
  title,
  text,
  actionLabel,
  actionTo,
  onAction,
}) {
  return (
    <div className="sdash-empty">
      <div className="sdash-empty__icon" aria-hidden="true">
        {icon || <Gem />}
      </div>
      <p className="sdash-empty__title">{title}</p>
      {text && <p className="sdash-empty__text">{text}</p>}
      {(actionLabel && (actionTo || onAction)) && (
        <div className="sdash-empty__action">
          {actionTo ? (
            <Link to={actionTo} className="btn btn-primary" style={{ fontSize: 12, padding: '7px 14px' }}>
              {actionLabel}
            </Link>
          ) : (
            <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: '7px 14px' }} onClick={onAction}>
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default DashboardEmptyState;
