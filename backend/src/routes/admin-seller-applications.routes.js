import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { listApplications, getApplication, approveApplication, rejectApplication } from '../controllers/seller-application.controller.js';

const router = Router();

router.get('/', requireAuth, requireRole(['admin']), listApplications);
router.get('/:id', requireAuth, requireRole(['admin']), getApplication);
router.post('/:id/approve', requireAuth, requireRole(['admin']), approveApplication);
router.post('/:id/reject', requireAuth, requireRole(['admin']), rejectApplication);

export default router;
