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

export function PurchaseHeader({
  liveLots,
  onMenuToggle,
  onSidebarToggle,
  sidebarCollapsed,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { branchName } = useBranch();
  const displayName = getDisplayName(user);
  const initials = getUserInitials(displayName, user?.email);

  // NOTE: the top-header search was removed on purpose — the page-level
  // "Search your purchases..." field inside the My Purchases content owns the
  // search. The header keeps the same left menu control the other customer
  // pages use (drawer on mobile / sidebar collapse on desktop).

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
      onMenuToggle={onMenuToggle}
      onSidebarToggle={onSidebarToggle}
      sidebarCollapsed={sidebarCollapsed}
      actions={actions}
      user={{ initials, name: displayName, role: branchName || 'Customer' }}
      settingsTo="/customer/account"
    />
  );
}
