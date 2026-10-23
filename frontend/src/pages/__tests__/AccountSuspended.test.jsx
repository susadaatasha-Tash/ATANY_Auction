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
vi.mock('../../shared/components/Toast', () => ({
  useToast: () => vi.fn(),
}));
const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));

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
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ success: true, request: { id: 'r1', reference: 'SUP-ABC123', status: 'new' }, email_notification: { sent: true } });
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

  it('offers the official ATANY support address as a direct-email fallback', () => {
    renderPage();
    const link = screen.getByRole('link', { name: /Email goldjewelryauction@gmail.com/i });
    const href = link.getAttribute('href');
    expect(href).toContain('mailto:goldjewelryauction@gmail.com');
    expect(decodeURIComponent(href)).toContain('Maria Santos');
    expect(decodeURIComponent(href)).toContain('Customer');
    expect(decodeURIComponent(href)).toContain('Repeated suspicious rapid high-value bidding activity.');
  });

  it('opens a REAL support request form (not a mailto dead end)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Contact ATANY Support/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('goldjewelryauction@gmail.com')).toBeInTheDocument();
    // The account context is prefilled — only what the owner can already see.
    const message = screen.getByLabelText('Message').value;
    expect(message).toContain('Role: Customer');
    expect(message).toContain('Suspension reason: Repeated suspicious rapid high-value bidding activity.');
    expect(screen.getByLabelText('Category')).toHaveValue('Account Issue');
    expect(screen.getByLabelText('Subject')).toHaveValue('Suspended Account Inquiry');
  });

  it('never exposes admin notes, audit history or the admin identity', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Contact ATANY Support/i }));
    const message = screen.getByLabelText('Message').value;
    expect(message).not.toMatch(/admin note/i);
    expect(message).not.toMatch(/audit/i);
    expect(message).not.toMatch(/admin@atany\.ph/i);
  });

  it('submits the persisted support request to the shared support endpoint', async () => {
    apiFetch.mockResolvedValue({ success: true, request: { id: 'r1', reference: 'SUP-ABC123', status: 'new' }, email_notification: { sent: true } });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Contact ATANY Support/i }));
    fireEvent.click(screen.getByRole('button', { name: /Send Support Request/i }));
    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url, opts]) => url === '/support/account' && opts?.method === 'POST');
      expect(call).toBeTruthy();
      const body = JSON.parse(call[1].body);
      expect(body.category).toBe('Account Issue');
      expect(body.subject).toBe('Suspended Account Inquiry');
      expect(body.message).toContain('suspended account');
    });
    await waitFor(() => expect(screen.getByText('SUP-ABC123')).toBeInTheDocument());
  });

  it('disables the submit button while the request is sending', async () => {
    let resolveCall;
    apiFetch.mockImplementation(() => new Promise((res) => { resolveCall = res; }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Contact ATANY Support/i }));
    const submit = screen.getByRole('button', { name: /Send Support Request/i });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole('button', { name: /Sending…/ })).toBeDisabled());
    resolveCall?.({ success: true, request: { reference: 'SUP-X' } });
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
