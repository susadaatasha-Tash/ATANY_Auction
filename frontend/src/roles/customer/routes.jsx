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
import MyPurchases from './pages/MyPurchases';
import OrderDetails from './pages/OrderDetails';
import CompletePayment from './pages/CompletePayment';
import PaymentSuccess from './pages/PaymentSuccess';
import Profile from './pages/Profile';
import Notifications from './pages/Notifications';
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
  { path: 'purchases', element: <MyPurchases /> },
  { path: 'orders/:id', element: <OrderDetails /> },
  { path: 'orders/:id/payment', element: <CompletePayment /> },
  { path: 'orders/:id/success', element: <PaymentSuccess /> },
  { path: 'messages', element: <MessagesPage role="customer" /> },
  { path: 'notifications', element: <Notifications /> },
  { path: 'account', element: <Profile /> },
  // The customer Settings page was removed (its content moved to Profile).
  // Old bookmarks/deep links redirect to Profile instead of 404ing.
  { path: 'settings', element: <Navigate to="/customer/account" replace /> },
];
