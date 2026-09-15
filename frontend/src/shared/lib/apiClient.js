// frontend/src/shared/lib/apiClient.js
// Centralized fetch wrapper — replaces ad-hoc fetches scattered across dashboards.
// Attach Supabase JWT; backend requireAuth.js validates it.
import { supabase } from './supabaseClient';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function authHeaders() {
  try {
    // Try to get session, and if expired try refresh (handles case where token was valid on login but expired by submit)
    const { data } = await supabase.auth.getSession();
    let token = data.session?.access_token;
    const expiresAt = data.session?.expires_at;
    // If token is missing or expired within 60s, try to refresh
    if (!token || (expiresAt && expiresAt * 1000 < Date.now() + 60000)) {
      try {
        const { data: refreshed } = await supabase.auth.refreshSession();
        token = refreshed.session?.access_token || token;
      } catch {}
    }
    if (!token) {
      // Fallback: check if we have a user but no session (e.g. seeded DB user without supabase session)
      // This would be the account-specific bug for Second Jewelers if it was created via direct DB insert
      console.warn('[apiClient] No supabase session — Authorization header will be missing. User may have been seeded directly into public.users without Supabase Auth.');
    }
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}

export async function apiFetch(path, opts = {}) {
  const isFormData = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const auth = await authHeaders();
  // For FormData (image upload) do NOT manually set Content-Type — browser must set multipart boundary.
  // Manually setting 'multipart/form-data' without boundary strips the header and can cause Authorization to be lost on some fetch/axios implementations.
  const headers = { ...auth, ...(opts.headers || {}) };
  if (!isFormData && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  } else if (isFormData && headers['Content-Type']) {
    // Remove incorrect manual Content-Type for FormData
    delete headers['Content-Type'];
    delete headers['content-type'];
  }
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || 'Request failed');
  }
  // DELETE 204 No Content has no body — calling .json() would throw "Unexpected end of JSON input"
  // and be caught as "Failed to remove" even though the delete succeeded. Treat any 2xx with empty
  // body (204/205 or 200 with no content) as success without JSON parsing.
  if (res.status === 204 || res.status === 205) return null;
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}
