// frontend/src/roles/shop-owner/routes.jsx
import Dashboard from './pages/Dashboard';
import MyListings from './pages/MyListings';
import MyAuctions from './pages/MyAuctions';
import SalesPayouts from './pages/SalesPayouts';
import WonLotsOrders from './pages/WonLotsOrders';
import Billing from './pages/Billing';
import BillingSuccess from './pages/BillingSuccess';
import Notifications from './pages/Notifications';
import ShopProfile from './pages/ShopProfile';
import MessagesPage from '../../shared/components/MessagesPage';

export const shopOwnerRoutes = [
  { path: '', element: <Dashboard /> },
  { path: 'listings', element: <MyListings /> },
  { path: 'auctions', element: <MyAuctions /> },
  { path: 'sales', element: <SalesPayouts /> },
  { path: 'orders', element: <WonLotsOrders /> },
  { path: 'billing/success', element: <BillingSuccess /> },
  { path: 'billing', element: <Billing /> },
  { path: 'messages', element: <MessagesPage role="seller" /> },
  { path: 'notifications', element: <Notifications /> },
  { path: 'profile', element: <ShopProfile /> },
];
