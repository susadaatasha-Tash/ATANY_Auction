// frontend/src/shared/hooks/__tests__/AccountSuspension.test.jsx
// Suspended CUSTOMER frontend behaviour: guards, the canonical route, login
// redirect, realtime + API-fallback handling, and sign-out cleanup.
//
// A valid Supabase session is AUTHENTICATION. It is not AUTHORIZATION. These
// tests pin the behaviour that makes an already-logged-in suspended customer
// lose real access without a manual refresh.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const apiFetch = vi.fn();
vi.mock('../../lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut,
    },
  },
}));
// hoisted so the vi.mock factories can reference them
const { socketHandlers, socketStub, signOut } = vi.hoisted(() => {
  const h = new Map();
  return {
    socketHandlers: h,
    signOut: vi.fn(),
    socketStub: {
      on: vi.fn((e, fn) => h.set(e, [...(h.get(e) || []), fn])),
      off: vi.fn((e, fn) => h.set(e, (h.get(e) || []).filter((f) => f !== fn))),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
  };
});
vi.mock('../../lib/socketClient', () => ({ socket: socketStub }));
vi.mock('../../components/Toast', () => ({ useToast: () => vi.fn() }));
vi.mock('../../components/NotificationBell', () => ({ NotificationBell: () => <span /> }));

import { AuthProvider, RequireActiveCustomer, useAuth } from '../useAuth';
import { AccountStatusRedirect } from '../../components/AccountStatusRedirect';
import AccountSuspended from '../../../pages/AccountSuspended';
import { ACCOUNT_SUSPENDED_EVENT } from '../useAuth';

const CUSTOMER = { id: 'cust-1', email: 'britz@example.com' };
const session = { access_token: 'tok', user: CUSTOMER };

function metaResponse(role, status) {
  return { ok: true, json: async () => ({ id: CUSTOMER.id, role, status, preferred_branch_id: 'br-1' }) };
}

function StatusProbe() {
  const { suspended, status } = useAuth();
  return <div data-testid="probe">{`${status}|${suspended}`}</div>;
}

async function renderApp(ui, { role = 'customer', status = 'active' } = {}) {
  global.fetch = vi.fn(async () => metaResponse(role, status));
  const user = userEvent.setup();
  const { supabase } = await import('../../lib/supabaseClient');
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  render(
    <MemoryRouter initialEntries={['/customer']}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(supabase.auth.getSession).toHaveBeenCalled());
  return user;
}

beforeEach(() => {
  apiFetch.mockReset();
  socketHandlers.clear();
  socketStub.on.mockClear();
  socketStub.emit.mockClear();
  socketStub.disconnect.mockClear();
  signOut.mockClear();
  signOut.mockResolvedValue({ error: null });
});

describe('auth bootstrap exposes the authoritative status', () => {
  test('1. an active customer has suspended === false', async () => {
    await renderApp(<StatusProbe />, { status: 'active' });
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('active|false'));
  });

  test('2. /auth/me status drives the suspended flag (not "role missing")', async () => {
    await renderApp(<StatusProbe />, { status: 'suspended' });
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('suspended|true'));
    // the console error about missing metadata must NOT appear for a suspended account
    expect(global.fetch).toHaveBeenCalled();
  });
});

