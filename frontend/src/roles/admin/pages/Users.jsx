// frontend/src/roles/admin/pages/Users.jsx
// Admin → Users & Roles.
//
// Route stays /admin/users. The page keeps managing EVERY platform account
// (administrators, shop owners and customers) — the approved staff-oriented
// layout is applied on top of the existing account-management capability.
//
// Real data only:
//   GET    /admin/users            list + search + role/branch/status filters
//   GET    /admin/users/summary    KPI aggregate over the FULL dataset
//   GET    /admin/branches         real branches for the branch filter
//   PUT    /admin/users/:id        update name / email / role / status / branch
//   PATCH  /admin/users/:id/suspend    suspend / reactivate
//   POST   /admin/users/invite     send a real invitation
//   PATCH  /admin/users/:id/resend-invite
//   DELETE /admin/users/:id/invite cancel a pending invitation
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { Modal } from '../../../shared/components/Modal';
import {
  Search, Users as UsersIcon, UserCheck, Mail, UserX, Store, Pencil,
  RefreshCw, X, MoreVertical, Plus, Check, Clock, Lock, Building2, RotateCcw,
} from 'lucide-react';
import {
  ROLE_OPTIONS, STATUS_TABS, roleLabel, statusLabel, initialsFor,
  formatLastActive, formatInviteSent, BRANCH_SCOPED_ROLES,
} from '../lib/userLabels';
import '../subscriptions/subscriptions.css';
import './users.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Convenience starting points for a suspension reason. The admin can always
// edit the final text — a preset is never stored without being selected.
const SUSPENSION_REASON_PRESETS = [
  'Suspicious bidding activity',
  'Terms or policy violation',
  'Payment-related concern',
  'Account security concern',
  'Fraud investigation',
  'Other',
];

function KpiMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="usr-kpi-menu" ref={ref}>
      <button
        type="button"
        className="usr-kpi-menu__trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="usr-kpi-menu__list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="usr-kpi-menu__item"
              onClick={() => { setOpen(false); item.onSelect(); }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, pill, pillIcon, pillTone, subtext, menu, testId }) {
  return (
    <article className="sub-kpi usr-kpi" data-testid={testId}>
      <div className="sub-kpi__top">
        <span className={`sub-kpi__icon sub-kpi__icon--${pillTone || 'navy'}`} aria-hidden="true">
          {icon}
        </span>
        {menu}
      </div>
      <div className="sub-kpi__label">{label}</div>
      <div className="sub-kpi__value">{value}</div>
      <div className="sub-kpi__foot">
        {pill ? (
          <span className={`sub-kpi__pill sub-kpi__pill--${pillTone || 'navy'}`}>
            {pillIcon}
            {pill}
          </span>
        ) : <span />}
        {subtext ? <span className="sub-kpi__sub">{subtext}</span> : <span />}
      </div>
    </article>
  );
}

