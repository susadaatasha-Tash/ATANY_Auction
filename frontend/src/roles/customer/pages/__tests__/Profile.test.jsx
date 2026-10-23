// frontend/src/roles/customer/pages/__tests__/Profile.test.jsx
// Customer Profile (/customer/account) — real editing, password change and
// Help & Support. Every network call is mocked; nothing here is UI-only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { apiFetch, toastSpy, authState, branchState, supabaseMock } = vi.hoisted(() => {
  const apiFetch = vi.fn();
  const toastSpy = vi.fn();
  const authState = {
    user: { id: 'u-1', email: 'maria.santos@email.com', user_metadata: { name: 'Maria Santos' } },
    profileName: 'Maria Santos',
    refreshProfile: vi.fn(async () => ({ name: 'Maria Santos' })),
  };
  const branchState = {
    branches: [
      { id: 'b1', name: 'Abreeza Branch', status: 'Open' },
      { id: 'b2', name: 'Gmall Branch', status: 'Open' },
      { id: 'b3', name: 'SM Lanang Branch', status: 'Temporarily Closed' },
    ],
    refreshBranch: vi.fn(async () => null),
  };
  const supabaseMock = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { email: 'maria.santos@email.com' } }, error: null })),
      signInWithPassword: vi.fn(async () => ({ data: { user: null, session: null }, error: null })),
      updateUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
  };
  return { apiFetch, toastSpy, authState, branchState, supabaseMock };
});

vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toastSpy }));
vi.mock('../../../../shared/hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../../../../shared/hooks/useBranch', () => ({ useBranch: () => branchState }));
vi.mock('../../../../shared/lib/supabaseClient', () => ({ supabase: supabaseMock }));

import Profile from '../Profile';

const ACCOUNT = {
  id: 'u-1',
  name: 'Maria Santos',
  email: 'maria.santos@email.com',
  role: 'customer',
  status: 'active',
  phone: '+639171234567',
  preferred_branch_id: 'b1',
  preferred_branch_name: 'Abreeza Branch',
};

function renderProfile(initialEntry = '/customer/account') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Profile />
    </MemoryRouter>
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  toastSpy.mockReset();
  authState.refreshProfile.mockClear();
  branchState.refreshBranch.mockClear();
  supabaseMock.auth.getUser.mockReset().mockResolvedValue({ data: { user: { email: 'maria.santos@email.com' } }, error: null });
  supabaseMock.auth.signInWithPassword.mockReset().mockResolvedValue({ data: { user: null, session: null }, error: null });
  supabaseMock.auth.updateUser.mockReset().mockResolvedValue({ data: { user: null }, error: null });
  apiFetch.mockImplementation(async (url) => {
    if (url === '/customer/account') return { ...ACCOUNT };
    return {};
  });
});

async function waitForProfile() {
  await waitFor(() => expect(screen.getByLabelText('Full Name')).toBeInTheDocument());
}

