// backend/src/controllers/support.controller.js
// ─────────────────────────────────────────────────────────────────────────────
// Authenticated ATANY support — the endpoint that EVERY signed-in role uses.
//
// Why a separate, narrowly scoped endpoint exists:
//   • /shop-owner is mounted behind requireActiveAccount(), so a SUSPENDED
//     Shop Owner could not reach anything underneath it.
//   • A suspended account MUST still be able to contact support — that is the
//     documented, intended path.
//   • Therefore this route is mounted at the app level with requireAuth +
//     requireRole(['customer','shop_owner']) and NO active-account guard.
//
// Security:
//   • The requester's id, name, email and role are resolved from the DATABASE
//     row of the authenticated session — never from the request body. A client
//     cannot file a request under someone else's identity.
//   • Only category / subject / message / attachment metadata are accepted
//     from the client.
//   • This endpoint grants NO access to any other protected functionality.
import { pool } from '../db/pool.js';
import {
  validateSupportRequest,
  sendSupportNotification,
  sanitizeMetadata,
  SUPPORT_SOURCES,
  resolveSupportEmail,
} from '../services/supportService.js';
import { createSupportAttachmentUploadUrl } from '../services/storageService.js';

const MAX_MESSAGE = 5000;

/**
 * Resolve the caller's identity from the database (authoritative).
 */
async function resolveIdentity(userId) {
  const { rows } = await pool.query(
    'SELECT id, name, email, role, status, suspension_reason FROM public.users WHERE id = $1',
    [userId]
  );
  return rows[0] || null;
}

/**
 * POST /support/account — authenticated support request (customer + shop owner).
 * Suspended accounts ARE allowed: contacting support is the point.
 */
export const submitAccountSupportRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Authentication required' });

    const account = await resolveIdentity(userId);
    if (!account) return res.status(404).json({ message: 'Account not found' });

    // Only these fields come from the client. user_id / name / email / role
    // always come from the authenticated database record.
    const {
      category,
      subject,
      message,
      metadata,
      attachment,
    } = req.body || {};

    const invalid = validateSupportRequest({
      name: account.name,
      email: account.email,
      subject,
      category,
      message,
      attachment,
    });
    if (invalid) return res.status(400).json(invalid);

    const source =
      account.role === 'shop_owner' ? SUPPORT_SOURCES.SELLER : SUPPORT_SOURCES.ACCOUNT;

    const result = await sendSupportNotification({
      source,
      requesterName: account.name,
      requesterEmail: account.email,
      requesterRole: account.role,
      requesterUserId: account.id,
      subject: typeof subject === 'string' ? subject : '',
      category: typeof category === 'string' ? category : 'General Inquiry',
      message,
      attachment: attachment && attachment.path ? attachment : null,
      metadata: sanitizeMetadata(metadata),
    });

    res.status(201).json({
      success: true,
      request: {
        id: result.id,
        reference: result.reference,
        status: result.status,
      },
      email_notification: {
        sent: result.emailNotification.sent,
        ...(result.emailNotification.reason ? { reason: result.emailNotification.reason } : {}),
      },
    });
  } catch (e) {
    console.error('[support] submitAccountSupportRequest failed:', e.message);
    res.status(500).json({ message: 'Unable to send your support request. Please try again.' });
  }
};

/**
 * POST /support/attachment-url — signed upload URL for a support attachment.
 * Images only (JPG/JPEG/PNG/WebP), 5 MB max, private bucket.
 */
export const supportAttachmentUploadUrl = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Authentication required' });
    const { filename } = req.body || {};
    const data = await createSupportAttachmentUploadUrl(filename);
    res.json(data);
  } catch (e) {
    console.error('[support] attachment upload url failed:', e.message);
    res.status(400).json({ message: e.message || 'Could not create an upload URL.' });
  }
};

/**
 * GET /support/contact — the official support destination for display.
 * Returns ONLY the public address (never a credential).
 */
export const supportContactInfo = async (_req, res) => {
  res.json({
    email: resolveSupportEmail(),
    response_time: null,
  });
};

export { MAX_MESSAGE };
