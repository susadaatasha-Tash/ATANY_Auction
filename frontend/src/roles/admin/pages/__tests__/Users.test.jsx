// frontend/src/roles/admin/pages/__tests__/Users.test.jsx
// Admin → Users & Roles — page, KPIs, filters, status tabs, row rendering and
// every account action (suspend / reactivate / edit / invite / resend / cancel).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { apiFetch, toastSpy } = vi.hoisted(() => ({ apiFetch: vi.fn(), toastSpy: vi.fn() }));
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toastSpy }));

import Users from '../Users';

const BRANCHES = [
  { id: 'b1', name: 'Abreeza Branch', status: 'Open' },
  { id: 'b2', name: 'Gmall Branch', status: 'Open' },
];

const ACCOUNTS = [
  {
    id: 'u-1', name: 'Adrian Villanueva', email: 'adrian.v@atany.ph', role: 'admin',
    status: 'active', created_at: '2026-09-13T00:00:00.000Z', branch_id: null, branch_name: null,
    last_active: new Date(Date.now() - 2 * 60000).toISOString(), bids: 0,
  },
  {
    id: 'u-2', name: 'Rosa Villanueva', email: 'rosa.v@atany.ph', role: 'shop_owner',
    status: 'active', created_at: '2026-09-13T00:00:00.000Z', branch_id: 'b2', branch_name: 'Gmall Branch',
    last_active: new Date(Date.now() - 18 * 60000).toISOString(), bids: 0,
  },
  {
    id: 'u-3', name: 'Bianca Ramos', email: 'bianca.r@atany.ph', role: 'shop_owner',
    status: 'invited', created_at: '2026-09-29T00:00:00.000Z', branch_id: 'b1', branch_name: 'Abreeza Branch',
    last_active: null, invited_at: '2026-09-29T00:00:00.000Z', invite_sent_at: '2026-09-29T00:00:00.000Z', bids: 0,
  },
  {
    id: 'u-4', name: 'Aaron Delos Reyes', email: 'aaron.d@atany.ph', role: 'customer',
    status: 'on_leave', created_at: '2026-09-22T00:00:00.000Z', branch_id: null, branch_name: null,
    last_active: '2026-09-22T09:40:00.000Z', bids: 0,
  },
  {
    id: 'u-5', name: 'Karl Bautista', email: 'karl.b@atany.ph', role: 'customer',
    status: 'suspended', created_at: '2026-08-30T00:00:00.000Z', branch_id: null, branch_name: null,
    last_active: '2026-08-30T09:40:00.000Z', bids: 0,
  },
];

const SUMMARY = {
  total_accounts: 5, total_staff: 2, active_staff: 2, pending_invites: 1,
  suspended_staff: 0, on_leave_staff: 0, staff_branch_count: 1,
};

/** Route the mocked apiFetch by url so filters can be asserted. */
function installApi({ rows = ACCOUNTS, summary = SUMMARY, branches = BRANCHES, fail = null } = {}) {
  apiFetch.mockImplementation(async (url, opts) => {
    if (String(url).startsWith('/admin/users/summary')) return summary;
    if (String(url).startsWith('/admin/branches')) return branches;
    if (String(url).startsWith('/admin/users')) {
      if (fail === 'list') throw new Error('Network down');
      const parsed = new URL(`http://x${url}`);
      const q = (parsed.searchParams.get('q') || '').toLowerCase();
      const role = parsed.searchParams.get('role');
      const branch = parsed.searchParams.get('branch_id');
      const status = parsed.searchParams.get('status');
      return rows.filter((r) => {
        if (q && !(`${r.name} ${r.email} ${r.role}`.toLowerCase().includes(q))) return false;
        if (role && r.role !== role) return false;
        if (branch && r.branch_id !== branch) return false;
        if (status && r.status !== status) return false;
        return true;
      });
    }
    return [];
  });
}

function renderUsers() {
  return render(<Users />);
}

async function waitForRows() {
  await waitFor(() => expect(screen.getByText('Personal Information'.length ? 'Adrian Villanueva' : '')).toBeInTheDocument());
}

beforeEach(() => {
  apiFetch.mockReset();
  toastSpy.mockReset();
  installApi();
});

