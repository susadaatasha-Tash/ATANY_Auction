// frontend/src/roles/admin/pages/Users.jsx
// Admin — Users & Roles.
// Data: GET /admin/users (admin-gated server-side). Mutations reuse the existing
// admin user routes: PUT /admin/users/:id and PATCH /admin/users/:id/suspend.
// DATA MODEL (real, unchanged): roles = customer | shop_owner | admin,
// statuses = active | suspended, branch link = users.preferred_branch_id.
// There is NO invitation/on-leave state in this schema, so none is simulated;
// JOINED comes from the real created_at.
//
// preferred_branch_id is READ-ONLY here on purpose. It is the customer's own
// self-selected branch (PUT /customer/preferred-branch, customer role only); it
// partitions their auction catalogue and drives notification targeting, and the
// users privilege-guard migration groups it with self-service profile fields
// rather than admin-managed ones. Admins can filter and see it; they cannot
// assign it, and the Edit dialog therefore does not offer a Branch control.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Pencil,
  ShieldAlert,
  Store,
  UserCheck,
  Users as UsersIcon,
} from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { Modal } from '../../../shared/components/Modal';
import { Skeleton, SkeletonCircle, SkeletonRegion } from '../../../shared/ui/Skeleton';
import './admin-users.css';

const ROLES = [
  { value: 'customer', label: 'Customer' },
  { value: 'shop_owner', label: 'Shop Owner' },
  { value: 'admin', label: 'Admin' },
];
const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

