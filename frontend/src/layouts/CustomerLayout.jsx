// frontend/src/layouts/CustomerLayout.jsx
// Shell for customer — BranchProvider + premium sidebar + topbar
import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from '../shared/components/Sidebar';
import { Topbar } from '../shared/components/Topbar';
import { AssistantWidget } from '../shared/components/AssistantWidget';
import { NotificationBell } from '../shared/components/NotificationBell';
import { useAuth } from '../shared/hooks/useAuth';
import { BranchProvider, useBranch } from '../shared/hooks/useBranch';

const sections = [
  { label: 'OVERVIEW', items: [{ to: '/customer', name: 'Dashboard', end: true }] },
  { label: 'SHOP', items: [
    { to: '/customer/live', name: 'Live Auctions' },
    { to: '/customer/bids', name: 'My Bids' },
    { to: '/customer/watchlist', name: 'Watchlist' },
  ]},
  { label: 'ORDERS', items: [{ to: '/customer/purchases', name: 'My Purchases' }] },
  { label: 'SETTINGS', items: [{ to: '/customer/account', name: 'Account Settings' }] },
];

const titles = {
  '/customer': ['Dashboard', 'Your bids, orders, and account at a glance.'],
  '/customer/live': ['Live Auctions', 'Browse every auction running right now.'],
  '/customer/bids': ['My Bids', "Track every auction you've bid on."],
  '/customer/watchlist': ['Watchlist', "Items you're keeping an eye on."],
  '/customer/purchases': ['My Purchases', 'Orders, payments, and pickup status.'],
  '/customer/messages': ['Messages', 'Communicate with sellers.'],
  '/customer/notifications': ['Notifications', 'You won! Pickup instructions.'],
  '/customer/account': ['Account Settings', 'Manage your profile.'],
};

function BranchSwitcher() {
  const { branchId } = useBranch();
  if (!branchId) return null;
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

function getUserInitials(email) {
  if (!email) return 'CU';
  const parts = email.split('@')[0].split(/[._-]/);
  return parts.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
}

function LayoutInner() {
  const [open, setOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, signOut, preferredBranchId } = useAuth();
  const { branchId, branchName, loading: branchLoading } = useBranch();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [title, subtitle] = titles[pathname] || titles['/customer'];
  const initials = getUserInitials(user?.email);

  // Use auth context as primary source (updated immediately by SelectBranch),
  // fall back to BranchProvider fetch (may lag behind)
  const hasBranch = !!(preferredBranchId || branchId);

  // Guard: if no branch selected from either source, redirect to /select-branch
  useEffect(() => {
    if (!branchLoading && !hasBranch) {
      navigate('/select-branch', { replace: true });
    }
  }, [hasBranch, branchLoading, navigate]);

  if (!branchLoading && !hasBranch) return null;

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar brand="ATANY" tag="MY ACCOUNT" sections={sections} open={open} onClose={() => setOpen(false)} />
      {open && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
      <div className="main">
        <Topbar title={title} subtitle={subtitle} onMenuToggle={() => setOpen((v) => !v)}
          sidebarCollapsed={sidebarCollapsed} onSidebarToggle={() => setSidebarCollapsed((v) => !v)}
          user={{ initials, name: user?.email || 'Customer', role: branchName || 'Customer' }} onSignOut={signOut}
          rightExtra={<><BranchSwitcher /><NotificationBell /></>}
          settingsTo="/customer/account" />
        <div className="content"><Outlet /></div>
      </div>
      <AssistantWidget mode="customer" userId={user?.id} />
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
