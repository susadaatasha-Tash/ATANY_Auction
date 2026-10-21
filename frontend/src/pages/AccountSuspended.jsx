// frontend/src/pages/AccountSuspended.jsx
// The ONE canonical suspended-account destination (customer AND shop owner).
//
// The suspension system itself is unchanged: admins suspend an account via
// Admin → Users (users.status = 'suspended') with a real reason, the backend
// rejects protected calls with 403 ACCOUNT_SUSPENDED, and /auth/me reports the
// status plus the CURRENT reason. This page gives that state a real
// destination and shows the account owner exactly why their account is paused.
import { Link } from 'react-router-dom';
import { ShieldAlert, Mail, LogOut, ArrowLeft } from 'lucide-react';
import { useAuth } from '../shared/hooks/useAuth';
import { PublicHeader } from '../shared/components/PublicHeader';
import { roleHome } from '../shared/lib/roleRoutes';

export default function AccountSuspended() {
  const { user, role, status, suspensionReason, loading, signOut } = useAuth();
  const isSuspended = String(status || '').toLowerCase() === 'suspended';
  const isSeller = role === 'shop_owner';
  const home = roleHome(role);
  const accountName = user?.user_metadata?.name || user?.email || 'Your account';
  const reason = (suspensionReason || '').trim();

  // The support channel is the existing ATANY support address; the context is
  // prefilled so support can act without exposing admin-only information.
  const supportSubject = `Account Suspension — ${accountName}`;
  const supportBody = [
    'Hi ATANY Support,',
    '',
    `My ATANY account has been suspended and I would like to understand the next steps.`,
    '',
    `Account: ${accountName}`,
    `Role: ${isSeller ? 'Shop Owner' : role === 'admin' ? 'Administrator' : 'Customer'}`,
    reason ? `Suspension reason: ${reason}` : 'Suspension reason: (not provided)',
    '',
    'Thank you.',
  ].join('\n');
  const supportHref = `mailto:support@atany.ph?subject=${encodeURIComponent(supportSubject)}&body=${encodeURIComponent(supportBody)}`;

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
            {isSeller
              ? 'If you believe this was a mistake or need assistance, please contact ATANY Support.'
              : 'If you believe this was a mistake or need assistance, please contact ATANY Support.'}
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a className="btn btn-primary" href={supportHref}>
              <Mail size={15} /> Contact Support
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
    </div>
  );
}
