// backend/src/services/socketAuth.js
// Priority 1 / H1: Socket.io handshake must authenticate via Supabase JWT.
// Clients cannot join arbitrary user rooms — identity is derived server-side.
import { createClient } from '@supabase/supabase-js';

function extractToken(socket) {
  const auth = socket.handshake?.auth || {};
  if (auth.token) return String(auth.token);
  const header = socket.handshake?.headers?.authorization;
  if (header) return String(header).replace(/^Bearer\s+/i, '');
  const query = socket.handshake?.query || {};
  if (query.token) return String(query.token);
  return null;
}

/**
 * Socket.io middleware factory.
 * On success: attaches socket.data.userId and joins `user:<authenticated-id>`.
 * On failure: next(new Error('unauthorized')) — connection is rejected.
 */
export function createSocketAuth({ supabaseClient } = {}) {
  const supabase =
    supabaseClient ||
    createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  return async function socketAuth(socket, next) {
    try {
      const token = extractToken(socket);
      if (!token) return next(new Error('unauthorized'));
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user?.id) return next(new Error('unauthorized'));
      socket.data = socket.data || {};
      socket.data.userId = data.user.id;
      socket.data.user = data.user;
      // Auto-join private room from authenticated identity only.
      socket.join(`user:${data.user.id}`);
      next();
    } catch (e) {
      console.warn('[socketAuth] handshake failed:', e?.message || 'unauthorized');
      next(new Error('unauthorized'));
    }
  };
}

export default createSocketAuth;
