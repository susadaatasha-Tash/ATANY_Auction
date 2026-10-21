// frontend/src/roles/admin/pages/__tests__/SecurityAlerts.test.jsx
// Admin → Security Alerts — the monitoring page AND the Alert Details review
// dialog (real detail payload, real activity trail, real status transitions,
// confirmation flows, and the parent-table/count refresh).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import React from 'react';

const { apiFetch, toastSpy } = vi.hoisted(() => ({ apiFetch: vi.fn(), toastSpy: vi.fn() }));
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => toastSpy }));

import SecurityAlerts from '../SecurityAlerts';

const ALERT_ID = '646ff462-6020-4467-a8e0-829345e3ea06';

const ALERTS = [
  {
    id: ALERT_ID, user_id: 'u1', type: 'Rapid High-Value Bidding',
    severity: 'high', status: 'new', detail: '4+ bids in 60s',
    activity_trail: ['16:12:01 — Bid ₱52,000 on Rose Gold Bangle'],
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(), customer: 'britz Susada',
  },
  {
    id: '861cb577-1111-2222-3333-444455556666', user_id: 'u2', type: 'Multiple Account Activity',
    severity: 'medium', status: 'investigating', detail: '3 accounts in 10 minutes',
    activity_trail: [],
    created_at: new Date(Date.now() - 10 * 86400000).toISOString(), customer: 'Maria Santos',
  },
];

const DETAIL = {
  id: ALERT_ID,
  type: 'Rapid High-Value Bidding',
  severity: 'high',
  status: 'new',
  detail: '4+ bids in 60s',
  created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
  detected_at: new Date(Date.now() - 5 * 86400000).toISOString(),
  activity_trail: ['12:38:29 — Bid ₱24,000 on QA Multi-Role Diamond Ring'],
  customer: {
    id: 'u1', name: 'Maria Santos', email: 'maria.santos@example.com',
    role: 'customer', status: 'active',
  },
  related: {
    bid_id: 'b1', auction_id: 'a1', auction_code: 'AUC-00234', product_id: 'p1',
    product_name: 'QA Multi-Role Diamond Ring', image_url: 'https://cdn.test/ring.png',
    category: 'Rings', branch_id: 'br1', branch_name: 'QA Branch', amount: 24000,
  },
  activity: [
    { created_at: '2026-10-16T04:38:29Z', time: '12:38:29', action: 'Bid', amount: 24000, item: 'QA Multi-Role Diamond Ring', flagged: true },
    { created_at: '2026-10-16T04:38:27Z', time: '12:38:27', action: 'Bid', amount: 23000, item: 'QA Multi-Role Diamond Ring', flagged: false },
    { created_at: '2026-10-16T04:38:25Z', time: '12:38:25', action: 'Bid', amount: 22000, item: 'QA Multi-Role Diamond Ring', flagged: false },
    { created_at: '2026-10-16T04:38:22Z', time: '12:38:22', action: 'Bid', amount: 21000, item: 'QA Multi-Role Diamond Ring', flagged: false },
  ],
  activity_count: 4,
};

const SUMMARY = {
  total: 27, open: 25, high: 27, medium: 0, low: 0, resolved_this_month: 1,
  severity_counts: { all: 27, high: 27, medium: 0, low: 0 },
  status_counts: { all: 27, new: 25, investigating: 0, resolved: 1, dismissed: 1 },
  trends: {
    open: { pct: 32, direction: 'up' },
    high: { pct: 18, direction: 'up' },
    resolved: null,
    total: { pct: 12, direction: 'up' },
  },
};

const PAGINATION = { page: 1, limit: 10, total: 27, total_pages: 3 };

