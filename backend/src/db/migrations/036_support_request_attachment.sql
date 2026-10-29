-- 036_support_request_attachment.sql
--
-- Optional image attachment for public Contact Us and Customer Help & Support.
--
-- Only the OBJECT PATH is stored here (e.g. 'guest/1730-ab12-photo.jpg').
-- Deliberately NOT stored:
--   · raw image bytes or base64  — the message column stays plain text
--   · a permanent public URL     — the bucket is private and links are signed
--
-- The objects live in the private `atany-support` bucket, which this migration
-- does not create (Supabase Storage buckets are managed through the Storage API,
-- not SQL). storageService.ensureSupportBucket() creates it idempotently on
-- first upload, and never sets public:true.

ALTER TABLE public.support_requests
  ADD COLUMN IF NOT EXISTS attachment_path text;

COMMENT ON COLUMN public.support_requests.attachment_path IS
  'Optional private-bucket object path for an image attached to this request. Never a public URL or raw bytes.';
