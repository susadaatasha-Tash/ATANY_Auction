// frontend/src/pages/__tests__/AccountSuspended.test.jsx
// The canonical suspended-account screen: the account owner sees the REAL
// admin reason, the role-aware copy, a working support channel and a way to
// try a different account.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const { authState, signOutSpy } = vi.hoisted(() => ({
  authState: { user: null, role: 'customer', status: null, suspensionReason: null, loading: false },
  signOutSpy: vi.fn(),
}));

vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ ...authState, signOut: signOutSpy }),
}));
vi.mock('../../shared/components/PublicHeader', () => ({
  PublicHeader: () => <div data-testid="public-header" />,
}));

import AccountSuspended from '../AccountSuspended';

function renderPage() {
  return render(
    <MemoryRouter>
      <AccountSuspended />
    </MemoryRouter>
  );
}

beforeEach(() => {
  signOutSpy.mockReset();
  authState.user = { id: 'u1', email: 'maria@example.com', user_metadata: { name: 'Maria Santos' } };
  authState.role = 'customer';
  authState.status = 'suspended';
  authState.suspensionReason = 'Repeated suspicious rapid high-value bidding activity.';
  authState.loading = false;
});

describe('AccountSuspended — the reason', () => {
  it('shows the actual admin reason', () => {
    renderPage();
    expect(screen.getByText('Account Suspended')).toBeInTheDocument();
    expect(screen.getByText('Reason for suspension')).toBeInTheDocument();
    expect(screen.getByText('Repeated suspicious rapid high-value bidding activity.')).toBeInTheDocument();
  });

  it('renders the reason as plain text (never executable markup)', () => {
    authState.suspensionReason = '<img src=x onerror="window.__pwned=1">Alert';
    const { container } = renderPage();
    expect(container.querySelector('img')).toBeNull();
    expect(window.__pwned).toBeUndefined();
    expect(screen.getByText('<img src=x onerror="window.__pwned=1">Alert')).toBeInTheDocument();
  });

  it('uses the seller copy for a shop owner', () => {
    authState.role = 'shop_owner';
    renderPage();
    expect(screen.getByText(/seller account has been temporarily suspended/i)).toBeInTheDocument();
    expect(screen.getByText(/listings, auction history, orders and financial records have not been deleted/i)).toBeInTheDocument();
  });

  it('links Contact Support with the account context prefilled', () => {
    renderPage();
    const link = screen.getByRole('link', { name: /Contact Support/i });
    const href = link.getAttribute('href');
    expect(href).toContain('mailto:support@atany.ph');
    expect(decodeURIComponent(href)).toContain('Maria Santos');
    expect(decodeURIComponent(href)).toContain('Customer');
    expect(decodeURIComponent(href)).toContain('Repeated suspicious rapid high-value bidding activity.');
  });

  it('offers a way to try a different account', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Try a different account/i }));
    expect(signOutSpy).toHaveBeenCalled();
  });

  it('shows the reactivated state without a reason', () => {
    authState.status = 'active';
    authState.suspensionReason = null;
    renderPage();
    expect(screen.queryByText('Reason for suspension')).toBeNull();
    expect(screen.getByText('Account Suspended')).toBeInTheDocument();
  });
});
