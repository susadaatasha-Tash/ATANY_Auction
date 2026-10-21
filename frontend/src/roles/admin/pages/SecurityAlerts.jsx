// frontend/src/roles/admin/pages/SecurityAlerts.jsx
// Admin → Security Alerts (monitoring + review).
//
// Everything on this page comes from the real security_alerts records:
//   GET  /admin/security-alerts  → { items, pagination, summary }
//   PATCH /admin/security-alerts/:id → review status transition
//
// The list is filtered, searched, sorted and paginated SERVER-SIDE. The
// severity / status tabs are facets of the same scoped set, and the KPI cards
// report real values (including real month-over-month movement — never a
// hardcoded percentage).
//
// Review is READ-ONLY inspection plus the permitted status transitions; the
// admin never participates in auctions here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  TriangleAlert, Zap, ShieldCheck, Shield, Search, CalendarDays, Filter,
  RotateCcw, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, AlertTriangle,
  Inbox, Clock,
} from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { AlertDetailModal } from '../components/AlertDetailModal';
import {
  ALERT_SEVERITY_TABS, ALERT_STATUS_TABS, ALERT_SEVERITY_OPTIONS, ALERT_STATUS_OPTIONS,
  ALERT_DATE_PRESETS, ALERT_PAGE_SIZES,
  alertSeverityLabel, alertSeverityTone, alertStatusLabel, alertStatusTone,
  formatRelativeTime, formatAbsoluteTime, resolveAlertDateRange, formatTrend,
} from '../lib/securityLabels';
import './security-alerts.css';

const SORTABLE = {
  id: { label: 'Alert ID', defaultOrder: 'asc' },
  customer: { label: 'Customer', defaultOrder: 'asc' },
  type: { label: 'Type', defaultOrder: 'asc' },
  severity: { label: 'Severity', defaultOrder: 'asc' },
  status: { label: 'Status', defaultOrder: 'asc' },
  detected: { label: 'Detected', defaultOrder: 'desc' },
};

function KpiSkeleton() {
  return <div className="adm-sa-skel adm-sa-skel--kpi" />;
}
function RowSkeleton() {
  return <tr className="adm-sa-skel-row"><td colSpan={7}><div className="adm-sa-skel adm-sa-skel--row" /></td></tr>;
}

