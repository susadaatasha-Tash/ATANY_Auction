// frontend/src/shared/hooks/useAuth.jsx
// Wraps Supabase Auth + role. Login/signup previously were demo redirects
// login.html:263 / signup.html:262  — now real auth via supabaseClient.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { socket } from '../lib/socketClient';

const AuthContext = createContext(null);

// Event used by the API client when a protected call answers 403
// ACCOUNT_SUSPENDED — the authoritative reason travels with the response.
export const ACCOUNT_SUSPENDED_EVENT = 'atany:account-suspended';

async function fetchUserMeta(token) {
  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000';
  try {
    const res = await fetch(`${apiBase}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error(`[useAuth] GET /auth/me failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const data = await res.json();
    return {
      // The DB (public.users) is the source of truth for the profile name —
      // it is what the Profile page edits and what /auth/me returns.
      name: data.name || null,
      email: data.email || null,
      role: data.role || null,
      status: data.status || null,
      // The admin-provided reason for the CURRENT suspension (null when active).
      suspensionReason: data.suspension_reason || null,
      preferredBranchId: data.preferred_branch_id || null,
    };
  } catch (e) {
    console.error('[useAuth] GET /auth/me network/error', e?.message || e);
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [status, setStatus] = useState(null);
  const [suspensionReason, setSuspensionReason] = useState(null);
  const [preferredBranchId, setPreferredBranchId] = useState(null);
  const [profileName, setProfileName] = useState(null);
  const [loading, setLoading] = useState(true);

  const applyMeta = useCallback((meta) => {
    setRole(meta.role);
    setStatus(meta.status);
    setSuspensionReason(meta.suspensionReason || null);
    setPreferredBranchId(meta.preferredBranchId);
    setProfileName(meta.name);
  }, []);

  const clearMeta = useCallback(() => {
    setRole(null);
    setStatus(null);
    setSuspensionReason(null);
    setPreferredBranchId(null);
    setProfileName(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        const u = data.session?.user ?? null;
        setUser(u);
        if (u && data.session?.access_token) {
          const meta = await fetchUserMeta(data.session.access_token);
          if (cancelled) return;
          if (meta) {
            applyMeta(meta);
          } else {
            console.error('[useAuth] /auth/me returned no metadata for authenticated user');
            clearMeta();
          }
        } else {
          clearMeta();
        }
      } catch (e) {
        console.error('[useAuth] Session init failed', e?.message || e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      if (cancelled) return;
      setLoading(true);
      try {
        const u = session?.user ?? null;
        setUser(u);
        if (u && session?.access_token) {
          const meta = await fetchUserMeta(session.access_token);
          if (cancelled) return;
          if (meta) {
            applyMeta(meta);
          } else {
            console.error('[useAuth] /auth/me returned no metadata on auth change');
            clearMeta();
          }
        } else {
          clearMeta();
        }
      } catch (e) {
        console.error('[useAuth] Auth state change failed', e?.message || e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription?.unsubscribe();
    };
  }, [applyMeta, clearMeta]);

  // ── realtime account status (suspension / reactivation) ──────────
  // The backend emits `account:status` to the account's own room right after
  // a successful status change. The database stays authoritative — this only
  // makes an ALREADY OPEN session react immediately.
  useEffect(() => {
    if (!user) return undefined;
    const onAccountStatus = (payload) => {
      const next = String(payload?.status || '').toLowerCase();
      if (!next) return;
      setStatus(next);
      setSuspensionReason(next === 'suspended' ? (payload?.reason || null) : null);
    };
    const onApiFallback = (event) => {
      const reason = event?.detail?.reason || null;
      setStatus('suspended');
      setSuspensionReason(reason);
    };
    try { socket.connect(); } catch { /* the socket is optional */ }
    socket.on('account:status', onAccountStatus);
    window.addEventListener(ACCOUNT_SUSPENDED_EVENT, onApiFallback);
    return () => {
      socket.off('account:status', onAccountStatus);
      window.removeEventListener(ACCOUNT_SUSPENDED_EVENT, onApiFallback);
    };
  }, [user]);

  // Re-read the server profile (name / branch / status) after a profile save
  // so the header and sidebar reflect the new values without a page reload.
  const refreshProfile = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return null;
      const meta = await fetchUserMeta(token);
      if (!meta) return null;
      applyMeta(meta);
      return meta;
    } catch (e) {
      console.error('[useAuth] refreshProfile failed', e?.message || e);
      return null;
    }
  }, [applyMeta]);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        status,
        suspensionReason,
        preferredBranchId,
        setPreferredBranchId,
        profileName,
        refreshProfile,
        loading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
};

// Role guard for App.jsx — mirrors backend requireRole middleware.
// Uses the DB-verified role from the auth context (fetched via GET /auth/me),
// NOT the client-editable JWT user_metadata.
//
// A SUSPENDED account never reaches a protected portal: it is routed to the
// single canonical /account-suspended screen (which shows the admin's reason).
import { Navigate } from 'react-router-dom';
import { ACCOUNT_SUSPENDED_ROUTE } from '../lib/roleRoutes';
export function RequireRole({ role, children }) {
  const { user, role: userRole, status, loading } = useAuth();
  if (loading) return null;
  const allowed = Array.isArray(role) ? role : [role];
  if (!user || (role && !allowed.includes(userRole))) {
    return <Navigate to="/login" replace />;
  }
  if (String(status || '').toLowerCase() === 'suspended') {
    return <Navigate to={ACCOUNT_SUSPENDED_ROUTE} replace />;
  }
  return children;
}
