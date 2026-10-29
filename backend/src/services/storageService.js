// backend/src/services/storageService.js
// Spec 1: Supabase Storage for product photos (or Cloudinary). Branch images also via same bucket.
// Upload is via signed URL: frontend requests POST /admin/products/upload-url, then PUT to Supabase.
// This keeps service_role key server-side (spec 5.6).
import { createClient } from '@supabase/supabase-js';

// Lazily created. Previously this ran at import time, which threw
// "supabaseUrl is required" for any consumer that imported the module without a
// loaded .env (unit tests, CLI tools). Building the client on first use keeps
// the import side-effect free; only an actual storage call needs credentials.
let client = null;
function supabase() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return client;
}

export async function createUploadUrl(filename) {
  // Use UUID + timestamp + sanitized filename to avoid collisions (e.g. all "Rings" uploads to same key overwriting)
  const { randomUUID } = await import('crypto');
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `products/${Date.now()}-${randomUUID()}-${safeName}`;
  const { data, error } = await supabase().storage.from('atany-products').createSignedUploadUrl(path);
  if (error) throw error;
  return { signedUrl: data.signedUrl, path, publicUrl: supabase().storage.from('atany-products').getPublicUrl(path).data.publicUrl };
}

export const BRANCH_IMAGE_BUCKET = 'atany-products';
const BRANCH_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

export function validateBranchFilename(filename) {
  if (!filename || typeof filename !== 'string') return 'Filename required';
  const lower = filename.toLowerCase();
  const ok = BRANCH_IMAGE_EXTS.some((ext) => lower.endsWith(ext));
  if (!ok) return 'Please upload a JPG, PNG, or WEBP image under 5 MB.';
  return null;
}

export async function createBranchUploadUrl(filename) {
  const err = validateBranchFilename(filename);
  if (err) throw new Error(err);
  const { randomUUID } = await import('crypto');
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `branch-images/${Date.now()}-${randomUUID()}-${safeName}`;
  const { data, error } = await supabase().storage.from(BRANCH_IMAGE_BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return { signedUrl: data.signedUrl, path, publicUrl: supabase().storage.from(BRANCH_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl };
}

export function branchPathFromPublicUrl(publicUrl) {
  try {
    if (!publicUrl || typeof publicUrl !== 'string') return null;
    // Supabase public URL format: {base}/storage/v1/object/public/{bucket}/{path}
    const marker = `${BRANCH_IMAGE_BUCKET}/`;
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return null;
    const path = publicUrl.slice(idx + marker.length).split('?')[0];
    if (!path.startsWith('branch-images/')) return null;
    return path;
  } catch { return null; }
}

export async function deleteBranchImageByUrl(publicUrl) {
  const path = branchPathFromPublicUrl(publicUrl);
  if (!path) return false;
  const { error } = await supabase().storage.from(BRANCH_IMAGE_BUCKET).remove([path]);
  if (error) throw error;
  return true;
}

/* ────────────────────────────────────────────────────────────────────────────
 * SUPPORT / CONTACT IMAGE ATTACHMENTS
 *
 * Deliberately separate from `atany-products` (which is PUBLIC and holds
 * catalogue imagery). Customer/guest support uploads are PRIVATE:
 *   · stored in their own private bucket
 *   · uploaded through a short-lived signed upload URL
 *   · never referenced by a permanent public URL
 *   · surfaced in the notification email as a time-limited SIGNED link
 *
 * Only real raster images are accepted. The declared MIME type, the file
 * extension and the size are all checked, because any one of them alone can be
 * forged by a client.
 * ──────────────────────────────────────────────────────────────────────────── */
export const SUPPORT_BUCKET = 'atany-support';
export const SUPPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const SUPPORT_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const SUPPORT_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

export const SUPPORT_IMAGE_ACCEPT = SUPPORT_MIME.join(',');

/** Human-facing, no internals. */
export const SUPPORT_IMAGE_RULE = 'Only JPG, PNG, and WebP images are allowed.';
export const SUPPORT_IMAGE_SIZE_RULE = 'Image must be 5 MB or smaller.';

/**
 * Validate a candidate support image.
 * @returns {string|null} error message, or null when acceptable
 */
export function validateSupportImage({ filename = '', contentType = '', size } = {}) {
  const type = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (!SUPPORT_MIME.includes(type)) return SUPPORT_IMAGE_RULE;

  const lower = String(filename || '').toLowerCase();
  if (!lower || !SUPPORT_EXT.some((ext) => lower.endsWith(ext))) return SUPPORT_IMAGE_RULE;

  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return SUPPORT_IMAGE_RULE;
  if (bytes > SUPPORT_IMAGE_MAX_BYTES) return SUPPORT_IMAGE_SIZE_RULE;

  return null;
}

/**
 * Create the private bucket on demand. Idempotent — safe to call per request.
 * Never made public: support uploads must not be world-readable.
 */
export async function ensureSupportBucket() {
  const { data: list, error: listErr } = await supabase().storage.listBuckets();
  if (listErr) throw listErr;
  const existing = (list || []).find((b) => b.name === SUPPORT_BUCKET);
  if (existing) return existing;
  const { data, error } = await supabase().storage.createBucket(SUPPORT_BUCKET, {
    public: false,
    fileSizeLimit: SUPPORT_IMAGE_MAX_BYTES,
    allowedMimeTypes: SUPPORT_MIME,
  });
  if (error && !/already exists/i.test(error.message || '')) throw error;
  return data;
}

/**
 * Issue a signed upload URL for one optional support image.
 * `scope` namespaces the object path (e.g. `guest` or `user-<id>`).
 */
export async function createSupportUploadUrl({ filename, contentType, size, scope = 'guest' }) {
  const invalid = validateSupportImage({ filename, contentType, size });
  if (invalid) throw new Error(invalid);

  await ensureSupportBucket();

  const { randomUUID } = await import('crypto');
  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  // Cap must exceed `user-<uuid>` (41 chars) or the id gets truncated and
  // different customers can share a scope prefix.
  const safeScope = String(scope).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'guest';
  const path = `${safeScope}/${Date.now()}-${randomUUID()}-${safeName}`;

  const { data, error } = await supabase().storage.from(SUPPORT_BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return { signedUrl: data.signedUrl, path, token: data.token };
}

/** Time-limited signed DOWNLOAD link for the notification email. */
export async function createSupportSignedUrl(path, expiresIn = 604800) { // 7 days
  if (!path || typeof path !== 'string' || !path.trim()) return null;
  const { data, error } = await supabase().storage.from(SUPPORT_BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl || null;
}

/** Extract the stored object path from a `/object/sign/<bucket>/<path>` URL. */
export function supportPathFromSignedUrl(url) {
  try {
    if (!url || typeof url !== 'string') return null;
    const marker = `${SUPPORT_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    const path = url.slice(idx + marker.length).split('?')[0];
    return path.includes('/') ? path : null;
  } catch { return null; }
}
