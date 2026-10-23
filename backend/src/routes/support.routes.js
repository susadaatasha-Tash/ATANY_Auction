// backend/src/routes/support.routes.js
// ─────────────────────────────────────────────────────────────────────────────
// Narrowly scoped ATANY support routes.
//
// Mounted in index.js as:
//   app.use('/support', requireAuth, requireRole(['customer','shop_owner']), supportRoutes)
//
// There is deliberately NO requireActiveAccount() here — a SUSPENDED account
// must still be able to contact support. No other protected functionality is
// reachable from these routes.
import { Router } from 'express';
import {
  submitAccountSupportRequest,
  supportAttachmentUploadUrl,
  supportContactInfo,
} from '../controllers/support.controller.js';

const router = Router();

// The official support destination (public address only — no credentials).
router.get('/contact', supportContactInfo);
// Authenticated support request — customer + shop owner (suspended allowed).
router.post('/account', submitAccountSupportRequest);
// Signed upload URL for a private support attachment.
router.post('/attachment-url', supportAttachmentUploadUrl);

export default router;
