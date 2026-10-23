import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import {
  listMyBilling,
  getMySubscription,
  listAllBilling,
  createBillingRecord,
  getMyBillingOne,
  createMaintenanceCheckout,
  checkoutSubscriptionPlan,
  previewSubscriptionChange,
  confirmSubscriptionChange,
  cancelSubscriptionChange,
  listMyPaymentMethods,
  attachMyPaymentMethod,
  setDefaultMyPaymentMethod,
  deleteMyPaymentMethod,
  adminRetryBilling,
  listSubscriptionPlans,
  listSubscriptionPaymentMethods,
  saveSubscriptionPaymentMethod,
} from '../controllers/billing.controller.js';

const router = Router();

// Plan catalog (backend source of truth) — authenticated users only
router.get('/plans', requireAuth, listSubscriptionPlans);

// Seller — own subscription/billing only
router.get('/me/subscription', requireAuth, requireRole('shop_owner'), getMySubscription);
router.get('/me', requireAuth, requireRole('shop_owner'), listMyBilling);
router.get('/me/:id', requireAuth, requireRole('shop_owner'), getMyBillingOne);

// Seller selects plan by plan_code (price resolved server-side) — new subscriptions
router.post(
  '/subscription/checkout',
  requireAuth,
  requireRole('shop_owner'),
  checkoutSubscriptionPlan
);

// Plan change — preview / confirm / cancel scheduled downgrade
router.post(
  '/subscription/change/preview',
  requireAuth,
  requireRole('shop_owner'),
  previewSubscriptionChange
);
router.post(
  '/subscription/change/confirm',
  requireAuth,
  requireRole('shop_owner'),
  confirmSubscriptionChange
);
router.post(
  '/subscription/change/cancel',
  requireAuth,
  requireRole('shop_owner'),
  cancelSubscriptionChange
);
router.delete(
  '/subscription/change/scheduled',
  requireAuth,
  requireRole('shop_owner'),
  cancelSubscriptionChange
);

// Payment methods — seller owns methods; never accept raw card data
router.get('/payment-methods', requireAuth, requireRole('shop_owner'), listMyPaymentMethods);
router.post('/payment-methods/attach', requireAuth, requireRole('shop_owner'), attachMyPaymentMethod);
router.patch(
  '/payment-methods/:id/default',
  requireAuth,
  requireRole('shop_owner'),
  setDefaultMyPaymentMethod
);
router.delete('/payment-methods/:id', requireAuth, requireRole('shop_owner'), deleteMyPaymentMethod);

// Subscription payment method flow — QR Ph / Card / GCash / Maya only.
// A suspended seller is blocked (403 ACCOUNT_SUSPENDED); a customer or an
// unauthenticated caller never reaches the controller.
router.get(
  '/subscription/payment-methods',
  requireAuth,
  requireRole('shop_owner'),
  requireActiveAccount(),
  listSubscriptionPaymentMethods
);
router.post(
  '/subscription/payment-method',
  requireAuth,
  requireRole('shop_owner'),
  requireActiveAccount(),
  saveSubscriptionPaymentMethod
);

// Seller pays/retries own billing record
router.post('/:id/checkout', requireAuth, requireRole('shop_owner'), createMaintenanceCheckout);

// Admin — same billing_records source of truth
router.get('/', requireAuth, requireRole(['admin']), listAllBilling);
router.post('/', requireAuth, requireRole(['admin']), createBillingRecord);
router.post('/:id/retry', requireAuth, requireRole(['admin']), adminRetryBilling);

export default router;
