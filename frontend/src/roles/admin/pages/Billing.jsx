// frontend/src/roles/admin/pages/Billing.jsx
// Admin Subscriptions — premium billing dashboard (flat header, KPIs, plan tiers, table)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { Modal } from '../../../shared/components/Modal';
import { PortalPageHeader } from '../../../shared/components/PortalPageHeader';
import { NotificationBell } from '../../../shared/components/NotificationBell';
import { useAuth } from '../../../shared/hooks/useAuth';
import { SubscriptionMetricsGrid } from '../subscriptions/SubscriptionMetricsGrid';
import { PlanTiersSection } from '../subscriptions/PlanTiersSection';
import { SubscriptionTable } from '../subscriptions/SubscriptionTable';
import {
  buildPlanTiers,
  computeSubscriptionMetrics,
  extractBranches,
  filterSubscriptionRows,
  formatDate,
  normalizeBillingRow,
  statusSummaryCounts,
} from '../lib/subscriptionSelectors';
import { STATUS_FILTERS } from '../lib/subscriptionStatus';
import { peso } from '../lib/currency';
import '../subscriptions/subscriptions.css';

function getDisplayName(user) {
  if (!user) return 'Admin';
  return user.user_metadata?.displayName
    || user.user_metadata?.fullName
    || user.user_metadata?.name
    || [user.user_metadata?.firstName, user.user_metadata?.lastName].filter(Boolean).join(' ')
    || user.email?.split('@')[0]?.replace(/[._-]/g, ' ')
    || user.email
    || 'Admin';
}

