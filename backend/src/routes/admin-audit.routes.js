import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { listAuditLogs } from '../controllers/admin/audit.controller.js';

const router = Router();

router.get('/', requireAuth, requireRole(['admin']), listAuditLogs);

export default router;
