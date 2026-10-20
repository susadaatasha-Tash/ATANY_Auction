// backend/src/middleware/requireAuth.js
// Verifies Supabase JWT. All role routes mount behind this.
// Spec 5.4: RLS enabled; this middleware also extracts req.user for requireRole and controllers.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Missing token' });
  // Bounded: a stalled Supabase Auth response must fail fast instead of
  // parking the request (and piling pool waiters behind it) indefinitely.
  let data = null;
  let error = null;
  try {
    const r = await Promise.race([
      supabase.auth.getUser(token),
      new Promise((_, rej) => setTimeout(() => rej(new Error('auth lookup timeout')), 10000)),
    ]);
    data = r?.data ?? null;
    error = r?.error ?? null;
  } catch (e) {
    return res.status(503).json({ message: 'Authentication service unavailable' });
  }
  if (error || !data.user) return res.status(401).json({ message: 'Invalid token' });
  req.user = data.user; // { id, email, user_metadata: { role } }
  next();
}
