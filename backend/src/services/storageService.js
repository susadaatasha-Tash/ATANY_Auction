// backend/src/services/storageService.js
// Spec 1: Supabase Storage for product photos (or Cloudinary). Branch images also via same bucket.
// Upload is via signed URL: frontend requests POST /admin/products/upload-url, then PUT to Supabase.
// This keeps service_role key server-side (spec 5.6).
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function createUploadUrl(filename) {
  // Use UUID + timestamp + sanitized filename to avoid collisions (e.g. all "Rings" uploads to same key overwriting)
  const { randomUUID } = await import('crypto');
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `products/${Date.now()}-${randomUUID()}-${safeName}`;
  const { data, error } = await supabase.storage.from('atany-products').createSignedUploadUrl(path);
  if (error) throw error;
  return { signedUrl: data.signedUrl, path, publicUrl: supabase.storage.from('atany-products').getPublicUrl(path).data.publicUrl };
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
  const { data, error } = await supabase.storage.from(BRANCH_IMAGE_BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return { signedUrl: data.signedUrl, path, publicUrl: supabase.storage.from(BRANCH_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl };
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
  const { error } = await supabase.storage.from(BRANCH_IMAGE_BUCKET).remove([path]);
  if (error) throw error;
  return true;
}
