// frontend/src/layouts/CustomerLayout.jsx
// Shell for customer — BranchProvider + premium sidebar + topbar
import { useState, useEffect, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from '../shared/components/Sidebar';
import { Topbar } from '../shared/components/Topbar';
import { AssistantWidget } from '../shared/components/AssistantWidget';
import { NotificationBell } from '../shared/components/NotificationBell';
import OtherBranchLivePopup from '../roles/customer/components/OtherBranchLivePopup';
import AuctionStartPopup from '../roles/customer/components/AuctionStartPopup';
import { useAuth } from '../shared/hooks/useAuth';
import { BranchProvider, useBranch } from '../shared/hooks/useBranch';
import { Home, Gavel, Tag, Heart, Eye, ShoppingBag, MapPin } from 'lucide-react';
import '../roles/customer/customer-dashboard.css';

const sections = [
  { label: 'OVERVIEW', items: [{ to: '/customer', name: 'Dashboard', end: true, icon: <Home size={16} /> }] },
  { label: 'SHOP', items: [
    { to: '/customer/auctions', name: 'Auctions', icon: <Gavel size={16} /> },
    { to: '/customer/bids', name: 'My Bids', icon: <Tag size={16} /> },
    { to: '/customer/favorites', name: 'Favorites', icon: <Heart size={16} /> },
    { to: '/customer/watchlist', name: 'Watchlist', icon: <Eye size={16} /> },
    { to: '/customer/branch-locator', name: 'Branch Locator', icon: <MapPin size={16} /> },
  ]},
  { label: 'ORDERS', items: [{ to: '/customer/purchases', name: 'My Purchases', icon: <ShoppingBag size={16} /> }] },
  // No SETTINGS section: the customer Settings page was removed. Profile stays
  // reachable through the account dropdown (see PortalPageHeader settingsTo).
];

const titles = {
  '/customer': ['Dashboard'],
  '/customer/auctions': ['Auctions'],
  '/customer/live': ['Auctions'],
  '/customer/bids': ['My Bids'],
  '/customer/favorites': ['Favorites'],
  '/customer/watchlist': ['Watchlist'],
  '/customer/purchases': ['My Purchases'],
  '/customer/messages': ['Messages'],
  '/customer/notifications': ['Notifications'],
  '/customer/account': ['Profile'],
};

function BranchSwitcher() {
  const { branchId } = useBranch();
  const { preferredBranchId } = useAuth();
  if (!branchId && !preferredBranchId) return null;
  return (
    <button
      className="topbar-change-btn branch-switcher"
      onClick={() => { window.location.href = '/select-branch'; }}
      style={{
        height: 34,
        padding: '0 12px',
        borderRadius: 4,
        border: '1px solid var(--line)',
        background: '#fff',
        fontSize: 11.5,
        fontWeight: 700,
        color: 'var(--gold)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'all .18s var(--ease)',
      }}
      title="Change preferred branch"
      aria-label="Change preferred branch"
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
  const { user, signOut, preferredBranchId, profileName, loading } = useAuth();

  // Apply saved theme early to avoid flash (customer-only)
  useEffect(() => {
    try {
      const metaTheme = user?.user_metadata?.settings?.theme;
      const key = user ? `atany_settings_${user.id}` : 'atany_settings_guest';
      const stored = localStorage.getItem(key);
      let theme = metaTheme;
      if (!theme && stored) {
        try { theme = JSON.parse(stored).theme; } catch {}
      }
      if (!theme) {
        const guestStored = localStorage.getItem('atany_settings_guest');
        if (guestStored) try { theme = JSON.parse(guestStored).theme; } catch {}
      }
      const root = document.querySelector('.customer-app') || document.documentElement;
      if (theme === 'dark') {
        root.setAttribute('data-theme', 'dark');
        document.body.style.background = '#0f172a';
      } else {
        root.removeAttribute('data-theme');
        document.body.style.background = '';
      }
    } catch {}
  }, [user]);
  const { branchId, branchName, branches, loading: branchLoading } = useBranch();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // My Purchases owns its page-level header (title / search / profile)
  const isPurchases = pathname === '/customer/purchases';
  const title = titles[pathname]?.[0] || titles['/customer'][0];
  // profileName comes from the DB (public.users) via /auth/me — it is what the
  // Profile page edits, so a rename shows up in the header immediately.
  const displayName = profileName || getDisplayName(user);
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

  // The customer drawer + sidebar collapse live here. Pages that render their
  // own flat header (My Purchases) get the SAME controls through the outlet
  // context — no second sidebar implementation.
  const outletContext = useMemo(() => ({
    menuOpen: open,
    openMenu: () => setOpen(true),
    closeMenu: () => setOpen(false),
    toggleMenu: () => setOpen((v) => !v),
    sidebarCollapsed,
    toggleSidebar: () => setSidebarCollapsed((v) => !v),
  }), [open, sidebarCollapsed]);

  return (
    <div className={`app customer-app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar brand="ATANY" tag="JEWELRY AUCTION" sections={sections} open={open} onClose={() => setOpen(false)} onSignOut={signOut} />
      {open && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
      <div className="main">
        {!isPurchases && (
          <Topbar
            title={title}
            role="customer"
            onMenuToggle={() => setOpen((v) => !v)}
            sidebarCollapsed={sidebarCollapsed}
            onSidebarToggle={() => setSidebarCollapsed((v) => !v)}
            user={{ initials, name: displayName, role: displayBranchName || 'Customer' }}
            onSignOut={signOut}
            rightExtra={<><BranchSwitcher /><NotificationBell /></>}
            settingsTo="/customer/account"
          />
        )}
        <div className={`content${isPurchases ? ' content-purchases' : ''}`}><Outlet context={outletContext} /></div>
      </div>
      <AssistantWidget mode="customer" userId={user?.id} />
      <OtherBranchLivePopup />
      <AuctionStartPopup />
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
