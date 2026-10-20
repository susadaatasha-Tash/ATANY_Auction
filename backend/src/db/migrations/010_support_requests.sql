-- 010_support_requests.sql
-- Contact form submissions — anyone (anon or authenticated) can insert; admin/manager can read.

CREATE TABLE IF NOT EXISTS support_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'General Inquiry',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;

-- Anyone can submit (anon or authenticated)
CREATE POLICY "Anyone can insert support_requests"
  ON support_requests FOR INSERT
  WITH CHECK (true);

-- Only admin/manager can read
CREATE POLICY "Admin can read support_requests"
  ON support_requests FOR SELECT
  USING (is_admin_or_manager());
