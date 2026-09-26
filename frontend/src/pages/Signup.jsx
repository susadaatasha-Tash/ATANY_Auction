// frontend/src/pages/Signup.jsx - Redesigned to match reference field styling
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../shared/lib/supabaseClient';
import { useToast } from '../shared/components/Toast';
import { AssistantWidget } from '../shared/components/AssistantWidget';
import TermsPolicyModal from '../components/TermsPolicyModal';
import loginBg from '../assests/Login_bg.jpg';

export default function Signup() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const role = 'customer';
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [modalAgreementChecked, setModalAgreementChecked] = useState(false);
  const showToast = useToast();
  const navigate = useNavigate();

  const handle = async (e) => {
    e.preventDefault();
    if (!termsAgreed) {
      showToast('Please agree to the Terms & Policy to create an account.');
      return;
    }
    const firstTrim = firstName.trim();
    const lastTrim = lastName.trim();
    if (!firstTrim || !lastTrim) {
      showToast('Please enter both first and last name');
      return;
    }
    const fullName = `${firstTrim} ${lastTrim}`.trim();
    const emailTrim = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      showToast('Please enter a valid email address (e.g., test+demo@email.com is allowed)');
      return;
    }
    if (password.length < 8) {
      showToast('Password must be at least 8 characters (Supabase requires 6+, we enforce 8 for security)');
      return;
    }
    if (password !== confirmPassword) {
      showToast('Passwords do not match — please re-enter');
      return;
    }
    // Phone is visual-only for now; not required for backend until confirmed
    // If phone is provided, basic validation
    if (phone && !/^9\d{2}\s?\d{3}\s?\d{4}$/.test(phone.replace(/\s+/g, '').replace(/^\+63/, '')) && phone.length > 0) {
      // Allow any 9XX format, but don't block submit — just warn
      console.warn('Phone format:', phone);
    }
    const normalizedRole = role.toLowerCase().trim();
      if (!['customer','shop_owner','admin'].includes(normalizedRole)) {
      showToast(`Invalid role "${role}" — must be customer or shop_owner`);
      return;
    }
    console.log('Signup attempt:', { email: emailTrim, role: normalizedRole, name: fullName, phone: phone ? `+63 ${phone}` : 'none' });
    const { data, error } = await supabase.auth.signUp({
      email: emailTrim, password,
      options: { data: { name: fullName, first_name: firstTrim, last_name: lastTrim, phone: phone ? `+63${phone.replace(/\s+/g,'')}` : undefined, role: normalizedRole } },
    });
    if (error) {
      console.error('Supabase signup failed:', error);
      const msg = error.message || '';
      if (msg.includes('already registered') || msg.includes('already exists') || error.status === 422) {
        showToast('This email is already registered — try Sign In instead');
      } else if (msg.includes('Password should be at least') || msg.includes('weak') || msg.includes('at least 6')) {
        showToast('Password must be at least 8 characters and include a number');
      } else if (msg.includes('Unable to validate email') || msg.includes('invalid format') || msg.includes('invalid email')) {
        showToast('Invalid email format — check for typos (e.g., test+demo@email.com is valid)');
      } else if (msg.includes('Failed to fetch') || msg.includes('Network') || error.status === 0) {
        showToast('Network/CORS error — check Supabase URL and API key in frontend/.env');
      } else {
        showToast(`Signup failed (${error.status || 'unknown'}): ${msg || 'invalid'}`);
      }
      return;
    }
    if (data.user?.id) {
      try {
        const { error: insertError } = await supabase.from('users').insert({
          id: data.user.id,
          name: fullName,
          email: emailTrim,
          password_hash: 'supabase_auth',
          role: normalizedRole,
          status: 'active',
        });
        if (insertError) {
          await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/auth/sync-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: data.user.id, name: fullName, email: emailTrim, role: normalizedRole }),
          }).catch(()=>{});
        }
      } catch (e) { console.warn('Users sync failed', e); }
    }
    showToast('Account created — check email for verification (Resend via Supabase SMTP, spec 4.6).');
    setTimeout(() => navigate('/login'), 700);
  };

  const inputStyle = {
    width: '100%',
    height: 46,
    padding: '0 14px',
    border: '1px solid #e5e2da',
    borderRadius: 12,
    outline: 'none',
    background: '#fff',
    color: 'var(--text)',
    fontSize: 13,
  };
  const labelStyle = {
    display: 'block',
    color: '#000',
    fontSize: 13,
    fontWeight: 700,
    marginBottom: 6,
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundImage: `url(${loginBg})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}>
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ width: 'min(480px,100%)', background: 'var(--ivory)', border: '1px solid #C89B3C', borderRadius: 4, padding: '36px 32px', boxShadow: '0 0 20px rgba(200, 155, 60, 0.30), 0 8px 35px rgba(200, 155, 60, 0.24), 0 2px 10px rgba(200, 155, 60, 0.18)' }}>
          <div style={{ color: 'var(--gold)', fontSize: 11, fontWeight: 700, letterSpacing: '.12em', marginBottom: 10, textAlign: 'center' }}>JOIN ATANY</div>
          <h1 style={{ fontSize: 30, color: 'var(--navy)', marginBottom: 6, textAlign: 'center' }}>Create Account</h1>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 26, textAlign: 'center' }}>Start discovering timeless pieces worth bidding for.</p>
          <form onSubmit={handle}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>First Name</label>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Isabella" required style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Last Name</label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Reyes" required style={inputStyle} />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Email Address</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required style={inputStyle} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Phone Number</label>
              <div style={{ display: 'flex', alignItems: 'center', height: 46, border: '1px solid #e5e2da', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', background: '#f8f7f5', height: '100%', borderRight: '1px solid #e5e2da', fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--navy)' }}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                  +63
                </div>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9XX XXX XXXX" style={{ flex: 1, border: 'none', outline: 'none', padding: '0 12px', fontSize: 13, background: 'transparent' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px', height: '100%' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#9CA3AF' }}><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#9CA3AF' }}><path d="m6 9 6 6 6-6"/></svg>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 characters" required style={{ ...inputStyle, paddingRight: 40 }} />
                <button type="button" onClick={() => setShowPassword(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', display: 'grid', placeItems: 'center' }} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.94 10.94 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.59 9.59 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showConfirm ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter password" required style={{ ...inputStyle, paddingRight: 40 }} />
                <button type="button" onClick={() => setShowConfirm(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', display: 'grid', placeItems: 'center' }} aria-label={showConfirm ? 'Hide password' : 'Show password'}>
                  {showConfirm ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.94 10.94 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.59 9.59 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 20, fontSize: 11.5, color: 'var(--muted)' }}>
              <input
                type="checkbox"
                checked={termsAgreed}
                onChange={() => {}}
                onClick={() => {
                  if (termsAgreed) {
                    setTermsAgreed(false);
                  } else {
                    setModalAgreementChecked(false);
                    setTermsModalOpen(true);
                  }
                }}
                readOnly
                style={{ cursor: 'pointer' }}
              />
              <span
                onClick={() => {
                  if (termsAgreed) {
                    setTermsAgreed(false);
                  } else {
                    setModalAgreementChecked(false);
                    setTermsModalOpen(true);
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                I agree to the Terms & Privacy Policy.
              </span>
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!termsAgreed}
              style={{ width: '100%', minHeight: 46, justifyContent: 'center', textAlign: 'center', opacity: termsAgreed ? 1 : 0.6, cursor: termsAgreed ? 'pointer' : 'not-allowed' }}
            >
              Create Account
            </button>
          </form>
          <p style={{ textAlign: 'center', marginTop: 22, fontSize: 12, color: 'var(--muted)' }}>Already have an account? <Link to="/login" style={{ color: 'var(--navy)', fontWeight: 700 }}>Sign in</Link></p>
        </div>
      </main>
      <TermsPolicyModal
        open={termsModalOpen}
        onClose={() => {
          setTermsModalOpen(false);
          setModalAgreementChecked(false);
        }}
        agreed={modalAgreementChecked}
        setAgreed={setModalAgreementChecked}
        onAgree={() => {
          if (!modalAgreementChecked) return;
          setTermsAgreed(true);
          setTermsModalOpen(false);
          setModalAgreementChecked(false);
        }}
      />
      <AssistantWidget mode="customer" />
    </div>
  );
}