describe('Admin Users & Roles — page + KPIs', () => {
  it('loads the page and the account list', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith('/admin/users');
    expect(screen.getByTestId('kpi-total-staff')).toBeInTheDocument();
    expect(document.querySelector('.usr-card')).toBeTruthy();
  });

  it('shows the four KPI cards with the values from the summary API', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByTestId('kpi-total-staff')).toBeInTheDocument());
    expect(within(screen.getByTestId('kpi-total-staff')).getByText('Total Staff')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-total-staff')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-active-accounts')).getByText('Active Accounts')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-active-accounts')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-pending-invites')).getByText('Pending Invites')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-pending-invites')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-suspended')).getByText('Suspended')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/admin/users/summary');
  });

  it('shows a skeleton while loading', () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = renderUsers();
    expect(container.querySelectorAll('.sub-kpi--skeleton').length).toBe(4);
    expect(container.querySelector('.usr-card')).toBeTruthy();
    expect(container.querySelectorAll('.usr-skel--cell').length).toBeGreaterThan(6);
  });

  it('shows an error state with a retry when the list cannot be loaded', async () => {
    installApi({ fail: 'list' });
    renderUsers();
    await waitFor(() => expect(screen.getByText('Unable to load the accounts')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows an empty state when no account matches', async () => {
    installApi({ rows: [] });
    renderUsers();
    await waitFor(() => expect(screen.getByText('No accounts match the current filters')).toBeInTheDocument());
  });
});

describe('Admin Users & Roles — search and filters', () => {
  it('searches by name, email or role', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    const search = screen.getByLabelText('Search name, email or role');
    expect(search).toHaveAttribute('placeholder', 'Search name, email or role...');
    fireEvent.change(search, { target: { value: 'rosa' } });
    await waitFor(() => expect(screen.queryByText('Adrian Villanueva')).not.toBeInTheDocument());
    expect(screen.getByText('Rosa Villanueva')).toBeInTheDocument();
  });

  it('filters by role', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    const select = screen.getByLabelText('Filter by role');
    expect(within(select).getByText('All roles')).toBeInTheDocument();
    expect(within(select).getByText('Administrator')).toBeInTheDocument();
    expect(within(select).getByText('Shop Owner')).toBeInTheDocument();
    expect(within(select).getByText('Customer')).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'shop_owner' } });
    await waitFor(() => expect(screen.getByText('Rosa Villanueva')).toBeInTheDocument());
    expect(screen.queryByText('Adrian Villanueva')).not.toBeInTheDocument();
  });

  it('filters by branch using the real branch list', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    const select = screen.getByLabelText('Filter by branch');
    expect(within(select).getByText('All branches')).toBeInTheDocument();
    expect(within(select).getByText('Gmall Branch')).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'b2' } });
    await waitFor(() => expect(screen.getByText('Rosa Villanueva')).toBeInTheDocument());
    expect(screen.queryByText('Bianca Ramos')).not.toBeInTheDocument();
  });

  it('composes search + role + branch filters', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Search name, email or role'), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'shop_owner' } });
    fireEvent.change(screen.getByLabelText('Filter by branch'), { target: { value: 'b2' } });
    await waitFor(() => expect(screen.queryByText('Bianca Ramos')).not.toBeInTheDocument());
    expect(screen.getByText('Rosa Villanueva')).toBeInTheDocument();
    expect(screen.queryByText('Adrian Villanueva')).not.toBeInTheDocument();
  });
});

describe('Admin Users & Roles — status tabs', () => {
  it('renders the five status tabs', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    ['All', 'Active', 'Invited', 'On Leave', 'Suspended'].forEach((t) => {
      expect(screen.getByRole('tab', { name: t })).toBeInTheDocument();
    });
  });

  it('the All tab shows every account', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('.usr-count').textContent).toContain('5');
    expect(document.querySelector('.usr-count').textContent).toContain('5 of 5 accounts');
  });

  it('the Active tab filters to active accounts', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'Active' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Active' }).getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByText('Rosa Villanueva')).toBeInTheDocument();
    expect(screen.queryByText('Bianca Ramos')).not.toBeInTheDocument();
    expect(screen.queryByText('Karl Bautista')).not.toBeInTheDocument();
  });

  it('the Invited tab filters to pending invitations', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'Invited' }));
    await waitFor(() => expect(screen.getByText('Bianca Ramos')).toBeInTheDocument());
    expect(screen.queryByText('Adrian Villanueva')).not.toBeInTheDocument();
  });

  it('the On Leave tab filters to accounts on leave', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'On Leave' }));
    await waitFor(() => expect(screen.getByText('Aaron Delos Reyes')).toBeInTheDocument());
    expect(screen.queryByText('Adrian Villanueva')).not.toBeInTheDocument();
  });

  it('the Suspended tab filters to suspended accounts', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'Suspended' }));
    await waitFor(() => expect(screen.getByText('Karl Bautista')).toBeInTheDocument());
    expect(screen.queryByText('Adrian Villanueva')).not.toBeInTheDocument();
  });
});

