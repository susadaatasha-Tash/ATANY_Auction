// frontend/src/pages/Signup.jsx - Validated signup per ATANY spec
import { useState, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../shared/lib/supabaseClient';
import { useToast } from '../shared/components/Toast';
import { AssistantWidget } from '../shared/components/AssistantWidget';
import TermsPolicyModal from '../components/TermsPolicyModal';
import loginBg from '../assests/Login_bg.jpg';
import {
  normalizeEmail,
  validateName,
  validateEmail,
  normalizePhilippinePhone,
  validatePhilippinePhone,
  extractLocalDigits,
  calculatePasswordStrength,
  validatePassword,
  validatePasswordMatch,
} from '../shared/validation/signupValidation';

export default function Signup() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [modalAgreementChecked, setModalAgreementChecked] = useState(false);
  const [touched, setTouched] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverFieldErrors, setServerFieldErrors] = useState({});
  const showToast = useToast();
  const navigate = useNavigate();
  const fieldRefs = useRef({});

  const emailNormalized = useMemo(() => normalizeEmail(email), [email]);
  const phoneNormalized = useMemo(() => phone ? normalizePhilippinePhone(phone) : '', [phone]);
  const pwdStrength = useMemo(() => calculatePasswordStrength(password), [password]);

  const validation = useMemo(() => {
    const eFirst = validateName(firstName);
    const eLast = validateName(lastName);
    const eEmail = validateEmail(email);
    const ePhone = validatePhilippinePhone(phone);
    const ePwd = validatePassword(password);
    const eConfirm = validatePasswordMatch(password, confirmPassword);
    const eTerms = termsAgreed ? '' : 'Please agree to the Terms & Privacy Policy.';
    return {
      firstName: eFirst,
      lastName: eLast,
      email: eEmail,
      phone: ePhone,
      password: ePwd,
      confirmPassword: eConfirm,
      terms: eTerms,
    };
  }, [firstName, lastName, email, phone, password, confirmPassword, termsAgreed]);

  const errors = useMemo(() => {
    // Merge server errors (they take precedence until field changes)
    return { ...validation, ...serverFieldErrors };
  }, [validation, serverFieldErrors]);

  const isFormValid = useMemo(() => Object.values(validation).every((e) => !e), [validation]);

  const hasError = (field) => (touched[field] || submitAttempted) && Boolean(errors[field]);
  const showSuccess = (field) => touched[field] && !errors[field] && String(field === 'firstName' ? firstName : field === 'lastName' ? lastName : field === 'email' ? email : field === 'phone' ? phone : field === 'password' ? password : confirmPassword).length > 0;

  const handlePhoneChange = (e) => {
    let val = e.target.value;
    if (val.includes('+63') || val.includes('09') || val.trim().startsWith('+')) {
      const extracted = extractLocalDigits(val);
      const cleaned = val.replace(/[\s\-\(\)\.]/g, '');
      if (cleaned.startsWith('+639') && cleaned.length >= 13) {
        if (extracted) {
          setServerFieldErrors((s) => { const n={...s}; delete n.phone; return n; });
          setPhone(extracted);
          return;
        }
      }
      if (cleaned.startsWith('09') && cleaned.length >= 11) {
        if (extracted) {
          setServerFieldErrors((s) => { const n={...s}; delete n.phone; return n; });
          setPhone(extracted);
          return;
        }
      }
    }
    setServerFieldErrors((s) => { const n={...s}; delete n.phone; return n; });
    setPhone(val);
  };

  const handlePhonePaste = (e) => {
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    if (!pasted) return;
    const cleaned = pasted.replace(/[\s\-\(\)\.]/g, '');
    if (cleaned.startsWith('+639') || cleaned.startsWith('09') || cleaned.startsWith('639')) {
      e.preventDefault();
      const local = extractLocalDigits(pasted);
      if (local) {
        setPhone(local);
        setTouched((t) => ({ ...t, phone: true }));
      } else {
        setPhone(pasted);
      }
    }
  };

  const clearServerError = (field) => setServerFieldErrors((s) => { const n = { ...s }; delete n[field]; return n; });

  const focusFirstInvalid = (errs) => {
    const order = ['firstName', 'lastName', 'email', 'phone', 'password', 'confirmPassword', 'terms'];
    for (const f of order) {
      if (errs[f]) {
        const el = fieldRefs.current[f];
        if (el && el.focus) { el.focus(); break; }
      }
    }
  };

  const handle = async (e) => {
    e.preventDefault();
    setSubmitAttempted(true);
    // Validate full form
    if (!isFormValid) {
      focusFirstInvalid(validation);
      return;
    }
    if (isSubmitting) return;
    setIsSubmitting(true);
    setServerFieldErrors({});
    const emailNorm = normalizeEmail(email);
    const phoneNorm = normalizePhilippinePhone(phone);
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    const firstTrim = firstName.trim();
    const lastTrim = lastName.trim();
    // Do not send role/shop_owner/admin from public signup — backend will hardcode customer
    try {
      const appOrigin = import.meta.env.VITE_APP_URL || window.location.origin;
      const { data, error } = await supabase.auth.signUp({
        email: emailNorm,
        password,
        options: {
          data: { name: fullName, first_name: firstTrim, last_name: lastTrim, phone: phoneNorm },
          emailRedirectTo: `${appOrigin.replace(/\/$/, '')}/auth/callback`,
        },
      });
      if (error) {
        const msg = (error.message || '').toLowerCase();
        // Map to field errors
        if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already registered') || error.status === 422) {
          setServerFieldErrors({ email: 'An account with this email already exists.' });
          showToast('An account with this email already exists.');
        } else if (msg.includes('password should be at least') || msg.includes('weak') || msg.includes('at least 6') || msg.includes('at least 8')) {
          setServerFieldErrors({ password: 'Password must be at least 8 characters and include a number' });
          showToast('Password must be at least 8 characters and include a number');
        } else if (msg.includes('unable to validate email') || msg.includes('invalid format') || msg.includes('invalid email') || msg.includes('email address')) {
          setServerFieldErrors({ email: 'Please enter a valid email address.' });
          showToast('Invalid email format — check for typos');
        } else if (msg.includes('phone') || msg.includes('mobile')) {
          setServerFieldErrors({ phone: 'Enter a valid Philippine mobile number.' });
          showToast('Enter a valid Philippine mobile number.');
        } else if (msg.includes('failed to fetch') || msg.includes('network') || error.status === 0) {
          showToast('Network/CORS error — check Supabase URL and API key in frontend/.env');
        } else {
          // Generic — do not expose raw JSON dumping
          showToast(error.message || 'Signup failed');
        }
        return;
      }
      if (data.user?.id) {
        try {
          const token = data.session?.access_token || (await supabase.auth.getSession()).data.session?.access_token;
          if (token) {
            await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/auth/sync-user`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ name: fullName }),
            }).catch(() => {});
          }
        } catch (err) { /* never log password/token */ }
      }
      showToast('Account created — check email for verification (Resend via Supabase SMTP, spec 4.6).');
      setTimeout(() => navigate('/login'), 700);
    } finally {
      setIsSubmitting(false);
    }
  };

  const baseInputStyle = {
    width: '100%',
    height: 46,
    padding: '0 14px',
    borderRadius: 12,
    outline: 'none',
    background: '#fff',
    color: 'var(--text)',
    fontSize: 13,
  };
  const getInputStyle = (hasErr, isValid) => ({
    ...baseInputStyle,
    border: hasErr ? '1px solid #ef4444' : isValid ? '1px solid #22c55e' : '1px solid #e5e2da',
    paddingRight: hasErr || isValid ? '36px' : '14px',
  });
  const labelStyle = { display: 'block', color: '#000', fontSize: 13, fontWeight: 700, marginBottom: 6 };

  const strengthMeta = useMemo(() => {
    const filled = pwdStrength.score <= 1 ? 1 : pwdStrength.score === 2 ? 2 : pwdStrength.score === 3 ? 3 : pwdStrength.score <= 5 ? 4 : 5;
    return { filled, total: 5 };
  }, [pwdStrength]);

  const pwdChecks = useMemo(() => {
    const pwd = password;
    return [
      { label: '8+ characters', ok: pwd.length >= 8 },
      { label: 'lowercase letter', ok: /[a-z]/.test(pwd) },
      { label: 'uppercase letter', ok: /[A-Z]/.test(pwd) },
      { label: 'number', ok: /[0-9]/.test(pwd) },
      { label: 'symbol', ok: /[^A-Za-z0-9]/.test(pwd) },
    ];
  }, [password]);

  return (
    <div className="public-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundImage: `url(${loginBg})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}>
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ width: 'min(480px,100%)', background: 'var(--ivory)', border: '1px solid #C89B3C', borderRadius: 4, padding: '36px 32px', boxShadow: '0 0 20px rgba(200, 155, 60, 0.30), 0 8px 35px rgba(200, 155, 60, 0.24), 0 2px 10px rgba(200, 155, 60, 0.18)' }}>
          <div style={{ color: 'var(--gold)', fontSize: 11, fontWeight: 700, letterSpacing: '.12em', marginBottom: 10, textAlign: 'center' }}>JOIN ATANY</div>
          <h1 style={{ fontSize: 30, color: 'var(--navy)', marginBottom: 6, textAlign: 'center' }}>Create Account</h1>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 26, textAlign: 'center' }}>Start discovering timeless pieces worth bidding for.</p>
          <form onSubmit={handle} noValidate>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={labelStyle} htmlFor="firstName">First Name</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="firstName"
                    ref={(el) => (fieldRefs.current.firstName = el)}
                    value={firstName}
                    onChange={(e) => { clearServerError('firstName'); setFirstName(e.target.value); }}
                    onBlur={() => setTouched((t) => ({ ...t, firstName: true }))}
                    placeholder="Isabella"
                    required
                    aria-invalid={hasError('firstName')}
                    aria-describedby={hasError('firstName') ? 'firstName-error' : undefined}
                    style={getInputStyle(hasError('firstName'), showSuccess('firstName'))}
                  />
                  {hasError('firstName') && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#ef4444', fontSize: 16 }}>⚠</span>}
                  {showSuccess('firstName') && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#22c55e', fontSize: 14 }}>✓</span>}
                </div>
                {hasError('firstName') && <div id="firstName-error" style={{ color: '#ef4444', fontSize: 11.5, marginTop: 4 }}>{errors.firstName}</div>}
              </div>
              <div>
                <label style={labelStyle} htmlFor="lastName">Last Name</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="lastName"
                    ref={(el) => (fieldRefs.current.lastName = el)}
                    value={lastName}
                    onChange={(e) => { clearServerError('lastName'); setLastName(e.target.value); }}
                    onBlur={() => setTouched((t) => ({ ...t, lastName: true }))}
                    placeholder="Reyes"
                    required
                    aria-invalid={hasError('lastName')}
                    aria-describedby={hasError('lastName') ? 'lastName-error' : undefined}
                    style={getInputStyle(hasError('lastName'), showSuccess('lastName'))}
                  />
                  {hasError('lastName') && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#ef4444', fontSize: 16 }}>⚠</span>}
                  {showSuccess('lastName') && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#22c55e', fontSize: 14 }}>✓</span>}
                </div>
                {hasError('lastName') && <div id="lastName-error" style={{ color: '#ef4444', fontSize: 11.5, marginTop: 4 }}>{errors.lastName}</div>}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle} htmlFor="email">Email Address</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="email"
                  ref={(el) => (fieldRefs.current.email = el)}
                  type="email"
                  value={email}
                  onChange={(e) => { clearServerError('email'); setEmail(e.target.value); if (touched.email) setTouched((t) => ({ ...t })); }}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  placeholder="you@example.com"
                  required
                  aria-invalid={hasError('email')}
                  aria-describedby={hasError('email') ? 'email-error' : undefined}
                  style={getInputStyle(hasError('email'), showSuccess('email'))}
                />
                {hasError('email') && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#ef4444', fontSize: 16 }}>⚠</span>}
                {showSuccess('email') && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#22c55e', fontSize: 14 }}>✓</span>}
              </div>
              {hasError('email') && <div id="email-error" style={{ color: '#ef4444', fontSize: 11.5, marginTop: 4 }}>{errors.email}</div>}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle} htmlFor="phone">Phone Number</label>
              <div style={{ display: 'flex', alignItems: 'center', height: 46, border: hasError('phone') ? '1px solid #ef4444' : showSuccess('phone') ? '1px solid #22c55e' : '1px solid #e5e2da', borderRadius: 12, background: '#fff', overflow: 'hidden' }} aria-invalid={hasError('phone')} aria-describedby={hasError('phone') ? 'phone-error' : undefined}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', background: '#f8f7f5', height: '100%', borderRight: '1px solid #e5e2da', fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--navy)' }}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                  +63
                </div>
                <input
                  id="phone"
                  ref={(el) => (fieldRefs.current.phone = el)}
                  value={phone}
                  onChange={handlePhoneChange}
                  onPaste={handlePhonePaste}
                  onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                  placeholder="9XX XXX XXXX"
                  inputMode="numeric"
                  required
                  aria-invalid={hasError('phone')}
                  aria-describedby={hasError('phone') ? 'phone-error' : undefined}
                  style={{ flex: 1, border: 'none', outline: 'none', padding: '0 12px', fontSize: 13, background: 'transparent' }}
                />
                {hasError('phone') && <span style={{ paddingRight: 8, color: '#ef4444', fontSize: 16 }}>⚠</span>}
                {showSuccess('phone') && <span style={{ paddingRight: 8, color: '#22c55e', fontSize: 14 }}>✓</span>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px', height: '100%' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#9CA3AF' }}><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#9CA3AF' }}><path d="m6 9 6 6 6-6"/></svg>
                </div>
              </div>
              {hasError('phone') && <div id="phone-error" style={{ color: '#ef4444', fontSize: 11.5, marginTop: 4 }}>{errors.phone}</div>}
              {!hasError('phone') && phone && showSuccess('phone') && <div style={{ color: '#22c55e', fontSize: 11.5, marginTop: 4 }}>Valid: {phoneNormalized}</div>}
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle} htmlFor="password">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="password"
                  ref={(el) => (fieldRefs.current.password = el)}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { clearServerError('password'); setPassword(e.target.value); }}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  placeholder="Min. 8 characters"
                  required
                  aria-invalid={hasError('password')}
                  aria-describedby={hasError('password') ? 'password-error' : 'password-strength'}
                  style={getInputStyle(hasError('password'), showSuccess('password'))}
                />
                <button type="button" onClick={() => setShowPassword(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', display: 'grid', placeItems: 'center' }} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.94 10.94 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.59 9.59 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
                {hasError('password') && <span style={{ position: 'absolute', right: 40, top: '50%', transform: 'translateY(-50%)', color: '#ef4444', fontSize: 16 }}>⚠</span>}
              </div>
              {hasError('password') && <div id="password-error" style={{ color: '#ef4444', fontSize: 11.5, marginTop: 4 }}>{errors.password}</div>}
              {password && (
                <div id="password-strength" style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < strengthMeta.filled ? (pwdStrength.label === 'Very Weak' ? '#ef4444' : pwdStrength.label === 'Weak' ? '#f97316' : pwdStrength.label === 'Fair' ? '#eab308' : pwdStrength.label === 'Strong' ? '#22c55e' : '#16a34a') : '#e5e7eb' }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 11.5, color: pwdStrength.label === 'Very Weak' ? '#ef4444' : pwdStrength.label === 'Weak' ? '#f97316' : pwdStrength.label === 'Fair' ? '#ca8a04' : '#16a34a', fontWeight: 600 }}>Password strength: {pwdStrength.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Use uppercase, lowercase, numbers, and symbols for a stronger password.</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 6, fontSize: 11 }}>
                    {pwdChecks.map((c) => (
                      <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 4, color: c.ok ? '#16a34a' : 'var(--muted)' }}>
                        <span style={{ fontSize: 12 }}>{c.ok ? '✓' : '○'}</span> {c.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle} htmlFor="confirmPassword">Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="confirmPassword"
                  ref={(el) => (fieldRefs.current.confirmPassword = el)}
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => { clearServerError('confirmPassword'); setConfirmPassword(e.target.value); }}
                  onBlur={() => setTouched((t) => ({ ...t, confirmPassword: true }))}
                  placeholder="Re-enter password"
                  required
                  aria-invalid={hasError('confirmPassword')}
                  aria-describedby={hasError('confirmPassword') ? 'confirmPassword-error' : undefined}
                  style={getInputStyle(hasError('confirmPassword'), showSuccess('confirmPassword'))}
                />
                <button type="button" onClick={() => setShowConfirm(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', display: 'grid', placeItems: 'center' }} aria-label={showConfirm ? 'Hide password' : 'Show password'}>
                  {showConfirm ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.94 10.94 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.59 9.59 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
                {hasError('confirmPassword') && <span style={{ position: 'absolute', right: 40, top: '50%', transform: 'translateY(-50%)', color: '#ef4444', fontSize: 16 }}>⚠</span>}
                {showSuccess('confirmPassword') && <span style={{ position: 'absolute', right: 40, top: '50%', transform: 'translateY(-50%)', color: '#22c55e', fontSize: 14 }}>✓</span>}
              </div>
              {hasError('confirmPassword') && <div id="confirmPassword-error" style={{ color: '#ef4444', fontSize: 11.5, marginTop: 4 }}>{errors.confirmPassword}</div>}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 20, fontSize: 11.5, color: 'var(--muted)' }}>
              <input
                type="checkbox"
                id="terms"
                ref={(el) => (fieldRefs.current.terms = el)}
                checked={termsAgreed}
                onChange={() => {}}
                onClick={() => {
                  if (termsAgreed) setTermsAgreed(false);
                  else { setModalAgreementChecked(false); setTermsModalOpen(true); }
                }}
                readOnly
                aria-invalid={hasError('terms')}
                aria-describedby={hasError('terms') ? 'terms-error' : undefined}
                style={{ cursor: 'pointer' }}
              />
              <span
                onClick={() => {
                  if (termsAgreed) setTermsAgreed(false);
                  else { setModalAgreementChecked(false); setTermsModalOpen(true); }
                }}
                style={{ cursor: 'pointer' }}
              >
                I agree to the Terms & Privacy Policy.
              </span>
            </div>
            {hasError('terms') && <div id="terms-error" style={{ color: '#ef4444', fontSize: 11.5, marginTop: -12, marginBottom: 12 }}>{errors.terms}</div>}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!isFormValid || isSubmitting}
              aria-disabled={!isFormValid || isSubmitting}
              style={{ width: '100%', minHeight: 46, justifyContent: 'center', textAlign: 'center', opacity: (!isFormValid || isSubmitting) ? 0.6 : 1, cursor: (!isFormValid || isSubmitting) ? 'not-allowed' : 'pointer' }}
            >
              {isSubmitting ? 'Creating account...' : 'Create Account'}
            </button>
          </form>
          <p style={{ textAlign: 'center', marginTop: 22, fontSize: 12, color: 'var(--muted)' }}>Already have an account? <Link to="/login" style={{ color: 'var(--navy)', fontWeight: 700 }}>Sign in</Link></p>
        </div>
      </main>
      <TermsPolicyModal
        open={termsModalOpen}
        onClose={() => { setTermsModalOpen(false); setModalAgreementChecked(false); }}
        agreed={modalAgreementChecked}
        setAgreed={setModalAgreementChecked}
        onAgree={() => {
          if (!modalAgreementChecked) return;
          setTermsAgreed(true);
          setTouched((t) => ({ ...t, terms: true }));
          setTermsModalOpen(false);
          setModalAgreementChecked(false);
        }}
      />
      <AssistantWidget mode="customer" />
    </div>
  );
}
