// frontend/src/pages/AccountSuspended.jsx
// /account-suspended — the ONE canonical suspended-account route.
//
// A suspended customer may authenticate (their identity token is valid) but is
// not authorized to use the platform. They land here instead of Customer Home,
// from any of these triggers:
//   · login / bootstrap  (useAuth status !== 'active')
//   · route guard       (RequireActiveCustomer)
//   · realtime event    (account:status → suspended)
//   · API fallback      (403 ACCOUNT_SUSPENDED on any protected request)
//
// Design target: the approved Account Suspended visual — warm cream, navy,
// gold accent, soft blush warning field, large lock icon, generous whitespace.
// Deliberately NOT a browser error page, and deliberately NOT a dead end.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ShieldAlert, HelpCircle } from 'lucide-react';
import { useAuth } from '../shared/hooks/useAuth';
import { ACCOUNT_STATUS_EVENT } from '../shared/hooks/useAuth';
import { supabase } from '../shared/lib/supabaseClient';
import { socket } from '../shared/lib/socketClient';
import { NotificationBell } from '../shared/components/NotificationBell';
import { useToast } from '../shared/components/Toast';
import './account-suspended.css';

export function useAccountSuspended() {
  const { user, status } = useAuth();
  return Boolean(user) && status === 'suspended';
}

/** Reactivation detection: this page also reports when the account comes back. */
export default function AccountSuspended() {
  const { user, status, role, loading } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  const [wasSuspended, setWasSuspended] = useState(status === 'suspended');
  const [reactivated, setReactivated] = useState(status === 'active');

  // If the account is reactivated while this page is open, show the recovered
  // state instead of a stale "suspended" screen.
  useEffect(() => {
    if (status === 'active' && wasSuspended) {
      setReactivated(true);
      setWasSuspended(false);
    }
    if (status === 'suspended') { setWasSuspended(true); setReactivated(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const signOutFully = async () => {
    try { socket.disconnect(); } catch { /* noop */ }
    try { await supabase.auth.signOut(); } catch { /* noop */ }
    try { localStorage.removeItem(Object.keys(localStorage).find((k) => k.includes('auth-token')) || ''); } catch { /* noop */ }
    window.location.href = '/login';
  };

  const continueToAtany = () => {
    const home = role === 'shop_owner' ? '/shop' : role === 'admin' ? '/admin' : '/customer';
    navigate(home, { replace: true });
  };

  // Contact Support opens the SAME real support channel the app already uses
  // (support_requests, identical to roles/customer/pages/Settings.jsx) — not an
  // invented address and not a dead button. It is reachable while suspended
  // because it does not go through the protected /customer API surface.
  const [supportOpen, setSupportOpen] = useState(false);
  const [subject, setSubject] = useState('Account suspension enquiry');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const sendSupportRequest = async () => {
    if (!subject.trim() || !message.trim()) return showToast('Please add a subject and message');
    try {
      setSending(true);
      const { error } = await supabase.from('support_requests').insert({
        name: user?.user_metadata?.name || user?.email || 'Customer',
        email: user?.email || 'unknown',
        subject: subject.trim(),
        message: message.trim(),
      });
      if (error) throw error;
      showToast('Message sent — we will reply within 1 business day');
      setSupportOpen(false);
      setMessage('');
    } catch (e) {
      showToast(e.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="acs-page">
        <div className="acs-card" role="status" aria-live="polite">
          <div className="acs-lock" aria-hidden="true"><Lock size={30} strokeWidth={1.6} /></div>
          <h1 className="acs-title">Checking your account…</h1>
          <p className="acs-text">One moment while we confirm your account status.</p>
        </div>
      </div>
    );
  }

  if (reactivated && status === 'active') {
    return (
      <div className="acs-page">
        <div className="acs-card" role="status" aria-live="polite">
          <div className="acs-lock acs-lock--ok" aria-hidden="true"><ShieldAlert size={30} strokeWidth={1.6} /></div>
          <h1 className="acs-title">Account Reactivated</h1>
          <p className="acs-text">Your ATANY account has been reactivated.</p>
          <button type="button" className="acs-btn acs-btn--gold" onClick={continueToAtany}>Continue to ATANY</button>
        </div>
      </div>
    );
  }

  return (
    <div className="acs-page">
      <header className="acs-head">
        <span className="acs-brand">
          <span className="acs-brand__mark" aria-hidden="true" />
          <span className="acs-brand__text">
            <strong>ATANY</strong>
            <em>Timeless Beauty,</em>
          </span>
        </span>
        {user ? <NotificationBell to="/customer/notifications" apiPath="/customer/notifications" /> : null}
      </header>

      <main className="acs-main">
        <div className="acs-card" role="alert" aria-live="assertive">
          <div className="acs-lock" aria-hidden="true"><Lock size={34} strokeWidth={1.5} /></div>
          <h1 className="acs-title">Account Suspended</h1>
          <p className="acs-text">
            Your ATANY account has been temporarily suspended.
            <br />
            You cannot participate in auctions or access customer features at this time.
          </p>

          <div className="acs-panel">
            <HelpCircle size={15} strokeWidth={2} aria-hidden="true" />
            <span>If you believe this is a mistake or need assistance, please contact ATANY Support.</span>
          </div>

          <button type="button" className="acs-btn acs-btn--gold" onClick={() => setSupportOpen(true)}>Contact Support</button>
          <button type="button" className="acs-btn acs-btn--ghost" onClick={signOutFully}>Try a different account</button>
        </div>
      </main>

      {supportOpen && (
        <div className="acs-modal-overlay" role="presentation" onClick={() => setSupportOpen(false)}>
          <div
            className="acs-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Contact ATANY Support"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="acs-modal__title">Contact ATANY Support</h2>
            <label className="acs-field">
              <span>Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label className="acs-field">
              <span>Message</span>
              <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell us what happened…" />
            </label>
            <div className="acs-modal__actions">
              <button type="button" className="acs-btn acs-btn--ghost" onClick={() => setSupportOpen(false)}>Cancel</button>
              <button type="button" className="acs-btn acs-btn--gold" onClick={sendSupportRequest} disabled={sending}>
                {sending ? 'Sending…' : 'Send message'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}