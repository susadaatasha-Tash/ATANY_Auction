// frontend/src/App.jsx
// Role-based routing — redirects to layout after login per spec.
// Guards mirror backend requireRole middleware: customer token can't hit /admin etc.
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, RequireRole } from './shared/hooks/useAuth';
import { ToastProvider } from './shared/components/Toast';
import { ErrorBoundary } from './shared/components/ErrorBoundary';
import CustomerLayout from './layouts/CustomerLayout';
import ShopOwnerLayout from './layouts/ShopOwnerLayout';
import AdminLayout from './layouts/AdminLayout';
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import Signup from './pages/Signup';
import SelectBranch from './pages/SelectBranch';
import SellerApplication from './pages/SellerApplication';
import BranchLocator from './roles/customer/pages/BranchLocator';
import { customerRoutes } from './roles/customer/routes';
import { shopOwnerRoutes } from './roles/shop-owner/routes';
import { adminRoutes } from './roles/admin/routes';

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <ErrorBoundary>
          <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/branches" element={<BranchLocator />} />
            <Route path="/seller-application" element={<SellerApplication />} />
            <Route path="/select-branch" element={<RequireRole role="customer"><SelectBranch /></RequireRole>} />
            {/* Customer */}
            <Route path="/customer" element={<RequireRole role="customer"><CustomerLayout /></RequireRole>}>
              {customerRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
            </Route>
            {/* Shop Owner */}
            <Route path="/shop" element={<RequireRole role="shop_owner"><ShopOwnerLayout /></RequireRole>}>
              {shopOwnerRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
            </Route>
            {/* Admin */}
            <Route path="/admin" element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
              {adminRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
            </Route>
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
      </ToastProvider>
    </AuthProvider>
  );
}