describe('Admin Users & Roles — row rendering', () => {
  it('renders the account name and email in the staff member cell', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    expect(screen.getByText('adrian.v@atany.ph')).toBeInTheDocument();
  });

  it('generates the avatar initials from the real name', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    const row = screen.getByTestId('user-row-u-1');
    expect(within(row).getByText('AV')).toBeInTheDocument();
  });

  it('shows the human readable role', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    const row = screen.getByTestId('user-row-u-1');
    expect(within(row).getByText('Administrator')).toBeInTheDocument();
    const row2 = screen.getByTestId('user-row-u-2');
    expect(within(row2).getByText('Shop Owner')).toBeInTheDocument();
  });

  it('shows the branch name, or a dash when there is none', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    expect(within(screen.getByTestId('user-row-u-2')).getByText('Gmall Branch')).toBeInTheDocument();
    expect(within(screen.getByTestId('user-row-u-1')).getByText('—')).toBeInTheDocument();
  });

  it('maps the account status to the reference badges', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    expect(within(screen.getByTestId('user-row-u-1')).getByText('Active')).toBeInTheDocument();
    expect(within(screen.getByTestId('user-row-u-3')).getByText('Invited')).toBeInTheDocument();
    expect(within(screen.getByTestId('user-row-u-4')).getByText('On Leave')).toBeInTheDocument();
    expect(within(screen.getByTestId('user-row-u-5')).getByText('Suspended')).toBeInTheDocument();
  });

  it('formats the last active timestamp and never invents one', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    expect(within(screen.getByTestId('user-row-u-1')).getByText('2 min ago')).toBeInTheDocument();
    expect(within(screen.getByTestId('user-row-u-2')).getByText('18 min ago')).toBeInTheDocument();
    expect(within(screen.getByTestId('user-row-u-4')).getByText('Sep 22, 2026')).toBeInTheDocument();
  });

  it('shows the invite date for a pending invitation', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    expect(within(screen.getByTestId('user-row-u-3')).getByText(/Invite sent/)).toBeInTheDocument();
  });

  it('shows the real account count in the footer', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    const count = document.querySelector('.usr-count');
    expect(count.textContent).toContain('Showing');
    expect(count.textContent).toContain('5 of 5 accounts');
  });
});

