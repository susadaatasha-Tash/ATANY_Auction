// frontend/src/pages/AccountSuspended.jsx
// The ONE canonical suspended-account destination (customer AND shop owner).
//
// The suspension system itself is unchanged: admins suspend an account via
// Admin → Users (users.status = 'suspended') with a real reason, the backend
// rejects protected calls with 403 ACCOUNT_SUSPENDED, and /auth/me reports the
// status plus the CURRENT reason.
//
// "Contact ATANY Support" opens a REAL support request that is persisted in
// support_requests and notified to the official ATANY inbox — it is not a
// mailto-only dead end. The requester is NOT reactivated by contacting
// support; the request is informational and reviewed manually.
//
// PRIVACY: only the suspension reason the account owner can already see is
// included. No admin notes, no audit history, no admin identity.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, Mail, LogOut, ArrowLeft, Send, X } from 'lucide-react';
import { useAuth } from '../shared/hooks/useAuth';
import { PublicHeader } from '../shared/components/PublicHeader';
import { roleHome } from '../shared/lib/roleRoutes';
import SupportRequestForm from '../shared/components/SupportRequestForm';
import { SUPPORT_EMAIL, supportMailto } from '../shared/config/support';

const SUPPORT_CATEGORY = 'Account Issue';
const SUPPORT_SUBJECT = 'Suspended Account Inquiry';

export default function AccountSuspended() {
  const { user, role, status, suspensionReason, loading, signOut } = useAuth();
  const isSuspended = String(status || '').toLowerCase() === 'suspended';
  const isSeller = role === 'shop_owner';
  const home = roleHome(role);
  const accountName = user?.user_metadata?.name || user?.email || 'Your account';
  const reason = (suspensionReason || '').trim();

  const roleLabel = isSeller ? 'Shop Owner' : role === 'admin' ? 'Administrator' : 'Customer';

  const [formOpen, setFormOpen] = useState(false);
  const [reference, setReference] = useState('');
  const [mailSent, setMailSent] = useState(true);

  // Only the reason the account owner can already see is included.
  const prefillMessage = [
    'Hello ATANY Support,',
    '',
    'I would like assistance regarding my suspended account.',
    '',
    `Role: ${roleLabel}`,
    reason ? `Suspension reason: ${reason}` : 'Suspension reason: (not provided)',
    '',
    'Please provide guidance regarding my account.',
  ].join('\n');

  const openForm = () => {
    setReference('');
    setFormOpen(true);
  };

  // Secondary fallback — a direct email link (properly URL-encoded).
  const supportHref = supportMailto(
    `Account Suspension — ${accountName}`,
    prefillMessage
  );

  return (
    <div className="public-page">
      <PublicHeader />
      <main className="container" style={{ padding: '72px 0 96px', maxWidth: 720 }}>
        <div
          style={{
            background: 'var(--ivory)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow)',
            padding: '44px 40px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: '50%',
              background: 'rgba(180,82,82,.12)',
              color: '#b45252',
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 20px',
            }}
          >
            <ShieldAlert size={26} aria-hidden="true" />
          </div>

          <h1 style={{ fontSize: 30, color: 'var(--navy)', fontWeight: 800, marginBottom: 12 }}>
            Account Suspended
          </h1>

          <p style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--muted)', marginBottom: 10 }}>
            {isSuspended
              ? (isSeller
                ? 'Your ATANY seller account has been temporarily suspended, so protected seller features are paused.'
                : 'Your ATANY account has been temporarily suspended.')
              : 'This page is shown to accounts that have been suspended by the ATANY team.'}
          </p>

          {reason && (
            <div
              style={{
                textAlign: 'left',
                border: '1px solid var(--line)',
                background: '#fff',
                borderRadius: 12,
                padding: '14px 16px',
                margin: '18px 0 16px',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color: 'var(--muted)',
                  marginBottom: 6,
                }}
              >
                Reason for suspension
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--navy)', fontWeight: 600, whiteSpace: 'pre-wrap' }}>
                {reason}
              </div>
            </div>
          )}

          <p style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--muted)', marginBottom: 10 }}>
            {isSeller
              ? 'Your existing listings, auction history, orders and financial records have not been deleted.'
              : 'You cannot access protected ATANY features while your account is suspended.'}
          </p>
          <p style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--muted)', marginBottom: 26 }}>
            If you believe this was a mistake or need assistance, please contact ATANY Support.
          </p>

          {reference && (
            <div
              role="status"
              style={{
                border: '1px solid var(--line)',
                background: '#fff',
                borderRadius: 12,
                padding: '14px 16px',
                margin: '0 auto 22px',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 13, color: 'var(--navy)', fontWeight: 700, marginBottom: 4 }}>
                Support request sent
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                We've received your message. ATANY Support will review your request.
                <br />
                Reference: <strong>{reference}</strong>
              </div>
              {!mailSent && (
                <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, marginTop: 6 }}>
                  Email notification is temporarily delayed — you can also reach us at{' '}
                  <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--navy)', fontWeight: 700 }}>
                    {SUPPORT_EMAIL}
                  </a>
                  .
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={openForm}>
              <Send size={15} /> Contact ATANY Support
            </button>
            <a className="btn btn-outline" href={supportHref}>
              <Mail size={15} /> Email {SUPPORT_EMAIL}
            </a>
            <button type="button" className="btn btn-outline" onClick={signOut}>
              <LogOut size={15} /> Try a different account
            </button>
            {home && !isSuspended && (
              <Link className="btn btn-outline" to={home}>
                Go to My Account
              </Link>
            )}
            <Link className="btn btn-outline" to="/">
              <ArrowLeft size={15} /> Back to Home
            </Link>
          </div>

          {!loading && !user && (
            <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 22 }}>
              Signed in? <Link to="/login" style={{ color: 'var(--navy)', fontWeight: 700 }}>Sign in</Link> to view
              your account status.
            </p>
          )}
        </div>
      </main>

      {/* Support form — persisted support request (never a mailto dead end). */}
      {formOpen && (
        <div
          className="profile-modal-overlay"
          role="presentation"
          onClick={() => setFormOpen(false)}
          style={{ zIndex: 1200 }}
        >
          <div
            className="profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="suspended-support-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="profile-modal__head">
              <h3 id="suspended-support-title">
                <Send size={17} aria-hidden="true" /> Contact ATANY Support
              </h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setFormOpen(false)}
                aria-label="Close support form"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="profile-modal__body">
              <p className="form-hint">
                Contacting support does NOT reactivate your account — a team member will review your request.
              </p>
              <SupportRequestForm
                endpoint="/support/account"
                initialCategory={SUPPORT_CATEGORY}
                initialSubject={SUPPORT_SUBJECT}
                initialMessage={prefillMessage}
                submitLabel="Send Support Request"
                onSent={({ reference: ref, mailSent: sent }) => {
                  setReference(ref);
                  setMailSent(sent);
                  setFormOpen(false);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
