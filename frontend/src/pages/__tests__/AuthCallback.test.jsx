import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const mockGetSession = vi.fn();
const mockExchange = vi.fn();

vi.mock('../../shared/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...args) => mockGetSession(...args),
      exchangeCodeForSession: (...args) => mockExchange(...args),
    },
  },
}));

import AuthCallback from '../AuthCallback';

describe('AuthCallback', () => {
  const originalHref = window.location.href;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockExchange.mockResolvedValue({ data: {}, error: null });
    // Reset URL to clean state
    window.history.replaceState({}, '', '/auth/callback');
  });

  afterEach(() => {
    window.history.replaceState({}, '', originalHref);
  });

  it('shows loading state initially', async () => {
    mockGetSession.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<MemoryRouter><AuthCallback /></MemoryRouter>);
    expect(screen.getByText('Verifying your email…')).toBeInTheDocument();
  });

  it('successful confirmation shows success and link to login', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok', user: { id: 'u' } } } });
    // No error in URL, no code
    window.history.replaceState({}, '', '/auth/callback');
    render(<MemoryRouter><AuthCallback /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Email confirmed')).toBeInTheDocument());
    expect(screen.getByText(/Your email has been confirmed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue to Sign in' })).toHaveAttribute('href', '/login');
  });

  it('expired/invalid link shows safe error and links to login/signup', async () => {
    window.history.replaceState({}, '', '/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    render(<MemoryRouter><AuthCallback /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Confirmation failed')).toBeInTheDocument());
    expect(screen.getByText(/has expired/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Create Account' })).toHaveAttribute('href', '/signup');
    // Ensure raw token not exposed
    expect(document.body.textContent).not.toContain('access_token');
  });

  it('code param is exchanged and then shows success', async () => {
    window.history.replaceState({}, '', '/auth/callback?code=abc123');
    mockGetSession.mockResolvedValueOnce({ data: { session: null } }).mockResolvedValueOnce({ data: { session: { access_token: 'tok' } } });
    mockExchange.mockResolvedValue({ data: { session: { access_token: 'tok' } }, error: null });
    render(<MemoryRouter><AuthCallback /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Email confirmed')).toBeInTheDocument());
    expect(mockExchange).toHaveBeenCalledWith('abc123');
  });

  it('does not contain hardcoded localhost', () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../AuthCallback.jsx'), 'utf8');
    expect(src).not.toContain('localhost:4000');
    expect(src).not.toContain('http://localhost:5178/auth/callback');
  });

  it('App.jsx has /auth/callback route', () => {
    const appSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../App.jsx'), 'utf8');
    expect(appSrc).toContain('/auth/callback');
    expect(appSrc).toContain('AuthCallback');
  });
});
