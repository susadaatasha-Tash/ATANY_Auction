// frontend/src/layouts/ShopOwnerLayout.jsx
// Shell for shop owner — premium sidebar + topbar
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '../shared/components/Sidebar';
import { Topbar } from '../shared/components/Topbar';
import { NotificationBell } from '../shared/components/NotificationBell';
import { useAuth } from '../shared/hooks/useAuth';

const sections = [
  { label: 'OVERVIEW', items: [{ to: '/shop', name: 'Dashboard', end: true }] },
  { label: 'INVENTORY', items: [
    { to: '/shop/listings', name: 'My Listings' },
    { to: '/shop/auctions', name: 'My Auctions' },
  ]},
  { label: 'EARNINGS', items: [
    { to: '/shop/sales', name: 'Sales & Payouts' },
    { to: '/shop/billing', name: 'Subscription' },
  ]},
  { label: 'SETTINGS', items: [{ to: '/shop/profile', name: 'Shop Profile' }] },
];

const titles = {
  '/shop': ['Dashboard', 'Your listings, auctions, and earnings at a glance.'],
  '/shop/listings': ['My Listings', 'Items awaiting review or live.'],
  '/shop/auctions': ['My Auctions', 'Create and manage your auctions.'],
  '/shop/sales': ['Sales & Payouts', 'Completed orders and payout status.'],
  '/shop/billing': ['Subscription', 'Your monthly seller subscription and payment history.'],
  '/shop/messages': ['Messages', 'Communicate with customers.'],
  '/shop/notifications': ['Notifications', 'Updates on your listings, auctions, payouts.'],
  '/shop/profile': ['Shop Profile', 'Manage shop details and payout method.'],
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
  const [title, subtitle] = titles[pathname] || titles['/shop'];
  const displayName = getDisplayName(user);
  const initials = getUserInitials(displayName, user?.email);

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar brand="ATANY" tag="SHOP OWNER" sections={sections} open={open} onClose={() => setOpen(false)} onSignOut={signOut} />
      {open && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
      <div className="main">
        <Topbar title={title} subtitle={subtitle} onMenuToggle={() => setOpen((v) => !v)}
          sidebarCollapsed={sidebarCollapsed} onSidebarToggle={() => setSidebarCollapsed((v) => !v)}
          user={{ initials, name: displayName, role: 'Shop Owner' }} onSignOut={signOut}
          rightExtra={<NotificationBell to="/shop/notifications" apiPath="/shop-owner/notifications" />}
          settingsTo="/shop/profile" />
        <div className="content"><Outlet /></div>
      </div>
    </div>
  );
}
