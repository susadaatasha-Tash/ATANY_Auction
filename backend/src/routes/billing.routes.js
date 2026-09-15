import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { listMyBilling, listAllBilling, createBillingRecord, markBillingPaid } from '../controllers/billing.controller.js';

const router = Router();

// Seller views their own billing
router.get('/me', requireAuth, requireRole('shop_owner'), listMyBilling);

// Admin views all billing
router.get('/', requireAuth, requireRole(['admin']), listAllBilling);
router.post('/', requireAuth, requireRole(['admin']), createBillingRecord);
router.patch('/:id/pay', requireAuth, requireRole(['admin']), markBillingPaid);

export default router;
