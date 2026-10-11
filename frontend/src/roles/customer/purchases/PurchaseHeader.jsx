// frontend/src/roles/customer/purchases/PurchaseHeader.jsx
// Flat My Purchases header — shared PortalPageHeader, not a floating card
import { useNavigate } from 'react-router-dom';
import { PortalPageHeader } from '../../../shared/components/PortalPageHeader';
import { NotificationBell } from '../../../shared/components/NotificationBell';
import { useAuth } from '../../../shared/hooks/useAuth';
import { useBranch } from '../../../shared/hooks/useBranch';

function getDisplayName(user) {
  if (!user) return 'Customer';
  return user.user_metadata?.displayName
    || user.user_metadata?.fullName
    || user.user_metadata?.name
    || [user.user_metadata?.firstName, user.user_metadata?.lastName].filter(Boolean).join(' ')
    || user.email?.split('@')[0]?.replace(/[._-]/g, ' ')
    || user.email
    || 'Customer';
}

function getUserInitials(name, email) {
  const src = name || email || '';
  if (!src) return 'CU';
  if (src.includes('@')) {
    const parts = src.split('@')[0].split(/[._-]/);
    return parts.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
  }
  const parts = src.trim().split(/\s+/);
  return parts.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
}

export function PurchaseHeader({ globalQuery, onGlobalQuerySubmit, liveLots }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { branchName } = useBranch();
  const displayName = getDisplayName(user);
  const initials = getUserInitials(displayName, user?.email);

  const search = (
    <form
      className="mp-header-search portal-search"
      onSubmit={(e) => {
        e.preventDefault();
        onGlobalQuerySubmit?.(globalQuery);
      }}
      role="search"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input
        type="search"
        value={globalQuery}
        onChange={(e) => onGlobalQuerySubmit?.(e.target.value, { live: true })}
        placeholder="Search lots, branches..."
        aria-label="Search lots and branches"
      />
    </form>
  );

  const actions = (
    <>
      {liveLots > 0 && (
        <button type="button" className="mp-live-pill" onClick={() => navigate('/customer/auctions')}>
          <span className="mp-live-dot" aria-hidden="true" />
          {liveLots} live lot{liveLots === 1 ? '' : 's'}
        </button>
      )}
      <button type="button" className="mp-branch-btn" onClick={() => navigate('/select-branch')}>
        Change branch
      </button>
      <NotificationBell to="/customer/notifications" />
    </>
  );

  return (
    <PortalPageHeader
      title="My Purchases"
      role="customer"
      search={search}
      actions={actions}
      user={{ initials, name: displayName, role: branchName || 'Customer' }}
      settingsTo="/customer/account"
    />
  );
}