// ─────────────────────────────────────────────────────────────
// Profile (12)
// ─────────────────────────────────────────────────────────────
describe('Customer Profile — profile data', () => {
  it('loads the current real user details from GET /customer/account', async () => {
    renderProfile();
    await waitForProfile();
    expect(apiFetch).toHaveBeenCalledWith('/customer/account');
    expect(screen.getByLabelText('Full Name')).toHaveValue('Maria Santos');
    expect(screen.getByLabelText('Email Address')).toHaveValue('maria.santos@email.com');
  });

  it('shows the saved phone number', async () => {
    renderProfile();
    await waitForProfile();
    expect(screen.getByLabelText('Phone Number')).toHaveValue('+639171234567');
  });

  it('allows the Full Name to be edited', async () => {
    renderProfile();
    await waitForProfile();
    const name = screen.getByLabelText('Full Name');
    expect(name).not.toBeDisabled();
    expect(name).not.toHaveAttribute('readonly');
    fireEvent.change(name, { target: { value: 'Maria L. Santos' } });
    expect(screen.getByLabelText('Full Name')).toHaveValue('Maria L. Santos');
  });

  it('keeps the Email Address read-only', async () => {
    renderProfile();
    await waitForProfile();
    const email = screen.getByLabelText('Email Address');
    expect(email).toBeDisabled();
    expect(email).toHaveAttribute('readonly');
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it('allows the Phone Number to be edited', async () => {
    renderProfile();
    await waitForProfile();
    const phone = screen.getByLabelText('Phone Number');
    expect(phone).not.toBeDisabled();
    fireEvent.change(phone, { target: { value: '09181234567' } });
    expect(screen.getByLabelText('Phone Number')).toHaveValue('09181234567');
  });

  it('uses real branches for the Preferred Branch picker and only offers open ones', async () => {
    renderProfile();
    await waitForProfile();
    const select = screen.getByLabelText('Preferred Branch');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('Abreeza Branch');
    expect(options).toContain('Gmall Branch');
    expect(options).not.toContain('SM Lanang Branch');
    expect(select).toHaveValue('b1');
  });

  it('sends only the changed fields on save', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Maria L. Santos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url, opts]) => url === '/customer/account' && opts?.method === 'PUT');
      expect(call).toBeTruthy();
      expect(JSON.parse(call[1].body)).toEqual({ name: 'Maria L. Santos' });
    });
  });

  it('never sends role, status or email fields', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Maria L. Santos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url, opts]) => url === '/customer/account' && opts?.method === 'PUT');
      expect(call).toBeTruthy();
      const body = JSON.parse(call[1].body);
      expect(body).not.toHaveProperty('role');
      expect(body).not.toHaveProperty('status');
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('userId');
    });
  });

  it('shows the success toast after a successful save', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Maria L. Santos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Profile updated successfully.'));
  });

  it('refreshes the global auth state after a name change so the header updates', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Maria L. Santos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(authState.refreshProfile).toHaveBeenCalled());
  });

  it('refreshes the global auth + branch state so the header updates', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.change(screen.getByLabelText('Preferred Branch'), { target: { value: 'b2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([url, opts]) => url === '/customer/preferred-branch' && opts?.method === 'PUT')).toBe(true);
      expect(authState.refreshProfile).toHaveBeenCalled();
      expect(branchState.refreshBranch).toHaveBeenCalled();
    });
  });

  it('saves the preferred branch through the customer endpoint', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.change(screen.getByLabelText('Preferred Branch'), { target: { value: 'b2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url, opts]) => url === '/customer/preferred-branch' && opts?.method === 'PUT');
      expect(call).toBeTruthy();
      expect(JSON.parse(call[1].body)).toEqual({ branch_id: 'b2' });
    });
  });

  it('keeps the unsaved edits and shows an error when the save fails', async () => {
    apiFetch.mockImplementation(async (url, opts) => {
      if (url === '/customer/account' && opts?.method === 'PUT') throw new Error('Unable to update profile.');
      if (url === '/customer/account') return { ...ACCOUNT };
      return {};
    });
    renderProfile();
    await waitForProfile();
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Maria L. Santos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Unable to update profile.'));
    expect(screen.getByLabelText('Full Name')).toHaveValue('Maria L. Santos');
  });

  it('shows a retry state when the profile cannot be loaded', async () => {
    apiFetch.mockImplementation(async (url) => {
      if (url === '/customer/account') throw new Error('boom');
      return {};
    });
    renderProfile();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument());
    expect(screen.getByText(/Unable to load your profile/i)).toBeInTheDocument();
  });

  it('blocks profile editing for a suspended account and points at support', async () => {
    apiFetch.mockImplementation(async (url) => {
      if (url === '/customer/account') return { ...ACCOUNT, status: 'suspended' };
      return {};
    });
    renderProfile();
    await waitForProfile();
    expect(screen.getByText(/Your account is suspended/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Account Status/i })).toHaveAttribute('href', '/account-suspended');
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });
});

