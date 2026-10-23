// frontend/src/pages/__tests__/Login.test.jsx
// Login form validation + inline credential error feedback.
// No floating "Invalid login credentials" toast for auth failures.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockSignIn = vi.fn();
const mockResend = vi.fn();
const mockGetSession = vi.fn(async () => ({ data: { session: null } }));

vi.mock('../../shared/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args) => mockSignIn(...args),
      resend: (...args) => mockResend(...args),
      getSession: (...args) => mockGetSession(...args),
    },
  },
}));

vi.mock('../../shared/components/Toast', () => ({
  useToast: () => vi.fn(),
}));

vi.mock('../../shared/components/AssistantWidget', () => ({
  AssistantWidget: () => null,
}));

vi.mock('../../assests/Login_bg.jpg', () => ({ default: 'bg.jpg' }));

// Mock auth hook so redirect logic does not depend on real Supabase/socket.
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    role: null,
    status: null,
    preferredBranchId: null,
    loading: false,
  }),
}));

const originalFetch = global.fetch;
global.fetch = vi.fn();

import Login from '../Login';

function renderLogin() {
  return render(<MemoryRouter initialEntries={['/login']}><Login /></MemoryRouter>);
}

const USER_CREDS = { email: 'contact@goldenheritage.ph', password: 'ShopOwner123!' };

function fillForm({ email = USER_CREDS.email, password = USER_CREDS.password } = {}) {
  fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

describe('Login — initial state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignIn.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    mockResend.mockResolvedValue({ error: null });
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders with no validation errors', () => {
    renderLogin();
    expect(screen.queryByText('Email address is required.')).not.toBeInTheDocument();
    expect(screen.queryByText('Password is required.')).not.toBeInTheDocument();
    expect(screen.queryByText('Email or password is incorrect.')).not.toBeInTheDocument();
  });

  it('has email and password inputs with labels', () => {
    renderLogin();
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeInTheDocument();
  });
});

describe('Login — frontend validation (no auth call)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignIn.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('blank form shows required errors under both fields and does not call auth', async () => {
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(screen.getByText('Email address is required.')).toBeInTheDocument());
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('invalid email format shows format error', async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument());
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('blank password shows required error', async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'contact@goldenheritage.ph' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(screen.getByText('Password is required.')).toBeInTheDocument());
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('focuses the first invalid field on validation failure', async () => {
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Email Address')));
  });

  it('valid fields call signInWithPassword exactly once', async () => {
    renderLogin();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
    expect(mockSignIn).toHaveBeenCalledWith({ email: USER_CREDS.email, password: USER_CREDS.password });
  });
});

describe('Login — invalid credentials from auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignIn.mockResolvedValue({
      data: null,
      error: { message: 'Invalid login credentials' },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows inline credential error on both fields', async () => {
    renderLogin();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(screen.getByText('Email or password is incorrect.')).toBeInTheDocument());
    // Both inputs carry the error state.
    const emailInput = screen.getByLabelText('Email Address');
    const passwordInput = screen.getByLabelText('Password');
    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    expect(passwordInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the inline error as a role=alert element', async () => {
    renderLogin();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(screen.getByText('Email or password is incorrect.')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('does not reveal which credential failed', async () => {
    renderLogin();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(screen.getByText('Email or password is incorrect.')).toBeInTheDocument());
    // The message must not leak which specific credential was wrong.
    expect(screen.queryByText(/email not found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/this email is not registered/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/password is incorrect for this email/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/wrong password for/i)).not.toBeInTheDocument();
  });

  it('clears credential error when editing email', async () => {
    renderLogin();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(screen.getByText('Email or password is incorrect.')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'changed@goldenheritage.ph' } });
    await waitFor(() => expect(screen.queryByText('Email or password is incorrect.')).not.toBeInTheDocument());
  });

  it('clears credential error when editing password', async () => {
    renderLogin();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(screen.getByText('Email or password is incorrect.')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'NewPassword123!' } });
    await waitFor(() => expect(screen.queryByText('Email or password is incorrect.')).not.toBeInTheDocument());
  });

  it('clears field error as user corrects email', async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'good@example.com' } });
    await waitFor(() => expect(screen.queryByText('Please enter a valid email address.')).not.toBeInTheDocument());
  });

  it('clears field error as user corrects password', async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'contact@goldenheritage.ph' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(screen.getByText('Password is required.')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'any-password' } });
    await waitFor(() => expect(screen.queryByText('Password is required.')).not.toBeInTheDocument());
  });
});

describe('Login — other auth errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignIn.mockResolvedValue({ data: null, error: { message: 'Invalid login credentials' } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('network failure is not shown as invalid credentials', async () => {
    mockSignIn.mockRejectedValue(new TypeError('Failed to fetch'));
    renderLogin();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(screen.getByText('Unable to sign in right now. Please check your connection and try again.')).toBeInTheDocument());
    expect(screen.queryByText('Email or password is incorrect.')).not.toBeInTheDocument();
  });

  it('rate limit error displays correct message', async () => {
    mockSignIn.mockResolvedValue({ data: null, error: { message: 'Too many requests. Please try again later.' } });
    renderLogin();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(screen.getByText('Too many sign-in attempts. Please try again later.')).toBeInTheDocument());
  });

  it('email not confirmed triggers resend flow', async () => {
    mockSignIn.mockResolvedValue({ data: null, error: { message: 'Email not confirmed' } });
    renderLogin();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(mockResend).toHaveBeenCalledWith({ type: 'signup', email: USER_CREDS.email }));
  });
});

describe('Login — password visibility toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignIn.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('toggles password visibility', () => {
    renderLogin();
    const pwdInput = screen.getByLabelText('Password');
    expect(pwdInput).toHaveAttribute('type', 'password');
    const toggle = screen.getByLabelText('Show password');
    fireEvent.click(toggle);
    expect(pwdInput).toHaveAttribute('type', 'text');
    fireEvent.click(toggle);
    expect(pwdInput).toHaveAttribute('type', 'password');
  });
});

describe('Login — submit behaviors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignIn.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('pressing Enter submits the form', async () => {
    renderLogin();
    fillForm();
    fireEvent.keyDown(screen.getByLabelText('Password'), { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
  });

  it('disables button while loading (prevents double submit)', async () => {
    let resolvePromise;
    mockSignIn.mockImplementation(() => new Promise((res) => { resolvePromise = res; }));
    renderLogin();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Signing in/i })).toBeInTheDocument());
    const btn = screen.getByRole('button', { name: /Signing in/i });
    expect(btn.disabled).toBe(true);
    // Attempt a second click while loading — should not call again.
    fireEvent.click(btn);
    expect(mockSignIn).toHaveBeenCalledTimes(1);
    resolvePromise({ data: { user: { id: 'u-1' } }, error: null });
  });
});

describe('Login — successful login (all roles)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignIn.mockResolvedValue({ data: { user: { id: 'u-1', email: 'contact@goldenheritage.ph', user_metadata: { name: 'Test User', role: 'customer' } } }, error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('customer login calls auth', async () => {
    renderLogin();
    fillForm({ email: 'contact@goldenheritage.ph', password: 'ShopOwner123!' });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
  });

  it('shop owner login calls auth', async () => {
    renderLogin();
    fillForm({ email: 'contact@goldenheritage.ph', password: 'ShopOwner123!' });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
  });

  it('admin login calls auth', async () => {
    renderLogin();
    fillForm({ email: 'admin@atany.ph', password: 'Admin123!' });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
  });
});
