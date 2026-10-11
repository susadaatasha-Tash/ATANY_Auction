// frontend/src/layouts/AdminLayout.jsx
// Shell for admin — premium sidebar + topbar with live badges
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '../shared/components/Sidebar';
import { Topbar } from '../shared/components/Topbar';
import { NotificationBell } from '../shared/components/NotificationBell';
import { useAuth } from '../shared/hooks/useAuth';

const sections = [
  { label: 'OVERVIEW', items: [{ to: '/admin', name: 'Dashboard', end: true }] },
  { label: 'BRANCH OPERATIONS', items: [
    { to: '/admin/branches', name: 'Branches' },
    { to: '/admin/users', name: 'Users & Roles' },
    { to: '/admin/transactions', name: 'Orders' },
  ]},
  { label: 'INVENTORY & AUCTIONS', items: [
    { to: '/admin/products', name: 'Jewelry' },
    { to: '/admin/auctions', name: 'Auctions' },
  ]},
  { label: 'PLATFORM MANAGEMENT', items: [
    { to: '/admin/billing', name: 'Subscriptions' },
    { to: '/admin/analytics', name: 'Reports' },
    { to: '/admin/security', name: 'Security Alerts' },
  ]},
];

const titles = {
  '/admin': ['Dashboard'],
  '/admin/products': ['Jewelry'],
  '/admin/auctions': ['Auctions'],
  '/admin/users': ['Users & Roles'],
  '/admin/transactions': ['Orders'],
  '/admin/analytics': ['Reports'],
  '/admin/security': ['Security Alerts'],
  '/admin/notifications': ['Notifications'],
  '/admin/branches': ['Branches'],
  '/admin/billing': ['Subscriptions'],
};

function getUserInitials(name, email) {
  const src = name || email || '';
  if (!src) return 'AU';
  if (src.includes('@')) {
    const parts = src.split('@')[0].split(/[._-]/);
    return parts.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
  }
  const parts = src.trim().split(/\s+/);
  return parts.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
}

function getDisplayName(user) {
  if (!user) return 'Admin';
  return user.user_metadata?.displayName
    || user.user_metadata?.fullName
    || user.user_metadata?.name
    || [user.user_metadata?.firstName, user.user_metadata?.lastName].filter(Boolean).join(' ')
    || user.email?.split('@')[0]?.replace(/[._-]/g, ' ')
    || user.email
    || 'Admin';
}

export default function AdminLayout() {
  const [open, setOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const title = titles[pathname]?.[0] || titles['/admin'][0];
  const displayName = getDisplayName(user);
  const initials = getUserInitials(displayName, user?.email);
  // Subscriptions page owns its flat portal header (search + platform pill)
  const isBilling = pathname === '/admin/billing';

  return (
    <div className={`app admin-app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar brand="ATANY" tag="ADMIN" sections={sections} open={open} onClose={() => setOpen(false)} onSignOut={signOut} />
      {open && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
      <div className="main">
        {!isBilling && (
          <Topbar
            title={title}
            role="admin"
            onMenuToggle={() => setOpen((v) => !v)}
            sidebarCollapsed={sidebarCollapsed}
            onSidebarToggle={() => setSidebarCollapsed((v) => !v)}
            user={{ initials, name: displayName, role: 'Administrator' }}
            onSignOut={signOut}
            rightExtra={<NotificationBell to="/admin/notifications" apiPath="/admin/notifications/history" />}
            settingsTo="/admin"
          />
        )}
        <div className={`content${isBilling ? ' content-billing' : ''}`}><Outlet /></div>
      </div>
    </div>
  );
}
