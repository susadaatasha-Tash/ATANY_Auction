// frontend/src/roles/admin/routes.jsx
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Orders from './pages/Orders';
import PaymentReconciliations from './pages/PaymentReconciliations';
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
  // The Orders page lives at /admin/orders and consumes the existing
  // GET /admin/transactions endpoint. /admin/transactions redirects here so
  // existing links/bookmarks keep working.
  { path: 'transactions', element: <Navigate to="/admin/orders" replace /> },
  { path: 'orders', element: <Orders /> },
  { path: 'payment-reconciliations', element: <PaymentReconciliations /> },
  { path: 'users', element: <Users /> },
  { path: 'billing', element: <AdminBilling /> },
  { path: 'analytics', element: <Analytics /> },
  { path: 'security', element: <SecurityAlerts /> },
  { path: 'branches', element: <AdminBranches /> },
  { path: 'notifications', element: <Notifications /> },
];
