// frontend/src/roles/admin/pages/Branches.jsx
// Admin — Branches (branch-centric monitoring hub).
//
// Real data only. Everything on this screen comes from the authoritative
// records Seller/Customer already create:
//   GET /admin/branches/monitor  →  branches + real per-branch lot counts and
//                                  this-calendar-month revenue (orders.branch_id)
// Branch inventory/auctions are reached by opening a branch →
//   /admin/branches/:branchId?tab=jewelry | auctions
//
// Admin is monitor-only here: the only actions are View details, Edit and
// Change status (all pre-existing admin branch endpoints). There is no bid,
// favourite, reserve or checkout control anywhere on this screen.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Clock, Download, Gem, MapPin, MoreVertical, Pencil, Phone, Plus, Store,
} from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { Skeleton, SkeletonCircle, SkeletonRegion } from '../../../shared/ui/Skeleton';
import { BranchModal } from '../components/BranchModal';
import { peso, pesoCompact } from '../lib/currency';
import './admin-branches.css';

const STATUS_PILLS = [
  { value: 'all', label: 'All' },
  { value: 'Open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];

/** Branch status enum is exactly ['Open','Temporarily Closed'] — nothing invented. */
export function isBranchOpen(branch) {
  return String(branch?.status || '') === 'Open';
}

export default function AdminBranches() {
  const [branches, setBranches] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [pill, setPill] = useState('all');
  const [menuFor, setMenuFor] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const navigate = useNavigate();
  const showToast = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/admin/branches/monitor');
      setBranches(Array.isArray(data?.branches) ? data.branches : []);
      setKpis(data?.kpis || null);
      setError('');
    } catch (e) {
      setError(e.message || 'Unable to load branches.');
    } finally {
      // Always clears the skeleton, including on failure, so the page can never
      // hang on a loading state if the request errors or the tab unmounts.
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return branches.filter((b) => {
      const matchesQ = !term
        || String(b.name || '').toLowerCase().includes(term)
        || String(b.address || '').toLowerCase().includes(term)
        || String(b.hours || '').toLowerCase().includes(term)
        || String(b.phone || '').toLowerCase().includes(term);
      const matchesPill = pill === 'all'
        || (pill === 'Open' ? isBranchOpen(b) : !isBranchOpen(b));
      return matchesQ && matchesPill;
    });
  }, [branches, q, pill]);

  const openBranch = (b) => navigate(`/admin/branches/${b.id}`);

  // Card is a button for keyboard/AT users; the three-dot menu stops propagation
  // so it never navigates.
  const cardKeyHandler = (e, b) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBranch(b); }
  };

  const handleSave = async (data) => {
    try {
      if (editing) {
        await apiFetch(`/admin/branches/${editing.id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Branch updated.');
      } else {
        await apiFetch('/admin/branches', { method: 'POST', body: JSON.stringify(data) });
        showToast('Branch created.');
      }
      setModalOpen(false);
      setEditing(null);
      await refresh();
    } catch (e) {
      showToast(e.message || 'Failed to save branch.');
    }
  };

  const setStatus = async (branch, status) => {
    setMenuFor(null);
    try {
      // Partial-safe: the branch update controller accepts the full field set,
      // so we send the branch's own current values with the new status.
      await apiFetch(`/admin/branches/${branch.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: branch.name, address: branch.address, hours: branch.hours,
          phone: branch.phone, lat: branch.lat, lng: branch.lng, status,
        }),
      });
      showToast(status === 'Open' ? 'Branch reopened.' : 'Branch marked closed.');
      await refresh();
    } catch (e) {
      showToast(e.message || 'Failed to update branch status.');
    }
  };

  // Export writes the SAME rows currently rendered — a real CSV of real data.
  const handleExport = () => {
    const header = ['Branch', 'Address', 'Status', 'Hours', 'Phone', 'Lots', 'Revenue (PHP)'];
    const lines = filtered.map((b) => [
      b.name, b.address, b.status, b.hours || '', b.phone || '',
      b.lots ?? 0, b.revenue ?? 0,
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atany-branches-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${filtered.length} branch${filtered.length === 1 ? '' : 'es'}.`);
  };

  const renderSkeleton = () => (
    <SkeletonRegion label="Loading branches" className="abx">
      <div className="abx-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div className="abx-kpi" key={i}>
            <SkeletonCircle size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton w="58%" h={11} />
              <Skeleton w="40%" h={28} style={{ marginTop: 10 }} />
              <Skeleton w="66%" h={12} style={{ marginTop: 10 }} />
            </div>
          </div>
        ))}
      </div>
      <div className="abx-panel">
        <div className="abx-controls">
          <Skeleton w="100%" h={44} r={12} />
          <Skeleton w={200} h={36} r="999px" />
        </div>
        <div className="abx-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="abx-card" key={i} aria-hidden="true">
              <Skeleton w="100%" h={150} r="12px 12px 0 0" />
              <div style={{ padding: 14 }}>
                <Skeleton w="62%" h={15} />
                <Skeleton w="88%" h={11} style={{ marginTop: 8 }} />
                <Skeleton w="48%" h={11} style={{ marginTop: 8 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );

  const kpiCards = kpis ? [
    { key: 'total', label: 'Total Branches', value: kpis.total_branches, icon: <Store size={18} />, tone: 'blue', badge: `${kpis.total_branches} in network`, note: 'operating locations' },
    { key: 'lots', label: 'Active Lots', value: kpis.active_lots, icon: <Gem size={18} />, tone: 'gold', badge: 'branch scoped', note: `across ${kpis.total_branches} branches` },
    { key: 'revenue', label: 'Monthly Revenue', value: pesoCompact(kpis.monthly_revenue), icon: <span className="abx-peso">₱</span>, tone: 'gold', badge: 'this month', note: 'orders, current month' },
    { key: 'open', label: 'Open Now', value: kpis.open_ratio, icon: <Clock size={18} />, tone: 'blue', badge: kpis.open_branches === kpis.total_branches ? 'all open' : 'some closed', note: 'branches trading' },
  ] : [];

  return (
    <div className="abx-root">
      <div className="abx-head">
        <div>
          <h1 className="abx-title">Branches</h1>
          <p className="abx-sub">
            {kpis
              ? `${kpis.total_branches} operating location${kpis.total_branches === 1 ? '' : 's'} across the ATANY network`
              : 'Operating locations across the ATANY network'}
          </p>
        </div>
        <div className="abx-head-actions">
          <button type="button" className="abx-btn" onClick={handleExport} disabled={loading || !filtered.length}>
            <Download size={15} strokeWidth={2} aria-hidden="true" /> Export
          </button>
          <button
            type="button"
            className="abx-btn abx-btn--primary"
            onClick={() => { setEditing(null); setModalOpen(true); }}
            disabled={loading}
          >
            <Plus size={15} strokeWidth={2} aria-hidden="true" /> Add branch
          </button>
        </div>
      </div>

      {loading ? renderSkeleton() : (
        <>
          <div className="abx-kpis">
            {kpiCards.map((c) => (
              <div className="abx-kpi" key={c.key}>
                <span className={`abx-kpi__icon abx-kpi__icon--${c.tone}`} aria-hidden="true">{c.icon}</span>
                <div className="abx-kpi__meta">
                  <p className="abx-kpi__label">{c.label}</p>
                  <p className="abx-kpi__value">{c.value}</p>
                  <p className="abx-kpi__foot">
                    <span className="abx-kpi__badge">{c.badge}</span>
                    <span className="abx-kpi__note">{c.note}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="abx-panel">
            <div className="abx-controls">
              <div className="abx-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search branch, address or manager..."
                  aria-label="Search branch, address or manager"
                />
              </div>
              <div className="abx-pills" role="group" aria-label="Filter branches by status">
                {STATUS_PILLS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={`abx-pill${pill === p.value ? ' is-active' : ''}`}
                    aria-pressed={pill === p.value}
                    onClick={() => setPill(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {error ? (
              <div className="abx-state" role="alert">
                <p className="abx-state__title">Unable to load branches.</p>
                <p className="abx-state__sub">{error}</p>
                <button type="button" className="abx-btn" onClick={refresh}>Retry</button>
              </div>
            ) : (
              <div className="abx-grid">
                {filtered.map((b) => (
                  <article
                    key={b.id}
                    className="abx-card"
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${b.name} branch details`}
                    onClick={() => openBranch(b)}
                    onKeyDown={(e) => cardKeyHandler(e, b)}
                  >
                    <div className="abx-card__media">
                      {b.branch_image_url ? (
                        <img src={b.branch_image_url} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      ) : (
                        <span className="abx-card__ph" aria-hidden="true"><Building2 size={26} /></span>
                      )}
                      <span className={`abx-badge${isBranchOpen(b) ? ' is-open' : ' is-closed'}`}>
                        <i aria-hidden="true" />{isBranchOpen(b) ? 'Open' : 'Closed'}
                      </span>
                      <button
                        type="button"
                        className="abx-kebab"
                        aria-label={`Actions for ${b.name}`}
                        onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === b.id ? null : b.id); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
                      >
                        <MoreVertical size={16} strokeWidth={2} aria-hidden="true" />
                      </button>
                      {menuFor === b.id && (
                        <div
                          className="abx-menu"
                          role="menu"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <button type="button" role="menuitem" onClick={() => { setMenuFor(null); openBranch(b); }}>
                            <Store size={14} strokeWidth={2} aria-hidden="true" /> View Details
                          </button>
                          <button type="button" role="menuitem" onClick={() => { setMenuFor(null); setEditing(b); setModalOpen(true); }}>
                            <Pencil size={14} strokeWidth={2} aria-hidden="true" /> Edit Branch
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => setStatus(b, isBranchOpen(b) ? 'Temporarily Closed' : 'Open')}
                          >
                            <Clock size={14} strokeWidth={2} aria-hidden="true" />
                            {isBranchOpen(b) ? 'Change Status — Close' : 'Change Status — Reopen'}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="abx-card__body">
                      <h3 className="abx-card__name">{b.name}</h3>
                      <p className="abx-card__line"><MapPin size={13} strokeWidth={2} aria-hidden="true" />{b.address}</p>
                      {/* No manager column exists on `branches` — real operating hours are shown instead. */}
                      {b.hours ? (
                        <p className="abx-card__line"><Clock size={13} strokeWidth={2} aria-hidden="true" />{b.hours}</p>
                      ) : b.phone ? (
                        <p className="abx-card__line"><Phone size={13} strokeWidth={2} aria-hidden="true" />{b.phone}</p>
                      ) : null}
                    </div>

                    <div className="abx-card__foot">
                      <div>
                        <span className="abx-card__key">Lots</span>
                        <span className="abx-card__val">{b.lots ?? 0}</span>
                      </div>
                      <div>
                        <span className="abx-card__key">Revenue</span>
                        <span className="abx-card__val">{peso(b.revenue ?? 0)}</span>
                      </div>
                    </div>
                  </article>
                ))}

                {!filtered.length && (
                  <div className="abx-state abx-state--grid">
                    <p className="abx-state__title">
                      {branches.length ? 'No branches match your search.' : 'No branches yet.'}
                    </p>
                    <p className="abx-state__sub">
                      {branches.length ? 'Try a different search or status filter.' : 'Add a branch to start tracking inventory and auctions.'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <BranchModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        initial={editing}
        onSave={handleSave}
      />
    </div>
  );
}