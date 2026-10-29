// frontend/src/shared/components/AccountStatusRedirect.jsx
// One place that reacts to an authoritative account-status change.
//
// Handles the realtime path (socket `account:status`) and the fallback path
// (any protected request answering 403 ACCOUNT_SUSPENDED, surfaced by
// shared/lib/apiClient as a window event). Individual pages never implement
// this — they keep rendering normally and the guard redirects.
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, ACCOUNT_STATUS_EVENT } from '../hooks/useAuth';
import { socket } from '../lib/socketClient';

export function AccountStatusRedirect() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    // Leave any live-auction presence immediately so a suspended user stops
    // being counted as a watcher from this tab.
    const leavePresence = () => {
      try {
        socket.emit('auction:unwatch', {});
        socket.disconnect();
      } catch { /* transport unavailable */ }
    };

    if (status === 'suspended') {
      leavePresence();
      if (pathname !== '/account-suspended') navigate('/account-suspended', { replace: true });
    }
    // NOTE: the reverse transition (active while on /account-suspended) is owned
    // by pages/AccountSuspended.jsx, which shows the "Account Reactivated" state
    // and an explicit "Continue to ATANY" action. Auto-navigating away here
    // would hide that confirmation and silently drop the customer on a landing
    // page, so this component deliberately does not handle it.
  }, [status, pathname, navigate]);

  // Defense in depth: react even if the auth state has not resolved yet.
  useEffect(() => {
    const onStatus = (e) => {
      const next = e?.detail?.status;
      if (next === 'suspended') {
        try { socket.disconnect(); } catch { /* noop */ }
        if (window.location.pathname !== '/account-suspended') {
          window.history.replaceState({}, '', '/account-suspended');
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      }
    };
    window.addEventListener(ACCOUNT_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(ACCOUNT_STATUS_EVENT, onStatus);
  }, []);

  return null;
}

export default AccountStatusRedirect;
