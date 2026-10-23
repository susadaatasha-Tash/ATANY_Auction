// frontend/src/layouts/AdminLayout.jsx
// Shell for admin — premium sidebar + topbar with live badges
import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '../shared/components/Sidebar';
import { Topbar } from '../shared/components/Topbar';
import { NotificationBell } from '../shared/components/NotificationBell';
import {
  LayoutDashboard,
  Store,
  Users,
  UserCog,
  ShoppingBag,
  CreditCard,
  BarChart3,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../shared/hooks/useAuth';

const sections = [
  { label: 'OVERVIEW', items: [{ to: '/admin', name: 'Dashboard', end: true, icon: <LayoutDashboard size={15} /> }] },
  { label: 'BRANCH OPERATIONS', items: [
    { to: '/admin/branches', name: 'Branches', icon: <Store size={15} />, matchPrefixes: ['/admin/branches'] },
    { to: '/admin/users', name: 'Users & Roles', icon: <Users size={15} />, matchPrefixes: ['/admin/users'] },
    { to: '/admin/transactions', name: 'Orders', icon: <ShoppingBag size={15} />, matchPrefixes: ['/admin/transactions', '/admin/orders'] },
  ]},
  { label: 'PLATFORM MANAGEMENT', items: [
    { to: '/admin/billing', name: 'Subscriptions', icon: <CreditCard size={15} />, matchPrefixes: ['/admin/billing'] },
    { to: '/admin/analytics', name: 'Reports', icon: <BarChart3 size={15} />, matchPrefixes: ['/admin/analytics'] },
    { to: '/admin/security', name: 'Security Alerts', icon: <ShieldAlert size={15} />, matchPrefixes: ['/admin/security'] },
  ]},
];

const titles = {
  '/admin': ['Dashboard'],
  '/admin/users': ['Users & Roles'],
  '/admin/transactions': ['Orders'],
  '/admin/orders': ['Orders'],
  '/admin/analytics': ['Reports'],
  '/admin/security': ['Security Alerts'],
  '/admin/notifications': ['Notifications'],
  '/admin/branches': ['Branches'],
  '/admin/billing': ['Subscriptions'],
};

// One-line context under the page title (Admin portal only).
const subtitles = {
  '/admin/transactions': 'Manage and monitor all customer orders and transactions across branches.',
  '/admin/orders': 'Manage and monitor all customer orders and transactions across branches.',
  '/admin/security': 'Monitor and review suspicious activities, security events, and account risks across the platform.',
};

function getUserInitials(name, email) {
  const src = name || email || '';
  if (!src) return 'AU';
  if (src.includes('@')) {
    const parts = src.split('@')[0].split(/[._-]/);
    return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
  }
  const parts = src.trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
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

const COLLAPSED_KEY = 'atany_admin_sidebar_collapsed';

export default function AdminLayout() {
  const [open, setOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const title = titles[pathname]?.[0]
    || (pathname.startsWith('/admin/branches') ? 'Branches' : titles['/admin'][0]);
  const subtitle = subtitles[pathname] || null;
  const displayName = getDisplayName(user);
  const initials = getUserInitials(displayName, user?.email);
  // Subscriptions page owns its flat portal header (search + platform pill)
  const isBilling = pathname === '/admin/billing';

  // Restore saved collapsed state (role-scoped; never leaks to other roles).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_KEY);
      if (stored !== null) setSidebarCollapsed(JSON.parse(stored) === true);
    } catch {}
  }, []);

  const persistCollapsed = useCallback((next) => {
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  return (
    <div className={`app admin-app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar
        brand="ATANY"
        tag="ADMIN"
        sections={sections}
        open={open}
        onClose={() => setOpen(false)}
        onSignOut={signOut}
        collapsed={sidebarCollapsed}
      />
      {open && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
      <div className="main">
        {!isBilling && (
          <Topbar
            title={title}
            subtitle={subtitle}
            role="admin"
            onMenuToggle={() => setOpen((v) => !v)}
            sidebarCollapsed={sidebarCollapsed}
            onSidebarToggle={() => persistCollapsed((v) => !v)}
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
