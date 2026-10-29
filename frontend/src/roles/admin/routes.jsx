// frontend/src/roles/admin/routes.jsx
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Transactions from './pages/Transactions';
import Analytics from './pages/Analytics';
import SecurityAlerts from './pages/SecurityAlerts';
import AdminBranches from './pages/Branches';
import AdminBilling from './pages/Billing';
import Notifications from './pages/Notifications';
import BranchDetails from './pages/BranchDetails';
import { Navigate } from 'react-router-dom';

export const adminRoutes = [
  { path: '', element: <Dashboard /> },
  { path: 'branches/:branchId', element: <BranchDetails /> },
  // Jewelry + Auctions are now reached through Branches → selected branch.
  // The old standalone URLs redirect so bookmarks keep working, and their page
  // components (Products / JewelryDetails / Auctions / AuctionDetails) stay in
  // the codebase — only the navigation entry points were removed.
  { path: 'jewelry', element: <Navigate to="/admin/branches" replace /> },
  { path: 'products', element: <Navigate to="/admin/branches" replace /> },
  { path: 'products/:id', element: <Navigate to="/admin/branches" replace /> },
  { path: 'auctions', element: <Navigate to="/admin/branches" replace /> },
  { path: 'auctions/:id', element: <Navigate to="/admin/branches" replace /> },
  { path: 'users', element: <Users /> },
  { path: 'transactions', element: <Transactions /> },
  { path: 'billing', element: <AdminBilling /> },
  { path: 'analytics', element: <Analytics /> },
  { path: 'security', element: <SecurityAlerts /> },
  { path: 'branches', element: <AdminBranches /> },
  { path: 'notifications', element: <Notifications /> },
];
