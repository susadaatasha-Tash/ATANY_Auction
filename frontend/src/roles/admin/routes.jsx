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
import SellerApplications from './pages/SellerApplications';
import AuditLogs from './pages/AuditLogs';
import Notifications from './pages/Notifications';
import ChatbotLogs from './pages/ChatbotLogs';
import AdminBilling from './pages/Billing';

export const adminRoutes = [
  { path: '', element: <Dashboard /> },
  { path: 'products', element: <Products /> },
  { path: 'products/:id', element: <JewelryDetails /> },
  { path: 'auctions', element: <Auctions /> },
  { path: 'auctions/:id', element: <AuctionDetails /> },
  { path: 'users', element: <Users /> },
  { path: 'seller-applications', element: <SellerApplications /> },
  { path: 'transactions', element: <Transactions /> },
  { path: 'billing', element: <AdminBilling /> },
  { path: 'analytics', element: <Analytics /> },
  { path: 'security', element: <SecurityAlerts /> },
  { path: 'branches', element: <AdminBranches /> },
  { path: 'audit-logs', element: <AuditLogs /> },
  { path: 'notifications', element: <Notifications /> },
  { path: 'chatbot', element: <ChatbotLogs /> },
];