// ─────────────────────────────────────────────────────────────
// Password (12)
// ─────────────────────────────────────────────────────────────
describe('Customer Profile — password change', () => {
  it('hides all three password fields by default', async () => {
    renderProfile();
    await waitForProfile();
    expect(screen.getByLabelText('Current Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('New Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm New Password')).toHaveAttribute('type', 'password');
  });

  it('shows the current password when the eye is clicked and hides it again with EyeOff', async () => {
    renderProfile();
    await waitForProfile();
    const toggle = screen.getByRole('button', { name: 'Show current password' });
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Current Password')).toHaveAttribute('type', 'text');
    const hide = screen.getByRole('button', { name: 'Hide current password' });
    expect(hide).toBeInTheDocument();
    fireEvent.click(hide);
    expect(screen.getByLabelText('Current Password')).toHaveAttribute('type', 'password');
  });

  it('toggles each password field independently', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Show new password' }));
    expect(screen.getByLabelText('New Password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Current Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm New Password')).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show confirm new password' }));
    expect(screen.getByLabelText('Confirm New Password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Current Password')).toHaveAttribute('type', 'password');
  });

  it('uses the correct autocomplete attributes', async () => {
    renderProfile();
    await waitForProfile();
    expect(screen.getByLabelText('Current Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('New Password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Confirm New Password')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('uses the correct autocomplete attributes on the profile fields', async () => {
    renderProfile();
    await waitForProfile();
    expect(screen.getByLabelText('Full Name')).toHaveAttribute('autocomplete', 'name');
    expect(screen.getByLabelText('Email Address')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Phone Number')).toHaveAttribute('autocomplete', 'tel');
    expect(screen.getByLabelText('Phone Number')).toHaveAttribute('inputmode', 'tel');
  });

  it('blocks the submit and shows "Passwords do not match." without calling the auth provider', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'Customer123!' } });
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'NewPass123!' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'Different123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));

    await waitFor(() => expect(screen.getByText('Passwords do not match.')).toBeInTheDocument());
    expect(supabaseMock.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(supabaseMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it('shows "Current password is incorrect." for a wrong current password', async () => {
    supabaseMock.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });
    renderProfile();
    await waitForProfile();
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'WrongPass123!' } });
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'NewPass123!' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'NewPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));

    await waitFor(() => expect(screen.getByText('Current password is incorrect.')).toBeInTheDocument());
    expect(supabaseMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it('rejects a new password that is shorter than the shared policy', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'Customer123!' } });
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));

    await waitFor(() => expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument());
    expect(supabaseMock.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('rejects a new password identical to the current one', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'Customer123!' } });
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'Customer123!' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'Customer123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));

    await waitFor(() =>
      expect(screen.getByText('New password must be different from the current password.')).toBeInTheDocument()
    );
    expect(supabaseMock.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('verifies the current password and then updates it in the auth provider', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'Customer123!' } });
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'NewPass123!' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'NewPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));

    await waitFor(() => expect(supabaseMock.auth.updateUser).toHaveBeenCalledWith({ password: 'NewPass123!' }));
    expect(supabaseMock.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'maria.santos@email.com',
      password: 'Customer123!',
    });
  });

  it('clears the password fields and re-hides them after a successful change', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Show new password' }));
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'Customer123!' } });
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'NewPass123!' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'NewPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Password updated successfully.'));
    expect(screen.getByLabelText('Current Password')).toHaveValue('');
    expect(screen.getByLabelText('New Password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm New Password')).toHaveValue('');
    expect(screen.getByLabelText('New Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show new password' })).toBeInTheDocument();
  });

  it('never sends the password to the ATANY backend', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'Customer123!' } });
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'NewPass123!' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'NewPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));

    await waitFor(() => expect(supabaseMock.auth.updateUser).toHaveBeenCalled());
    const bodies = apiFetch.mock.calls.map(([, opts]) => opts?.body).filter(Boolean).join(' ');
    expect(bodies).not.toMatch(/Customer123|NewPass123|password/i);
  });
});

