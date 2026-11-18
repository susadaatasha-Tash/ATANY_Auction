// frontend/src/roles/customer/routes.jsx
// Role-isolated routing — only customer pages. Protected by RequireRole('customer') in App.jsx.
// Maps to customer-dashboard.html sections: dashboard/auctions/bids/watchlist/purchases/account
// Canonical customer browsing is Auctions (Live+Scheduled, branch-scoped); /live is compatibility alias.
import { Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Auctions from './pages/Auctions';
import LiveAuctions from './pages/LiveAuctions';
import MyBids from './pages/MyBids';
import Favorites from './pages/Favorites';
import Watchlist from './pages/Watchlist';
import PurchaseWorkspace from './pages/PurchaseWorkspace';
import AccountSettings from './pages/AccountSettings';
import Notifications from './pages/Notifications';
import AssistantOrderChat from './pages/AssistantOrderChat';
import BranchLocator from './pages/BranchLocator';
import MessagesPage from '../../shared/components/MessagesPage';

export const customerRoutes = [
  { path: '', element: <Dashboard /> },
  { path: 'auctions', element: <Auctions /> },
  { path: 'live', element: <Navigate to="/customer/auctions" replace /> },
  { path: 'bids', element: <MyBids /> },
  { path: 'favorites', element: <Favorites /> },
  { path: 'watchlist', element: <Watchlist /> },
  { path: 'branch-locator', element: <BranchLocator /> },
  { path: 'purchases', element: <PurchaseWorkspace /> },
  { path: 'orders/:id', element: <PurchaseWorkspace /> },
  { path: 'orders/:id/invoice', element: <PurchaseWorkspace /> },
  { path: 'orders/:id/payment', element: <PurchaseWorkspace /> },
  { path: 'orders/:id/success', element: <PurchaseWorkspace /> },
  { path: 'messages', element: <MessagesPage role="customer" /> },
  { path: 'notifications', element: <Notifications /> },
  { path: 'assistant/orders/:orderId', element: <AssistantOrderChat /> },
  { path: 'account', element: <AccountSettings /> },
  // Customer Settings was retired. Old bookmarks / deep links land on Profile
  // instead of a 404, so previously shared URLs keep working.
  { path: 'settings', element: <Navigate to="/customer/account" replace /> },
];
