// frontend/src/layouts/ShopOwnerLayout.jsx
// Shell for shop owner — compact header + premium sidebar + live auction card
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '../shared/components/Sidebar';
import { Topbar } from '../shared/components/Topbar';
import { NotificationBell } from '../shared/components/NotificationBell';
import { useAuth } from '../shared/hooks/useAuth';
import { apiFetch } from '../shared/lib/apiClient';
import { socket } from '../shared/lib/socketClient';
import { LiveAuctionCard } from '../roles/shop-owner/components/LiveAuctionCard';
import {
  LayoutDashboard, Gem, Gavel, Receipt, CreditCard, Store, Package,
} from 'lucide-react';
import '../roles/shop-owner/seller-dashboard.css';

const titles = {
  '/shop': ['Dashboard'],
  '/shop/listings': ['My Listings'],
  '/shop/auctions': ['My Auctions'],
  '/shop/orders': ['Won Lots & Orders'],
  '/shop/sales': ['Sales & Payouts'],
  '/shop/billing': ['Subscription'],
  '/shop/messages': ['Messages'],
  '/shop/notifications': ['Notifications'],
  '/shop/profile': ['Shop Profile'],
};

function getDisplayName(user) {
  if (!user) return 'Shop Owner';
  return user.user_metadata?.displayName
    || user.user_metadata?.fullName
    || user.user_metadata?.name
    || [user.user_metadata?.firstName, user.user_metadata?.lastName].filter(Boolean).join(' ')
    || user.email?.split('@')[0]?.replace(/[._-]/g, ' ')
    || user.email
    || 'Shop Owner';
}
function getUserInitials(name, email) {
  const src = name || email || '';
  if (!src) return 'SO';
  if (src.includes('@')) {
    const parts = src.split('@')[0].split(/[._-]/);
    return parts.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
  }
  const parts = src.trim().split(/\s+/);
  return parts.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
}

export default function ShopOwnerLayout() {
  const [open, setOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const title = titles[pathname]?.[0] || titles['/shop'][0];
  const displayName = getDisplayName(user);
  const initials = getUserInitials(displayName, user?.email);
  const isBilling = pathname === '/shop/billing';

  // Portal data: shop identity + real sidebar/header counts + live auction
  const [shop, setShop] = useState(null);
  const [listings, setListings] = useState([]);
  const [auctions, setAuctions] = useState([]);
  const [sales, setSales] = useState([]);
  const [portalLoading, setPortalLoading] = useState(true);

  const refreshPortalData = useCallback(async () => {
    try {
      const [l, a, s, sh] = await Promise.all([
        apiFetch('/shop-owner/listings').catch(() => []),
        apiFetch('/shop-owner/auctions').catch(() => []),
        apiFetch('/shop-owner/sales').catch(() => []),
        apiFetch('/shop-owner/shop').catch(() => null),
      ]);
      setListings(Array.isArray(l) ? l : []);
      setAuctions(Array.isArray(a) ? a : []);
      setSales(Array.isArray(s) ? s : []);
      setShop(sh || null);
    } finally {
      setPortalLoading(false);
    }
  }, []);

  useEffect(() => { refreshPortalData(); }, [refreshPortalData]);

  // Sidebar live card follows mutations elsewhere (e.g. End in My Auctions):
  // any authoritative auction:update refreshes portal data so an ended lot
  // disappears from the sidebar without a hard refresh.
  useEffect(() => {
    function onPortalAuctionUpdate() { refreshPortalData(); }
    try { socket.on('auction:update', onPortalAuctionUpdate); } catch {}
    return () => { try { socket.off('auction:update', onPortalAuctionUpdate); } catch {} };
  }, [refreshPortalData]);

  const listingCount = listings.length;
  const auctionCount = auctions.length;
  const orderCount = sales.length;
  const activeListings = useMemo(() => {
    return listings.filter((l) => {
      const st = l.computed_status || l.status;
      return st !== 'ended' && st !== 'rejected';
    }).length;
  }, [listings]);

  const shopName = shop?.shop_name || displayName;
  const profileInitials = shopName
    ? shopName.trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('')
    : initials;

  const sections = useMemo(() => ([
    {
      label: 'OVERVIEW',
      items: [{ to: '/shop', name: 'Dashboard', end: true, icon: <LayoutDashboard size={15} /> }],
    },
    {
      label: 'INVENTORY',
      items: [
        { to: '/shop/listings', name: 'My Listings', icon: <Gem size={15} />, badge: listingCount || undefined },
        { to: '/shop/auctions', name: 'My Auctions', icon: <Gavel size={15} />, badge: auctionCount || undefined },
        { to: '/shop/orders', name: 'Won Lots & Orders', icon: <Package size={15} />, badge: orderCount || undefined },
      ],
    },
    {
      label: 'EARNINGS',
      items: [
        { to: '/shop/sales', name: 'Sales & Payouts', icon: <Receipt size={15} /> },
        { to: '/shop/billing', name: 'Subscription', icon: <CreditCard size={15} /> },
      ],
    },
    {
      label: 'SETTINGS',
      items: [{ to: '/shop/profile', name: 'Shop Profile', icon: <Store size={15} /> }],
    },
  ]), [listingCount, auctionCount, orderCount]);

  const outletContext = useMemo(() => ({
    shop,
    listings,
    auctions,
    sales,
    loading: portalLoading,
    refreshPortalData,
  }), [shop, listings, auctions, sales, portalLoading, refreshPortalData]);

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar
        brand="ATANY"
        tag="SHOP OWNER"
        sections={sections}
        open={open}
        onClose={() => setOpen(false)}
        onSignOut={signOut}
        extra={<LiveAuctionCard auctions={auctions} loading={portalLoading} />}
      />
      {open && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
      <div className="main">
        <Topbar
          title={title}
          eyebrow={pathname === '/shop/auctions' ? undefined : 'Seller Portal'}
          role="seller"
          onMenuToggle={() => setOpen((v) => !v)}
          sidebarCollapsed={sidebarCollapsed}
          onSidebarToggle={() => setSidebarCollapsed((v) => !v)}
          user={{ initials: profileInitials, name: shopName, role: 'Shop Owner' }}
          onSignOut={signOut}
          actions={(
            <>
              <span className="sdash-active-pill" title="Active listings">
                <span className="sdash-active-pill__dot" aria-hidden="true" />
                <span className="sdash-active-pill__count">{activeListings}</span>
                active listings
              </span>
              <NotificationBell to="/shop/notifications" apiPath="/shop-owner/notifications" />
            </>
          )}
          settingsTo="/shop/profile"
        />
        <div className={`content content-sdash${isBilling ? ' content-billing' : ''}`}>
          <Outlet context={outletContext} />
        </div>
      </div>
    </div>
  );
}
