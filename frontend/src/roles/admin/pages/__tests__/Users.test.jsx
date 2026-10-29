// frontend/src/roles/admin/pages/__tests__/Users.test.jsx
// Admin — Users & Roles: KPI cards, filters, status tabs, branch resolution and
// the suspend / reactivate / edit mutations against the REAL data model
// (roles customer|shop_owner|admin, statuses active|suspended, no invites).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
const toast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toast }));
vi.mock('../../../../shared/components/Modal', () => ({
  Modal: ({ open, onClose, title, children, footer }) => open ? (
    <div role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
      <button type="button" onClick={onClose}>close-modal</button>
      {children}
      {footer}
    </div>
  ) : null,
}));

import Users from '../Users';

const BRANCH_1 = 'br-1';
const BRANCH_2 = 'br-2';
const BRANCHES = [
  { id: BRANCH_1, name: 'Gmall' },
  { id: BRANCH_2, name: 'Greenhills' },
];

const USERS = [
  { id: 'u-admin', name: 'Alyssa Santos', email: 'alyssa@atany.ph', role: 'admin', status: 'active', preferred_branch_id: null, branch_name: null, created_at: '2026-09-13T02:00:00Z' },
  { id: 'u-cust', name: 'Klane Cruz', email: 'klane@gmail.com', role: 'customer', status: 'active', preferred_branch_id: BRANCH_1, branch_name: 'Gmall', created_at: '2026-10-07T02:00:00Z' },
  { id: 'u-shop', name: 'Golden Heritage', email: 'owner@goldenheritage.ph', role: 'shop_owner', status: 'suspended', preferred_branch_id: BRANCH_2, branch_name: 'Greenhills', created_at: '2026-09-14T02:00:00Z' },
];

function routeFetch(overrides = {}) {
  return (path, opts = {}) => {
    if (path === '/admin/users' && (!opts.method || opts.method === 'GET')) return Promise.resolve(overrides.users ?? USERS);
    if (path === '/branches') return Promise.resolve(BRANCHES);
    if (/\/admin\/users\/.+\/suspend$/.test(path)) {
      const id = path.split('/')[3];
      return Promise.resolve({ id, status: JSON.parse(opts.body).status });
    }
    if (/^\/admin\/users\/[^/]+$/.test(path) && opts.method === 'PUT') {
      return Promise.resolve({ id: path.split('/')[3], ...JSON.parse(opts.body) });
    }
    return Promise.reject(new Error(`unmocked ${path}`));
  };
}

const rows = () => screen.getAllByRole('row').slice(1);
const rowFor = (name) => screen.getByText(name).closest('tr');

async function renderPage(overrides) {
  apiFetch.mockImplementation(routeFetch(overrides));
  const user = userEvent.setup();
  render(<Users />);
  await waitFor(() => expect(screen.getByText('Klane Cruz')).toBeTruthy());
  return user;
}

beforeEach(() => { apiFetch.mockReset(); toast.mockReset(); });

describe('KPI cards — real counts, never hardcoded', () => {
  it('renders exactly four cards from the fetched dataset', async () => {
    await renderPage();
    const labels = ['Total Accounts', 'Active Accounts', 'Shop Owners', 'Suspended'];
    const cards = document.querySelectorAll('.aur-kpi');
    expect(cards).toHaveLength(4);
    // Total 3 · Active 2 · Shop Owners 1 · Suspended 1 — computed from the response
    cards.forEach((card, i) => {
      expect(within(card).getByText(labels[i])).toBeTruthy();
      expect(card.querySelector('.aur-kpi__value').textContent).toBe(['3', '2', '1', '1'][i]);
    });
  });

  it('never shows invite or on-leave KPI copy', async () => {
    await renderPage();
    expect(screen.queryByText(/pending invite/i)).toBeNull();
    expect(screen.queryByText(/on leave/i)).toBeNull();
  });
});

