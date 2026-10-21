// backend/src/controllers/customer/support.controller.js
// Authenticated customer support request.
//
// Identity is derived from the verified session (never from the request body),
// so a customer cannot file a request under someone else's name or email.
// The support_requests row is the authoritative record.
import { validateSupportRequest, createSupportRequest } from '../../services/supportService.js';
import { pool } from '../../db/pool.js';

export const submitSupportRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Authentication required' });

    // Server-side identity for the authenticated customer.
    const { rows: users } = await pool.query('SELECT name, email FROM users WHERE id=$1', [userId]);
    const account = users[0];
    if (!account) return res.status(404).json({ message: 'Account not found' });

    // A suspended account may still contact support (that is the documented
    // path) — so there is no status gate here on purpose.
    const { subject, message } = req.body || {};
    const invalid = validateSupportRequest({
      name: account.name,
      email: account.email,
      subject,
      message,
    });
    if (invalid) return res.status(400).json(invalid);

    const result = await createSupportRequest({
      name: account.name,
      email: account.email,
      subject,
      message,
    });
    res.status(201).json(result);
  } catch (e) {
    console.error('submitSupportRequest failed:', e.message);
    res.status(500).json({ message: 'Failed to send message' });
  }
};
