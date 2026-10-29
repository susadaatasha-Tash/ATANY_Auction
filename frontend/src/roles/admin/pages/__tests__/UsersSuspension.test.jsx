// frontend/src/roles/admin/pages/__tests__/UsersSuspension.test.jsx
// Admin control surface for CUSTOMER SUSPENSION.
//
// This suite exists to prove one thing: the buttons the admin already had are
// the SAME control that really revokes customer access — no parallel API, no
// second status field, no visual redesign of the admin page. Everything the
// customer experiences downstream is a consequence of the one PATCH below.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
const toast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toast }));
vi.mock('../../../../shared/components/Modal', () => ({
  Modal: ({ open, onClose, title, children, footer }) => (open ? (
    <div role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
      <button type="button" onClick={onClose}>close-modal</button>
      {children}
      {footer}
    </div>
  ) : null),
}));

import Users from '../Users';

const BRANCH = 'br-1';
const CUSTOMER = {
  id: 'u-cust', name: 'Klane Cruz', email: 'klane@gmail.com', role: 'customer',
  status: 'active', preferred_branch_id: BRANCH, branch_name: 'Gmall', created_at: '2026-10-07T02:00:00Z',
};
const SELF = {
  id: 'u-admin', name: 'Alyssa Santos', email: 'alyssa@atany.ph', role: 'admin',
  status: 'active', preferred_branch_id: null, branch_name: null, created_at: '2026-09-13T02:00:00Z',
};

function routeFetch(overrides = {}) {
  // Stateful like the real API: a successful suspension changes what the next
  // refetch returns, so row/KPI assertions test real behaviour, not a fixture.
  const list = (overrides.users ?? [CUSTOMER, SELF]).map((u) => ({ ...u }));
  return (path, opts = {}) => {
    if (path === '/admin/users' && (!opts.method || opts.method === 'GET')) return Promise.resolve(list.map((u) => ({ ...u })));
    if (path === '/branches') return Promise.resolve([{ id: BRANCH, name: 'Gmall' }]);
    if (/\/admin\/users\/.+\/suspend$/.test(path) && (opts.method === 'PATCH' || !opts.method)) {
      if (overrides.suspendError) return Promise.reject(new Error(overrides.suspendError));
      const id = path.split('/')[3];
      const status = JSON.parse(opts.body).status;
      const target = list.find((u) => u.id === id);
      if (target) target.status = status;
      return Promise.resolve({ id, status });
    }
    if (/^\/admin\/users\/[^/]+$/.test(path) && opts.method === 'PUT') {
      return Promise.resolve({ id: path.split('/')[3], ...JSON.parse(opts.body) });
    }
    return Promise.reject(new Error(`unmocked ${path}`));
  };
}

// the confirmation modal also shows the name, so scope to the first (table) match
const rowFor = (name) => screen.getAllByText(name)[0].closest('tr');
const suspendCalls = () =>
  apiFetch.mock.calls.filter(([p, o]) => /\/(suspend)$/.test(p) && (!o || o.method === 'PATCH'));

async function renderPage(overrides) {
  apiFetch.mockImplementation(routeFetch(overrides));
  const user = userEvent.setup();
  render(<Users />);
  await waitFor(() => expect(screen.getByText(CUSTOMER.name)).toBeTruthy());
  return user;
}

/** Press the row's Suspend button and confirm in the modal. */
async function confirmSuspend(user, name = CUSTOMER.name) {
  await user.click(within(rowFor(name)).getByRole('button', { name: `Suspend ${name}` }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Suspend' }));
}

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
});

