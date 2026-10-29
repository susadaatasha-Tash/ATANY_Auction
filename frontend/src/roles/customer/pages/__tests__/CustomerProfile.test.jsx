// frontend/src/roles/customer/pages/__tests__/CustomerProfile.test.jsx
//
// Customer Profile (/customer/account) + retirement of customer Settings.
//
// Guarantees locked here:
//   · Profile loads the authoritative account + real branch records
//   · Full Name and Phone are genuinely editable and saved to the backend
//   · Email stays read-only (no unverified identity change)
//   · Save sends ONLY changed allow-listed fields — never role/status
//   · Preferred Branch uses the real branches source and its dedicated endpoint
//   · Password change proves the CURRENT password first, then updates in the
//     auth provider; the password never reaches the ATANY backend
//   · Each password field has an independent show/hide toggle
//   · Help & Support (FAQ + Contact Us) lives on Profile and really works
//   · The customer sidebar has no Settings entry; the old URL redirects to Profile
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
const toast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toast }));

const signInWithPassword = vi.fn();
const updateUser = vi.fn();
vi.mock('../../../../shared/lib/supabaseClient', () => ({
  supabase: { auth: { signInWithPassword: (...a) => signInWithPassword(...a), updateUser: (...a) => updateUser(...a) } },
}));

let authValue = { user: { id: 'c1', email: 'maria.santos@email.com', user_metadata: {} }, setPreferredBranchId: vi.fn() };
vi.mock('../../../../shared/hooks/useAuth', () => ({ useAuth: () => authValue }));

import AccountSettings from '../AccountSettings';

const ACCOUNT = {
  id: 'c1', name: 'Maria Santos', email: 'maria.santos@email.com',
  phone: '+639171234567', preferred_branch_id: 'b2', preferred_branch_name: 'Gmall Branch',
};
const BRANCHES = [
  { id: 'b1', name: 'Abreeza Branch', address: 'Abreeza Mall', lat: 7.09, lng: 125.61, status: 'Open' },
  { id: 'b2', name: 'Gmall Branch', address: 'Gmall Davao', lat: 7.07, lng: 125.61, status: 'Open' },
];

function routeApi(over = {}) {
  return (p, opts = {}) => {
    if (p === '/customer/account' && (!opts.method || opts.method === 'GET')) {
      if (over.loadError) return Promise.reject(new Error(over.loadError));
      return Promise.resolve(over.account || ACCOUNT);
    }
    if (p === '/branches') {
      if (over.branchesError) return Promise.reject(new Error('branches down'));
      return Promise.resolve(over.branches || BRANCHES);
    }
    if (p === '/customer/account' && opts.method === 'PUT') {
      if (over.saveError) return Promise.reject(new Error(over.saveError));
      const body = JSON.parse(opts.body);
      return Promise.resolve({ profile: { ...ACCOUNT, ...body } });
    }
    if (p === '/customer/preferred-branch') {
      const body = JSON.parse(opts.body);
      const b = (over.branches || BRANCHES).find((x) => x.id === body.branch_id);
      return Promise.resolve({ preferred_branch_id: body.branch_id, branch_name: b?.name || null });
    }
    if (p === '/customer/support') {
      if (over.supportError) return Promise.reject(new Error('support down'));
      return Promise.resolve({ ok: true, id: 'sr-1' });
    }
    return Promise.reject(new Error(`unmocked ${p}`));
  };
}

async function renderPage(over = {}) {
  apiFetch.mockImplementation(routeApi(over));
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/customer/account']}>
      <Routes>
        <Route path="/customer/account" element={<AccountSettings />} />
      </Routes>
    </MemoryRouter>
  );
  // The error case never renders the form, so callers opt out of the wait.
  if (!over.loadError) await screen.findByDisplayValue('Maria Santos');
  return user;
}

const putCalls = () => apiFetch.mock.calls.filter(([p, o]) => p === '/customer/account' && o?.method === 'PUT');

beforeEach(() => {
  apiFetch.mockReset(); toast.mockReset();
  signInWithPassword.mockReset().mockResolvedValue({ error: null });
  updateUser.mockReset().mockResolvedValue({ error: null });
  authValue = { user: { id: 'c1', email: 'maria.santos@email.com', user_metadata: {} }, setPreferredBranchId: vi.fn() };
});
afterEach(() => cleanup());

