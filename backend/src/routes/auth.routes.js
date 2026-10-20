// backend/src/routes/auth.routes.js
// Spec 3: single users table with role enum; auth via Supabase Auth + Resend emails
import { Router } from 'express';
import { signup, login, logout, syncUser, getMe } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();
// signup uses supabase.auth.admin.createUser — admin-only, never public
router.post('/signup', requireAuth, requireRole(['admin']), rateLimit({ name: 'auth-signup', windowMs: 60_000, max: 10 }), signup);
// Credential stuffing protection — public high-risk endpoint
router.post('/login', rateLimit({ name: 'auth-login', windowMs: 60_000, max: 10 }), login);
router.post('/logout', rateLimit({ name: 'auth-logout', windowMs: 60_000, max: 30 }), logout);
router.get('/me', requireAuth, rateLimit({ name: 'auth-me', windowMs: 60_000, max: 60 }), getMe);
// sync-user: authenticated customer-only profile sync (C3) — never privileged roles
router.post('/sync-user', requireAuth, rateLimit({ name: 'auth-sync-user', windowMs: 60_000, max: 20 }), syncUser);
export default router;