describe('admin suspend control — one endpoint, canonical status', () => {
  it('1. suspending a customer issues exactly one PATCH /admin/users/:id/suspend', async () => {
    const user = await renderPage();
    await confirmSuspend(user);
    await waitFor(() => expect(suspendCalls()).toHaveLength(1));
    const [path, opts] = suspendCalls()[0];
    expect(path).toBe(`/admin/users/${CUSTOMER.id}/suspend`);
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ status: 'suspended' });
  });

  it('2. no duplicate suspension endpoint is used (nothing else is called to revoke access)', async () => {
    const user = await renderPage();
    await confirmSuspend(user);
    await waitFor(() => expect(suspendCalls()).toHaveLength(1));
    const mutations = apiFetch.mock.calls.filter(([, o]) => o && o.method && o.method !== 'GET');
    expect(mutations.every(([p]) => p.endsWith('/suspend'))).toBe(true);
  });

  it('3. the confirmation states exactly what is lost and what is preserved', async () => {
    const user = await renderPage();
    await user.click(within(rowFor(CUSTOMER.name)).getByRole('button', { name: `Suspend ${CUSTOMER.name}` }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(`Suspend ${CUSTOMER.name}?`);
    expect(dialog).toHaveTextContent(/auctions, bidding, orders, watchlist and profile access/i);
    expect(dialog).toHaveTextContent(/will not be deleted/i);
    // and it is still a confirmation, not an instant action
    expect(suspendCalls()).toHaveLength(0);
  });

  it('4. cancelling the confirmation changes nothing', async () => {
    const user = await renderPage();
    await user.click(within(rowFor(CUSTOMER.name)).getByRole('button', { name: `Suspend ${CUSTOMER.name}` }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(suspendCalls()).toHaveLength(0);
  });

  it('5. on success the row, status pill and Suspended KPI all reflect the new status', async () => {
    const user = await renderPage();
    await confirmSuspend(user);
    await waitFor(() => expect(within(rowFor(CUSTOMER.name)).getByText('Suspended')).toBeTruthy());
    const kpis = Array.from(document.querySelectorAll('.aur-kpi')).find((k) => /Suspended/.test(k.textContent));
    expect(kpis.textContent).toContain('1'); // the Suspended KPI counts the change too
    await waitFor(() => expect(screen.getByRole('button', { name: `Reactivate ${CUSTOMER.name}` })).toBeTruthy());
    expect(toast).toHaveBeenCalledWith('Account suspended.');
  });

  it('6. reactivating posts status "active" to the same endpoint', async () => {
    const user = await renderPage({ users: [{ ...CUSTOMER, status: 'suspended' }, SELF] });
    await user.click(within(rowFor(CUSTOMER.name)).getByRole('button', { name: `Reactivate ${CUSTOMER.name}` }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(suspendCalls()).toHaveLength(1));
    expect(JSON.parse(suspendCalls()[0][1].body)).toEqual({ status: 'active' });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Account reactivated.'));
  });

  it('7. admin safety failures are surfaced verbatim, never silently swallowed', async () => {
    const user = await renderPage({ suspendError: 'You cannot suspend your own account' });
    await confirmSuspend(user);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('You cannot suspend your own account'));
    // the row keeps its real state — a rejected suspension must not fake success
    await waitFor(() => expect(within(rowFor(CUSTOMER.name)).getByText('Active')).toBeTruthy());
  });

  it('8. the last-active-admin guard message is shown as-is', async () => {
    const user = await renderPage({ suspendError: 'At least one active admin must remain' });
    await confirmSuspend(user);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('At least one active admin must remain'));
  });

  it('9. an admin can still suspend their own row only through the guarded endpoint', async () => {
    // the UI offers the action; the SERVER owns the rule. The button must not be
    // silently hidden, because hiding it would misrepresent the admin surface.
    const user = await renderPage();
    expect(within(rowFor(SELF.name)).getByRole('button', { name: `Suspend ${SELF.name}` })).toBeTruthy();
    await user.click(within(rowFor(SELF.name)).getByRole('button', { name: `Suspend ${SELF.name}` }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(`Suspend ${SELF.name}?`);
  });

  it('10. the admin page keeps its existing design contract (no new statuses, no redesign)', async () => {
    await renderPage();
    // the status vocabulary is unchanged: Active / Suspended only
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.queryByText('Banned')).toBeNull();
    expect(screen.queryByText('Deactivated')).toBeNull();
    // the same single control surface, one button per row
    expect(within(rowFor(CUSTOMER.name)).getByRole('button', { name: `Suspend ${CUSTOMER.name}` })).toBeTruthy();
  });
});