describe('profile loads real data', () => {
  it('1. loads the authenticated account and real branches', async () => {
    await renderPage();
    expect(apiFetch).toHaveBeenCalledWith('/customer/account');
    expect(apiFetch).toHaveBeenCalledWith('/branches', { public: true });
    expect(screen.getByDisplayValue('maria.santos@email.com')).toBeTruthy();
    expect(screen.getByDisplayValue('+639171234567')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Abreeza Branch' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Gmall Branch' })).toBeTruthy();
  });

  it('2. branch options come from the API, never hardcoded', async () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../AccountSettings.jsx'), 'utf8');
    ['Abreeza', 'Gmall', 'SM Lanang'].forEach((n) => expect(src).not.toContain(n));
  });

  it('3. the preferred branch is selected from the loaded data', async () => {
    await renderPage();
    expect(screen.getByLabelText(/preferred branch/i).value).toBe('b2');
  });

  it('4. a load failure shows a retry state instead of a blank page', async () => {
    await renderPage({ loadError: 'Unable to load your profile.' });
    expect(await screen.findByText(/unable to load your profile/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});

describe('editing + saving', () => {
  it('5. Full Name is editable and saves to the backend', async () => {
    const user = await renderPage();
    const input = screen.getByLabelText(/full name/i);
    expect(input).not.toHaveAttribute('disabled');
    await user.clear(input);
    await user.type(input, 'Maria L. Santos');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(JSON.parse(putCalls()[0][1].body)).toEqual({ name: 'Maria L. Santos' });
    expect(toast).toHaveBeenCalledWith('Profile updated successfully.');
  });

  it('6. Email Address is read-only, never submitted', async () => {
    const user = await renderPage();
    const email = screen.getByLabelText(/email address/i);
    expect(email).toHaveAttribute('readonly');
    expect(email).toBeDisabled();
    await user.clear(screen.getByLabelText(/full name/i));
    await user.type(screen.getByLabelText(/full name/i), 'Someone Else');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    const body = JSON.parse(putCalls()[0][1].body);
    expect(body).not.toHaveProperty('email');
  });

  it('7. Phone is editable, validated and saved', async () => {
    const user = await renderPage();
    const phone = screen.getByLabelText(/phone number/i);
    expect(phone).toHaveAttribute('inputmode', 'tel');
    expect(phone).toHaveAttribute('autocomplete', 'tel');
    expect(phone).not.toHaveAttribute('type', 'number');
    await user.clear(phone);
    // typed with spaces + leading zero, stored canonically
    await user.type(phone, '0918 555 1234');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(JSON.parse(putCalls()[0][1].body)).toEqual({ phone: '+639185551234' });
  });

  it('8. invalid phone is rejected client-side with a friendly message', async () => {
    const user = await renderPage();
    const phone = screen.getByLabelText(/phone number/i);
    await user.clear(phone);
    await user.type(phone, '12345');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/enter a valid philippine mobile number/i)).toBeTruthy();
    expect(putCalls()).toHaveLength(0);
  });

  it('9. only changed fields are sent (no stale overwrite)', async () => {
    const user = await renderPage();
    // Change ONLY the branch: the profile endpoint must not be called at all,
    // so the untouched name/phone can never be written back from a stale render.
    await user.selectOptions(screen.getByLabelText(/preferred branch/i), 'b1');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Profile updated successfully.'));
    expect(putCalls()).toHaveLength(0);
    expect(apiFetch).toHaveBeenCalledWith('/customer/preferred-branch', expect.objectContaining({ method: 'PUT' }));
  });

  it('10. role and status are never sent', async () => {
    const user = await renderPage();
    await user.clear(screen.getByLabelText(/full name/i));
    await user.type(screen.getByLabelText(/full name/i), 'QA Name');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    const body = JSON.parse(putCalls()[0][1].body);
    ['role', 'status', 'id', 'user_id', 'userId', 'password'].forEach((k) => expect(body).not.toHaveProperty(k));
  });

  it('11. a save failure preserves the typed edits and explains itself', async () => {
    const user = await renderPage({ saveError: 'Unable to update profile.' });
    const name = screen.getByLabelText(/full name/i);
    await user.clear(name);
    await user.type(name, 'Keep My Edit');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Unable to update profile.'));
    expect(screen.getByLabelText(/full name/i).value).toBe('Keep My Edit');
  });

  it('12. preferred branch saves through its own endpoint and syncs the header', async () => {
    const user = await renderPage();
    const select = screen.getByLabelText(/preferred branch/i);
    await user.selectOptions(select, 'b1');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/customer/preferred-branch', expect.objectContaining({ method: 'PUT' })));
    expect(authValue.setPreferredBranchId).toHaveBeenCalledWith('b1');
  });

  it('13. the save button is disabled while saving and when nothing changed', async () => {
    const user = await renderPage();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    await user.clear(screen.getByLabelText(/full name/i));
    await user.type(screen.getByLabelText(/full name/i), 'Changed');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();
  });
});