function installApi({
  items = ALERTS, pagination = PAGINATION, summary = SUMMARY,
  fail = false, detailFail = false, patchFail = false, detail = DETAIL,
} = {}) {
  // The mock mirrors the server: a PATCH changes the stored status and the
  // list returns the current value.
  const state = { status: {}, suspended: false };
  ALERTS.forEach((a) => { state.status[a.id] = a.status; });
  if (detail?.status) state.status[detail.id] = detail.status;
  apiFetch.mockImplementation(async (url, opts = {}) => {
    const u = String(url);
    const method = String(opts.method || 'GET').toUpperCase();
    if (u.startsWith('/admin/security-alerts/') && method === 'PATCH') {
      if (patchFail) throw new Error('Invalid transition resolved → dismissed');
      const body = opts.body ? JSON.parse(opts.body) : {};
      if (body.suspendUserId) state.suspended = true;
      state.status[detail.id] = body.status || state.status[detail.id];
      return {
        ...detail,
        status: state.status[detail.id],
        customer: body.suspendUserId ? { ...detail.customer, status: 'suspended' } : detail.customer,
        suspended_user: body.suspendUserId ? { id: detail.customer.id, status: 'suspended' } : null,
      };
    }
    if (u.startsWith('/admin/security-alerts/')) {
      if (detailFail) throw new Error('Network down');
      return { ...detail, status: state.status[detail.id] || detail.status };
    }
    if (u.startsWith('/admin/security-alerts')) {
      if (fail) throw new Error('Network down');
      const listItems = items.map((i) => ({ ...i, status: state.status[i.id] || i.status }));
      return { items: listItems, pagination, summary };
    }
    return [];
  });
}

function renderPage(entry = '/admin/security') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/security" element={<SecurityAlerts />} />
        <Route path="/admin/branches/:branchId" element={<div data-testid="branch-page" />} />
      </Routes>
    </MemoryRouter>
  );
}

function lastQuery() {
  const call = [...apiFetch.mock.calls].reverse().find(([u]) => String(u).startsWith('/admin/security-alerts?'));
  return new URLSearchParams(String(call?.[0] || '').split('?')[1] || '');
}

async function openReview() {
  const buttons = await screen.findAllByRole('button', { name: /^Review alert/ });
  fireEvent.click(buttons[0]);
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText('Risk reason')).toBeInTheDocument());
}

beforeEach(() => {
  apiFetch.mockReset();
  toastSpy.mockReset();
  installApi();
});

describe('Admin Security Alerts — page', () => {
  it('renders the page with the real alert rows', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    const table = screen.getByRole('table');
    expect(within(table).getByText('britz Susada')).toBeInTheDocument();
    expect(within(table).getByText('Rapid High-Value Bidding')).toBeInTheDocument();
    expect(screen.getByText('5 days ago')).toBeInTheDocument();
  });

  it('renders the four KPI cards with the real summary values', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Open Alerts')).toBeInTheDocument());
    const kpi = (label) => screen.getByText(label).closest('.adm-sa-kpi');
    expect(within(kpi('Open Alerts')).getByText('25')).toBeInTheDocument();
    expect(within(kpi('Total Alerts')).getByText('27')).toBeInTheDocument();
    expect(within(kpi('Resolved This Month')).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('↑ 32% from last month')).toBeInTheDocument();
  });

  it('renders the severity and status tabs with the real counts', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Showing 1 to 10 of 27 alerts')).toBeInTheDocument());
    const sev = screen.getByRole('group', { name: 'Filter by severity' });
    expect(within(sev).getByRole('button', { name: /^High/ })).toBeInTheDocument();
    const st = screen.getByRole('group', { name: 'Filter by status' });
    expect(within(st).getByRole('button', { name: /^Under Review/ })).toBeInTheDocument();
  });

  it('searches, filters and resets', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Search security alerts/), { target: { value: '  646ff462 ' } });
    await waitFor(() => expect(lastQuery().get('search')).toBe('646ff462'), { timeout: 2000 });
    fireEvent.change(screen.getByLabelText('Filter security alerts by severity'), { target: { value: 'high' } });
    await waitFor(() => expect(lastQuery().get('severity')).toBe('high'));
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    await waitFor(() => {
      expect(lastQuery().get('search')).toBeNull();
      expect(lastQuery().get('severity')).toBeNull();
    });
  });

  it('sorts and paginates', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Sort by severity' }));
    await waitFor(() => expect(lastQuery().get('sort')).toBe('severity'));
    fireEvent.change(screen.getByLabelText('Security alerts per page'), { target: { value: '25' } });
    await waitFor(() => expect(lastQuery().get('limit')).toBe('25'));
  });

  it('shows the loading, empty and error states', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelectorAll('.adm-sa-skel').length).toBeGreaterThan(0);
    cleanup();

    installApi({ items: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 1 } });
    renderPage();
    await waitFor(() => expect(screen.getByText('No security alerts match the current filters.')).toBeInTheDocument());
    cleanup();

    installApi({ fail: true });
    renderPage();
    await waitFor(() => expect(screen.getByText('Unable to load security alerts.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('Admin Security Alerts — Review button', () => {
  it('renders the Review button as TEXT ONLY (no eye icon)', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    const buttons = screen.getAllByRole('button', { name: /^Review alert/ });
    expect(buttons[0].textContent.trim()).toBe('Review');
    expect(buttons[0].querySelector('svg')).toBeNull();
    expect(container.querySelector('.adm-sa-review svg')).toBeNull();
  });
});

