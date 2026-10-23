// frontend/src/pages/Login.jsx
// Premium login page — polished card, demo buttons, role-based redirect
//
// Login validation/errors are shown INLINE next to the relevant inputs
// instead of a floating "Invalid login credentials" toast.
// Authentication mismatch never reveals which credential was wrong:
//   "Email or password is incorrect."
import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, CircleAlert } from 'lucide-react';
import { supabase } from '../shared/lib/supabaseClient';
import { useAuth } from '../shared/hooks/useAuth';
import { useToast } from '../shared/components/Toast';
import { AssistantWidget } from '../shared/components/AssistantWidget';
import { validateEmail, validatePassword } from '../shared/validation/loginValidation';
import loginBg from '../assests/Login_bg.jpg';

const ERROR_COLOR = '#b91c1c';
const ERROR_TINT = 'rgba(185, 28, 28, 0.10)';
const ERROR_RING = 'rgba(185, 28, 28, 0.15)';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  // Field errors (format / required) and a single credential error
  // (auth mismatch) shown as a callout below the password field.
  const [errors, setErrors] = useState({ email: '', password: '', credential: '' });
  const showToast = useToast();
  const navigate = useNavigate();
  const { user, role, status, preferredBranchId, loading } = useAuth();
  const navigationRef = useRef(false);
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect') || '/customer';
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

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
    // A suspended account never reaches a protected portal — it lands on the
    // single canonical suspended screen (with the admin's reason).
    if (String(status || '').toLowerCase() === 'suspended') {
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
      // Keep the original destination through the branch picker so a guest who
      // signs in from a landing-page bid returns to the exact auction.
      navigate(`/select-branch?redirect=${encodeURIComponent(redirect)}`, { replace: true });
    } else {
      navigate('/customer', { replace: true });
    }
  }, [user, role, status, preferredBranchId, redirect, navigate, loading]);

  const setFieldError = useCallback((field, message) => {
    setErrors((prev) => ({ ...prev, [field]: message }));
  }, []);

  const clearCredentialError = useCallback(() => {
    setErrors((prev) => {
      if (!prev.credential) return prev;
      return { ...prev, credential: '' };
    });
  }, []);

  const handleEmailChange = useCallback((e) => {
    const val = e.target.value;
    setEmail(val);
    // Clears the stale server credential error as soon as the user edits.
    setErrors((prev) => {
      const next = { ...prev, credential: '' };
      if (prev.email) next.email = validateEmail(val);
      return next;
    });
  }, []);

  const handlePasswordChange = useCallback((e) => {
    const val = e.target.value;
    setPassword(val);
    // Clears the stale server credential error as soon as the user edits.
    setErrors((prev) => {
      const next = { ...prev, credential: '' };
      if (prev.password) next.password = validatePassword(val);
      return next;
    });
  }, []);

  const mapAuthError = useCallback((error) => {
    const msg = String(error.message || '');
    const lower = msg.toLowerCase();

    // Network / infrastructure failure — do NOT map to bad credentials.
    if (!msg || lower.includes('failed to fetch') || lower.includes('network') || lower.includes('unable to reach')) {
      return 'Unable to sign in right now. Please check your connection and try again.';
    }

    // Rate limit / too many attempts.
    if (lower.includes('rate limit') || lower.includes('too many') || lower.includes('429')) {
      return 'Too many sign-in attempts. Please try again later.';
    }

    // Email not confirmed — preserve existing resend flow.
    if (lower.includes('email not confirmed')) {
      return 'EMAIL_NOT_CONFIRMED';
    }

    // Invalid credentials — do not reveal which field is wrong.
    return 'Email or password is incorrect.';
  }, []);

  const handle = async (e) => {
    e.preventDefault();

    // Clear previous errors before validating.
    setErrors({ email: '', password: '', credential: '' });

    // Frontend validation — never call Supabase when the form is invalid.
    const emailErr = validateEmail(email);
    const passwordErr = validatePassword(password);

    if (emailErr || passwordErr) {
      setErrors({ email: emailErr, password: passwordErr, credential: '' });
      // Focus the first invalid field using the newly computed errors.
      if (emailErr && emailRef.current) {
        emailRef.current.focus();
      } else if (passwordErr && passwordRef.current) {
        passwordRef.current.focus();
      }
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) {
        const mapped = mapAuthError(error);

        if (mapped === 'EMAIL_NOT_CONFIRMED') {
          await supabase.auth.resend({ type: 'signup', email });
          return showToast('Please verify your email first — we just resent the verification link.');
        }

        // System / network error: show inline callout (not a credential error).
        if (
          mapped === 'Unable to sign in right now. Please check your connection and try again.' ||
          mapped === 'Too many sign-in attempts. Please try again later.'
        ) {
          setErrors({ email: '', password: '', credential: mapped });
          return;
        }

        // Invalid credentials: both fields take the error border, single
        // callout message below the password. Never reveal which failed.
        setErrors({
          email: '',
          password: '',
          credential: 'Email or password is incorrect.',
        });
        return;
      }
      // Success — handled by auth state change / useEffect redirect.
    } catch (err) {
      setBusy(false);
      setErrors({ email: '', password: '', credential: 'Unable to sign in right now. Please check your connection and try again.' });
    }
  };

  const inputErrorStyle = (fieldError, credential) => ({
    borderColor: (fieldError || credential) ? ERROR_COLOR : undefined,
    ...((fieldError || credential) && { boxShadow: `0 0 0 3px ${ERROR_RING}` }),
  });

  const errorText = (message) => ({
    color: ERROR_COLOR,
    fontSize: 12,
    fontWeight: 600,
    marginTop: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    letterSpacing: 0.01,
  });

  return (
    <div className="public-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundImage: `url(${loginBg})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}>
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ width: 'min(420px,100%)', background: 'white', border: '1px solid #C89B3C', borderRadius: 4, padding: '36px 32px', boxShadow: '0 0 20px rgba(200, 155, 60, 0.30), 0 8px 35px rgba(200, 155, 60, 0.24), 0 2px 10px rgba(200, 155, 60, 0.18)' }}>
          <div style={{ color: 'var(--gold)', fontSize: 11, fontWeight: 700, letterSpacing: '.12em', marginBottom: 10, textAlign: 'center' }}>WELCOME BACK</div>
          <h1 style={{ fontSize: 28, color: 'var(--navy)', marginBottom: 6, fontWeight: 800, textAlign: 'center' }}>Sign In</h1>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 24, textAlign: 'center' }}>Access your bids, favorites, and purchases.</p>
          <form noValidate onSubmit={handle} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.requestSubmit(); }}>
            <div className="form-row">
              <label htmlFor="login-email">Email Address</label>
              <input
                id="login-email"
                ref={emailRef}
                type="email"
                value={email}
                onChange={handleEmailChange}
                placeholder="you@example.com"
                aria-invalid={!!(errors.email || errors.credential)}
                aria-describedby={
                  errors.email
                    ? 'login-email-error'
                    : errors.credential
                    ? 'login-credential-error'
                    : undefined
                }
                style={inputErrorStyle(errors.email, errors.credential)}
              />
              {errors.email && (
                <p id="login-email-error" role="alert" style={errorText(errors.email)}>
                  <CircleAlert size={14} style={{ color: ERROR_COLOR, flexShrink: 0 }} />
                  {errors.email}
                </p>
              )}
            </div>
            <div className="form-row">
              <label htmlFor="login-password">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="login-password"
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={handlePasswordChange}
                  placeholder="Enter your password"
                  aria-invalid={!!(errors.password || errors.credential)}
                  aria-describedby={
                    errors.password
                      ? 'login-password-error'
                      : errors.credential
                      ? 'login-credential-error'
                      : undefined
                  }
                  style={{
                    paddingRight: 42,
                    ...inputErrorStyle(errors.password, errors.credential),
                  }}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((v) => !v)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, display: 'grid', placeItems: 'center', border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', borderRadius: 6 }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && (
                <p id="login-password-error" role="alert" style={errorText(errors.password)}>
                  <CircleAlert size={14} style={{ color: ERROR_COLOR, flexShrink: 0 }} />
                  {errors.password}
                </p>
              )}
            </div>
            {errors.credential && (
              <div
                id="login-credential-error"
                role="alert"
                style={{
                  background: ERROR_TINT,
                  border: `1px solid ${ERROR_COLOR}`,
                  borderRadius: 6,
                  padding: 10,
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <CircleAlert size={14} style={{ color: ERROR_COLOR, flexShrink: 0 }} />
                <span style={{ color: ERROR_COLOR, fontSize: 12.5, fontWeight: 600 }}>{errors.credential}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, fontSize: 11.5 }}>
              <label style={{ display: 'flex', gap: 6, color: 'var(--muted)' }}><input type="checkbox" /> Remember me</label>
              <a href="#" onClick={(e) => { e.preventDefault(); showToast('Password reset coming soon.'); }} style={{ color: 'var(--navy)', fontWeight: 700 }}>Forgot password?</a>
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%', minHeight: 46, justifyContent: 'center', textAlign: 'center' }}>{busy ? 'Signing in…' : 'Sign In'}</button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 22, fontSize: 12, color: 'var(--muted)' }}>New to ATANY? <Link to="/signup" style={{ color: 'var(--navy)', fontWeight: 700 }}>Create an account</Link></p>
          {/* Locked out? The PUBLIC contact form reaches ATANY Support without
              revealing whether an account exists. */}
          <p style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
            Locked out?{' '}
            <Link to="/#contact" style={{ color: 'var(--navy)', fontWeight: 700 }}>Contact ATANY Support</Link>
          </p>
          <Link to="/" style={{ display: 'block', textAlign: 'center', marginTop: 18, fontSize: 11.5, color: 'var(--muted)' }}>&larr; Back to home</Link>
        </div>
      </main>
      <AssistantWidget mode="customer" />
    </div>
  );
}