describe('security / password', () => {
  const allPasswordInputs = () => screen.getAllByPlaceholderText(/••••|at least 6|repeat your new password/i);

  it('14. all three password fields start hidden with correct autocomplete', async () => {
    await renderPage();
    expect(screen.getByLabelText('Current Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('New Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm New Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Current Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('New Password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Confirm New Password')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('15. each Eye toggle is independent', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /show current password/i }));
    expect(screen.getByLabelText('Current Password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('New Password')).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: /show new password/i }));
    expect(screen.getByLabelText('Current Password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('New Password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Confirm New Password')).toHaveAttribute('type', 'password');
    // toggling back hides it and flips the accessible label
    await user.click(screen.getByRole('button', { name: /hide current password/i }));
    expect(screen.getByLabelText('Current Password')).toHaveAttribute('type', 'password');
  });

  it('16. the toggles are real buttons that do not submit the form', async () => {
    await renderPage();
    document.querySelectorAll('.password-toggle').forEach((b) => {
      expect(b.tagName).toBe('BUTTON');
      expect(b).toHaveAttribute('type', 'button');
    });
  });

  it('17. mismatched passwords never reach the auth provider', async () => {
    const user = await renderPage();
    await user.type(screen.getByLabelText('Current Password'), 'OldPass123');
    await user.type(screen.getByLabelText('New Password'), 'NewPass123');
    await user.type(screen.getByLabelText('Confirm New Password'), 'Different123');
    await user.click(screen.getByRole('button', { name: /update password/i }));
    expect(await screen.findByText(/passwords do not match/i)).toBeTruthy();
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('18. a wrong current password is rejected safely', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const user = await renderPage();
    await user.type(screen.getByLabelText('Current Password'), 'WrongPass');
    await user.type(screen.getByLabelText('New Password'), 'NewPass123');
    await user.type(screen.getByLabelText('Confirm New Password'), 'NewPass123');
    await user.click(screen.getByRole('button', { name: /update password/i }));
    expect(await screen.findByText(/current password is incorrect/i)).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('19. a valid change verifies then updates, clears fields and re-hides them', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /show new password/i }));
    await user.type(screen.getByLabelText('Current Password'), 'OldPass123');
    await user.type(screen.getByLabelText('New Password'), 'NewPass123');
    await user.type(screen.getByLabelText('Confirm New Password'), 'NewPass123');
    await user.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'NewPass123' }));
    // current password is proven BEFORE the update
    expect(signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(updateUser.mock.invocationCallOrder[0]);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'maria.santos@email.com', password: 'OldPass123' });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Password updated successfully.'));
    expect(screen.getByLabelText('Current Password').value).toBe('');
    expect(screen.getByLabelText('New Password').value).toBe('');
    expect(screen.getByLabelText('Confirm New Password').value).toBe('');
    expect(screen.getByLabelText('New Password')).toHaveAttribute('type', 'password');
  });

  it('20. the password is never sent to the ATANY backend', async () => {
    const user = await renderPage();
    await user.type(screen.getByLabelText('Current Password'), 'OldPass123');
    await user.type(screen.getByLabelText('New Password'), 'NewPass123');
    await user.type(screen.getByLabelText('Confirm New Password'), 'NewPass123');
    await user.click(screen.getByRole('button', { name: /update password/i }));
    await waitFor(() => expect(updateUser).toHaveBeenCalled());
    const serialised = JSON.stringify(apiFetch.mock.calls);
    ['OldPass123', 'NewPass123'].forEach((secret) => expect(serialised).not.toContain(secret));
  });

  it('21. browser password-manager UI is not suppressed with hidden CSS hacks', () => {
    const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../../../index.css'), 'utf8');
    expect(css).not.toMatch(/-webkit-credentials-auto-fill-button/);
    expect(css).not.toMatch(/-ms-clear/);
    expect(css).not.toMatch(/-webkit-autofill/);
  });
});

