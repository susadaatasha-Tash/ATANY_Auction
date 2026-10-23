// backend/src/controllers/customer/support.controller.js
// Authenticated customer support request.
//
// Identity is derived from the verified session AND the authoritative database
// row (never from the request body), so a customer cannot file a request under
// someone else's name or email. The support_requests row is the
// authoritative record; the email notification to the official ATANY inbox is
// best-effort and never blocks storage.
import {
  validateSupportRequest,
  sendSupportNotification,
  sanitizeMetadata,
  SUPPORT_SOURCES,
} from '../../services/supportService.js';
import { pool } from '../../db/pool.js';

export const submitSupportRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Authentication required' });

    // Server-side identity for the authenticated customer.
    const { rows: users } = await pool.query(
      'SELECT id, name, email, role FROM users WHERE id=$1',
      [userId]
    );
    const account = users[0];
    if (!account) return res.status(404).json({ message: 'Account not found' });

    // A suspended account may still contact support (that is the documented
    // path) — so there is no status gate here on purpose.
    const { subject, category, message, metadata } = req.body || {};
    // The legacy contract sent the CATEGORY in `subject`; an explicit
    // `category` wins when both are present.
    const resolvedCategory =
      (typeof category === 'string' && category.trim()) ||
      (typeof subject === 'string' && subject.trim()) ||
      'General Inquiry';
    const invalid = validateSupportRequest({
      name: account.name,
      email: account.email,
      subject,
      category: resolvedCategory,
      message,
    });
    if (invalid) return res.status(400).json(invalid);

    const result = await sendSupportNotification({
      source: SUPPORT_SOURCES.CUSTOMER,
      requesterName: account.name,
      requesterEmail: account.email,
      requesterRole: account.role || 'customer',
      requesterUserId: account.id,
      subject: typeof subject === 'string' ? subject : '',
      category: resolvedCategory,
      message,
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
    console.error('submitSupportRequest failed:', e.message);
    res.status(500).json({ message: 'Unable to send your support request. Please try again.' });
  }
};
