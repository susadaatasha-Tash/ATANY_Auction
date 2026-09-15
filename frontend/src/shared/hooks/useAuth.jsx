// frontend/src/shared/hooks/useAuth.jsx
// Wraps Supabase Auth + role. Login/signup previously were demo redirects
// login.html:263 / signup.html:262  — now real auth via supabaseClient.
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const AuthContext = createContext(null);

async function fetchUserMeta(token) {
  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000';
  try {
    const res = await fetch(`${apiBase}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { role: data.role || null, preferredBranchId: data.preferred_branch_id || null };
  } catch { return null; }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [preferredBranchId, setPreferredBranchId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      setUser(u);
      setLoading(false);
      if (u && data.session?.access_token) {
        fetchUserMeta(data.session.access_token).then((meta) => {
          if (meta) { setRole(meta.role); setPreferredBranchId(meta.preferredBranchId); }
        });
      }
    }).catch(() => setLoading(false));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u && session?.access_token) {
        fetchUserMeta(session.access_token).then((meta) => {
          if (meta) { setRole(meta.role); setPreferredBranchId(meta.preferredBranchId); }
        });
      } else {
        setRole(null);
        setPreferredBranchId(null);
      }
    });
    return () => sub.subscription?.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return <AuthContext.Provider value={{ user, role, preferredBranchId, setPreferredBranchId, loading, signOut }}>{children}</AuthContext.Provider>;
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
  if (loading || (user && role && !userRole)) return null;
  const allowed = Array.isArray(role) ? role : [role];
  if (!user || (role && !allowed.includes(userRole))) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
