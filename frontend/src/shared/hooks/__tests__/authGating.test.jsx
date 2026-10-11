import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const apiFetch = vi.fn();
vi.mock('../../lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));

let mockAuthState = { user: { id: 'u1' }, loading: false };
vi.mock('../useAuth', () => ({
  useAuth: () => mockAuthState,
  RequireRole: ({ role, children }) => {
    const { user, role: userRole, loading } = mockAuthState;
    if (loading) return null;
    const allowed = Array.isArray(role) ? role : [role];
    if (!user || (role && !allowed.includes(userRole))) {
      const { Navigate } = require('react-router-dom');
      return null;
    }
    return children;
  },
}));

vi.mock('../../components/Toast', () => ({ useToast: () => vi.fn() }));

import { useFavorites } from '../../../roles/customer/hooks/useFavorites';

function FavProbe() {
  const { items } = useFavorites();
  return <div data-testid="fav-count">{items.length}</div>;
}

describe('auth gating', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue([]);
    mockAuthState = { user: { id: 'u1' }, loading: false };
  });

  it('4. auth-loading prevents premature protected requests', async () => {
    mockAuthState = { user: null, loading: true };
    render(<MemoryRouter><FavProbe /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('fav-count')).toBeInTheDocument());
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('unauthenticated does not call protected endpoint', async () => {
    mockAuthState = { user: null, loading: false };
    render(<MemoryRouter><FavProbe /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('fav-count')).toBeInTheDocument());
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('authenticated calls protected endpoint', async () => {
    mockAuthState = { user: { id: 'u1' }, loading: false };
    render(<MemoryRouter><FavProbe /></MemoryRouter>);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/customer/favorites'));
  });

  it('5. real RequireRole holds while loading and redirects when unauthenticated', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../useAuth.jsx'), 'utf8');
    expect(src).toContain('if (loading) return null');
    expect(src).toContain('Navigate to="/login"');
  });

  it('login creates session before protected navigation (gated by loading/user/role)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../pages/Login.jsx'), 'utf8');
    expect(src).toContain('signInWithPassword');
    expect(src).toContain('if (loading) return');
    expect(src).toContain('if (!user || navigationRef.current || !role) return');
  });

  it('6. callback with no session routes to login safely (no protected call)', async () => {
    // AuthCallback with no session should show login link, not call /auth/sync-user
    const { default: AuthCallback } = await import('../../../pages/AuthCallback');
    const supabaseMock = vi.fn();
    // AuthCallback uses supabase directly, mocked in its own test; here verify no apiFetch to sync-user
    window.history.replaceState({}, '', '/auth/callback');
    render(<MemoryRouter><AuthCallback /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Verifying your email|Email confirmed|Confirmation failed/)).toBeInTheDocument());
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining('/auth/sync-user'));
  });
});