describe('Admin Security Alerts — Alert Details dialog', () => {
  it('opens the dialog with the real alert detail', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Alert Details')).toBeInTheDocument();
    expect(within(dialog).getByText('Review the security event and take an appropriate action.')).toBeInTheDocument();
    expect(within(dialog).getByText(ALERT_ID)).toBeInTheDocument();
    expect(within(dialog).getByText('Maria Santos')).toBeInTheDocument();
    expect(within(dialog).getByText('maria.santos@example.com')).toBeInTheDocument();
    expect(within(dialog).getByText('Rapid High-Value Bidding')).toBeInTheDocument();
    expect(within(dialog).getByText('High Severity')).toBeInTheDocument();
    expect(within(dialog).getByText('New')).toBeInTheDocument();
  });

  it('shows the detected time as relative + absolute', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Detected 5 days ago/)).toBeInTheDocument();
    expect(within(dialog).getByText('(5 days ago)')).toBeInTheDocument();
  });

  it('shows the real related item and links to the admin branch view', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('QA Multi-Role Diamond Ring')).toBeInTheDocument();
    expect(within(dialog).getByText(/Auction Code: AUC-00234/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Branch: QA Branch/)).toBeInTheDocument();
    const link = within(dialog).getByRole('link');
    expect(link.getAttribute('href')).toBe('/admin/branches/br1?tab=auctions');
  });

  it('shows the activity trail with the real count and rows', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Activity Trail')).toBeInTheDocument();
    expect(within(dialog).getByText('4 events')).toBeInTheDocument();
    expect(within(dialog).getByText('12:38:29')).toBeInTheDocument();
    expect(within(dialog).getByText('₱24,000')).toBeInTheDocument();
    expect(within(dialog).getAllByText('on QA Multi-Role Diamond Ring').length).toBe(4);
  });

  it('shows the empty activity state when there is no evidence', async () => {
    installApi({ detail: { ...DETAIL, activity: [], activity_count: 0 } });
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    expect(screen.getByText('No related activity is available for this alert.')).toBeInTheDocument();
  });

  it('shows "No related auction/item." when there is no related item', async () => {
    installApi({ detail: { ...DETAIL, related: null } });
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    expect(screen.getByText('No related auction/item.')).toBeInTheDocument();
  });

  it('copies the alert id', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Copy alert ID' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ALERT_ID));
    expect(toastSpy).toHaveBeenCalledWith('Alert ID copied.');
  });

  it('marks the alert under review and refreshes the row + counts', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Under Review' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      `/admin/security-alerts/${ALERT_ID}`,
      expect.objectContaining({ method: 'PATCH' })
    ));
    expect(toastSpy).toHaveBeenCalledWith('Alert marked under review.');
    // The parent row + counts are refreshed (no full page reload).
    await waitFor(() => {
      const row = screen.getByText('646ff462').closest('tr');
      expect(within(row).getByText('Under Review')).toBeInTheDocument();
    });
  });

  it('resolves the alert', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Resolved' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Alert resolved.'));
  });

  it('asks for confirmation before dismissing', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.getByText('Dismiss security alert?')).toBeInTheDocument());
    expect(screen.getByText(/marked as dismissed and removed from active review/)).toBeInTheDocument();
    // Cancelling does not call the backend.
    const before = apiFetch.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Dismiss security alert?')).toBeNull());
    expect(apiFetch.mock.calls.length).toBe(before);
  });

  it('dismisses the alert after confirmation', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.getByText('Dismiss security alert?')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Alert' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Alert dismissed.'));
  });

  it('asks for confirmation before suspending the customer', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend Customer' }));
    await waitFor(() => expect(screen.getByText('Suspend customer?')).toBeInTheDocument());
    expect(screen.getByText(/Maria Santos will lose access/)).toBeInTheDocument();
  });

  it('suspends the customer and shows the suspended state', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend Customer' }));
    await waitFor(() => expect(screen.getByText('Suspend customer?')).toBeInTheDocument());
    const confirmDialog = screen.getAllByRole('dialog').pop();
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Suspend Customer' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Customer suspended.'));
    await waitFor(() => expect(screen.getByText('Suspended')).toBeInTheDocument());
  });

  it('the Security Alerts suspension also requires a reason', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend Customer' }));
    await waitFor(() => expect(screen.getByText('Suspend customer?')).toBeInTheDocument());
    const confirmDialog = screen.getAllByRole('dialog').pop();
    // The reason field is prefilled with a suggestion the admin can edit.
    const textarea = within(confirmDialog).getByLabelText(/Reason for suspension/i);
    expect(textarea.value).toContain('Rapid High-Value Bidding');
    // Clearing it must block the confirmation.
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Suspend Customer' }));
    await waitFor(() => expect(within(confirmDialog).getByRole('alert')).toBeInTheDocument());
    const patch = apiFetch.mock.calls.find(([u, o]) => String(u).includes('/admin/security-alerts/') && o?.method === 'PATCH');
    expect(patch).toBeUndefined();
  });

  it('sends the admin reason with the Security Alerts suspension', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend Customer' }));
    await waitFor(() => expect(screen.getByText('Suspend customer?')).toBeInTheDocument());
    const confirmDialog = screen.getAllByRole('dialog').pop();
    fireEvent.change(within(confirmDialog).getByLabelText(/Reason for suspension/i), {
      target: { value: 'Suspicious Rapid High-Value Bidding activity.' },
    });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Suspend Customer' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Customer suspended.'));
    const patch = apiFetch.mock.calls.find(([u, o]) => String(u).includes('/admin/security-alerts/') && o?.method === 'PATCH');
    expect(JSON.parse(patch[1].body)).toMatchObject({
      status: 'new',
      suspendUserId: 'u1',
      reason: 'Suspicious Rapid High-Value Bidding activity.',
    });
  });

  it('hides invalid actions for a closed alert', async () => {
    installApi({ detail: { ...DETAIL, status: 'resolved' } });
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    expect(screen.queryByRole('button', { name: 'Mark Under Review' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark Resolved' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Suspend Customer' })).toBeNull();
  });

  it('disables the footer actions while a mutation runs', async () => {
    let resolvePatch;
    apiFetch.mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      const method = String(opts.method || 'GET').toUpperCase();
      if (u.startsWith('/admin/security-alerts/') && method === 'PATCH') {
        await new Promise((r) => { resolvePatch = r; });
        return { ...DETAIL, status: 'investigating' };
      }
      if (u.startsWith('/admin/security-alerts/')) return DETAIL;
      return { items: ALERTS, pagination: PAGINATION, summary: SUMMARY };
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Under Review' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Updating/ })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Updating/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mark Resolved' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Suspend Customer' })).toBeDisabled();
    resolvePatch?.();
  });

  it('keeps the dialog open with a safe error when the mutation fails', async () => {
    installApi({ patchFail: true });
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Under Review' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Under Review' })).not.toBeDisabled();
  });

  it('shows the detail error state with a retry', async () => {
    installApi({ detailFail: true });
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /^Review alert/ })[0]);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes the dialog', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Admin Security Alerts — footer layout', () => {
  it('renders the two action groups side by side in one footer row', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    const foot = document.querySelector('.adm-ad__foot');
    expect(foot).toBeTruthy();
    const groups = Array.from(foot.querySelectorAll('.adm-ad__actions'));
    expect(groups).toHaveLength(2);
    // LEFT group → Mark Under Review + Dismiss
    expect(Array.from(groups[0].querySelectorAll('button')).map((b) => b.textContent.trim()))
      .toEqual(['Mark Under Review', 'Dismiss']);
    // RIGHT group → Mark Resolved + Suspend Customer
    expect(Array.from(groups[1].querySelectorAll('button')).map((b) => b.textContent.trim()))
      .toEqual(['Mark Resolved', 'Suspend Customer']);
  });

  it('keeps the footer on one row (flex row, space-between, wrapping groups)', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '..', 'alert-detail.css'),
      'utf8'
    );
    const footRule = css.match(/\.adm-ad__foot\s*\{([^}]*)\}/);
    expect(footRule).toBeTruthy();
    expect(footRule[1]).toMatch(/display:\s*flex/);
    expect(footRule[1]).toMatch(/justify-content:\s*space-between/);
    expect(footRule[1]).toMatch(/flex-wrap:\s*wrap/);
    // The groups never wrap internally on desktop.
    const groupRule = css.match(/\.adm-ad__actions\s*\{([^}]*)\}/);
    expect(groupRule).toBeTruthy();
    expect(groupRule[1]).toMatch(/display:\s*flex/);
    expect(groupRule[1]).toMatch(/flex-wrap:\s*nowrap/);
    // The footer uses the full modal width with matching padding.
    const footPadding = css.match(/\.modal-box\.modal-box--wide \.modal-box-foot\s*\{([^}]*)\}/);
    expect(footPadding).toBeTruthy();
    expect(footPadding[1]).toMatch(/padding:\s*16px 28px 20px/);
    expect(footPadding[1]).toMatch(/justify-content:\s*space-between/);
  });

  it('uses consistent button sizing (44px height, 9px radius, 0 18px padding)', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'alert-detail.css'), 'utf8');
    const btnRule = css.match(/\.adm-ad__btn\s*\{([^}]*)\}/);
    expect(btnRule).toBeTruthy();
    expect(btnRule[1]).toMatch(/height:\s*44px/);
    expect(btnRule[1]).toMatch(/border-radius:\s*9px/);
    expect(btnRule[1]).toMatch(/padding:\s*0 18px/);
    expect(btnRule[1]).toMatch(/font-weight:\s*600/);
    // Suggested minimum widths.
    expect(css).toMatch(/\.adm-ad__btn--review\s*\{\s*min-width:\s*170px/);
    expect(css).toMatch(/\.adm-ad__btn--dismiss\s*\{\s*min-width:\s*95px/);
    expect(css).toMatch(/\.adm-ad__btn--resolve\s*\{\s*min-width:\s*150px/);
    expect(css).toMatch(/\.adm-ad__btn--suspend\s*\{\s*min-width:\s*170px/);
  });

  it('shows a per-action label while a mutation runs and disables every action', async () => {
    let resolvePatch;
    apiFetch.mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      const method = String(opts.method || 'GET').toUpperCase();
      if (u.startsWith('/admin/security-alerts/') && method === 'PATCH') {
        await new Promise((r) => { resolvePatch = r; });
        return { ...DETAIL, status: 'investigating' };
      }
      if (u.startsWith('/admin/security-alerts/')) return DETAIL;
      return { items: ALERTS, pagination: PAGINATION, summary: SUMMARY };
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('646ff462')).toBeInTheDocument());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Under Review' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Updating...' })).toBeInTheDocument());
    // Every action is disabled while the mutation runs (no double submit).
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mark Resolved' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Suspend Customer' })).toBeDisabled();
    resolvePatch?.();
  });
});
