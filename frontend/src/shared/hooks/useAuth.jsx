// frontend/src/shared/hooks/useAuth.jsx
// Wraps Supabase Auth + role. Login/signup previously were demo redirects
// login.html:263 / signup.html:262  — now real auth via supabaseClient.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

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
    return {
      // The DB (public.users) is the source of truth for the profile name —
      // it is what the Profile page edits and what /auth/me returns.
      name: data.name || null,
      email: data.email || null,
      role: data.role || null,
      status: data.status || null,
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
  const [preferredBranchId, setPreferredBranchId] = useState(null);
  const [profileName, setProfileName] = useState(null);
  const [loading, setLoading] = useState(true);

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
            setStatus(meta.status);
            setPreferredBranchId(meta.preferredBranchId);
            setProfileName(meta.name);
          } else {
            console.error('[useAuth] /auth/me returned no metadata for authenticated user');
            setRole(null);
            setStatus(null);
            setPreferredBranchId(null);
            setProfileName(null);
          }
        } else {
          setRole(null);
          setStatus(null);
          setPreferredBranchId(null);
          setProfileName(null);
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
            setStatus(meta.status);
            setPreferredBranchId(meta.preferredBranchId);
            setProfileName(meta.name);
          } else {
            console.error('[useAuth] /auth/me returned no metadata on auth change');
            setRole(null);
            setStatus(null);
            setPreferredBranchId(null);
            setProfileName(null);
          }
        } else {
          setRole(null);
          setStatus(null);
          setPreferredBranchId(null);
          setProfileName(null);
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

  // Re-read the server profile (name / branch / status) after a profile save
  // so the header and sidebar reflect the new values without a page reload.
  const refreshProfile = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return null;
      const meta = await fetchUserMeta(token);
      if (!meta) return null;
      setRole(meta.role);
      setStatus(meta.status);
      setPreferredBranchId(meta.preferredBranchId);
      setProfileName(meta.name);
      return meta;
    } catch (e) {
      console.error('[useAuth] refreshProfile failed', e?.message || e);
      return null;
    }
  }, []);

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
import { Navigate } from 'react-router-dom';
export function RequireRole({ role, children }) {
  const { user, role: userRole, loading } = useAuth();
  if (loading) return null;
  const allowed = Array.isArray(role) ? role : [role];
  if (!user || (role && !allowed.includes(userRole))) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
