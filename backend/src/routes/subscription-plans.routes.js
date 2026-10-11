import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { listSubscriptionPlans } from '../controllers/billing.controller.js';

const router = Router();

// GET /subscription-plans — public catalog for any authenticated portal user
router.get('/', requireAuth, listSubscriptionPlans);

export default router;
