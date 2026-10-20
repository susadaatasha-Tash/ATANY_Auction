// frontend/src/pages/AuthCallback.jsx
// Handles Supabase email confirmation redirect: /auth/callback
// Supabase sends user here via emailRedirectTo = `${window.location.origin}/auth/callback`
// Works on desktop, LAN IP, and production without hardcoded localhost.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../shared/lib/supabaseClient';

export default function AuthCallback() {
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const timerIds = [];

    async function process() {
      // Check for error in URL (hash or query) — Supabase appends ?error=&error_code=&error_description=
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
      const error = url.searchParams.get('error') || hash.get('error');
      const errorCode = url.searchParams.get('error_code') || hash.get('error_code');
      const errorDesc = url.searchParams.get('error_description') || hash.get('error_description');

      if (error) {
        if (cancelled) return;
        // Safe error message — do not expose raw token
        let safeMsg = 'This confirmation link is invalid or has expired.';
        if (errorCode === 'otp_expired' || /expired/i.test(errorDesc || '')) {
          safeMsg = 'This confirmation link has expired. Please request a new one or try signing up again.';
        } else if (errorDesc) {
          // Only show generic, not raw Supabase internals if too verbose
          safeMsg = decodeURIComponent(errorDesc).replace(/\+/g, ' ').slice(0, 200);
          if (!safeMsg.toLowerCase().includes('expired') && !safeMsg.toLowerCase().includes('invalid')) {
            safeMsg = 'This confirmation link is invalid or has expired.';
          }
        }
        setStatus('error');
        setMessage(safeMsg);
        return;
      }

      // Allow Supabase to process PKCE code / hash session first
      // supabase-js with detectSessionInUrl will auto-exchange ?code=... on getSession()
      // Explicitly exchange code if present for robustness (mobile PKCE flow)
      const code = url.searchParams.get('code');
      if (code) {
        try {
          // supabase-js v2: exchangeCodeForSession expects the code string
          if (typeof supabase.auth.exchangeCodeForSession === 'function') {
            await supabase.auth.exchangeCodeForSession(code);
          }
        } catch {}
      }
      // Poll briefly for session to appear
      let session = null;
      for (let i = 0; i < 5; i++) {
        try {
          const { data } = await supabase.auth.getSession();
          if (data?.session) { session = data.session; break; }
        } catch {}
        // Also check hash for implicit flow access_token as fallback
        const hashHasToken = url.hash.includes('access_token') || hash.has('access_token');
        if (hashHasToken) {
          await new Promise((r) => setTimeout(r, 300));
        } else if (i === 0) {
          await new Promise((r) => setTimeout(r, 500));
        } else {
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      if (cancelled) return;
      if (session) {
        setStatus('success');
        setMessage('Your email has been confirmed. Redirecting to sign in…');
        const t = setTimeout(() => navigate('/login', { replace: true }), 1800);
        timerIds.push(t);
      } else {
        // No session and no error — could be already verified, or link used already
        // Show success-like but with link to login, or error with recovery
        // Check if code param exists but no session — likely expired
        const hasCode = url.searchParams.has('code') || hash.has('code');
        if (hasCode) {
          setStatus('error');
          setMessage('This confirmation link is invalid or has expired. Please try signing up again or request a new confirmation email.');
        } else {
          // Fallback: treat as success to allow user to proceed to login (session may be set via cookie)
          // But to be safe, ask to log in
          setStatus('success');
          setMessage('If your email was confirmed, you can now sign in.');
          const t = setTimeout(() => navigate('/login', { replace: true }), 1800);
          timerIds.push(t);
        }
      }
    }

    process();
    return () => {
      cancelled = true;
      timerIds.forEach(clearTimeout);
    };
  }, [navigate]);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--ivory, #FFFEFA)' }}>
      <div style={{ width: 'min(420px, 100%)', background: '#fff', border: '1px solid #e5e2da', borderRadius: 12, padding: 32, textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
        {status === 'loading' && (
          <>
            <div style={{ width: 36, height: 36, border: '3px solid #e5e2da', borderTopColor: 'var(--gold, #C89B3C)', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />
            <h1 style={{ fontSize: 18, color: 'var(--navy, #142A4A)', marginBottom: 8 }}>Verifying your email…</h1>
            <p style={{ fontSize: 13, color: 'var(--muted, #7B8493)' }}>Please wait while we confirm your account.</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </>
        )}
        {status === 'success' && (
          <>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f0fdf4', color: '#16a34a', display: 'grid', placeItems: 'center', fontSize: 24, margin: '0 auto 16px' }}>✓</div>
            <h1 style={{ fontSize: 18, color: 'var(--navy, #142A4A)', marginBottom: 8 }}>Email confirmed</h1>
            <p style={{ fontSize: 13, color: 'var(--muted, #7B8493)', marginBottom: 16 }}>{message}</p>
            <Link to="/login" style={{ display: 'inline-block', background: 'var(--navy, #142A4A)', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>Continue to Sign in</Link>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fef2f2', color: '#ef4444', display: 'grid', placeItems: 'center', fontSize: 20, margin: '0 auto 16px' }}>⚠</div>
            <h1 style={{ fontSize: 18, color: 'var(--navy, #142A4A)', marginBottom: 8 }}>Confirmation failed</h1>
            <p style={{ fontSize: 13, color: 'var(--muted, #7B8493)', marginBottom: 16 }}>{message}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <Link to="/login" style={{ background: 'var(--navy, #142A4A)', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>Back to Sign in</Link>
              <Link to="/signup" style={{ background: '#fff', color: 'var(--navy, #142A4A)', border: '1px solid #e5e2da', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>Create Account</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
