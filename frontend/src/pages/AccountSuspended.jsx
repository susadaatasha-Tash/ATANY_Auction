// frontend/src/pages/AccountSuspended.jsx
// Landing destination for a suspended account.
//
// The suspension system itself is unchanged: admins suspend an account via
// Admin → Users (users.status = 'suspended'), the backend rejects bids with
// 403 ACCOUNT_SUSPENDED, and /auth/me reports the status. This page only
// gives that state a real destination so no link in the app can dead-end or
// bypass the guard.
import { Link } from 'react-router-dom';
import { ShieldAlert, Mail, ArrowLeft } from 'lucide-react';
import { useAuth } from '../shared/hooks/useAuth';
import { PublicHeader } from '../shared/components/PublicHeader';
import { roleHome } from '../shared/lib/roleRoutes';

export default function AccountSuspended() {
  const { user, role, status, loading } = useAuth();
  const isSuspended = String(status || '').toLowerCase() === 'suspended';
  const home = roleHome(role);

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
              background: 'rgba(196,162,101,.12)',
              color: 'var(--gold)',
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
              ? 'Your ATANY account is currently suspended, so bidding, checkout and account actions are paused.'
              : 'This page is shown to accounts that have been suspended by the ATANY team.'}
          </p>
          <p style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--muted)', marginBottom: 26 }}>
            Auction history and saved items are preserved. Contact our support team with your registered email
            address and we will review your account.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a className="btn btn-primary" href="mailto:support@atany.ph">
              <Mail size={15} /> Contact Support
            </a>
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