// ─────────────────────────────────────────────────────────────
// Help & Support (8)
// ─────────────────────────────────────────────────────────────
describe('Customer Profile — Help & Support', () => {
  it('displays the Help & Support card', async () => {
    renderProfile();
    await waitForProfile();
    expect(screen.getByRole('heading', { name: 'Help & Support' })).toBeInTheDocument();
    expect(screen.getByText('Get help when you need it.')).toBeInTheDocument();
  });

  it('shows a FAQ row and a Contact Us row', async () => {
    renderProfile();
    await waitForProfile();
    expect(screen.getByText('FAQ')).toBeInTheDocument();
    expect(screen.getByText('Find answers to common questions.')).toBeInTheDocument();
    expect(screen.getByText('Contact Us')).toBeInTheDocument();
    // The official ATANY support address is shown (centralized constant).
    expect(screen.getByText(/Reach our support team at goldjewelryauction@gmail.com/)).toBeInTheDocument();
  });

  it('opens real FAQ content when FAQ is clicked', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.click(screen.getByText('FAQ'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText('Frequently Asked Questions')).toBeInTheDocument();
    expect(screen.getByText('How do I bid on an auction?')).toBeInTheDocument();
    expect(screen.getByText('When do I have to pay after winning?')).toBeInTheDocument();
  });

  it('the FAQ answers are grounded in ATANY policy (7-day window, pickup only)', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.click(screen.getByText('FAQ'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText(/7 days from the win to complete payment/i)).toBeInTheDocument();
    expect(screen.getByText(/Pickup only — there is no delivery/i)).toBeInTheDocument();
  });

  it('opens the Contact Us form when Contact Us is clicked', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.click(screen.getByText('Contact Us'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByLabelText('Subject')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
  });

  it('prefills the signed-in customer identity in the contact form', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.click(screen.getByText('Contact Us'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const dialogText = screen.getByRole('dialog').textContent;
    expect(dialogText).toContain('Maria Santos');
    expect(dialogText).toContain('maria.santos@email.com');
  });

  it('validates the support form before submitting', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.click(screen.getByText('Contact Us'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    await waitFor(() => expect(screen.getByText('Please enter a message.')).toBeInTheDocument());
    expect(apiFetch.mock.calls.some(([url, opts]) => url === '/customer/support' && opts?.method === 'POST')).toBe(false);
  });

  it('submits the support request to the real customer support endpoint', async () => {
    renderProfile();
    await waitForProfile();
    fireEvent.click(screen.getByText('Contact Us'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Bid Support' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'I was outbid — please check.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));

    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url, opts]) => url === '/customer/support' && opts?.method === 'POST');
      expect(call).toBeTruthy();
      const body = JSON.parse(call[1].body);
      expect(body.subject).toBe('Bid Support');
      expect(body.message).toBe('I was outbid — please check.');
      // identity is derived server-side from the session
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('name');
      expect(body).not.toHaveProperty('userId');
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows an error state when the support request fails', async () => {
    apiFetch.mockImplementation(async (url, opts) => {
      if (url === '/customer/support' && opts?.method === 'POST') throw new Error('Unable to send your message right now.');
      if (url === '/customer/account') return { ...ACCOUNT };
      return {};
    });
    renderProfile();
    await waitForProfile();
    fireEvent.click(screen.getByText('Contact Us'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));

    await waitFor(() => expect(screen.getByText('Unable to send your message right now.')).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('the expired-winner deep link opens the support form with safe context', async () => {
    const qs = new URLSearchParams({
      support: 'expired-payment',
      order: 'TXN-1234',
      item: 'Rose Gold Bangle',
      deadline: '2026-09-15T10:00:00.000Z',
      amount: '55000',
    }).toString();
    renderProfile(`/customer/account?${qs}`);
    await waitForProfile();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByLabelText('Category')).toHaveValue('Auction / Payment Support');
    const message = screen.getByLabelText('Message').value;
    expect(message).toContain('Rose Gold Bangle');
    expect(message).toContain('TXN-1234');
    expect(message).toContain('55000');
    // The next bidder is NEVER part of the support context.
    expect(message).not.toMatch(/Britz|Maria Santos \(next|Juan/i);
  });

  it('the expired-winner request carries only whitelisted safe metadata', async () => {
    const qs = new URLSearchParams({
      support: 'expired-payment',
      order: 'TXN-1234',
      item: 'Rose Gold Bangle',
      deadline: '2026-09-15T10:00:00.000Z',
      amount: '55000',
    }).toString();
    renderProfile(`/customer/account?${qs}`);
    await waitForProfile();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url, opts]) => url === '/customer/support' && opts?.method === 'POST');
      expect(call).toBeTruthy();
      const body = JSON.parse(call[1].body);
      expect(body.category).toBe('Auction / Payment Support');
      expect(body.metadata.item).toBe('Rose Gold Bangle');
      expect(body.metadata.transaction_code).toBe('TXN-1234');
      expect(body.metadata.winning_amount).toBe('55000');
      expect(Object.keys(body.metadata).sort()).toEqual(
        ['expired_payment_deadline', 'item', 'transaction_code', 'winning_amount']
      );
    });
  });

  it('has no dead chevrons — every support row performs an action', async () => {
    renderProfile();
    await waitForProfile();
    const faqRow = screen.getByText('FAQ').closest('button');
    const contactRow = screen.getByText('Contact Us').closest('button');
    expect(faqRow).toBeTruthy();
    expect(contactRow).toBeTruthy();
    fireEvent.click(faqRow);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });
});
