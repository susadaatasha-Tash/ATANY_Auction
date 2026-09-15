// frontend/src/roles/customer/routes.jsx
// Role-isolated routing — only customer pages. Protected by RequireRole('customer') in App.jsx.
// Maps to customer-dashboard.html sections: dashboard/live/bids/watchlist/purchases/account
import Dashboard from './pages/Dashboard';
import LiveAuctions from './pages/LiveAuctions';
import MyBids from './pages/MyBids';
import Watchlist from './pages/Watchlist';
import MyPurchases from './pages/MyPurchases';
import OrderDetails from './pages/OrderDetails';
import CompletePayment from './pages/CompletePayment';
import PaymentSuccess from './pages/PaymentSuccess';
import AccountSettings from './pages/AccountSettings';
import Notifications from './pages/Notifications';
import MessagesPage from '../../shared/components/MessagesPage';

export const customerRoutes = [
  { path: '', element: <Dashboard /> },
  { path: 'live', element: <LiveAuctions /> },
  { path: 'bids', element: <MyBids /> },
  { path: 'watchlist', element: <Watchlist /> },
  { path: 'purchases', element: <MyPurchases /> },
  { path: 'orders/:id', element: <OrderDetails /> },
  { path: 'orders/:id/payment', element: <CompletePayment /> },
  { path: 'orders/:id/success', element: <PaymentSuccess /> },
  { path: 'messages', element: <MessagesPage role="customer" /> },
  { path: 'notifications', element: <Notifications /> },
  { path: 'account', element: <AccountSettings /> },
];