export default function SecurityAlerts() {
  const [params, setParams] = useSearchParams();

  // ── URL state ─────────────────────────────────────────────────
  const search = params.get('search') || '';
  const severity = params.get('severity') || 'all';
  const status = params.get('status') || 'all';
  const datePreset = params.get('date') || 'all';
  const dateFrom = params.get('from') || '';
  const dateTo = params.get('to') || '';
  const sort = params.get('sort') || 'detected';
  const order = params.get('order') || 'desc';
  const page = Math.max(1, Number(params.get('page') || 1) || 1);
  const limit = ALERT_PAGE_SIZES.includes(Number(params.get('limit'))) ? Number(params.get('limit')) : 10;

  const [searchInput, setSearchInput] = useState(search);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const requestId = useRef(0);

  useEffect(() => { setSearchInput(search); }, [search]);

  const updateParams = useCallback((patch, { resetPage = true } = {}) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => {
      if (value === '' || value == null || value === 'all') next.delete(key);
      else next.set(key, String(value));
    });
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  }, [params, setParams]);

  // ── debounced search ──────────────────────────────────────────
  useEffect(() => {
    const value = searchInput.trim();
    if (value === search) return undefined;
    const id = setTimeout(() => updateParams({ search: value }), 350);
    return () => clearTimeout(id);
  }, [searchInput, search, updateParams]);

  const range = useMemo(
    () => resolveAlertDateRange(datePreset, dateFrom, dateTo),
    [datePreset, dateFrom, dateTo]
  );

  const queryString = useMemo(() => {
    const q = new URLSearchParams();
    if (search.trim()) q.set('search', search.trim());
    if (severity && severity !== 'all') q.set('severity', severity);
    if (status && status !== 'all') q.set('status', status);
    if (range.date_from) q.set('date_from', range.date_from);
    if (range.date_to) q.set('date_to', range.date_to);
    q.set('page', String(page));
    q.set('limit', String(limit));
    q.set('sort', sort);
    q.set('order', order);
    return q.toString();
  }, [search, severity, status, range.date_from, range.date_to, page, limit, sort, order]);

  const load = useCallback(async ({ quiet } = {}) => {
    const id = ++requestId.current;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/admin/security-alerts?${queryString}`);
      if (id !== requestId.current) return; // a newer request already answered
      setData(res);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e.message || 'Failed to load security alerts');
      setData(null);
    } finally {
      if (id === requestId.current && !quiet) setLoading(false);
    }
  }, [queryString]);

  useEffect(() => { load(); }, [load]);

  const items = Array.isArray(data?.items) ? data.items : [];
  const pagination = data?.pagination || { page: 1, limit, total: 0, total_pages: 1 };
  const summary = data?.summary || null;
  const severityCounts = summary?.severity_counts || {};
  const statusCounts = summary?.status_counts || {};

  const total = pagination.total || 0;
  const fromRow = total === 0 ? 0 : ((pagination.page - 1) * pagination.limit) + 1;
  const toRow = Math.min(total, pagination.page * pagination.limit);

  const hasFilters = Boolean(
    search.trim() || severity !== 'all' || status !== 'all' || datePreset !== 'all'
  );

  const handleReset = () => {
    setSearchInput('');
    setParams(new URLSearchParams(), { replace: true });
  };

  const handleSort = (key) => {
    const meta = SORTABLE[key];
    if (!meta) return;
    const nextOrder = sort === key ? (order === 'asc' ? 'desc' : 'asc') : meta.defaultOrder;
    updateParams({ sort: key, order: nextOrder });
  };

  const setPage = (p) => updateParams(
    { page: Math.min(Math.max(1, p), Math.max(1, pagination.total_pages || 1)) },
    { resetPage: false }
  );

  const pageButtons = useMemo(() => {
    const totalPages = Math.max(1, pagination.total_pages || 1);
    const current = pagination.page || 1;
    const out = [];
    const start = Math.max(1, Math.min(current - 2, totalPages - 4));
    const end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i += 1) out.push(i);
    return out;
  }, [pagination.page, pagination.total_pages]);

  // Keep the page inside the real result set.
  useEffect(() => {
    if (loading || !data) return;
    const totalPages = pagination.total_pages || 1;
    if (pagination.total > 0 && pagination.page > totalPages) {
      updateParams({ page: totalPages }, { resetPage: false });
    }
  }, [loading, data, pagination.page, pagination.total_pages, pagination.total, updateParams]);

  /**
   * A review action finished inside the dialog: patch the affected row right
   * away, then reconcile the KPI cards and the status-tab counts with the
   * server. No full page reload — the active filters and page stay intact.
   */
  const handleAlertUpdated = (updated) => {
    if (updated?.id) {
      setData((prev) => {
        if (!prev || !Array.isArray(prev.items)) return prev;
        return {
          ...prev,
          // Only the row's own columns are patched — the detail response uses
          // a different (object) shape for `customer`.
          items: prev.items.map((it) => (it.id === updated.id
            ? { ...it, status: updated.status ?? it.status, severity: updated.severity ?? it.severity }
            : it)),
        };
      });
    }
    load({ quiet: true });
  };

  const trend = (key) => formatTrend(summary?.trends?.[key]);

  return (
    <div className="adm-sa">
      {/* ── KPI cards ─────────────────────────────────────────── */}
      <div className="adm-sa-kpis">
        {loading && !data ? (
          <><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /></>
        ) : (
          <>
            <article className="adm-sa-kpi adm-sa-kpi--red">
              <div className="adm-sa-kpi__icon"><TriangleAlert size={17} /></div>
              <div className="adm-sa-kpi__body">
                <span className="adm-sa-kpi__label">Open Alerts</span>
                <strong className="adm-sa-kpi__value">{summary?.open ?? 0}</strong>
                <span className="adm-sa-kpi__note adm-sa-kpi__note--red">
                  {trend('open') || `${statusCounts.new ?? 0} new · ${statusCounts.investigating ?? 0} under review`}
                </span>
              </div>
            </article>

            <article className="adm-sa-kpi adm-sa-kpi--gold">
              <div className="adm-sa-kpi__icon"><Zap size={17} /></div>
              <div className="adm-sa-kpi__body">
                <span className="adm-sa-kpi__label">High Severity</span>
                <strong className="adm-sa-kpi__value">{summary?.high ?? 0}</strong>
                <span className="adm-sa-kpi__note adm-sa-kpi__note--gold">
                  {trend('high') || `${summary?.medium ?? 0} medium · ${summary?.low ?? 0} low`}
                </span>
              </div>
            </article>

            <article className="adm-sa-kpi adm-sa-kpi--green">
              <div className="adm-sa-kpi__icon"><ShieldCheck size={17} /></div>
              <div className="adm-sa-kpi__body">
                <span className="adm-sa-kpi__label">Resolved This Month</span>
                <strong className="adm-sa-kpi__value">{summary?.resolved_this_month ?? 0}</strong>
                <span className="adm-sa-kpi__note adm-sa-kpi__note--green">
                  {trend('resolved') || `${statusCounts.resolved ?? 0} resolved in total`}
                </span>
              </div>
            </article>

            <article className="adm-sa-kpi adm-sa-kpi--blue">
              <div className="adm-sa-kpi__icon"><Shield size={17} /></div>
              <div className="adm-sa-kpi__body">
                <span className="adm-sa-kpi__label">Total Alerts</span>
                <strong className="adm-sa-kpi__value">{summary?.total ?? 0}</strong>
                <span className="adm-sa-kpi__note adm-sa-kpi__note--blue">
                  {trend('total') || `${statusCounts.dismissed ?? 0} dismissed`}
                </span>
              </div>
            </article>
          </>
        )}
      </div>

      {/* ── Filter toolbar ────────────────────────────────────── */}
      <div className="adm-sa-toolbar">
        <div className="adm-sa-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search alerts, customer, or alert ID..."
            aria-label="Search security alerts by id, customer, or type"
          />
        </div>

        <div className="adm-sa-select">
          <Clock size={15} aria-hidden="true" />
          <select
            value={datePreset}
            onChange={(e) => updateParams({ date: e.target.value })}
            aria-label="Filter security alerts by time"
          >
            {ALERT_DATE_PRESETS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>

        {datePreset === 'custom' && (
          <>
            <input
              type="date"
              className="adm-sa-date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => updateParams({ from: e.target.value, to: dateTo })}
              aria-label="Custom range start date"
            />
            <input
              type="date"
              className="adm-sa-date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => updateParams({ from: dateFrom, to: e.target.value })}
              aria-label="Custom range end date"
            />
          </>
        )}

        <div className="adm-sa-select">
          <TriangleAlert size={15} aria-hidden="true" />
          <select
            value={severity}
            onChange={(e) => updateParams({ severity: e.target.value })}
            aria-label="Filter security alerts by severity"
          >
            {ALERT_SEVERITY_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div className="adm-sa-select">
          <Filter size={15} aria-hidden="true" />
          <select
            value={status}
            onChange={(e) => updateParams({ status: e.target.value })}
            aria-label="Filter security alerts by status"
          >
            {ALERT_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <button type="button" className="adm-sa-reset" onClick={handleReset} disabled={!hasFilters}>
          <RotateCcw size={14} /> Reset
        </button>
      </div>

      {/* ── Severity / status tabs ────────────────────────────── */}
      <div className="adm-sa-tabs">
        <div className="adm-sa-tabs__group" role="group" aria-label="Filter by severity">
          {ALERT_SEVERITY_TABS.map((tab) => {
            const active = severity === tab.value;
            const count = severityCounts[tab.value] ?? 0;
            return (
              <button
                key={tab.value}
                type="button"
                className={`adm-sa-tab adm-sa-tab--${tab.tone}${active ? ' is-active' : ''}`}
                onClick={() => updateParams({ severity: tab.value })}
                aria-pressed={active}
              >
                {tab.label}
                <span className="adm-sa-tab__count">{count}</span>
              </button>
            );
          })}
        </div>
        <span className="adm-sa-tabs__divider" aria-hidden="true" />
        <div className="adm-sa-tabs__group" role="group" aria-label="Filter by status">
          {ALERT_STATUS_TABS.map((tab) => {
            const active = status === tab.value;
            const count = statusCounts[tab.value] ?? 0;
            return (
              <button
                key={tab.value}
                type="button"
                className={`adm-sa-tab adm-sa-tab--${tab.tone}${active ? ' is-active' : ''}`}
                onClick={() => updateParams({ status: tab.value })}
                aria-pressed={active}
              >
                {tab.label}
                <span className="adm-sa-tab__count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────── */}
      <div className="adm-sa-table-wrap">
        {error ? (
          <div className="adm-sa-error">
            <AlertTriangle size={16} />
            <div>
              <strong>Unable to load security alerts.</strong>
              <span>{error}</span>
            </div>
            <button type="button" className="adm-sa-retry" onClick={load}>Retry</button>
          </div>
        ) : loading && !data ? (
          <table className="adm-sa-table">
            <thead>
              <tr>
                {['id', 'customer', 'type', 'severity', 'status', 'detected'].map((key) => (
                  <th key={key} scope="col">{SORTABLE[key].label}</th>
                ))}
                <th scope="col" className="adm-sa-table__review-head"><span className="adm-sa-sr-only">Review</span></th>
              </tr>
            </thead>
            <tbody>{Array.from({ length: 8 }).map((_, i) => <RowSkeleton key={i} />)}</tbody>
          </table>
        ) : items.length ? (
          <table className="adm-sa-table">
            <thead>
              <tr>
                {['id', 'customer', 'type', 'severity', 'status', 'detected'].map((key) => {
                  const active = sort === key;
                  return (
                    <th
                      key={key}
                      scope="col"
                      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button
                        type="button"
                        className={`adm-sa-sort${active ? ' is-active' : ''}`}
                        onClick={() => handleSort(key)}
                        aria-label={`Sort by ${SORTABLE[key].label.toLowerCase()}`}
                      >
                        {SORTABLE[key].label}
                        {active
                          ? (order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
                          : <span className="adm-sa-sort__idle" aria-hidden="true">⇅</span>}
                      </button>
                    </th>
                  );
                })}
                <th scope="col" className="adm-sa-table__review-head"><span className="adm-sa-sr-only">Review</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td className="adm-sa-table__id" title={a.id}>{a.id.slice(0, 8)}</td>
                  <td>{typeof a.customer === 'string' ? a.customer : (a.customer?.name || a.user_id?.slice(0, 8) || 'Unknown')}</td>
                  <td>{a.type}</td>
                  <td>
                    <span className={`adm-sa-badge adm-sa-badge--${alertSeverityTone(a.severity)}`}>
                      {alertSeverityLabel(a.severity)}
                    </span>
                  </td>
                  <td>
                    <span className={`adm-sa-badge adm-sa-badge--${alertStatusTone(a.status)}`}>
                      {alertStatusLabel(a.status)}
                    </span>
                  </td>
                  <td className="adm-sa-table__detected" title={formatAbsoluteTime(a.created_at)}>
                    {formatRelativeTime(a.created_at)}
                  </td>
                  <td className="adm-sa-table__review">
                    <button
                      type="button"
                      className="adm-sa-review"
                      onClick={() => setSelected(a)}
                      aria-label={`Review alert ${a.id.slice(0, 8)}`}
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="adm-sa-empty">
            <Inbox size={20} />
            <strong>No security alerts match the current filters.</strong>
            <span>Try adjusting your search, severity, status, or date range.</span>
            <button type="button" className="adm-sa-retry" onClick={handleReset}>Clear filters</button>
          </div>
        )}
      </div>

      {/* ── Pagination ────────────────────────────────────────── */}
      <div className="adm-sa-pager">
        <span className="adm-sa-pager__info">
          {loading && !data
            ? 'Loading security alerts…'
            : `Showing ${fromRow} to ${toRow} of ${total} alert${total === 1 ? '' : 's'}`}
        </span>
        <div className="adm-sa-pager__controls">
          <button
            type="button"
            className="adm-sa-page-btn"
            onClick={() => setPage(pagination.page - 1)}
            disabled={(pagination.page || 1) <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={15} />
          </button>
          {pageButtons.map((p) => (
            <button
              key={p}
              type="button"
              className={`adm-sa-page-btn adm-sa-page-btn--num${p === pagination.page ? ' is-active' : ''}`}
              onClick={() => setPage(p)}
              aria-label={`Page ${p}`}
              aria-current={p === pagination.page ? 'page' : undefined}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            className="adm-sa-page-btn"
            onClick={() => setPage(pagination.page + 1)}
            disabled={(pagination.page || 1) >= (pagination.total_pages || 1)}
            aria-label="Next page"
          >
            <ChevronRight size={15} />
          </button>
          <div className="adm-sa-select adm-sa-select--pages">
            <select
              value={String(limit)}
              onChange={(e) => updateParams({ limit: e.target.value })}
              aria-label="Security alerts per page"
            >
              {ALERT_PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
            </select>
          </div>
        </div>
      </div>

      <AlertDetailModal
        alertId={selected?.id || null}
        open={!!selected}
        onClose={() => setSelected(null)}
        onUpdated={handleAlertUpdated}
        onSuspended={() => load({ quiet: true })}
      />
    </div>
  );
}
