// frontend/src/shared/lib/supportAttachment.js
//
// Optional image attachment for Contact Us / Help & Support.
//
// Mirrors the backend rules exactly (backend/src/services/storageService.js) so
// the visitor gets an instant, human-readable message instead of a round-trip
// rejection. The backend still validates independently — this is convenience,
// never the security boundary.
//
// Flow: ask the backend for a short-lived signed upload URL, PUT the file
// straight to Supabase Storage, then submit the returned object `path` with the
// message. Image bytes never pass through the ATANY server.
import { apiFetch } from './apiClient';

export const SUPPORT_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];
export const SUPPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const SUPPORT_IMAGE_ACCEPT = SUPPORT_IMAGE_MIME.join(',');
export const SUPPORT_IMAGE_HINT = 'JPG, PNG or WebP — max 5 MB';

/** @returns {string|null} friendly error, or null when the file is acceptable */
export function validateSupportImage(file) {
  if (!file) return null;
  const type = String(file.type || '').toLowerCase();
  if (!SUPPORT_IMAGE_MIME.includes(type)) return 'Only JPG, PNG, and WebP images are allowed.';
  if (file.size > SUPPORT_IMAGE_MAX_BYTES) return 'Image must be 5 MB or smaller.';
  if (file.size <= 0) return 'Only JPG, PNG, and WebP images are allowed.';
  return null;
}

/**
 * Upload one image and return its storage path.
 * @param {File} file
 * @param {{ authenticated?: boolean }} opts  authenticated uses the customer endpoint
 * @returns {Promise<string>} object path
 * @throws {Error} with a user-facing message
 */
export async function uploadSupportAttachment(file, { authenticated = false } = {}) {
  const invalid = validateSupportImage(file);
  if (invalid) throw new Error(invalid);

  const path = authenticated ? '/customer/support/attachment' : '/api/public/contact/attachment';

  const { signedUrl, path: objectPath } = await apiFetch(path, {
    method: 'POST',
    ...(authenticated ? {} : { public: true }),
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type,
      size: file.size,
    }),
  });

  const put = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!put.ok) {
    throw new Error('We could not upload your image. Please try again.');
  }

  return objectPath;
}
