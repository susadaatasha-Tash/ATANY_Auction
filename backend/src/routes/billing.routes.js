import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { listMyBilling, listAllBilling, createBillingRecord, getMyBillingOne, createMaintenanceCheckout } from '../controllers/billing.controller.js';

const router = Router();

// Seller views their own billing
router.get('/me', requireAuth, requireRole('shop_owner'), listMyBilling);
router.get('/me/:id', requireAuth, requireRole('shop_owner'), getMyBillingOne);
router.post('/:id/checkout', requireAuth, requireRole('shop_owner'), createMaintenanceCheckout);

// Admin views all billing
router.get('/', requireAuth, requireRole(['admin']), listAllBilling);
router.post('/', requireAuth, requireRole(['admin']), createBillingRecord);

export default router;
