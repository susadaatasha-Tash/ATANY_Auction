// frontend/src/roles/admin/routes.jsx
// Admin route table.
//
// Jewelry and Auctions are no longer standalone admin destinations: they are
// reached through Branches → selected branch → Jewelry / Auctions (see
// BranchDetails.jsx). The old URLs still resolve — they redirect to
// /admin/branches so old bookmarks keep working and the admin portal does
// not expose duplicate navigation. The underlying page components are kept
// in the codebase (pages/Products.jsx, pages/Auctions.jsx, …) for reuse.
import { Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Orders from './pages/Orders';
import Analytics from './pages/Analytics';
import SecurityAlerts from './pages/SecurityAlerts';
import AdminBranches from './pages/Branches';
import BranchDetails from './pages/BranchDetails';
import AdminBilling from './pages/Billing';
import Notifications from './pages/Notifications';

export const adminRoutes = [
  { path: '', element: <Dashboard /> },
  // Branch-centric monitoring: list + detail (tab state lives in the query
  // string so /admin/branches/:branchId?tab=jewelry survives a refresh).
  { path: 'branches', element: <AdminBranches /> },
  { path: 'branches/:branchId', element: <BranchDetails /> },
  // Legacy standalone jewelry / auctions URLs → Branches.
  { path: 'products', element: <Navigate to="/admin/branches" replace /> },
  { path: 'products/:id', element: <Navigate to="/admin/branches" replace /> },
  { path: 'jewelry', element: <Navigate to="/admin/branches" replace /> },
  { path: 'auctions', element: <Navigate to="/admin/branches" replace /> },
  { path: 'auctions/:id', element: <Navigate to="/admin/branches" replace /> },
  { path: 'users', element: <Users /> },
  // Orders (monitoring) — the sidebar link stays /admin/transactions;
  // /admin/orders is the same screen so both URLs work.
  { path: 'transactions', element: <Orders /> },
  { path: 'orders', element: <Orders /> },
  { path: 'billing', element: <AdminBilling /> },
  { path: 'analytics', element: <Analytics /> },
  { path: 'security', element: <SecurityAlerts /> },
  { path: 'notifications', element: <Notifications /> },
];
