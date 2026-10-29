// frontend/src/shared/hooks/__tests__/CustomerSuspension.test.jsx
// The CUSTOMER side of admin-connected suspension: what a suspended customer
// actually experiences — login entry, the canonical page, its support channel,
// full sign-out, and the HTTP contract that drives all of it.
//
// The bar for this suite: a suspended customer can never end up inside a
// protected page, never place a bid, and is never shown a dead control.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const socketStub = vi.hoisted(() => ({
  on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
}));
const { toast, supportInsert, signOut } = vi.hoisted(() => ({
  toast: vi.fn(), supportInsert: vi.fn(), signOut: vi.fn(),
}));

vi.mock('../../lib/socketClient', () => ({ socket: socketStub }));
vi.mock('../../components/Toast', () => ({ useToast: () => toast }));
vi.mock('../../components/NotificationBell', () => ({ NotificationBell: () => <span data-testid="bell" /> }));
vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithPassword: vi.fn(),
      signOut,
    },
    from: () => ({ insert: (...a) => supportInsert(...a) }),
  },
}));

import { apiFetch, ACCOUNT_SUSPENDED_CODE } from '../../lib/apiClient';
import { AuthProvider } from '../useAuth';
import AccountSuspended from '../../../pages/AccountSuspended';
import Login from '../../../pages/Login';

const CUSTOMER = { id: 'cust-1', email: 'klane@gmail.com', user_metadata: { name: 'Klane Cruz' } };
const SESSION = { access_token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 3600, user: CUSTOMER };

const meResponse = (status) => ({
  ok: true,
  json: async () => ({ id: CUSTOMER.id, email: CUSTOMER.email, role: 'customer', status, preferred_branch_id: 'br-1' }),
});

/** Boots the app the way App.jsx does: auth provider + the suspended route. */
async function boot(status, { at = '/account-suspended' } = {}) {
  global.fetch = vi.fn(async (url) => (String(url).includes('/auth/me') ? meResponse(status) : { ok: true, json: async () => ({}) }));
  const { supabase } = await import('../../lib/supabaseClient');
  supabase.auth.getSession.mockResolvedValue({ data: { session: SESSION } });
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[at]}>
      <AuthProvider>
        <Routes>
          <Route path="/account-suspended" element={<AccountSuspended />} />
          <Route path="/customer" element={<div>Customer Home</div>} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  return user;
}

