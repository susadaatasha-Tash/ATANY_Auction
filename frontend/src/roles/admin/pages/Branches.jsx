// frontend/src/roles/admin/pages/Branches.jsx
// Admin → Branches (branch-centric monitoring).
//
// The Branches screen is the single entry point into the admin's view of the
// marketplace: every branch, its listings and its auctions. Jewelry and
// Auctions are no longer standalone admin pages — they are reached through
// the selected branch (see BranchDetails.jsx).
//
// Everything rendered here comes from the real ATANY records:
//   GET /admin/branches      → branches + per-branch lots / active lots / revenue
//   GET /admin/analytics     → platform monthly revenue + the real delta
//   POST/PUT/DELETE /admin/branches → branch administration (existing modal)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Gem, Wallet, Clock3, MoreVertical, Search, User,
  Plus, Download, ChevronRight,
} from 'lucide-react';
import { BranchModal } from '../components/BranchModal';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import {
  compactPeso, isBranchOpen, branchStatusLabel, branchState, peso,
} from '../lib/adminBranchLabels';
import './branches.css';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];

function KpiSkeleton() {
  return <div className="adm-skel adm-skel--kpi" />;
}
function CardSkeleton() {
  return <div className="adm-skel adm-skel--card" />;
}

export default function AdminBranches() {
  const navigate = useNavigate();
  const showToast = useToast();
  const [branches, setBranches] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const menuRef = useRef(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [rows, stats] = await Promise.all([
        apiFetch('/admin/branches'),
        apiFetch('/admin/analytics?bucket=month&range=1').catch(() => null),
      ]);
      setBranches(Array.isArray(rows) ? rows : []);
      setAnalytics(stats);
    } catch (e) {
      setError(e.message || 'Failed to load branches');
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuFor(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuFor]);

  const handleSave = async (data) => {
    try {
      if (editing) {
        await apiFetch(`/admin/branches/${editing.id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Branch updated');
      } else {
        await apiFetch('/admin/branches', { method: 'POST', body: JSON.stringify(data) });
        showToast('Branch created');
      }
      setOpen(false);
      setEditing(null);
      await refresh();
    } catch (e) {
      showToast(e.message || 'Failed to save branch');
    }
  };

  const handleDelete = async (branch) => {
    setMenuFor(null);
    if (!confirm(`Delete "${branch.name}"? This will remove a live pickup location.`)) return;
    try {
      await apiFetch(`/admin/branches/${branch.id}`, { method: 'DELETE' });
      showToast('Branch deleted');
      await refresh();
    } catch (e) {
      showToast(e.message || 'Failed to delete branch');
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return branches.filter((b) => {
      if (status !== 'all' && branchState(b) !== status) return false;
      if (!needle) return true;
      return [b.name, b.address, b.manager_name, b.hours, b.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [branches, q, status]);

  const openCount = branches.filter(isBranchOpen).length;
  const totalBranches = branches.length;
  const activeLots = branches.reduce((sum, b) => sum + (b.active_lot_count || 0), 0);
  const monthlyRevenue = analytics?.kpis?.totalRevenue ?? null;
  const revenueDelta = analytics?.kpis?.revenueDelta;

  const exportCsv = () => {
    const header = ['Branch', 'Address', 'Manager', 'Status', 'Lots', 'Active Lots', 'Revenue'];
    const rows = branches.map((b) => [
      b.name, b.address || '', b.manager_name || '', b.status || '',
      b.lot_count || 0, b.active_lot_count || 0, b.revenue || 0,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      showToast('Branch list ready to export');
      return;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atany-branches-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    showToast('Branch list exported');
  };

  return (
    <div className="adm-page">
      <div className="adm-head">
        <div>
          <h1 className="adm-head__title">Branches</h1>
          <p className="adm-head__sub">
            {loading ? 'Loading the ATANY network…' : `${totalBranches} operating locations across the ATANY network`}
          </p>
        </div>
        <div className="adm-head__actions">
          <button type="button" className="adm-btn" onClick={exportCsv} disabled={!branches.length}>
            <Download size={14} /> Export
          </button>
          <button type="button" className="adm-btn adm-btn--primary" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus size={15} /> Add branch
          </button>
        </div>
      </div>

      {error && <div className="adm-error">{error}</div>}

      {loading ? (
        <div className="adm-kpi-grid">
          <KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton />
        </div>
      ) : (
        <div className="adm-kpi-grid">
          <article className="adm-kpi">
            <MoreVertical size={15} className="adm-kpi__dots" aria-hidden="true" />
            <div className="adm-kpi__top">
              <div className="adm-kpi__icon"><Building2 size={18} /></div>
              <div>
                <p className="adm-kpi__label">Total Branches</p>
                <p className="adm-kpi__value">{totalBranches}</p>
              </div>
            </div>
            <div className="adm-kpi__foot">
              <span className="adm-pill adm-pill--blue">{openCount} open</span>
              <span className="adm-kpi__context">across the ATANY network</span>
            </div>
          </article>

          <article className="adm-kpi">
            <MoreVertical size={15} className="adm-kpi__dots" aria-hidden="true" />
            <div className="adm-kpi__top">
              <div className="adm-kpi__icon"><Gem size={18} /></div>
              <div>
                <p className="adm-kpi__label">Active Lots</p>
                <p className="adm-kpi__value">{activeLots}</p>
              </div>
            </div>
            <div className="adm-kpi__foot">
              <span className="adm-pill">Live + scheduled</span>
              <span className="adm-kpi__context">branch-scoped listings</span>
            </div>
          </article>

          <article className="adm-kpi">
            <MoreVertical size={15} className="adm-kpi__dots" aria-hidden="true" />
            <div className="adm-kpi__top">
              <div className="adm-kpi__icon adm-kpi__icon--gold"><Wallet size={18} /></div>
              <div>
                <p className="adm-kpi__label">Monthly Revenue</p>
                <p className="adm-kpi__value">{compactPeso(monthlyRevenue)}</p>
              </div>
            </div>
            <div className="adm-kpi__foot">
              {Number.isFinite(revenueDelta) ? (
                <span className={`adm-pill ${revenueDelta >= 0 ? '' : 'adm-pill--grey'}`}>
                  {revenueDelta >= 0 ? '+' : ''}{revenueDelta}%
                </span>
              ) : (
                <span className="adm-pill adm-pill--grey">Recognized</span>
              )}
              <span className="adm-kpi__context">vs last month</span>
            </div>
          </article>

          <article className="adm-kpi">
            <MoreVertical size={15} className="adm-kpi__dots" aria-hidden="true" />
            <div className="adm-kpi__top">
              <div className="adm-kpi__icon"><Clock3 size={18} /></div>
              <div>
                <p className="adm-kpi__label">Open Now</p>
                <p className="adm-kpi__value">{openCount}/{totalBranches}</p>
              </div>
            </div>
            <div className="adm-kpi__foot">
              <span className="adm-pill adm-pill--green">Operational</span>
              <span className="adm-kpi__context">branches accepting pickups</span>
            </div>
          </article>
        </div>
      )}

      <div className="adm-filter-panel">
        <div className="adm-search">
          <Search size={16} />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search branch, address or manager..."
            aria-label="Search branches"
          />
        </div>
        <div className="adm-pills" role="group" aria-label="Filter branches by status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`adm-pills__btn${status === f.value ? ' is-active' : ''}`}
              onClick={() => setStatus(f.value)}
              aria-pressed={status === f.value}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="adm-branch-grid">
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      ) : filtered.length ? (
        <div className="adm-branch-grid">
          {filtered.map((b) => {
            const open = isBranchOpen(b);
            const image = b.image_url || b.branch_image_url;
            return (
              <article
                key={b.id}
                className="adm-branch-card"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/admin/branches/${b.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/admin/branches/${b.id}`);
                  }
                }}
                aria-label={`Open ${b.name} details`}
              >
                <div className={`adm-branch-card__media${image ? '' : ' adm-branch-card__media--empty'}`}>
                  {image && <img src={image} alt={`${b.name} branch`} loading="lazy" />}
                  {!image && <Building2 size={26} />}
                  <span className={`adm-branch-card__badge${open ? '' : ' adm-branch-card__badge--closed'}`}>
                    <i /> {branchStatusLabel(b)}
                  </span>
                  <button
                    type="button"
                    className="adm-branch-card__menu-btn"
                    aria-label={`Actions for ${b.name}`}
                    onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === b.id ? null : b.id); }}
                  >
                    <MoreVertical size={15} />
                  </button>
                </div>

                <div className="adm-branch-card__body">
                  <h3 className="adm-branch-card__name">{b.name}</h3>
                  {b.address && <p className="adm-branch-card__addr">{b.address}</p>}
                  <div className="adm-branch-card__meta">
                    <User size={14} />
                    <span>Manager · {b.manager_name || 'Unassigned'}</span>
                  </div>

                  <div className="adm-branch-card__stats">
                    <div>
                      <div className="adm-branch-card__stat-label">Lots</div>
                      <div className="adm-branch-card__stat-value">{b.lot_count || 0}</div>
                    </div>
                    <div className="adm-branch-card__stat--right">
                      <div className="adm-branch-card__stat-label">Revenue</div>
                      <div className="adm-branch-card__stat-value">{peso(b.revenue || 0)}</div>
                    </div>
                  </div>

                  {menuFor === b.id && (
                    <div className="adm-menu" ref={menuRef} role="menu" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="adm-menu__item"
                        role="menuitem"
                        onClick={(e) => { e.stopPropagation(); setMenuFor(null); navigate(`/admin/branches/${b.id}`); }}
                      >
                        <ChevronRight size={14} /> View details
                      </button>
                      <button
                        type="button"
                        className="adm-menu__item"
                        role="menuitem"
                        onClick={(e) => { e.stopPropagation(); setMenuFor(null); setEditing(b); setOpen(true); }}
                      >
                        <Building2 size={14} /> Edit branch
                      </button>
                      <button
                        type="button"
                        className="adm-menu__item adm-menu__item--danger"
                        role="menuitem"
                        onClick={(e) => { e.stopPropagation(); handleDelete(b); }}
                      >
                        <Trash2Icon /> Delete branch
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="adm-empty">No branches match your search.</div>
      )}

      {!loading && !error && (
        <p className="adm-footnote">
          {filtered.length} of {totalBranches} branches shown. Select a branch to inspect its listings and auctions.
        </p>
      )}

      <BranchModal open={open} onClose={() => { setOpen(false); setEditing(null); }} initial={editing} onSave={handleSave} />
    </div>
  );
}

function Trash2Icon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}
