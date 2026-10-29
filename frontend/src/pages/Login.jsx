// frontend/src/pages/Login.jsx
// Premium login page — polished card, demo buttons, role-based redirect
import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from '../shared/lib/supabaseClient';
import { useAuth } from '../shared/hooks/useAuth';
import { useToast } from '../shared/components/Toast';
import { AssistantWidget } from '../shared/components/AssistantWidget';
import loginBg from '../assests/Login_bg.jpg';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const showToast = useToast();
  const navigate = useNavigate();
  const { user, role, status, preferredBranchId, loading } = useAuth();
  const navigationRef = useRef(false);
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect') || '/customer';

  useEffect(() => {
    if (!user) navigationRef.current = false;
  }, [user]);

  useEffect(() => {
    if (loading) return;
    if (!user || !role) return;
    showToast('Welcome back');
  }, [user, role, loading, showToast]);

  useEffect(() => {
    if (loading) return;
    if (user && !role) {
      console.error('[Login] Authenticated but role metadata missing for user', user.id);
    }
    if (!user || navigationRef.current || !role) return;
    navigationRef.current = true;
    // AUTHORIZATION: authentication succeeded, but this ATANY account is not
    // active. Never route them into the customer portal.
    if (status === 'suspended') {
      navigate('/account-suspended', { replace: true });
      return;
    }
    if (redirect !== '/customer') {
      navigate(redirect, { replace: true });
    } else if (role === 'admin') {
      navigate('/admin', { replace: true });
    } else if (role === 'shop_owner') {
      navigate('/shop', { replace: true });
    } else if (!preferredBranchId) {
      navigate('/select-branch', { replace: true });
    } else {
      navigate('/customer', { replace: true });
    }
  }, [user, role, status, preferredBranchId, redirect, navigate, loading]);

  const handle = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      if (error.message?.toLowerCase().includes('email not confirmed')) {
        await supabase.auth.resend({ type: 'signup', email });
        return showToast('Please verify your email first — we just resent the verification link.');
      }
      return showToast(error.message);
    }
  };

  return (
    <div className="public-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundImage: `url(${loginBg})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}>
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ width: 'min(420px,100%)', background: 'white', border: '1px solid #C89B3C', borderRadius: 4, padding: '36px 32px', boxShadow: '0 0 20px rgba(200, 155, 60, 0.30), 0 8px 35px rgba(200, 155, 60, 0.24), 0 2px 10px rgba(200, 155, 60, 0.18)' }}>
          <div style={{ color: 'var(--gold)', fontSize: 11, fontWeight: 700, letterSpacing: '.12em', marginBottom: 10, textAlign: 'center' }}>WELCOME BACK</div>
          <h1 style={{ fontSize: 28, color: 'var(--navy)', marginBottom: 6, fontWeight: 800, textAlign: 'center' }}>Sign In</h1>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 24, textAlign: 'center' }}>Access your bids, favorites, and purchases.</p>
          <form onSubmit={handle}>
            <div className="form-row"><label>Email Address</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required /></div>
            <div className="form-row"><label>Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required style={{ paddingRight: 42 }} />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(v => !v)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, display: 'grid', placeItems: 'center', border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', borderRadius: 6 }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, fontSize: 11.5 }}>
              <label style={{ display: 'flex', gap: 6, color: 'var(--muted)' }}><input type="checkbox" /> Remember me</label>
              <a href="#" onClick={(e) => { e.preventDefault(); showToast('Password reset coming soon.'); }} style={{ color: 'var(--navy)', fontWeight: 700 }}>Forgot password?</a>
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%', minHeight: 46, justifyContent: 'center', textAlign: 'center' }}>{busy ? 'Signing in…' : 'Sign In'}</button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 22, fontSize: 12, color: 'var(--muted)' }}>New to ATANY? <Link to="/signup" style={{ color: 'var(--navy)', fontWeight: 700 }}>Create an account</Link></p>
          <Link to="/" style={{ display: 'block', textAlign: 'center', marginTop: 18, fontSize: 11.5, color: 'var(--muted)' }}>&larr; Back to home</Link>
        </div>
      </main>
      <AssistantWidget mode="customer" />
    </div>
  );
}
