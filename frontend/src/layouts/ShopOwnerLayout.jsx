// frontend/src/layouts/ShopOwnerLayout.jsx
// Shell for shop owner — premium sidebar + topbar + assistant
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '../shared/components/Sidebar';
import { Topbar } from '../shared/components/Topbar';
import { NotificationBell } from '../shared/components/NotificationBell';
import { AssistantWidget } from '../shared/components/AssistantWidget';
import { useAuth } from '../shared/hooks/useAuth';

const sections = [
  { label: 'OVERVIEW', items: [{ to: '/shop', name: 'Dashboard', end: true }] },
  { label: 'INVENTORY', items: [
    { to: '/shop/listings', name: 'My Listings' },
    { to: '/shop/auctions', name: 'My Auctions' },
  ]},
  { label: 'EARNINGS', items: [
    { to: '/shop/sales', name: 'Sales & Payouts' },
    { to: '/shop/billing', name: 'Billing & Maintenance' },
  ]},
  { label: 'SETTINGS', items: [{ to: '/shop/profile', name: 'Shop Profile' }] },
];

const titles = {
  '/shop': ['Dashboard', 'Your listings, auctions, and earnings at a glance.'],
  '/shop/listings': ['My Listings', 'Items awaiting review or live.'],
  '/shop/auctions': ['My Auctions', 'Create and manage your auctions.'],
  '/shop/sales': ['Sales & Payouts', 'Completed orders and payout status.'],
  '/shop/billing': ['Billing & Maintenance', 'Platform maintenance fees and billing.'],
  '/shop/messages': ['Messages', 'Communicate with customers.'],
  '/shop/notifications': ['Notifications', 'Updates on your listings, auctions, payouts.'],
  '/shop/profile': ['Shop Profile', 'Manage shop details and payout method.'],
};

function getUserInitials(email) {
  if (!email) return 'SO';
  const parts = email.split('@')[0].split(/[._-]/);
  return parts.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
}

export default function ShopOwnerLayout() {
  const [open, setOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const [title, subtitle] = titles[pathname] || titles['/shop'];
  const initials = getUserInitials(user?.email);

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar brand="ATANY" tag="SELLER" sections={sections} open={open} onClose={() => setOpen(false)} />
      {open && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
      <div className="main">
        <Topbar title={title} subtitle={subtitle} onMenuToggle={() => setOpen((v) => !v)}
          sidebarCollapsed={sidebarCollapsed} onSidebarToggle={() => setSidebarCollapsed((v) => !v)}
          user={{ initials, name: user?.email || 'Shop Owner', role: 'Seller' }} onSignOut={signOut}
          rightExtra={<NotificationBell to="/shop/notifications" apiPath="/shop-owner/notifications" />}
          settingsTo="/shop/profile" />
        <div className="content"><Outlet /></div>
      </div>
      <AssistantWidget mode="seller" userId={user?.id} />
    </div>
  );
}
