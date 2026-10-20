import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { createApplication, getMyApplication } from '../controllers/seller-application.controller.js';

const router = Router();

// Authenticated users can submit seller applications
router.post('/', requireAuth, createApplication);
// Authenticated users can view their own application
router.get('/me', requireAuth, getMyApplication);

export default router;