describe('table — real fields only', () => {
  it('uses USER / ROLE / BRANCH / STATUS / JOINED / ACTIONS headers', async () => {
    await renderPage();
    ['User', 'Role', 'Branch', 'Status', 'Joined', 'Actions'].forEach((h) => expect(screen.getByText(h)).toBeTruthy());
    expect(screen.queryByText(/last active/i)).toBeNull();
  });

  it('renders initials, name, email, real role label, branch and status', async () => {
    await renderPage();
    const row = rowFor('Klane Cruz');
    expect(within(row).getByText('KC')).toBeTruthy();
    expect(within(row).getByText('klane@gmail.com')).toBeTruthy();
    expect(within(row).getByText('Customer')).toBeTruthy();
    expect(within(row).getByText('Gmall')).toBeTruthy();
    expect(within(row).getByText('Active')).toBeTruthy();
    expect(within(row).getByText('Oct 7, 2026')).toBeTruthy();
    expect(within(row).getByRole('button', { name: /suspend klane cruz/i })).toBeTruthy();
  });

  it('shows — when the account has no preferred branch', async () => {
    await renderPage();
    const admin = rowFor('Alyssa Santos');
    expect(within(admin).getByText('—')).toBeTruthy();
  });

  it('preserves every real role: customer, shop owner and admin', async () => {
    await renderPage();
    const body = document.querySelector('.aur-table tbody');
    ['Customer', 'Shop Owner', 'Admin'].forEach((r) => expect(within(body).getByText(r)).toBeTruthy());
  });

  it('shows Reactivate (not Suspend) for a suspended account', async () => {
    await renderPage();
    const row = rowFor('Golden Heritage');
    expect(within(row).getByRole('button', { name: /reactivate golden heritage/i })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /^suspend/i })).toBeNull();
    expect(within(row).getByText('Suspended')).toBeTruthy();
  });

  it('footer counts filtered rows against the total', async () => {
    await renderPage();
    expect(screen.getByText(/showing 3 of 3 accounts/i)).toBeTruthy();
  });
});

describe('search, role filter, branch filter and status tabs', () => {
  it('searches name, email and role label', async () => {
    const user = await renderPage();
    const input = screen.getByLabelText(/search name, email or role/i);
    await user.type(input, 'golden');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByText('Golden Heritage')).toBeTruthy();
    await user.clear(input);
    await user.type(input, 'shop owner');
    await waitFor(() => expect(screen.getByText('Golden Heritage')).toBeTruthy());
    expect(screen.queryByText('Klane Cruz')).toBeNull();
  });

  it('role filter offers exactly the three real roles', async () => {
    await renderPage();
    const select = screen.getByLabelText(/filter by role/i);
    expect(within(select).getByText('All Roles')).toBeTruthy();
    ['Customer', 'Shop Owner', 'Admin'].forEach((r) => expect(within(select).getByText(r)).toBeTruthy());
    expect(within(select).queryByText(/branch manager|auctioneer|appraiser|clerk|cashier/i)).toBeNull();
  });

  it('role filter narrows the table', async () => {
    const user = await renderPage();
    await user.selectOptions(screen.getByLabelText(/filter by role/i), 'shop_owner');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByText('Golden Heritage')).toBeTruthy();
  });

  it('branch filter uses real branch records via preferred_branch_id', async () => {
    const user = await renderPage();
    const select = screen.getByLabelText(/filter by branch/i);
    expect(within(select).getByText('Gmall')).toBeTruthy();
    expect(within(select).getByText('Greenhills')).toBeTruthy();
    await user.selectOptions(select, BRANCH_2);
    await waitFor(() => expect(screen.getByText('Golden Heritage')).toBeTruthy());
    expect(screen.queryByText('Klane Cruz')).toBeNull();
  });

  it('status tabs are only All / Active / Suspended', async () => {
    await renderPage();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['All', 'Active', 'Suspended']);
    expect(screen.queryByText('Invited')).toBeNull();
    expect(screen.queryByText('On Leave')).toBeNull();
  });

  it('Suspended tab filters, Active tab filters, All restores', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('tab', { name: 'Suspended' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByText('Golden Heritage')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Active' }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.queryByText('Golden Heritage')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'All' }));
    await waitFor(() => expect(rows()).toHaveLength(3));
  });

  it('empty filter result shows a no-match state, not fake rows', async () => {
    const user = await renderPage();
    await user.type(screen.getByLabelText(/search name, email or role/i), 'zzzzz');
    await waitFor(() => expect(screen.getByText(/no users match your filters/i)).toBeTruthy());
  });
});

describe('suspend / reactivate', () => {
  it('suspends the SELECTED user by id after confirmation', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /suspend klane cruz/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Klane Cruz')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/admin/users/u-cust/suspend',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'suspended' }) }),
    ));
    expect(toast).toHaveBeenCalledWith('Account suspended.');
    await waitFor(() => expect(apiFetch.mock.calls.filter((c) => c[0] === '/admin/users').length).toBeGreaterThan(1));
  });

  it('reactivates a suspended user by id', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /reactivate golden heritage/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/admin/users/u-shop/suspend',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'active' }) }),
    ));
    expect(toast).toHaveBeenCalledWith('Account reactivated.');
  });

  it('cancelling the confirmation performs no mutation', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /suspend klane cruz/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(apiFetch).not.toHaveBeenCalledWith('/admin/users/u-cust/suspend', expect.anything());
  });

  it('surfaces a server-side rejection (e.g. self-suspend) as feedback', async () => {
    apiFetch.mockImplementation((path, opts = {}) => {
      if (path === '/branches') return Promise.resolve(BRANCHES);
      if (/\/suspend$/.test(path)) return Promise.reject(new Error('You cannot suspend your own account'));
      return Promise.resolve(USERS);
    });
    const user = userEvent.setup();
    render(<Users />);
    await waitFor(() => expect(screen.getByText('Klane Cruz')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /suspend klane cruz/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('You cannot suspend your own account'));
  });
});

