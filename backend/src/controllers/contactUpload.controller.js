// backend/src/controllers/contactUpload.controller.js
//
// Issues a short-lived signed upload URL for ONE optional image that can be
// attached to a public Contact Us or Customer Help & Support message.
//
// Flow: browser asks here → gets a signed URL → PUTs the file straight to
// Supabase Storage → submits the form with the returned object `path`.
//
// The bytes never pass through this server, and the bucket stays private; the
// notification email later carries a time-limited SIGNED link, never a
// permanent public URL.
import { createSupportUploadUrl } from '../services/storageService.js';

/** Public (guest) attachment upload. */
export const createPublicContactUpload = async (req, res) => {
  try {
    const { signedUrl, path } = await createSupportUploadUrl({
      filename: req.body?.filename,
      contentType: req.body?.content_type,
      size: req.body?.size,
      scope: 'guest',
    });
    res.json({ signedUrl, path });
  } catch (e) {
    // Validation failures are user-facing and already phrased for the customer.
    const isValidation = /allowed|smaller/i.test(e?.message || '');
    if (isValidation) return res.status(400).json({ message: e.message });
    console.error('[contact/upload] guest upload url failed:', e?.message || e);
    res.status(503).json({ message: 'We could not prepare the image upload. Please try again.' });
  }
};

/**
 * Authenticated customer attachment upload.
 * Identity comes from the session (namespaces the object path) — never from
 * the request body.
 */
export const createCustomerSupportUpload = async (req, res) => {
  try {
    const { signedUrl, path } = await createSupportUploadUrl({
      filename: req.body?.filename,
      contentType: req.body?.content_type,
      size: req.body?.size,
      scope: `user-${req.user.id}`,
    });
    res.json({ signedUrl, path });
  } catch (e) {
    const isValidation = /allowed|smaller/i.test(e?.message || '');
    if (isValidation) return res.status(400).json({ message: e.message });
    console.error('[contact/upload] customer upload url failed:', e?.message || e);
    res.status(503).json({ message: 'We could not prepare the image upload. Please try again.' });
  }
};