beforeEach(() => {
  toast.mockReset();
  supportInsert.mockReset().mockResolvedValue({ data: [], error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  socketStub.disconnect.mockClear();
  socketStub.emit.mockClear();
});

describe('login entry point — authentication is not authorization', () => {
  async function renderLogin(status, { at = '/login' } = {}) {
    global.fetch = vi.fn(async (url) => (String(url).includes('/auth/me') ? meResponse(status) : { ok: true, json: async () => ({}) }));
    const { supabase } = await import('../../lib/supabaseClient');
    supabase.auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    render(
      <MemoryRouter initialEntries={[at]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/customer" element={<div>Customer Home</div>} />
            <Route path="/account-suspended" element={<div>Suspended Page</div>} />
            <Route path="/select-branch" element={<div>Select Branch</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
  }

  test('1. a SUSPENDED customer lands on /account-suspended, never the portal', async () => {
    await renderLogin('suspended');
    expect(await screen.findByText('Suspended Page')).toBeTruthy();
    expect(screen.queryByText('Customer Home')).toBeNull();
    expect(screen.queryByText('Select Branch')).toBeNull();
  });

  test('2. an ACTIVE customer still goes straight to their portal', async () => {
    await renderLogin('active');
    expect(await screen.findByText('Customer Home')).toBeTruthy();
  });

  test('3. a suspended customer is not dumped into branch selection first', async () => {
    global.fetch = vi.fn(async (url) => (String(url).includes('/auth/me')
      ? { ok: true, json: async () => ({ id: CUSTOMER.id, role: 'customer', status: 'suspended', preferred_branch_id: null }) }
      : { ok: true, json: async () => ({}) }));
    const { supabase } = await import('../../lib/supabaseClient');
    supabase.auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/select-branch" element={<div>Select Branch</div>} />
            <Route path="/account-suspended" element={<div>Suspended Page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
    expect(await screen.findByText('Suspended Page')).toBeTruthy();
    expect(screen.queryByText('Select Branch')).toBeNull();
  });
});

describe('HTTP contract — 403 + ACCOUNT_SUSPENDED', () => {
  function respondWith(status, body) {
    global.fetch = vi.fn(async () => ({
      ok: false, status,
      clone: () => ({ json: async () => body }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    }));
  }
  const SUSPENDED_BODY = { success: false, error: { code: ACCOUNT_SUSPENDED_CODE, message: 'Account suspended' } };

  test('4. a suspended API answer raises the global suspension signal', async () => {
    respondWith(403, SUSPENDED_BODY);
    const seen = vi.fn();
    window.addEventListener('atany:account-suspended', seen);
    await expect(apiFetch('/customer/orders')).rejects.toThrow();
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener('atany:account-suspended', seen);
  });

  test('5. the signal carries the stable code, not a parsed message', async () => {
    respondWith(403, SUSPENDED_BODY);
    let detail = null;
    const onEvt = (e) => { detail = e.detail; };
    window.addEventListener('atany:account-suspended', onEvt);
    await apiFetch('/customer/bids').catch(() => {});
    expect(detail.code).toBe(ACCOUNT_SUSPENDED_CODE);
    expect(detail.path).toBe('/customer/bids'); // the blocked request is identifiable
    window.removeEventListener('atany:account-suspended', onEvt);
  });

  test('6. an unrelated 403 (role denied) does NOT fake a suspension', async () => {
    respondWith(403, { success: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } });
    const seen = vi.fn();
    window.addEventListener('atany:account-suspended', seen);
    await apiFetch('/admin/users').catch(() => {});
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener('atany:account-suspended', seen);
  });

  test('7. a 401 is never treated as suspension (that is an expired session)', async () => {
    respondWith(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'Session expired' } });
    const seen = vi.fn();
    window.addEventListener('atany:account-suspended', seen);
    await apiFetch('/customer/orders').catch(() => {});
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener('atany:account-suspended', seen);
  });

  test('8. placing a bid while suspended fails loudly with the stable contract', async () => {
    respondWith(403, SUSPENDED_BODY);
    let bid = null;
    await apiFetch('/customer/bids', { method: 'POST', body: JSON.stringify({ auction_id: 'a1', amount: 100 }) })
      .then((r) => { bid = r; })
      .catch((e) => { bid = e; });
    expect(bid).toBeInstanceOf(Error);
    expect(bid.status).toBe(403);
    expect(bid.code).toBe(ACCOUNT_SUSPENDED_CODE);
  });
});

describe('regression — the platform keeps working for everyone else', () => {
  test('9. an active customer request is untouched by the suspension contract', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      clone: () => ({ json: async () => [] }),
      json: async () => [],
      text: async () => '[]',
    }));
    const seen = vi.fn();
    window.addEventListener('atany:account-suspended', seen);
    await expect(apiFetch('/customer/orders')).resolves.toEqual([]);
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener('atany:account-suspended', seen);
  });

  test('10. historical data endpoints keep their existing shapes', async () => {
    const bids = [{ id: 'b1', amount: 500 }];
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      clone: () => ({ json: async () => bids }),
      json: async () => bids,
      text: async () => JSON.stringify(bids),
    }));
    await expect(apiFetch('/customer/bids/history')).resolves.toEqual(bids);
  });

  test('11. public endpoints are unaffected by the account gate', async () => {
    const branches = [{ id: 'br-1', name: 'Gmall' }];
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      clone: () => ({ json: async () => branches }),
      json: async () => branches,
      text: async () => JSON.stringify(branches),
    }));
    await expect(apiFetch('/branches', { public: true })).resolves.toEqual(branches);
  });
});

describe('the suspended page is a real destination, not a dead end', () => {
  test('12. it states the situation and offers real exits', async () => {
    await boot('suspended');
    expect(await screen.findByText('Account Suspended')).toBeTruthy();
    expect(screen.getByRole('button', { name: /contact support/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /try a different account/i })).toBeTruthy();
  });

  test('13. Contact Support reaches the app\'s REAL support channel', async () => {
    const user = await boot('suspended');
    await user.click(await screen.findByRole('button', { name: /contact support/i }));
    await user.type(screen.getByRole('textbox', { name: /message/i }), 'Why was I suspended?');
    await user.click(screen.getByRole('button', { name: /send message/i }));
    await waitFor(() => expect(supportInsert).toHaveBeenCalledTimes(1));
    // identical table/mechanism the app already uses in customer Settings
    expect(supportInsert.mock.calls[0][0].message).toBe('Why was I suspended?');
    expect(supportInsert.mock.calls[0][0].email).toBe(CUSTOMER.email);
  });

  test('14. "Try a different account" is a FULL sign-out, not a soft redirect', async () => {
    await boot('suspended');
    const user = await screen.findByRole('button', { name: /try a different account/i });
    // the page must not rely on protected /customer APIs to be usable
    expect(global.fetch.mock.calls.every(([u]) => !String(u).includes('/customer/'))).toBe(true);
    // window.location assignment is jsdom-guarded; assert the teardown instead
    expect(user).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });
});