function getUserInitials(name, email) {
  const src = name || email || '';
  if (!src) return 'AU';
  if (src.includes('@')) {
    return src.split('@')[0].split(/[._-]/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
  }
  return src.trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
}

export default function AdminBilling() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [retryState, setRetryState] = useState({ id: null, busy: false });
  const [planFilter, setPlanFilter] = useState('');
  const showToast = useToast();
  const { user } = useAuth();
  const { pathname } = useLocation();

  const displayName = getDisplayName(user);
  const initials = getUserInitials(displayName, user?.email);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiFetch('/billing');
      const rows = Array.isArray(payload) ? payload : (payload?.records || []);
      setRecords(rows);
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load subscriptions');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const normalized = useMemo(() => records.map(normalizeBillingRow), [records]);
  const metrics = useMemo(() => computeSubscriptionMetrics(records), [records]);
  const planTiers = useMemo(() => buildPlanTiers(records), [records]);
  const branches = useMemo(() => extractBranches(records), [records]);
  const summary = useMemo(() => statusSummaryCounts(records), [records]);

  const visible = useMemo(() => {
    const list = filterSubscriptionRows(normalized, {
      search,
      status: statusFilter,
      branch: branchFilter,
      plan: planFilter,
    });
    return list;
  }, [normalized, search, statusFilter, branchFilter, planFilter]);

  const openDetails = async (rec) => {
    const row = normalizeBillingRow(rec);
    setSelected({ ...rec, ...row });
    try {
      const payload = await apiFetch(`/billing?seller_id=${rec.seller_id}`);
      const rows = Array.isArray(payload) ? payload : (payload?.records || []);
      setHistory(rows);
    } catch {
      setHistory([rec]);
    }
  };

  const handleRetry = async (rec) => {
    if (!rec?.id) return;
    setRetryState({ id: rec.id, busy: true });
    try {
      const res = await apiFetch(`/billing/${rec.id}/retry`, { method: 'POST' });
      if (res?.checkout_url) {
        showToast('Opening payment checkout…');
        window.open(res.checkout_url, '_blank', 'noopener');
      } else {
        showToast('Retry checkout created');
      }
      await refresh();
    } catch (e) {
      showToast(e.message || 'Failed to retry charge');
    } finally {
      setRetryState({ id: null, busy: false });
    }
  };

  const handleViewTier = (tier) => {
    // Toggle: clicking the already-selected plan clears the filter
    const nextFilter = planFilter === tier?.name ? '' : (tier?.name || '');
    setPlanFilter(nextFilter);
    setStatusFilter('all');
    const el = document.getElementById('active-subscribers');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const headerSearch = (
    <div className="mp-header-search portal-search" role="search" style={{ maxWidth: 360 }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search branches, sellers, orders"
        aria-label="Search branches, sellers, orders"
      />
    </div>
  );

  const headerActions = (
    <>
      <span className="sub-platform-pill" title="Platform overview">
        <span className="sub-platform-pill__dot" aria-hidden="true" />
        Platform overview
      </span>
      <NotificationBell to="/admin/notifications" apiPath="/admin/notifications/history" />
    </>
  );

  return (
    <div className="sub-page">
      {/* Flat integrated admin header — layout Topbar hidden on this route */}
      <PortalPageHeader
        title="Subscriptions"
        role="admin"
        search={headerSearch}
        actions={headerActions}
        user={{ initials, name: displayName, role: 'Administrator' }}
        settingsTo="/admin"
      />

      <SubscriptionMetricsGrid metrics={loading && !records.length ? null : metrics} />

      <PlanTiersSection
        tiers={planTiers}
        loading={loading}
        totalSubscriptions={metrics.totalRecords}
        totalArrLabel={metrics.arrLabel}
        onViewTier={handleViewTier}
        selectedPlanName={planFilter}
      />

      <section className="sub-subscribers" id="active-subscribers" aria-labelledby="active-subscribers-heading">
        <div className="sub-subscribers__head">
          <div className="sub-subscribers__title">
            <h2 id="active-subscribers-heading">Active subscribers</h2>
            <p>Billing status and renewal schedule for every account</p>
          </div>
          <div className="sub-subscribers__search" role="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subscriber or plan..."
              aria-label="Search subscriber or plan"
            />
          </div>
        </div>

        <div className="sub-filters" role="tablist" aria-label="Subscription status filters">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={statusFilter === f.id}
              className={`sub-filter-pill${statusFilter === f.id ? ' is-active' : ''}`}
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
          <select
            className="sub-select"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            aria-label="Filter by branch"
          >
            <option value="all">All Branches</option>
            {branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          {planFilter && (
            <button
              type="button"
              className="sub-filter-pill is-active"
              onClick={() => setPlanFilter('')}
              aria-label={`Clear plan filter ${planFilter}`}
            >
              {planFilter} ✕
            </button>
          )}
        </div>

        <SubscriptionTable
          rows={visible}
          loading={loading}
          error={error}
          onRetry={handleRetry}
          onOpen={openDetails}
          onRetryState={retryState}
        />

        <div className="sub-table-foot">
          <span>
            Showing <strong>{visible.length}</strong> of <strong>{normalized.length}</strong> accounts
          </span>
          <div className="sub-legend" aria-label="Status summary">
            <span className="sub-legend__item">
              <span className="sub-legend__dot sub-legend__dot--active" /> {summary.active} active
            </span>
            <span className="sub-legend__item">
              <span className="sub-legend__dot sub-legend__dot--past_due" /> {summary.pastDue} past due
            </span>
            <span className="sub-legend__item">
              <span className="sub-legend__dot sub-legend__dot--pending" /> {summary.pending} pending
            </span>
            {summary.canceled > 0 && (
              <span className="sub-legend__item">
                <span className="sub-legend__dot sub-legend__dot--canceled" /> {summary.canceled} canceled
              </span>
            )}
          </div>
        </div>
      </section>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Subscription Details"
        footer={<button className="btn btn-outline" onClick={() => setSelected(null)}>Close</button>}
      >
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Seller</div>
                <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{selected.seller_name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{selected.seller_email}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Shop</div>
                <div style={{ fontWeight: 700 }}>{selected.shop_name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{selected.branch_name || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Plan</div>
                <div>{selected.planName || 'Monthly Seller Subscription'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Monthly Amount</div>
                <div style={{ fontWeight: 700 }}>{peso(selected.amount)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Status</div>
                <span className={`sub-chip sub-chip--${selected.statusChip}`}>{selected.statusLabel}</span>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Next Renewal</div>
                <div>{formatDate(selected.current_period_end || selected.due_date)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Current Period</div>
                <div>
                  {selected.current_period_start && selected.current_period_end
                    ? `${formatDate(selected.current_period_start)} – ${formatDate(selected.current_period_end)}`
                    : selected.billing_period}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Last Payment</div>
                <div>{selected.paid_at ? formatDate(selected.paid_at) : '—'}</div>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Payment Reference</div>
                <div style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  {selected.payment_reference || selected.paymongo_checkout_session_id || '—'}
                </div>
              </div>
              {selected.paymongo_checkout_session_id && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>PayMongo Checkout Session</div>
                  <div style={{ fontSize: 11, wordBreak: 'break-all', color: 'var(--muted)' }}>
                    {selected.paymongo_checkout_session_id}
                  </div>
                </div>
              )}
            </div>
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>Payment History</div>
              {history.length ? history.map((h) => (
                <div
                  key={h.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '6px 0',
                    borderBottom: '1px solid var(--line)',
                    fontSize: 12,
                  }}
                >
                  <span>
                    {h.billing_period} — {formatDate(h.current_period_start || h.created_at)} – {formatDate(h.current_period_end || h.due_date)}
                  </span>
                  <span style={{ fontWeight: 600 }}>{peso(h.amount)}</span>
                  <span className="sub-chip sub-chip--pending" style={{ fontSize: 10 }}>{h.status}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{h.paid_at ? formatDate(h.paid_at) : '—'}</span>
                </div>
              )) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>No history</div>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
