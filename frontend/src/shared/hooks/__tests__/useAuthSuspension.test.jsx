// frontend/src/shared/hooks/__tests__/useAuthSuspension.test.jsx
// The suspension signal chain:
//   • the realtime `account:status` event updates the status + the reason
//   • the API fallback (403 ACCOUNT_SUSPENDED) does the same
//   • a suspended account is routed to /account-suspended (no protected flash)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

const socketHandlers = {};
const { sessionMock, authMetaMock } = vi.hoisted(() => ({
  sessionMock: { session: { user: { id: 'u1' }, access_token: 'token' } },
  authMetaMock: {
    id: 'u1', name: 'Maria Santos', email: 'maria@example.com', role: 'customer',
    status: 'active', suspension_reason: null, preferred_branch_id: null,
  },
}));

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: sessionMock })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn(),
    },
  },
}));
vi.mock('../../lib/socketClient', () => ({
  socket: {
    connect: vi.fn(),
    on: vi.fn((ev, fn) => { socketHandlers[ev] = fn; }),
    off: vi.fn((ev) => { delete socketHandlers[ev]; }),
  },
}));

import { AuthProvider, RequireRole, ACCOUNT_SUSPENDED_EVENT } from '../useAuth';

function Probe() {
  return <div data-testid="protected">protected area</div>;
}
function SuspendedProbe() {
  return <div data-testid="suspended-page">suspended page</div>;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/customer']}>
      <AuthProvider>
        <Routes>
          <Route path="/customer" element={<RequireRole role="customer"><Probe /></RequireRole>} />
          <Route path="/account-suspended" element={<SuspendedProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  Object.keys(socketHandlers).forEach((k) => delete socketHandlers[k]);
  sessionMock.session = { user: { id: 'u1' }, access_token: 'token' };
  authMetaMock.status = 'active';
  authMetaMock.suspension_reason = null;
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ...authMetaMock }) }));
});

describe('suspension — the auth context', () => {
  it('an active account reaches the protected area', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByTestId('protected')).toBeInTheDocument());
  });

  it('the realtime account:status event suspends the session and keeps the reason', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByTestId('protected')).toBeInTheDocument());
    expect(typeof socketHandlers['account:status']).toBe('function');
    socketHandlers['account:status']({ status: 'suspended', reason: 'Suspicious bidding activity.' });
    await waitFor(() => expect(screen.getByTestId('suspended-page')).toBeInTheDocument());
  });

  it('the reactivation event clears the suspension (access restored)', async () => {
    const { unmount } = renderApp();
    await waitFor(() => expect(screen.getByTestId('protected')).toBeInTheDocument());
    socketHandlers['account:status']({ status: 'suspended', reason: 'Suspicious bidding activity.' });
    await waitFor(() => expect(screen.getByTestId('suspended-page')).toBeInTheDocument());
    socketHandlers['account:status']({ status: 'active' });
    await waitFor(() => expect(screen.getByTestId('suspended-page')).toBeInTheDocument());
    // A fresh visit to the protected area is allowed again.
    unmount();
    renderApp();
    await waitFor(() => expect(screen.getByTestId('protected')).toBeInTheDocument());
  });

  it('the 403 ACCOUNT_SUSPENDED fallback also suspends the session', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByTestId('protected')).toBeInTheDocument());
    window.dispatchEvent(new CustomEvent(ACCOUNT_SUSPENDED_EVENT, {
      detail: { reason: 'Suspicious bidding activity.' },
    }));
    await waitFor(() => expect(screen.getByTestId('suspended-page')).toBeInTheDocument());
  });

  it('a suspended account never reaches a protected portal (no protected flash)', async () => {
    authMetaMock.status = 'suspended';
    authMetaMock.suspension_reason = 'Suspicious bidding activity.';
    renderApp();
    await waitFor(() => expect(screen.getByTestId('suspended-page')).toBeInTheDocument());
    expect(screen.queryByTestId('protected')).toBeNull();
  });
});