/** Single role-label mapper — never scattered (spec §21). */
export function roleLabel(role) {
  return ROLES.find((r) => r.value === role)?.label || (role ? String(role) : '—');
}
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function formatJoined(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [statusTab, setStatusTab] = useState('all');

  // Modals hold IDs, never row snapshots (spec §38/§65).
  const [editingId, setEditingId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { id, nextStatus, name, action }
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'customer', status: 'active' });
  const [formError, setFormError] = useState('');
  const showToast = useToast();
  const reqSeq = useRef(0);

  const refresh = useCallback(async ({ background = false } = {}) => {
    const seq = ++reqSeq.current;
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      // Branches come from the EXISTING public endpoint (index.js: app.get('/branches'));
      // no duplicate branch API is introduced.
      const [userRows, branchRows] = await Promise.all([
        apiFetch('/admin/users'),
        apiFetch('/branches', { public: true }).catch(() => []),
      ]);
      if (seq !== reqSeq.current) return;
      setUsers(Array.isArray(userRows) ? userRows : []);
      setBranches(Array.isArray(branchRows) ? branchRows : []);
      setLoadError('');
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setLoadError(e.message || 'Unable to load users.');
    } finally {
      if (seq === reqSeq.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // KPIs always use the FULL authorized dataset, never the filtered page.
  const kpis = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.status === 'active').length;
    const suspended = users.filter((u) => u.status === 'suspended').length;
    const shopOwners = users.filter((u) => u.role === 'shop_owner').length;
    return { total, active, suspended, shopOwners };
  }, [users]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return users.filter((u) => {
      const matchesQ = !term ||
        String(u.name || '').toLowerCase().includes(term) ||
        String(u.email || '').toLowerCase().includes(term) ||
        roleLabel(u.role).toLowerCase().includes(term);
      const matchesRole = !roleFilter || u.role === roleFilter;
      const matchesBranch = !branchFilter || String(u.preferred_branch_id || '') === String(branchFilter);
      const matchesStatus = statusTab === 'all' || u.status === statusTab;
      return matchesQ && matchesRole && matchesBranch && matchesStatus;
    });
  }, [users, q, roleFilter, branchFilter, statusTab]);

  // Selected records always resolved from the freshest list by id.
  const editing = editingId ? users.find((u) => u.id === editingId) || null : null;
  const confirming = confirm ? users.find((u) => u.id === confirm.id) || null : null;

  const openEdit = (u) => {
    setEditingId(u.id);
    setForm({
      name: u.name || '',
      email: u.email || '',
      role: u.role || 'customer',
      status: u.status || 'active',
    });
    setFormError('');
  };

  const handleSave = async (e) => {
    e?.preventDefault?.();
    if (!editing) return;
    setFormError('');
    // EXACT admin update contract. preferred_branch_id is deliberately absent:
    // it is the customer's own self-selected branch (PUT /customer/preferred-branch),
    // it partitions their auction feed and notification targeting, and it is
    // grouped with self-service fields by the users privilege guard. Admins see
    // it read-only in the table/filter; they do not assign it.
    const body = { name: form.name.trim(), email: form.email.trim(), role: form.role, status: form.status };
    if (!body.name) { setFormError('Full name is required.'); return; }
    if (!ROLES.some((r) => r.value === form.role)) { setFormError('Select a valid role.'); return; }
    setBusy(true);
    try {
      await apiFetch(`/admin/users/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      showToast('User updated.');
      setEditingId(null);
      await refresh({ background: true });
    } catch (err) {
      setFormError(err.message || 'Unable to update this user.');
    } finally {
      setBusy(false);
    }
  };

  const handleStatusChange = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await apiFetch(`/admin/users/${confirm.id}/suspend`, {
        method: 'PATCH',
        body: JSON.stringify({ status: confirm.nextStatus }),
      });
      showToast(confirm.nextStatus === 'suspended' ? 'Account suspended.' : 'Account reactivated.');
      setConfirm(null);
      await refresh({ background: true });
    } catch (err) {
      showToast(err.message || 'Unable to update this account.');
    } finally {
      setBusy(false);
    }
  };

  const openStatusConfirm = (u) => {
    const nextStatus = u.status === 'active' ? 'suspended' : 'active';
    setConfirm({
      id: u.id,
      name: u.name,
      nextStatus,
      action: nextStatus === 'suspended' ? 'suspend' : 'reactivate',
    });
  };

  const renderSkeleton = () => (
    <SkeletonRegion label="Loading users and roles" className="aur">
      <div className="aur-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div className="aur-kpi" key={i}>
            <SkeletonCircle size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton w="56%" h={10} />
              <Skeleton w="38%" h={26} style={{ marginTop: 10 }} />
              <Skeleton w="64%" h={10} style={{ marginTop: 10 }} />
            </div>
          </div>
        ))}
      </div>
      <div className="aur-panel">
        <div className="aur-controls">
          <Skeleton w="100%" h={44} r={12} />
          <Skeleton w={160} h={44} r={12} />
          <Skeleton w={160} h={44} r={12} />
        </div>
        <div className="aur-tabs">
          {[0, 1, 2].map((i) => <Skeleton key={i} w={78} h={30} r="999px" />)}
        </div>
        <table className="aur-table">
          <thead>
            <tr>{['User', 'Role', 'Branch', 'Status', 'Joined', 'Actions'].map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {Array.from({ length: 7 }).map((_, i) => (
              <tr key={i} aria-hidden="true">
                <td>
                  <span className="aur-user">
                    <SkeletonCircle size={38} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <Skeleton w="52%" h={13} />
                      <Skeleton w="68%" h={10} style={{ marginTop: 6 }} />
                    </span>
                  </span>
                </td>
                <td><Skeleton w={92} h={12} /></td>
                <td><Skeleton w={104} h={12} /></td>
                <td><Skeleton w={74} h={20} r="999px" /></td>
                <td><Skeleton w={96} h={12} /></td>
                <td><Skeleton w={124} h={28} r={9} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SkeletonRegion>
  );

  return (
    <div className="aur-root">
      {loading ? renderSkeleton() : (
        <>
          {/* ── KPI cards (real counts over the full dataset) ────────────── */}
          <div className="aur-kpis">
            <div className="aur-kpi">
              <span className="aur-kpi__icon aur-kpi__icon--blue" aria-hidden="true"><UsersIcon size={18} /></span>
              <div>
                <p className="aur-kpi__label">Total Accounts</p>
                <p className="aur-kpi__value">{kpis.total}</p>
                <p className="aur-kpi__sub">across all roles</p>
              </div>
            </div>
            <div className="aur-kpi">
              <span className="aur-kpi__icon" aria-hidden="true"><UserCheck size={18} /></span>
              <div>
                <p className="aur-kpi__label">Active Accounts</p>
                <p className="aur-kpi__value">{kpis.active}</p>
                <p className="aur-kpi__sub">with access</p>
              </div>
            </div>
            <div className="aur-kpi">
              <span className="aur-kpi__icon" aria-hidden="true"><Store size={18} /></span>
              <div>
                <p className="aur-kpi__label">Shop Owners</p>
                <p className="aur-kpi__value">{kpis.shopOwners}</p>
                <p className="aur-kpi__sub">seller accounts</p>
              </div>
            </div>
            <div className="aur-kpi">
              <span className="aur-kpi__icon aur-kpi__icon--blue" aria-hidden="true"><ShieldAlert size={18} /></span>
              <div>
                <p className="aur-kpi__label">Suspended</p>
                <p className="aur-kpi__value">{kpis.suspended}</p>
                <p className="aur-kpi__sub">access revoked</p>
              </div>
            </div>
          </div>

          {/* ── main panel ─────────────────────────────────────────────────── */}
          <div className="aur-panel">
            <div className="aur-controls" aria-busy={refreshing ? 'true' : undefined}>
              <div className="aur-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search name, email or role..."
                  aria-label="Search name, email or role"
                />
              </div>
              <select className="aur-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role">
                <option value="">All Roles</option>
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <select className="aur-select" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label="Filter by branch">
                <option value="">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            <div className="aur-tabs" role="tablist" aria-label="Filter by status">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={statusTab === tab.value}
                  className={`aur-tab${statusTab === tab.value ? ' is-active' : ''}`}
                  onClick={() => setStatusTab(tab.value)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {loadError ? (
              <div className="aur-state" role="alert">
                <p className="aur-state__title">Unable to load users.</p>
                <p className="aur-state__sub">{loadError}</p>
                <button type="button" className="btn btn-outline" onClick={() => refresh()}>Retry</button>
              </div>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="aur-table">
                    <caption className="aur-sr-only">Users and roles</caption>
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Role</th>
                        <th>Branch</th>
                        <th>Status</th>
                        <th>Joined</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length ? filtered.map((u) => (
                        <tr key={u.id} data-testid={`user-row-${u.id}`}>
                          <td>
                            <span className="aur-user">
                              <span className="aur-user__avatar" aria-hidden="true">{initials(u.name)}</span>
                              <span className="aur-user__meta">
                                <span className="aur-user__name">{u.name}</span>
                                <span className="aur-user__email">{u.email}</span>
                              </span>
                            </span>
                          </td>
                          <td>{roleLabel(u.role)}</td>
                          <td>
                            {u.branch_name ? (
                              <span className="aur-branch"><Store size={14} strokeWidth={2} aria-hidden="true" />{u.branch_name}</span>
                            ) : '—'}
                          </td>
                          <td>
                            <span className={`aur-status aur-status--${u.status === 'active' ? 'active' : 'suspended'}`}>
                              {u.status === 'active' ? 'Active' : 'Suspended'}
                            </span>
                          </td>
                          <td>{formatJoined(u.created_at)}</td>
                          <td>
                            <span className="aur-actions">
                              {u.status === 'active' ? (
                                <button type="button" className="aur-btn-suspend" onClick={() => openStatusConfirm(u)} aria-label={`Suspend ${u.name}`}>
                                  <ShieldAlert size={14} strokeWidth={2} aria-hidden="true" /> <span className="aur-btn__label">Suspend</span>
                                </button>
                              ) : (
                                <button type="button" className="aur-btn-reactivate" onClick={() => openStatusConfirm(u)} aria-label={`Reactivate ${u.name}`}>
                                  <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" /> <span className="aur-btn__label">Reactivate</span>
                                </button>
                              )}
                              <button type="button" className="aur-btn-edit" onClick={() => openEdit(u)} aria-label={`Edit ${u.name}`}>
                                <Pencil size={15} strokeWidth={2} aria-hidden="true" />
                              </button>
                            </span>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={6}>
                            <div className="aur-state">
                              <p className="aur-state__title">
                                {users.length === 0 ? 'No users yet.' : 'No users match your filters.'}
                              </p>
                              <p className="aur-state__sub">
                                {users.length === 0 ? 'Accounts will appear here.' : 'Try adjusting your search or filters.'}
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="aur-footer">
                  <span className="aur-footer__count" aria-live="polite">
                    Showing {filtered.length} of {users.length} account{users.length === 1 ? '' : 's'}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* ── suspend / reactivate confirmation ─────────────────────────── */}
          <Modal
            open={!!confirming}
            onClose={() => setConfirm(null)}
            title={confirm?.action === 'suspend' ? 'Suspend account?' : 'Reactivate account?'}
            className="aur-modal"
            footer={
              <>
                <button type="button" className="btn btn-outline" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={handleStatusChange} disabled={busy}>
                  {busy ? 'Saving…' : confirm?.action === 'suspend' ? 'Suspend' : 'Reactivate'}
                </button>
              </>
            }
          >
            <p className="aur-confirm__name">{confirming?.name}</p>
            <p className="aur-confirm__body">
              {/* Copy only — the modal, its buttons and the row design are unchanged. */}
              {confirm?.action === 'suspend' ? (
                <>
                  Suspend {confirming?.name}? This account will temporarily lose access to ATANY features,
                  including auctions, bidding, orders, watchlist and profile access.
                  {' '}Existing bids, orders, payments and account history will not be deleted.
                </>
              ) : (
                <>Reactivate {confirming?.name}? This account will regain access to ATANY features.</>
              )}
            </p>
          </Modal>

          {/* ── edit user ──────────────────────────────────────────────────── */}
          <Modal
            open={!!editing}
            onClose={() => setEditingId(null)}
            title={`Edit ${editing?.name || 'user'}`}
            className="aur-modal"
            footer={
              <>
                <button type="button" className="btn btn-outline" onClick={() => setEditingId(null)} disabled={busy}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
              </>
            }
          >
            {formError && <div className="aur-error" role="alert">{formError}</div>}
            <div className="form-row">
              <label htmlFor="aur-name">Full Name</label>
              <input id="aur-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
            </div>
            <div className="form-row">
              <label htmlFor="aur-email">Email Address</label>
              <input id="aur-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" />
            </div>
            <div className="form-grid-2">
              <div className="form-row">
                <label htmlFor="aur-role">Role</label>
                <select id="aur-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label htmlFor="aur-status">Status</label>
                <select id="aur-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>
</Modal>
        </>
      )}
    </div>
  );
}