export default function Users() {
  const showToast = useToast();

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [statusTab, setStatusTab] = useState('');

  const [busyId, setBusyId] = useState(null);
  const [suspendTarget, setSuspendTarget] = useState(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendError, setSuspendError] = useState('');
  const [reactivateTarget, setReactivateTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', role: '', status: '', branch_id: '' });
  const [editErrors, setEditErrors] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: '', branch_id: '' });
  const [inviteErrors, setInviteErrors] = useState({});
  const [sendingInvite, setSendingInvite] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (roleFilter) p.set('role', roleFilter);
    if (branchFilter) p.set('branch_id', branchFilter);
    if (statusTab) p.set('status', statusTab);
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [q, roleFilter, branchFilter, statusTab]);

  const load = useCallback(async (opts = {}) => {
    const { silent } = opts;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [list, sum, brs] = await Promise.all([
        apiFetch(`/admin/users${query}`),
        apiFetch('/admin/users/summary').catch(() => null),
        apiFetch('/admin/branches').catch(() => []),
      ]);
      setRows(Array.isArray(list) ? list : []);
      if (sum) setSummary(sum);
      if (Array.isArray(brs)) setBranches(brs);
    } catch (e) {
      setError(e?.message || 'Unable to load the accounts.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [query]);

  // Debounced search — typing never fires a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { load(); }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    apiFetch('/admin/branches').then((b) => { if (Array.isArray(b)) setBranches(b); }).catch(() => {});
  }, []);

  const totalAccounts = summary?.total_accounts ?? rows.length;

  const applyQuickFilter = (status) => {
    setStatusTab(status);
    setRoleFilter('');
  };

  const setStatus = async (user, nextStatus, reason = null) => {
    setBusyId(user.id);
    try {
      await apiFetch(`/admin/users/${user.id}/suspend`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus, ...(reason ? { reason } : {}) }),
      });
      showToast(nextStatus === 'suspended' ? 'Account suspended.' : 'Account reactivated.');
      await load({ silent: true });
    } catch (e) {
      showToast(e?.message || 'Unable to update the account.');
      throw e;
    } finally {
      setBusyId(null);
    }
  };

  /** A suspension ALWAYS needs a real, admin-provided reason. */
  const confirmSuspend = async () => {
    if (!suspendTarget) return;
    const reason = suspendReason.trim();
    if (reason.length < 5) {
      setSuspendError('Please provide a reason for suspension (at least 5 characters).');
      return;
    }
    if (reason.length > 500) {
      setSuspendError('The reason must be at most 500 characters.');
      return;
    }
    try {
      await setStatus(suspendTarget, 'suspended', reason);
      setSuspendTarget(null);
      setSuspendReason('');
      setSuspendError('');
    } catch {
      /* the toast already explains the failure — the dialog stays open */
    }
  };

  const openEdit = (user) => {
    setEditing(user);
    setEditErrors({});
    setEditForm({
      name: user.name || '',
      email: user.email || '',
      role: user.role || 'customer',
      status: user.status || 'active',
      branch_id: user.branch_id || '',
    });
  };

  const saveEdit = async (e) => {
    e?.preventDefault?.();
    const errors = {};
    if (!editForm.name.trim()) errors.name = 'Full name is required.';
    if (!EMAIL_RE.test(editForm.email.trim())) errors.email = 'Enter a valid email address.';
    setEditErrors(errors);
    if (Object.keys(errors).length) return;

    setSavingEdit(true);
    try {
      const body = {
        name: editForm.name.trim(),
        email: editForm.email.trim(),
        role: editForm.role,
        status: editForm.status,
      };
      if (editForm.branch_id) body.branch_id = editForm.branch_id;
      await apiFetch(`/admin/users/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      showToast('User updated.');
      setEditing(null);
      await load({ silent: true });
    } catch (err) {
      showToast(err?.message || 'Unable to update the user.');
    } finally {
      setSavingEdit(false);
    }
  };

  const sendInvite = async (e) => {
    e?.preventDefault?.();
    const errors = {};
    if (!inviteForm.name.trim()) errors.name = 'Full name is required.';
    if (!EMAIL_RE.test(inviteForm.email.trim())) errors.email = 'Enter a valid email address.';
    if (!inviteForm.role) errors.role = 'Please choose a role.';
    if (BRANCH_SCOPED_ROLES.includes(inviteForm.role) && !inviteForm.branch_id) errors.branch_id = 'Please choose a branch.';
    setInviteErrors(errors);
    if (Object.keys(errors).length) return;

    setSendingInvite(true);
    try {
      await apiFetch('/admin/users/invite', {
        method: 'POST',
        body: JSON.stringify({
          name: inviteForm.name.trim(),
          email: inviteForm.email.trim(),
          role: inviteForm.role,
          branch_id: inviteForm.branch_id || undefined,
        }),
      });
      showToast('Invitation sent.');
      setInviteOpen(false);
      setInviteForm({ name: '', email: '', role: '', branch_id: '' });
      await load({ silent: true });
    } catch (err) {
      showToast(err?.message || 'Unable to send the invitation.');
    } finally {
      setSendingInvite(false);
    }
  };

  const resendInvite = async (user) => {
    setBusyId(user.id);
    try {
      await apiFetch(`/admin/users/${user.id}/resend-invite`, { method: 'PATCH' });
      showToast('Invitation resent.');
      await load({ silent: true });
    } catch (err) {
      showToast(err?.message || 'Unable to resend the invitation.');
    } finally {
      setBusyId(null);
    }
  };

  const cancelInvite = async () => {
    if (!cancelTarget) return;
    setBusyId(cancelTarget.id);
    try {
      await apiFetch(`/admin/users/${cancelTarget.id}/invite`, { method: 'DELETE' });
      showToast('Invitation cancelled.');
      setCancelTarget(null);
      await load({ silent: true });
    } catch (err) {
      showToast(err?.message || 'Unable to cancel the invitation.');
    } finally {
      setBusyId(null);
    }
  };

  const clearFilters = () => {
    setQ('');
    setRoleFilter('');
    setBranchFilter('');
    setStatusTab('');
  };

  if (loading) {
    return (
      <div className="usr-page">
        <div className="sub-kpi-grid" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="sub-kpi sub-kpi--skeleton">
              <div className="sub-skel" style={{ width: 36, height: 36, borderRadius: 10 }} />
              <div className="sub-skel" style={{ width: '40%', height: 12, marginTop: 14 }} />
              <div className="sub-skel" style={{ width: '70%', height: 28, marginTop: 8 }} />
              <div className="sub-skel" style={{ width: '50%', height: 12, marginTop: 12 }} />
            </div>
          ))}
        </div>
        <section className="usr-card" aria-hidden="true">
          <div className="usr-card__top">
            <div className="usr-skel usr-skel--search" />
            <div className="usr-card__filters">
              <div className="usr-skel usr-skel--filter" />
              <div className="usr-skel usr-skel--filter" />
            </div>
          </div>
          <div className="usr-tabs">
            <div className="usr-skel usr-skel--tab" />
            <div className="usr-skel usr-skel--tab" />
            <div className="usr-skel usr-skel--tab" />
            <div className="usr-skel usr-skel--tab" />
            <div className="usr-skel usr-skel--tab" />
          </div>
          <div className="usr-table-wrap">
            <table className="usr-table">
              <thead>
                <tr>
                  <th>Staff Member</th><th>Role</th><th>Branch</th>
                  <th>Status</th><th>Last Active</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <tr key={i}>
                    <td><div className="usr-skel usr-skel--cell" style={{ width: 200 }} /></td>
                    <td><div className="usr-skel usr-skel--cell" style={{ width: 120 }} /></td>
                    <td><div className="usr-skel usr-skel--cell" style={{ width: 130 }} /></td>
                    <td><div className="usr-skel usr-skel--cell" style={{ width: 90 }} /></td>
                    <td><div className="usr-skel usr-skel--cell" style={{ width: 110 }} /></td>
                    <td><div className="usr-skel usr-skel--cell" style={{ width: 150 }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  if (error) {
    return (
      <div className="usr-page">
        <section className="usr-card">
          <div className="usr-empty">
            <p className="usr-empty__title">Unable to load the accounts</p>
            <p className="usr-empty__text">{error}</p>
            <button type="button" className="btn btn-primary" onClick={() => load()}>Try again</button>
          </div>
        </section>
      </div>
    );
  }

  const hasFilters = !!(q.trim() || roleFilter || branchFilter || statusTab);

  return (
    <div className="usr-page">
      {/* KPI row */}
      <div className="sub-kpi-grid">
        <MetricCard
          testId="kpi-total-staff"
          icon={<UsersIcon size={17} />}
          label="Total Staff"
          value={summary ? summary.total_staff : '—'}
          pill={`${summary ? summary.staff_branch_count : 0} branches`}
          pillIcon={<Building2 size={12} />}
          pillTone="blue"
          subtext="admin & shop accounts"
          menu={(
            <KpiMenu
              label="Total staff options"
              items={[{ label: 'View all accounts', icon: <UsersIcon size={14} />, onSelect: () => applyQuickFilter('') }]}
            />
          )}
        />
        <MetricCard
          testId="kpi-active-accounts"
          icon={<UserCheck size={17} />}
          label="Active Accounts"
          value={summary ? summary.active_staff : '—'}
          pill="Signed in"
          pillIcon={<Check size={12} />}
          pillTone="gold"
          subtext="with live access"
          menu={(
            <KpiMenu
              label="Active accounts options"
              items={[{ label: 'Filter: Active', icon: <UserCheck size={14} />, onSelect: () => applyQuickFilter('active') }]}
            />
          )}
        />
        <MetricCard
          testId="kpi-pending-invites"
          icon={<Mail size={17} />}
          label="Pending Invites"
          value={summary ? summary.pending_invites : '—'}
          pill="Awaiting setup"
          pillIcon={<Clock size={12} />}
          pillTone="gold"
          subtext="not yet onboarded"
          menu={(
            <KpiMenu
              label="Pending invites options"
              items={[{ label: 'Filter: Invited', icon: <Mail size={14} />, onSelect: () => applyQuickFilter('invited') }]}
            />
          )}
        />
        <MetricCard
          testId="kpi-suspended"
          icon={<UserX size={17} />}
          label="Suspended"
          value={summary ? summary.suspended_staff : '—'}
          pill="Access revoked"
          pillIcon={<Lock size={12} />}
          pillTone="blue"
          subtext="under review"
          menu={(
            <KpiMenu
              label="Suspended options"
              items={[{ label: 'Filter: Suspended', icon: <UserX size={14} />, onSelect: () => applyQuickFilter('suspended') }]}
            />
          )}
        />
      </div>

      {/* Users card */}
      <section className="usr-card">
        <div className="usr-card__top">
          <div className="usr-search" role="search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, email or role..."
              aria-label="Search name, email or role"
            />
          </div>
          <div className="usr-card__filters">
            <select
              className="usr-select"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              aria-label="Filter by role"
            >
              <option value="">All roles</option>
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <select
              className="usr-select"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              aria-label="Filter by branch"
            >
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>

        <div className="usr-tabs" role="tablist" aria-label="Account status">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value || 'all'}
              type="button"
              role="tab"
              aria-selected={statusTab === tab.value}
              className={`usr-tab${statusTab === tab.value ? ' is-active' : ''}`}
              onClick={() => setStatusTab(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="usr-table-wrap">
          <table className="usr-table">
            <thead>
              <tr>
                <th scope="col">Staff Member</th>
                <th scope="col">Role</th>
                <th scope="col">Branch</th>
                <th scope="col">Status</th>
                <th scope="col">Last Active</th>
                <th scope="col" className="usr-table__actions-head">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="usr-empty">
                      <p className="usr-empty__title">No accounts match the current filters</p>
                      <p className="usr-empty__text">Try a different search term, role, branch or status.</p>
                      {hasFilters && (
                        <button type="button" className="btn btn-outline" onClick={clearFilters}>Clear filters</button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : rows.map((u) => (
                <tr key={u.id} data-testid={`user-row-${u.id}`}>
                  <td>
                    <div className="usr-member">
                      <span className="usr-avatar" aria-hidden="true">{initialsFor(u.name, u.email)}</span>
                      <span className="usr-member__text">
                        <span className="usr-member__name">{u.name}</span>
                        <span className="usr-member__email">{u.email}</span>
                      </span>
                    </div>
                  </td>
                  <td><span className="usr-role">{roleLabel(u.role)}</span></td>
                  <td>
                    <span className="usr-branch">
                      <Store size={14} aria-hidden="true" />
                      {u.branch_name || '—'}
                    </span>
                  </td>
                  <td>
                    <span className={`usr-badge usr-badge--${u.status}`}>{statusLabel(u.status)}</span>
                  </td>
                  <td>
                    <span className="usr-lastactive">
                      {u.status === 'invited'
                        ? formatInviteSent(u.invite_sent_at || u.invited_at)
                        : formatLastActive(u.last_active)}
                    </span>
                  </td>
                  <td>
                    <div className="usr-actions">
                      {u.status === 'invited' ? (
                        <>
                          <button
                            type="button"
                            className="usr-icon-btn"
                            title="Resend invitation"
                            aria-label={`Resend invitation for ${u.name}`}
                            disabled={busyId === u.id}
                            onClick={() => resendInvite(u)}
                          >
                            <RefreshCw size={15} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="usr-icon-btn"
                            title="Cancel invitation"
                            aria-label={`Cancel invitation for ${u.name}`}
                            disabled={busyId === u.id}
                            onClick={() => setCancelTarget(u)}
                          >
                            <X size={15} aria-hidden="true" />
                          </button>
                        </>
                      ) : u.status === 'suspended' ? (
                        <button
                          type="button"
                          className="usr-action-btn usr-action-btn--reactivate"
                          disabled={busyId === u.id}
                          onClick={() => setReactivateTarget(u)}
                        >
                          <RotateCcw size={15} aria-hidden="true" />
                          Reactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="usr-action-btn"
                          disabled={busyId === u.id}
                          onClick={() => setSuspendTarget(u)}
                        >
                          <UserX size={15} aria-hidden="true" />
                          Suspend
                        </button>
                      )}
                      <button
                        type="button"
                        className="usr-icon-btn"
                        title="Edit account"
                        aria-label={`Edit ${u.name}`}
                        onClick={() => openEdit(u)}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="usr-card__foot">
          <span className="usr-count">
            Showing <b>{rows.length}</b> of <b>{totalAccounts}</b> accounts
          </span>
          <button type="button" className="usr-invite-link" onClick={() => { setInviteErrors({}); setInviteOpen(true); }}>
            <Plus size={15} aria-hidden="true" />
            Invite another member
          </button>
        </footer>
      </section>

      {/* Suspend confirmation — a REAL reason is required before an account
          can be suspended (the backend validates it too). */}
      <Modal
        open={!!suspendTarget}
        onClose={() => { setSuspendTarget(null); setSuspendReason(''); setSuspendError(''); }}
        title="Suspend account?"
        eyebrow="Users & Roles"
        footer={(
          <>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => { setSuspendTarget(null); setSuspendReason(''); setSuspendError(''); }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ background: 'var(--danger)' }}
              disabled={busyId === suspendTarget?.id}
              onClick={() => confirmSuspend()}
            >
              {busyId === suspendTarget?.id ? 'Suspending…' : 'Suspend Account'}
            </button>
          </>
        )}
      >
        {suspendTarget && (
          <div className="usr-confirm">
            <p className="usr-confirm__name">Suspend {suspendTarget.name}?</p>
            <p className="usr-confirm__text">
              {suspendTarget.role === 'shop_owner'
                ? 'This shop owner will temporarily lose access to protected seller features. Existing listings, auctions, orders, payments and historical records must remain intact.'
                : 'This customer will temporarily lose access to ATANY features. Their existing bids, orders, payments and account history will not be deleted.'}
            </p>

            <label className="usr-reason-label" htmlFor="usr-suspend-reason">
              Reason for suspension <span aria-hidden="true">*</span>
            </label>
            <textarea
              id="usr-suspend-reason"
              className="usr-reason-input"
              rows={4}
              maxLength={500}
              value={suspendReason}
              onChange={(e) => { setSuspendReason(e.target.value); setSuspendError(''); }}
              placeholder="Enter the reason for suspending this account..."
              aria-describedby={suspendError ? 'usr-suspend-reason-error' : undefined}
            />
            <div className="usr-reason-presets" role="group" aria-label="Quick reason presets">
              {SUSPENSION_REASON_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="usr-reason-preset"
                  onClick={() => { setSuspendReason(preset); setSuspendError(''); }}
                >
                  {preset}
                </button>
              ))}
            </div>
            {suspendError && <p className="usr-field-error" id="usr-suspend-reason-error" role="alert">{suspendError}</p>}
            <p className="usr-reason-hint">
              The reason is shown to the account owner and stored in the admin audit trail.
            </p>
          </div>
        )}
      </Modal>

      {/* Reactivate confirmation */}
      <Modal
        open={!!reactivateTarget}
        onClose={() => setReactivateTarget(null)}
        title="Reactivate account?"
        eyebrow="Users & Roles"
        footer={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => setReactivateTarget(null)}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { setStatus(reactivateTarget, 'active'); setReactivateTarget(null); }}
            >
              Reactivate
            </button>
          </>
        )}
      >
        {reactivateTarget && (
          <div className="usr-confirm">
            <p className="usr-confirm__name">{reactivateTarget.name}</p>
            <p className="usr-confirm__text">This user will regain access to the platform immediately.</p>
          </div>
        )}
      </Modal>

      {/* Cancel invitation confirmation */}
      <Modal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title="Cancel invitation?"
        eyebrow="Users & Roles"
        footer={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => setCancelTarget(null)}>Keep invitation</button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ background: 'var(--danger)' }}
              onClick={cancelInvite}
            >
              Cancel invitation
            </button>
          </>
        )}
      >
        {cancelTarget && (
          <div className="usr-confirm">
            <p className="usr-confirm__name">{cancelTarget.name} — {cancelTarget.email}</p>
            <p className="usr-confirm__text">
              The pending invitation is removed and the account can no longer be accepted. No active account is deleted.
            </p>
          </div>
        )}
      </Modal>

      {/* Edit account */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit account"
        eyebrow={editing ? editing.email : ''}
        footer={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={savingEdit} onClick={saveEdit}>
              {savingEdit ? 'Saving...' : 'Save changes'}
            </button>
          </>
        )}
      >
        <form onSubmit={saveEdit}>
          <div className="form-row">
            <label htmlFor="usr-edit-name">Full Name</label>
            <input
              id="usr-edit-name"
              value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Full name"
            />
            {editErrors.name && <p className="usr-field-error">{editErrors.name}</p>}
          </div>
          <div className="form-row">
            <label htmlFor="usr-edit-email">Email Address</label>
            <input
              id="usr-edit-email"
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="you@example.com"
            />
            {editErrors.email && <p className="usr-field-error">{editErrors.email}</p>}
          </div>
          <div className="form-grid-2">
            <div className="form-row">
              <label htmlFor="usr-edit-role">Role</label>
              <select
                id="usr-edit-role"
                value={editForm.role}
                onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
              >
                {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="usr-edit-status">Status</label>
              <select
                id="usr-edit-status"
                value={editForm.status}
                onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
              >
                {STATUS_TABS.filter((t) => t.value).map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="usr-edit-branch">Branch</label>
            <select
              id="usr-edit-branch"
              value={editForm.branch_id}
              onChange={(e) => setEditForm((f) => ({ ...f, branch_id: e.target.value }))}
            >
              <option value="">No branch</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <p className="form-hint">Only the branch of the branch-scoped roles is used for pickup.</p>
          </div>
        </form>
      </Modal>

      {/* Invite staff */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a member"
        eyebrow="Users & Roles"
        footer={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => setInviteOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={sendingInvite} onClick={sendInvite}>
              {sendingInvite ? 'Sending...' : 'Send Invite'}
            </button>
          </>
        )}
      >
        <form onSubmit={sendInvite}>
          <div className="form-row">
            <label htmlFor="usr-invite-name">Full Name</label>
            <input
              id="usr-invite-name"
              value={inviteForm.name}
              onChange={(e) => setInviteForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Full name"
            />
            {inviteErrors.name && <p className="usr-field-error">{inviteErrors.name}</p>}
          </div>
          <div className="form-row">
            <label htmlFor="usr-invite-email">Email</label>
            <input
              id="usr-invite-email"
              type="email"
              value={inviteForm.email}
              onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="name@atany.ph"
            />
            {inviteErrors.email && <p className="usr-field-error">{inviteErrors.email}</p>}
          </div>
          <div className="form-grid-2">
            <div className="form-row">
              <label htmlFor="usr-invite-role">Role</label>
              <select
                id="usr-invite-role"
                value={inviteForm.role}
                onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value }))}
              >
                <option value="">Select a role</option>
                {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              {inviteErrors.role && <p className="usr-field-error">{inviteErrors.role}</p>}
            </div>
            <div className="form-row">
              <label htmlFor="usr-invite-branch">Branch</label>
              <select
                id="usr-invite-branch"
                value={inviteForm.branch_id}
                onChange={(e) => setInviteForm((f) => ({ ...f, branch_id: e.target.value }))}
              >
                <option value="">No branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {inviteErrors.branch_id && <p className="usr-field-error">{inviteErrors.branch_id}</p>}
            </div>
          </div>
          <p className="form-hint">
            The invitation creates a pending account. The member can sign in once they accept it.
          </p>
        </form>
      </Modal>
    </div>
  );
}
