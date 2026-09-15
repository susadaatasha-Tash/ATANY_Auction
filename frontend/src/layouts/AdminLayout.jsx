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
    { to: '/admin/seller-applications', name: 'Seller Applications' },
    { to: '/admin/transactions', name: 'Orders' },
  ]},
  { label: 'PLATFORM MANAGEMENT', items: [
    { to: '/admin/billing', name: 'Billing & Maintenance' },
    { to: '/admin/analytics', name: 'Reports' },
  ]},
];

const titles = {
  '/admin': ['Dashboard', 'Multi-branch overview — branches, sellers, customers, and orders.'],
  '/admin/products': ['Jewelry', 'Add, edit, and track inventory.'],
  '/admin/auctions': ['Auctions', 'Monitor live, scheduled, and closed auctions.'],
  '/admin/users': ['Users & Roles', 'Manage customer and admin accounts.'],
  '/admin/seller-applications': ['Seller Applications', 'Review and approve seller applications.'],
  '/admin/transactions': ['Orders', 'Track payments, refunds, pickups.'],
  '/admin/analytics': ['Reports', 'Sales performance + CSV export.'],
  '/admin/security': ['Security Alerts', 'Suspicious activity flagged for review.'],
  '/admin/audit-logs': ['Audit Logs', 'System action history and records.'],
  '/admin/notifications': ['Notifications', 'Send and review updates.'],
  '/admin/chatbot': ['Chatbot Logs', 'Sessions handled by the assistant.'],
  '/admin/branches': ['Branches', 'Manage branches shown on locator.'],
  '/admin/billing': ['Billing & Maintenance', 'Seller platform fees and payment tracking.'],
};

function getUserInitials(email) {
  if (!email) return 'AU';
  const parts = email.split('@')[0].split(/[._-]/);
  return parts.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
}

export default function AdminLayout() {
  const [open, setOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const [title, subtitle] = titles[pathname] || titles['/admin'];
  const initials = getUserInitials(user?.email);

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar brand="ATANY" tag="ADMIN" sections={sections} open={open} onClose={() => setOpen(false)} />
      {open && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
      <div className="main">
        <Topbar title={title} subtitle={subtitle} onMenuToggle={() => setOpen((v) => !v)}
          sidebarCollapsed={sidebarCollapsed} onSidebarToggle={() => setSidebarCollapsed((v) => !v)}
          user={{ initials, name: user?.email || 'Admin', role: 'Administrator' }} onSignOut={signOut}
          rightExtra={<NotificationBell to="/admin/notifications" apiPath="/admin/notifications/history" />}
          settingsTo="/admin" />
        <div className="content"><Outlet /></div>
      </div>
    </div>
  );
}
