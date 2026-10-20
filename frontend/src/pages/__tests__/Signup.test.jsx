import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const mockSignUp = vi.fn();
const mockGetSession = vi.fn(async () => ({ data: { session: null } }));
const mockFetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));

vi.mock('../../shared/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signUp: (...args) => mockSignUp(...args),
      getSession: (...args) => mockGetSession(...args),
    },
  },
}));

// Stub asset and modal to avoid image load issues
vi.mock('../../assests/Login_bg.jpg', () => ({ default: 'bg.jpg' }));
vi.mock('../../components/TermsPolicyModal', () => ({
  default: ({ open, onAgree, setAgreed }) => open ? <><input type="checkbox" data-testid="modal-check" onChange={(e) => setAgreed(e.target.checked)} /><button onClick={onAgree}>Agree Terms</button></> : null,
}));
vi.mock('../../shared/components/Toast', () => ({
  useToast: () => vi.fn(),
}));
vi.mock('../../shared/components/AssistantWidget', () => ({
  AssistantWidget: () => null,
}));

// Mock fetch globally for sync-user
const originalFetch = global.fetch;
global.fetch = mockFetch;

import Signup from '../Signup';

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Isabella' } });
  fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Reyes' } });
  fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'You@Example.COM  ' } });
  fireEvent.change(screen.getByPlaceholderText('9XX XXX XXXX'), { target: { value: '9514118324' } });
  fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'Klane@2026Strong' } });
  fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'Klane@2026Strong' } });
  fireEvent.click(screen.getByText(/I agree to the Terms/i));
  return waitFor(() => screen.getByText('Agree Terms')).then(() => {
    fireEvent.click(screen.getByTestId('modal-check'));
    fireEvent.click(screen.getByText('Agree Terms'));
  });
}