describe('route guard — no bypass, no protected-page flash', () => {
  test('3. an active customer renders the protected page', async () => {
    await renderApp(
      <Routes>
        <Route path="/customer" element={<RequireActiveCustomer><div>Customer Home</div></RequireActiveCustomer>} />
        <Route path="/account-suspended" element={<div>Suspended Page</div>} />
      </Routes>,
      { status: 'active' }
    );
    expect(await screen.findByText('Customer Home')).toBeTruthy();
  });

  test('4. a suspended customer is redirected to /account-suspended', async () => {
    await renderApp(
      <Routes>
        <Route path="/customer" element={<RequireActiveCustomer><div>Customer Home</div></RequireActiveCustomer>} />
        <Route path="/account-suspended" element={<div>Suspended Page</div>} />
      </Routes>,
      { status: 'suspended' }
    );
    expect(await screen.findByText('Suspended Page')).toBeTruthy();
    // the protected page never rendered, so there is no frame of Customer Home
    expect(screen.queryByText('Customer Home')).toBeNull();
  });

  test('5. while the status is unknown, nothing protected is rendered yet', async () => {
    global.fetch = vi.fn(() => new Promise(() => {}));
    const { supabase } = await import('../../lib/supabaseClient');
    supabase.auth.getSession.mockResolvedValue({ data: { session } });
    render(
      <MemoryRouter initialEntries={['/customer']}>
        <AuthProvider>
          <Routes>
            <Route path="/customer" element={<RequireActiveCustomer><div>Customer Home</div></RequireActiveCustomer>} />
            <Route path="/account-suspended" element={<div>Suspended Page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText('Customer Home')).toBeNull();
    expect(screen.queryByText('Suspended Page')).toBeNull();
  });

  test('6. reactivation is confirmed on the page and needs a deliberate return', async () => {
    const userEvt = userEvent.setup();
    await renderApp(
      <Routes>
        <Route path="/customer" element={<RequireActiveCustomer><div>Customer Home</div></RequireActiveCustomer>} />
        <Route path="/account-suspended" element={<AccountSuspended />} />
      </Routes>,
      { status: 'suspended' }
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Account Suspended')).toBeTruthy();

    // reactivation arrives over the SAME socket event the server emits
    (socketHandlers.get('account:status') || []).forEach((fn) => fn({ userId: CUSTOMER.id, status: 'active' }));
    expect(await screen.findByText('Account Reactivated')).toBeTruthy();
    expect(screen.queryByText('Account Suspended')).toBeNull();

    // leaving is an explicit customer action, never an automatic bounce
    await userEvt.click(screen.getByRole('button', { name: /continue to atany/i }));
    expect(await screen.findByText('Customer Home')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.getAllByText('Customer Home')).toHaveLength(1); // no redirect loop
  });
});

describe('realtime + API fallback', () => {
  test('7. an account:status event flips the global state immediately', async () => {
    await renderApp(<StatusProbe />, { status: 'active' });
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('active|false'));
    (socketHandlers.get('account:status') || []).forEach((fn) => fn({ userId: CUSTOMER.id, status: 'suspended' }));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('suspended|true'));
  });

  test('8. an event for a DIFFERENT user id is ignored', async () => {
    await renderApp(<StatusProbe />, { status: 'active' });
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('active|false'));
    (socketHandlers.get('account:status') || []).forEach((fn) => fn({ userId: 'someone-else', status: 'suspended' }));
    await new Promise((r) => setTimeout(r, 40));
    expect(screen.getByTestId('probe').textContent).toBe('active|false');
  });

  test('10. after a forced disconnect the tab still learns it was reactivated', async () => {
    // Suspension force-disconnects the customer's sockets server-side, so the
    // reactivation EVENT can no longer arrive. The tab must re-read the
    // authoritative status instead of staying stuck on a stale screen.
    await renderApp(<StatusProbe />, { status: 'suspended' });
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('suspended|true'));

    // the server has reactivated the account
    global.fetch = vi.fn(async () => metaResponse('customer', 'active'));
    window.dispatchEvent(new Event('focus')); // customer comes back to the tab

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('active|false'));
    expect(global.fetch).toHaveBeenCalled(); // it re-read /auth/me, it did not guess
  });

  test('9. the 403 ACCOUNT_SUSPENDED API fallback works even without realtime', async () => {
    await renderApp(<StatusProbe />, { status: 'active' });
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('active|false'));
    window.dispatchEvent(new CustomEvent(ACCOUNT_SUSPENDED_EVENT, { detail: { code: 'ACCOUNT_SUSPENDED' } }));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('suspended|true'));
  });
});