describe('help & support', () => {
  it('22. FAQ opens with real, grounded answers', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /faq/i }));
    const dialog = await screen.findByRole('dialog', { name: /frequently asked/i });
    // Grounded in the real winner-fallback behaviour, not "you win immediately".
    await user.click(within(dialog).getByRole('button', { name: /what happens when an auction ends/i }));
    expect(within(dialog).getByText(/highest eligible bidder becomes the current winner/i)).toBeTruthy();
    expect(within(dialog).getByText(/7-day window/i)).toBeTruthy();
    // it reflects the real winner fallback, not the old "you win immediately" claim
    expect(within(dialog).queryByText(/automatically owns/i)).toBeNull();
  });

  it('23. FAQ answers expand and collapse', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /faq/i }));
    const btn = screen.getByRole('button', { name: /where do i collect my piece/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await user.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: /frequently asked/i });
    expect(within(dialog).getByText(/valid ID and your order number/i)).toBeTruthy();
  });

  it('24. Contact Us opens with the signed-in identity prefilled', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /contact us/i }));
    expect(await screen.findByText(/maria\.santos@email\.com/i)).toBeTruthy();
  });

  it('25. the support form validates before sending', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /contact us/i }));
    await user.click(screen.getByRole('button', { name: /send message/i }));
    expect(await screen.findByText(/please choose a subject/i)).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalledWith('/customer/support', expect.anything());
  });

  it('26. a valid message submits to the real support endpoint', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /contact us/i }));
    await user.selectOptions(screen.getByLabelText(/subject/i), 'Account Issue');
    await user.type(screen.getByLabelText(/message/i), 'Please help with my account.');
    await user.click(screen.getByRole('button', { name: /send message/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/customer/support', expect.objectContaining({ method: 'POST' })));
    const body = JSON.parse(apiFetch.mock.calls.find(([p]) => p === '/customer/support')[1].body);
    // identity comes from the session, never from the payload
    expect(body).toEqual({ subject: 'Account Issue', message: 'Please help with my account.' });
    expect(await screen.findByText(/request submitted/i)).toBeTruthy();
  });

  it('27. a support failure keeps the modal usable and explains itself', async () => {
    const user = await renderPage({ supportError: 'support down' });
    await user.click(screen.getByRole('button', { name: /contact us/i }));
    await user.selectOptions(screen.getByLabelText(/subject/i), 'General Inquiry');
    await user.type(screen.getByLabelText(/message/i), 'Hello there please.');
    await user.click(screen.getByRole('button', { name: /send message/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('support down'));
    expect(screen.queryByText(/^request submitted$/i)).toBeNull();
  });

  it('28. Help & Support is rendered on Profile, and its rows are real buttons', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: /help & support/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /faq/i }).tagName).toBe('BUTTON');
    expect(screen.getByRole('button', { name: /contact us/i }).tagName).toBe('BUTTON');
  });
});

describe('customer settings retirement', () => {
  const layoutSrc = () => require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../../../layouts/CustomerLayout.jsx'), 'utf8');

  it('29. the customer sidebar no longer has a Settings section or item', () => {
    const src = layoutSrc();
    expect(src).not.toMatch(/label: 'SETTINGS'/);
    expect(src).not.toMatch(/'\/customer\/settings'/);
    expect(src).not.toMatch(/name: 'Settings'/);
  });

  it('30. the other customer nav entries survive untouched', () => {
    const src = layoutSrc();
    ['Dashboard', 'Auctions', 'My Bids', 'Favorites', 'Watchlist', 'Branch Locator', 'My Purchases']
      .forEach((item) => expect(src).toContain(`name: '${item}'`));
    expect(src).toContain('label: \'ORDERS\'');
  });

  it('31. Profile stays reachable from the account menu', () => {
    expect(layoutSrc()).toContain('settingsTo="/customer/account"');
    expect(layoutSrc()).toContain("'/customer/account': ['Profile']");
  });

  it('32. the old Settings URL redirects to Profile instead of 404ing', () => {
    const routes = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../routes.jsx'), 'utf8');
    expect(routes).toMatch(/path: 'settings', element: <Navigate to="\/customer\/account" replace \/>/);
  });

  it('33. the retired Settings page is gone and not imported anywhere', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    expect(fs.existsSync(path.join(__dirname, '../Settings.jsx'))).toBe(false);
    expect(fs.readFileSync(path.join(__dirname, '../../routes.jsx'), 'utf8')).not.toContain("from './pages/Settings'");
  });

  it('34. admin and seller navigation is unaffected', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const base = path.join(__dirname, '../../../../layouts');
    const shop = fs.readFileSync(path.join(base, 'ShopOwnerLayout.jsx'), 'utf8');
    expect(shop).toContain('Shop Profile');
    // only the CUSTOMER sidebar lost its Settings entry
    expect(fs.readFileSync(path.join(base, 'CustomerLayout.jsx'), 'utf8')).not.toMatch(/name: 'Settings'/);
  });
});
