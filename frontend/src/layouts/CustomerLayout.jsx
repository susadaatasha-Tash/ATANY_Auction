// frontend/src/layouts/CustomerLayout.jsx
// Shell for customer — BranchProvider + premium sidebar + topbar
import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from '../shared/components/Sidebar';
import { Topbar } from '../shared/components/Topbar';
import { AssistantWidget } from '../shared/components/AssistantWidget';
import { NotificationBell } from '../shared/components/NotificationBell';
import OtherBranchLivePopup from '../roles/customer/components/OtherBranchLivePopup';
import { useAuth } from '../shared/hooks/useAuth';
import { BranchProvider, useBranch } from '../shared/hooks/useBranch';
import { Home, Gavel, Tag, Heart, Eye, ShoppingBag, Settings, MapPin } from 'lucide-react';
import '../roles/customer/customer-dashboard.css';

const sections = [
  { label: 'OVERVIEW', items: [{ to: '/customer', name: 'Dashboard', end: true, icon: <Home size={16} /> }] },
  { label: 'SHOP', items: [
    { to: '/customer/live', name: 'Live Auctions', icon: <Gavel size={16} /> },
    { to: '/customer/bids', name: 'My Bids', icon: <Tag size={16} /> },
    { to: '/customer/favorites', name: 'Favorites', icon: <Heart size={16} /> },
    { to: '/customer/watchlist', name: 'Watchlist', icon: <Eye size={16} /> },
    { to: '/customer/branch-locator', name: 'Branch Locator', icon: <MapPin size={16} /> },
  ]},
  { label: 'ORDERS', items: [{ to: '/customer/purchases', name: 'My Purchases', icon: <ShoppingBag size={16} /> }] },
  { label: 'SETTINGS', items: [{ to: '/customer/account', name: 'Account Settings', icon: <Settings size={16} /> }] },
];

const titles = {
  '/customer': ['Dashboard', 'Your bids, orders, and account at a glance.'],
  '/customer/live': ['Live Auctions', 'Browse every auction running right now.'],
  '/customer/bids': ['My Bids', "Track every auction you've bid on."],
  '/customer/favorites': ['Favorites', 'Items you liked — saved for later.'],
  '/customer/watchlist': ['Watchlist', 'Auctions you participated in by bidding.'],
  '/customer/purchases': ['My Purchases', 'Orders, payments, and pickup status.'],
  '/customer/messages': ['Messages', 'Communicate with sellers.'],
  '/customer/notifications': ['Notifications', 'You won! Pickup instructions.'],
  '/customer/account': ['Account Settings', 'Manage your profile.'],
};

function BranchSwitcher() {
  const { branchId } = useBranch();
  const { preferredBranchId } = useAuth();
  if (!branchId && !preferredBranchId) return null;
  return (
    <button
      onClick={() => { window.location.href = '/select-branch'; }}
      style={{
        height: 34,
        padding: '0 12px',
        borderRadius: 8,
        border: '1px solid var(--line)',
        background: '#fff',
        fontSize: 11.5,
        fontWeight: 700,
        color: 'var(--gold)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all .18s var(--ease)',
      }}
      title="Change preferred branch"
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.background = 'rgba(196,162,101,.05)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.background = '#fff'; }}
    >
      Change
    </button>
  );
}

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

function LayoutInner() {
  const [open, setOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, signOut, preferredBranchId, loading } = useAuth();
  const { branchId, branchName, branches, loading: branchLoading } = useBranch();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [title, subtitle] = titles[pathname] || titles['/customer'];
  const displayName = getDisplayName(user);
  const initials = getUserInitials(displayName, user?.email);

  // Use auth context as primary source (updated immediately by SelectBranch),
  // fall back to BranchProvider fetch (may lag behind)
  const hasBranch = !!(preferredBranchId || branchId);
  const displayBranchName = branchName || branches.find((b) => b.id === preferredBranchId)?.name || '';

  // Guard: if no branch selected from either source, redirect to /select-branch
  // Only redirect after both AuthContext and BranchProvider have finished loading
  useEffect(() => {
    if (!branchLoading && !loading && !hasBranch) {
      navigate('/select-branch', { replace: true });
    }
  }, [hasBranch, loading, branchLoading, navigate]);

  if (!branchLoading && !loading && !hasBranch) return null;

  return (
    <div className={`app customer-app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar brand="ATANY" tag="JEWELRY AUCTION" sections={sections} open={open} onClose={() => setOpen(false)} />
      {open && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
      <div className="main">
        <Topbar title={title} subtitle={subtitle} onMenuToggle={() => setOpen((v) => !v)}
          sidebarCollapsed={sidebarCollapsed} onSidebarToggle={() => setSidebarCollapsed((v) => !v)}
          user={{ initials, name: displayName, role: displayBranchName || 'Customer' }} onSignOut={signOut}
          rightExtra={<><BranchSwitcher /><NotificationBell /></>}
          settingsTo="/customer/account" />
        <div className="content"><Outlet /></div>
      </div>
      <AssistantWidget mode="customer" userId={user?.id} />
      <OtherBranchLivePopup />
    </div>
  );
}

export default function CustomerLayout() {
  return (
    <BranchProvider>
      <LayoutInner />
    </BranchProvider>
  );
}
