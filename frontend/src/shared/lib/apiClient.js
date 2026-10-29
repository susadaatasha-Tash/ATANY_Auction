// frontend/src/shared/lib/apiClient.js
// Centralized fetch wrapper — attaches Supabase JWT for protected routes.
// Protected by default: fails closed if no valid session (no silent unauthenticated request).
// Public endpoints must opt-in via { public: true } or { auth: false }.
import { supabase } from './supabaseClient';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

/** Stable server contract for a suspended ATANY account. */
export const ACCOUNT_SUSPENDED_CODE = 'ACCOUNT_SUSPENDED';
const ACCOUNT_SUSPENDED_EVENT = 'atany:account-suspended';

export class ApiError extends Error {
  constructor(message, status = 500, code = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function getValidToken() {
  try {
    const { data } = await supabase.auth.getSession();
    let token = data.session?.access_token;
    const expiresAt = data.session?.expires_at;
    if (!token || (expiresAt && expiresAt * 1000 < Date.now() + 60000)) {
      try {
        const { data: refreshed } = await supabase.auth.refreshSession();
        token = refreshed.session?.access_token || token;
      } catch {}
    }
    return token || null;
  } catch {
    return null;
  }
}

export async function apiFetch(path, opts = {}) {
  const isPublic = opts.public === true || opts.auth === false;
  // Strip public/auth flags before passing to fetch
  const { public: _pub, auth: _auth, ...fetchOpts } = opts;

  const isFormData = typeof FormData !== 'undefined' && fetchOpts.body instanceof FormData;

  let token = null;
  if (!isPublic) {
    token = await getValidToken();
    if (!token) {
      throw new ApiError('AUTH_REQUIRED', 401, 'AUTH_REQUIRED');
    }
  } else {
    // Public endpoint: try to attach token if available, but don't require it
    token = await getValidToken().catch(() => null);
  }

  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
  let headers = { ...authHeader, ...(fetchOpts.headers || {}) };
  if (!isFormData && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  } else if (isFormData && headers['Content-Type']) {
    delete headers['Content-Type'];
    delete headers['content-type'];
  }

  let res = await fetch(`${BASE}${path}`, { ...fetchOpts, headers });

  // If 401 due to expired token, try refresh once for protected calls
  if (!isPublic && res.status === 401) {
    const errBody = await res.clone().json().catch(() => ({}));
    const msg = (errBody.message || '').toLowerCase();
    if (msg.includes('invalid token') || msg.includes('missing token') || msg.includes('jwt expired')) {
      try {
        const { data: refreshed } = await supabase.auth.refreshSession();
        const newToken = refreshed.session?.access_token;
        if (newToken) {
          const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` };
          res = await fetch(`${BASE}${path}`, { ...fetchOpts, headers: retryHeaders });
        }
      } catch {}
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    const code = err?.code || err?.error?.code || null;
    const message = err?.message || err?.error?.message || 'Request failed';
    const error = new ApiError(message, res.status, code);
    // Global account-state fallback. Realtime is the primary signal, but a
    // suspended customer must be caught even when the socket event was missed:
    // ANY protected request answering 403 ACCOUNT_SUSPENDED flips the global
    // account state, which drives the guard to /account-suspended. Individual
    // pages never handle this themselves.
    if (res.status === 403 && code === ACCOUNT_SUSPENDED_CODE) {
      window.dispatchEvent(new CustomEvent(ACCOUNT_SUSPENDED_EVENT, { detail: { code, message, path } }));
    }
    throw error;
  }
  if (res.status === 204 || res.status === 205) return null;
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

// Convenience for explicitly public endpoints (no auth required)
export function publicFetch(path, opts = {}) {
  return apiFetch(path, { ...opts, public: true });
}
