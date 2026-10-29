// backend/src/middleware/optionalAuth.js
//
// Attaches the VERIFIED identity when a valid Supabase token is present, and
// simply continues when it is not.
//
// Used by routes that are PUBLIC but behave better — and are safer — when they
// know who is calling (currently: POST /chat, so conversation logs are attributed
// to a verified account instead of a client-declared id).
//
// This NEVER rejects a request and never grants access: it only populates
// req.user for routes that already decided they are public.
import { createClient } from '@supabase/supabase-js';

let cachedClient = null;
function anonClient() {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  cachedClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cachedClient;
}

export async function optionalAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      const client = anonClient();
      if (client) {
        const { data } = await client.auth.getUser(token);
        if (data?.user?.id) req.user = { id: data.user.id, email: data.user.email };
      }
    }
  } catch {
    // A bad/absent token is simply an anonymous visitor.
  }
  return next();
}

export default optionalAuth;