describe('edit', () => {
  it('opens the correct user pre-filled and saves through the existing PUT route', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /edit klane cruz/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/full name/i).value).toBe('Klane Cruz');
    expect(within(dialog).getByLabelText(/email address/i).value).toBe('klane@gmail.com');
    expect(within(dialog).getByLabelText(/^role/i).value).toBe('customer');
    expect(within(dialog).getByLabelText(/^status/i).value).toBe('active');

    await user.clear(within(dialog).getByLabelText(/full name/i));
    await user.type(within(dialog).getByLabelText(/full name/i), 'Klane Cruz Jr');
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/admin/users/u-cust',
      expect.objectContaining({ method: 'PUT' }),
    ));
    const body = JSON.parse(apiFetch.mock.calls.find((c) => c[0] === '/admin/users/u-cust')[1].body);
    expect(body).toEqual({ name: 'Klane Cruz Jr', email: 'klane@gmail.com', role: 'customer', status: 'active' });
    // preferred_branch_id is customer-owned: never in the admin update payload
    expect(Object.keys(body)).not.toContain('preferred_branch_id');
    expect(toast).toHaveBeenCalledWith('User updated.');
  });

  it('offers NO branch control — preferred_branch_id is customer-owned, read-only for admins', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /edit klane cruz/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('#aur-branch')).toBeNull();
    expect(within(dialog).queryByLabelText(/branch/i)).toBeNull();
    // the value is still displayed read-only in the table itself
    expect(within(rowFor('Klane Cruz')).getByText('Gmall')).toBeTruthy();
  });

  it('only offers the three real roles and two real statuses', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /edit klane cruz/i }));
    const dialog = await screen.findByRole('dialog');
    const roles = within(dialog).getByLabelText(/^role/i);
    expect(within(roles).getAllByRole('option').map((o) => o.value)).toEqual(['customer', 'shop_owner', 'admin']);
    const status = within(dialog).getByLabelText(/^status/i);
    expect(within(status).getAllByRole('option').map((o) => o.value)).toEqual(['active', 'suspended']);
  });

  it('shows the server error inside the modal instead of closing it', async () => {
    const user = userEvent.setup();
    apiFetch.mockImplementation((path, opts = {}) => {
      if (path === '/branches') return Promise.resolve(BRANCHES);
      if (opts.method === 'PUT') return Promise.reject(new Error('At least one active admin must remain'));
      return Promise.resolve(USERS);
    });
    render(<Users />);
    await waitFor(() => expect(screen.getByText('Klane Cruz')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /edit klane cruz/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/active admin must remain/i);
  });
});

describe('loading, error and skeleton states', () => {
  it('shows 4 KPI skeletons + table row skeletons, never fake empty data', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<Users />);
    const busy = await screen.findByLabelText(/loading users and roles/i);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('.aur-kpis .aur-kpi')).toHaveLength(4);
    expect(container.querySelectorAll('.aur-table tbody tr').length).toBeGreaterThanOrEqual(6);
    expect(screen.queryByText('No users yet.')).toBeNull();
    expect(screen.queryByText(/total accounts/i)).toBeNull();
  });

  it('renders an error state with retry when the list request fails', async () => {
    apiFetch.mockImplementation(() => Promise.reject(new Error('Network down')));
    render(<Users />);
    expect(await screen.findByText('Unable to load users.')).toBeTruthy();
    expect(screen.getByText('Network down')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('renders a true empty state when the platform has no accounts', async () => {
    apiFetch.mockImplementation(routeFetch({ users: [] }));
    render(<Users />);
    expect(await screen.findByText('No users yet.')).toBeTruthy();
    expect(screen.getByText(/showing 0 of 0 accounts/i)).toBeTruthy();
  });
});

describe('no invitation surface exists', () => {
  it('renders no invite controls or copy anywhere in the page', async () => {
    await renderPage();
    expect(screen.queryByText(/invite/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /invite/i })).toBeNull();
    expect(screen.queryByText(/resend|cancel invite|send invite/i)).toBeNull();
    // and no invite request is ever issued
    expect(apiFetch.mock.calls.some(([p]) => /invite/i.test(String(p)))).toBe(false);
  });
});