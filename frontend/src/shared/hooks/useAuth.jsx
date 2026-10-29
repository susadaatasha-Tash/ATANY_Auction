// frontend/src/shared/hooks/useAuth.jsx
// Wraps Supabase Auth + role. Login/signup previously were demo redirects
// login.html:263 / signup.html:262  — now real auth via supabaseClient.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { socket } from '../lib/socketClient';

// Broadcast when an authoritative 403 ACCOUNT_SUSPENDED comes back from any API.
// This is the fallback path for when the realtime event is missed (offline,
// socket blocked, tab opened later).
export const ACCOUNT_SUSPENDED_EVENT = 'atany:account-suspended';
export const ACCOUNT_STATUS_EVENT = 'atany:account-status';

const AuthContext = createContext(null);

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
    return { role: data.role || null, status: data.status || null, preferredBranchId: data.preferred_branch_id || null };
  } catch (e) {
    console.error('[useAuth] GET /auth/me network/error', e?.message || e);
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [preferredBranchId, setPreferredBranchId] = useState(null);
  // Authoritative ATANY account state (users.status). `null` = not yet resolved.
  // A suspended customer is AUTHENTICATED but not AUTHORIZED.
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const statusRef = useRef(null);
  // Shared handle on the single status-application routine, so the reactivation
  // re-check and the realtime listener cannot drift apart.
  const applyStatusRef = useRef(null);

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
            setRole(meta.role);
            setStatus(meta.status || null);
            setPreferredBranchId(meta.preferredBranchId);
          } else {
            console.error('[useAuth] /auth/me returned no metadata for authenticated user');
            setRole(null);
            setStatus(null);
            setPreferredBranchId(null);
          }
        } else {
          setRole(null);
          setStatus(null);
          setPreferredBranchId(null);
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
            setRole(meta.role);
            setStatus(meta.status || null);
            setPreferredBranchId(meta.preferredBranchId);
          } else {
            console.error('[useAuth] /auth/me returned no metadata on auth change');
            setRole(null);
            setStatus(null);
            setPreferredBranchId(null);
          }
        } else {
          setRole(null);
          setStatus(null);
          setPreferredBranchId(null);
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
  }, []);

  // The realtime socket is the ONLY way an already-open tab learns that its
  // account was suspended (the server emits `account:status` to `user:<id>`),
  // and it is also how a customer's live-auction presence is registered. The
  // socket is created with autoConnect:false, so an authenticated session must
  // open it here — otherwise customers are permanently offline for realtime.
  useEffect(() => {
    if (!user) {
      try { socket.disconnect(); } catch { /* transport unavailable */ }
      return;
    }
    try { socket.connect(); } catch { /* transport unavailable */ }
  }, [user?.id]);

  // Live account-status changes. The server emits `account:status` to the
  // private room `user:<id>` right after it commits a suspension, so an already
  // logged-in customer flips state with no refresh and no polling.
  useEffect(() => {
    const applyStatus = (nextStatus, source) => {
      if (!nextStatus) return;
      setStatus(nextStatus);
      statusRef.current = nextStatus;
      window.dispatchEvent(new CustomEvent(ACCOUNT_STATUS_EVENT, { detail: { status: nextStatus, source } }));
    };
    applyStatusRef.current = applyStatus;
    const onSocketStatus = (payload) => {
      if (!payload?.status) return;
      // The userId comes from verified socket auth server-side; we still only
      // accept it for the currently signed-in identity.
      if (payload.userId && user?.id && String(payload.userId) !== String(user.id)) return;
      applyStatus(payload.status, 'realtime');
    };
    const onApiFallback = () => applyStatus('suspended', 'api');
    socket.on('account:status', onSocketStatus);
    window.addEventListener(ACCOUNT_SUSPENDED_EVENT, onApiFallback);
    return () => {
      socket.off('account:status', onSocketStatus);
      window.removeEventListener(ACCOUNT_SUSPENDED_EVENT, onApiFallback);
    };
  }, [user?.id]);

  // Reactivation recovery. Suspension deliberately force-disconnects the
  // customer's sockets server-side (so no stale session keeps streaming), which
  // also means the tab can no longer RECEIVE the reactivation event. So while
  // suspended this tab re-reads the authoritative status through the EXISTING
  // /auth/me endpoint — slowly, and whenever the customer comes back to the
  // tab — and reconnects realtime only once the account is active again.
  useEffect(() => {
    if (status !== 'suspended') return undefined;
    let cancelled = false;
    const recheck = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token || cancelled) return;
        const meta = await fetchUserMeta(token);
        if (cancelled || !meta || meta.status !== 'active') return;
        applyStatusRef.current?.('active', 'recheck');
        try { socket.connect(); } catch { /* transport unavailable */ }
      } catch { /* offline — try again on the next tick */ }
    };
    const onWake = () => { if (document.visibilityState !== 'hidden') recheck(); };
    const timer = setInterval(recheck, 20000);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [status]);

  const signOut = async () => {
    try { socket.disconnect(); } catch {}
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider
      value={{
        user, role, status, preferredBranchId, setPreferredBranchId, loading, signOut,
        suspended: status === 'suspended',
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
import { Navigate } from 'react-router-dom';
export function RequireRole({ role, children, activeOnly = false }) {
  const { user, role: userRole, status, loading } = useAuth();
  // Bootstrap: never render a protected page before the authoritative
  // role + status are known, otherwise a suspended customer would see a frame
  // of Customer Home before being redirected.
  if (loading) return null;
  const allowed = Array.isArray(role) ? role : [role];
  if (!user || (role && !allowed.includes(userRole))) {
    return <Navigate to="/login" replace />;
  }
  // Authorization is separate from authentication: a valid session on a
  // suspended ATANY account cannot reach protected pages.
  if (activeOnly && status === 'suspended') {
    return <Navigate to="/account-suspended" replace />;
  }
  return children;
}

/** Customer-scoped guard: authenticated + role customer + account ACTIVE. */
export function RequireActiveCustomer({ children }) {
  return <RequireRole role="customer" activeOnly>{children}</RequireRole>;
}
