// backend/src/routes/auth.routes.js
// Spec 3: single users table with role enum; auth via Supabase Auth + Resend emails
import { Router } from 'express';
import { signup, login, logout, syncUser, getMe } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();
// signup uses supabase.auth.admin.createUser — admin-only, never public
router.post('/signup', requireAuth, requireRole(['admin']), signup);
router.post('/login', login);
router.post('/logout', logout);
router.get('/me', requireAuth, getMe);
// sync-user: public fallback for frontend RLS insert failures, but rejects role escalation
router.post('/sync-user', syncUser);
export default router;
