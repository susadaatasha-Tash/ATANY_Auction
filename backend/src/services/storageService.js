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