describe('Signup form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignUp.mockResolvedValue({ data: { user: { id: 'new-id' }, session: { access_token: 'tok' } }, error: null });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows email validation on blur', async () => {
    render(<MemoryRouter><Signup /></MemoryRouter>);
    const email = screen.getByLabelText('Email Address');
    fireEvent.change(email, { target: { value: 'klane' } });
    fireEvent.blur(email);
    expect(await screen.findByText('Please enter a valid email address.')).toBeInTheDocument();
  });

  it('phone incomplete shows error after blur', async () => {
    render(<MemoryRouter><Signup /></MemoryRouter>);
    const phone = screen.getByPlaceholderText('9XX XXX XXXX');
    fireEvent.change(phone, { target: { value: '951411832' } });
    fireEvent.blur(phone);
    expect(await screen.findByText('Mobile number is incomplete. Enter 10 digits after +63.')).toBeInTheDocument();
  });

  it('password strength updates live', async () => {
    render(<MemoryRouter><Signup /></MemoryRouter>);
    const pwd = screen.getByLabelText(/^Password$/);
    fireEvent.change(pwd, { target: { value: '12345678' } });
    expect(await screen.findByText(/Password strength: Weak/)).toBeInTheDocument();
    fireEvent.change(pwd, { target: { value: 'Klane@2026Strong' } });
    expect(await screen.findByText(/Password strength: (Strong|Very Strong)/)).toBeInTheDocument();
  });

  it('confirm password mismatch', async () => {
    render(<MemoryRouter><Signup /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'Klane@2026Strong' } });
    const confirm = screen.getByLabelText('Confirm Password');
    fireEvent.change(confirm, { target: { value: 'different' } });
    fireEvent.blur(confirm);
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
  });

  it('invalid form never calls signup and Create Account disabled', async () => {
    render(<MemoryRouter><Signup /></MemoryRouter>);
    // Fill invalid email
    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Isabella' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Reyes' } });
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'bad' } });
    fireEvent.change(screen.getByPlaceholderText('9XX XXX XXXX'), { target: { value: '9514118324' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'Klane@2026Strong' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'Klane@2026Strong' } });
    // Agree terms
    fireEvent.click(screen.getByText(/I agree to the Terms/i));
    await waitFor(() => screen.getByText('Agree Terms'));
    fireEvent.click(screen.getByTestId('modal-check'));
    fireEvent.click(screen.getByText('Agree Terms'));
    const btn = screen.getByRole('button', { name: 'Create Account' });
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    await waitFor(() => expect(mockSignUp).not.toHaveBeenCalled());
  });

  it('valid form calls signup exactly once with normalized data and does not send confirmPassword or role', async () => {
    render(<MemoryRouter><Signup /></MemoryRouter>);
    await fillValidForm();
    // Wait for validation to enable button
    const btn = await waitFor(() => {
      const b = screen.getByRole('button', { name: 'Create Account' });
      expect(b.disabled).toBe(false);
      return b;
    });
    fireEvent.click(btn);
    await waitFor(() => expect(mockSignUp).toHaveBeenCalledTimes(1));
    const call = mockSignUp.mock.calls[0][0];
    expect(call.email).toBe('you@example.com'); // normalized lowercase trimmed
    expect(call.password).toBe('Klane@2026Strong');
    expect(call.options.data.phone).toBe('+639514118324');
    expect(call.options.data).not.toHaveProperty('confirmPassword');
    expect(call).not.toHaveProperty('role');
    expect(call.options.data).not.toHaveProperty('role');
    // Ensure only password sent, not confirm
    const bod = JSON.stringify(call);
    expect(bod).not.toContain('confirmPassword');
  });

  it('paste +639... normalizes to local field', async () => {
    render(<MemoryRouter><Signup /></MemoryRouter>);
    const phone = screen.getByPlaceholderText('9XX XXX XXXX');
    const pasteEvent = { clipboardData: { getData: () => '+639514118324' }, preventDefault: vi.fn() };
    fireEvent.paste(phone, pasteEvent);
    // After paste, value should be local digits
    await waitFor(() => expect(phone.value).toBe('9514118324'));
  });

  it('uses window.location.origin for emailRedirectTo and not hardcoded localhost (fallback)', async () => {
    vi.stubEnv('VITE_APP_URL', '');
    render(<MemoryRouter><Signup /></MemoryRouter>);
    await fillValidForm();
    const btn = await waitFor(() => {
      const b = screen.getByRole('button', { name: 'Create Account' });
      expect(b.disabled).toBe(false);
      return b;
    });
    fireEvent.click(btn);
    await waitFor(() => expect(mockSignUp).toHaveBeenCalled());
    const opts = mockSignUp.mock.calls[0][0].options;
    expect(opts.emailRedirectTo).toBe(`${window.location.origin}/auth/callback`);
    expect(opts.emailRedirectTo).not.toContain('localhost:4000');
    vi.unstubAllEnvs();
  });

  it('VITE_APP_URL takes priority over window.location.origin', async () => {
    vi.stubEnv('VITE_APP_URL', 'https://atany.ph');
    render(<MemoryRouter><Signup /></MemoryRouter>);
    await fillValidForm();
    const btn = await waitFor(() => {
      const b = screen.getByRole('button', { name: 'Create Account' });
      expect(b.disabled).toBe(false);
      return b;
    });
    fireEvent.click(btn);
    await waitFor(() => expect(mockSignUp).toHaveBeenCalled());
    const opts = mockSignUp.mock.calls[0][0].options;
    expect(opts.emailRedirectTo).toBe('https://atany.ph/auth/callback');
    vi.unstubAllEnvs();
  });

  it('falls back to window.location.origin when env missing', async () => {
    vi.stubEnv('VITE_APP_URL', undefined);
    // also ensure delete
    delete import.meta.env.VITE_APP_URL;
    render(<MemoryRouter><Signup /></MemoryRouter>);
    await fillValidForm();
    const btn = await waitFor(() => {
      const b = screen.getByRole('button', { name: 'Create Account' });
      expect(b.disabled).toBe(false);
      return b;
    });
    fireEvent.click(btn);
    await waitFor(() => expect(mockSignUp).toHaveBeenCalled());
    const opts = mockSignUp.mock.calls[0][0].options;
    expect(opts.emailRedirectTo).toBe(`${window.location.origin}/auth/callback`);
    vi.unstubAllEnvs();
  });

  it('trailing slash does not produce double slash', async () => {
    vi.stubEnv('VITE_APP_URL', 'https://atany.ph/');
    render(<MemoryRouter><Signup /></MemoryRouter>);
    await fillValidForm();
    const btn = await waitFor(() => {
      const b = screen.getByRole('button', { name: 'Create Account' });
      expect(b.disabled).toBe(false);
      return b;
    });
    fireEvent.click(btn);
    await waitFor(() => expect(mockSignUp).toHaveBeenCalled());
    const opts = mockSignUp.mock.calls[0][0].options;
    expect(opts.emailRedirectTo).toBe('https://atany.ph/auth/callback');
    expect(opts.emailRedirectTo).not.toContain('//auth');
    vi.unstubAllEnvs();
  });

  it('callback remains /auth/callback', async () => {
    vi.stubEnv('VITE_APP_URL', 'https://atany.ph');
    render(<MemoryRouter><Signup /></MemoryRouter>);
    await fillValidForm();
    const btn = await waitFor(() => {
      const b = screen.getByRole('button', { name: 'Create Account' });
      expect(b.disabled).toBe(false);
      return b;
    });
    fireEvent.click(btn);
    await waitFor(() => expect(mockSignUp).toHaveBeenCalled());
    const opts = mockSignUp.mock.calls[0][0].options;
    expect(opts.emailRedirectTo).toMatch(/\/auth\/callback$/);
    vi.unstubAllEnvs();
  });

  it('does not contain hardcoded localhost confirmation redirect', async () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../Signup.jsx'), 'utf8');
    expect(src).not.toContain('localhost:4000/auth/callback');
    // Should not hardcode http://localhost:5178/auth/callback directly, must use env + window.location.origin
    expect(src).not.toMatch(/['"]http:\/\/localhost:5178\/auth\/callback['"]/);
    expect(src).toContain('VITE_APP_URL');
    expect(src).toContain('window.location.origin');
    expect(src).toContain('/auth/callback');
  });
});
