// frontend/src/roles/admin/routes.jsx
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Auctions from './pages/Auctions';
import AuctionDetails from './pages/AuctionDetails';
import JewelryDetails from './pages/JewelryDetails';
import Users from './pages/Users';
import Transactions from './pages/Transactions';
import Analytics from './pages/Analytics';
import SecurityAlerts from './pages/SecurityAlerts';
import AdminBranches from './pages/Branches';
import AdminBilling from './pages/Billing';
import Notifications from './pages/Notifications';

export const adminRoutes = [
  { path: '', element: <Dashboard /> },
  { path: 'products', element: <Products /> },
  { path: 'products/:id', element: <JewelryDetails /> },
  { path: 'auctions', element: <Auctions /> },
  { path: 'auctions/:id', element: <AuctionDetails /> },
  { path: 'users', element: <Users /> },
  { path: 'transactions', element: <Transactions /> },
  { path: 'billing', element: <AdminBilling /> },
  { path: 'analytics', element: <Analytics /> },
  { path: 'security', element: <SecurityAlerts /> },
  { path: 'branches', element: <AdminBranches /> },
  { path: 'notifications', element: <Notifications /> },
];