describe('Admin Users & Roles — account actions', () => {
  it('Suspend opens the confirmation for the clicked account', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    fireEvent.click(within(screen.getByTestId('user-row-u-1')).getByRole('button', { name: /Suspend/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Suspend account?')).toBeInTheDocument();
    expect(within(dialog).getByText('Adrian Villanueva')).toBeInTheDocument();
    expect(within(dialog).getByText(/will lose access until reactivated/i)).toBeInTheDocument();
  });

  it('Suspend mutates the clicked account and toasts', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    fireEvent.click(within(screen.getByTestId('user-row-u-1')).getByRole('button', { name: /Suspend/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Account suspended.'));
    const call = apiFetch.mock.calls.find(([u, o]) => u === '/admin/users/u-1/suspend' && o?.method === 'PATCH');
    expect(call).toBeTruthy();
    expect(JSON.parse(call[1].body)).toEqual({ status: 'suspended' });
  });

  it('Reactivate is offered for a suspended account and mutates it', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Karl Bautista')).toBeInTheDocument());
    fireEvent.click(within(screen.getByTestId('user-row-u-5')).getByRole('button', { name: /Reactivate/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Reactivate account?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Account reactivated.'));
    const call = apiFetch.mock.calls.find(([u, o]) => u === '/admin/users/u-5/suspend' && o?.method === 'PATCH');
    expect(JSON.parse(call[1].body)).toEqual({ status: 'active' });
  });

  it('Edit opens the clicked account (never stale data)', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Edit Adrian Villanueva'));
    let dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('#usr-edit-name').value).toBe('Adrian Villanueva');
    expect(dialog.querySelector('#usr-edit-email').value).toBe('adrian.v@atany.ph');
    expect(dialog.querySelector('#usr-edit-role').value).toBe('admin');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Edit Rosa Villanueva'));
    dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('#usr-edit-name').value).toBe('Rosa Villanueva');
    expect(dialog.querySelector('#usr-edit-email').value).toBe('rosa.v@atany.ph');
  });

  it('Edit saves the clicked account and refreshes', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Rosa Villanueva')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Edit Rosa Villanueva'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('#usr-edit-name'), { target: { value: 'Rosa V. Villanueva' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('User updated.'));
    const call = apiFetch.mock.calls.find(([u, o]) => u === '/admin/users/u-2' && o?.method === 'PUT');
    expect(call).toBeTruthy();
    expect(JSON.parse(call[1].body).name).toBe('Rosa V. Villanueva');
    expect(JSON.parse(call[1].body)).not.toHaveProperty('password');
  });

  it('Edit validates the name and email', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Rosa Villanueva')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Edit Rosa Villanueva'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('#usr-edit-name'), { target: { value: '' } });
    fireEvent.change(dialog.querySelector('#usr-edit-email'), { target: { value: 'not-an-email' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(within(dialog).getByText('Full name is required.')).toBeInTheDocument());
    expect(within(dialog).getByText('Enter a valid email address.')).toBeInTheDocument();
  });
});

describe('Admin Users & Roles — invitations', () => {
  it('opens the invite modal from the footer action', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Add User/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Invite another member/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Invite a member')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Full Name')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Email')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Role')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Branch')).toBeInTheDocument();
  });

  it('validates the invite form before calling the API', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Invite another member/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send Invite' }));
    await waitFor(() => expect(within(dialog).getByText('Full name is required.')).toBeInTheDocument());
    expect(within(dialog).getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(apiFetch.mock.calls.some(([u, o]) => u === '/admin/users/invite' && o?.method === 'POST')).toBe(false);
  });

  it('requires a branch for a branch-scoped role', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Invite another member/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('#usr-invite-name'), { target: { value: 'New Member' } });
    fireEvent.change(dialog.querySelector('#usr-invite-email'), { target: { value: 'new.member@atany.ph' } });
    fireEvent.change(dialog.querySelector('#usr-invite-role'), { target: { value: 'shop_owner' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send Invite' }));
    await waitFor(() => expect(within(dialog).getByText('Please choose a branch.')).toBeInTheDocument());
  });

  it('sends a valid invitation', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Adrian Villanueva')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Invite another member/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('#usr-invite-name'), { target: { value: 'New Member' } });
    fireEvent.change(dialog.querySelector('#usr-invite-email'), { target: { value: 'new.member@atany.ph' } });
    fireEvent.change(dialog.querySelector('#usr-invite-role'), { target: { value: 'admin' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send Invite' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Invitation sent.'));
    const call = apiFetch.mock.calls.find(([u, o]) => u === '/admin/users/invite' && o?.method === 'POST');
    expect(JSON.parse(call[1].body)).toEqual({
      name: 'New Member', email: 'new.member@atany.ph', role: 'admin', branch_id: undefined,
    });
  });

  it('resends a pending invitation', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Bianca Ramos')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Resend invitation for Bianca Ramos'));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Invitation resent.'));
    const call = apiFetch.mock.calls.find(([u, o]) => u === '/admin/users/u-3/resend-invite' && o?.method === 'PATCH');
    expect(call).toBeTruthy();
  });

  it('cancels a pending invitation after a confirmation', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('Bianca Ramos')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Cancel invitation for Bianca Ramos'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Cancel invitation?')).toBeInTheDocument();
    expect(within(dialog).getByText(/Bianca Ramos/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel invitation' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Invitation cancelled.'));
    const call = apiFetch.mock.calls.find(([u, o]) => u === '/admin/users/u-3/invite' && o?.method === 'DELETE');
    expect(call).toBeTruthy();
  });
});
