// frontend/src/roles/admin/pages/Orders.jsx
// Admin → Orders (monitoring screen).
//
// Every number, row and count on this page comes from the real ATANY orders
// endpoint (GET /admin/transactions) — the list is filtered, searched, sorted
// and paginated SERVER-SIDE.
//
// This screen is READ-ONLY monitoring: there is no Actions column, no order
// detail drawer and no row checkboxes (there is no bulk operation to run).
// Fulfillment stays with the seller / customer flows.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ShoppingCart, Wallet, Hourglass, CheckCircle2, Search, CalendarDays,
  Building2, Filter, RotateCcw, ChevronLeft, ChevronRight, ArrowUp, ArrowDown,
  AlertTriangle, Inbox,
} from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import {
  ORDER_STATUS_TABS, ORDER_STATUS_OPTIONS, DATE_PRESETS, PAGE_SIZES,
  orderStatusLabel, orderStatusTone, peso, formatOrderDate, resolveDateRange,
} from '../lib/orderLabels';
import './orders.css';

const SORTABLE = {
  transaction: { key: 'transaction', label: 'Transaction ID', defaultOrder: 'asc' },
  amount: { key: 'amount', label: 'Amount', defaultOrder: 'desc' },
  branch: { key: 'branch', label: 'Branch', defaultOrder: 'asc' },
  status: { key: 'status', label: 'Status', defaultOrder: 'asc' },
  date: { key: 'date', label: 'Date', defaultOrder: 'desc' },
};

function KpiSkeleton() {
  return <div className="adm-ord-skel adm-ord-skel--kpi" />;
}
function RowSkeleton() {
  return <tr className="adm-ord-skel-row"><td colSpan={7}><div className="adm-ord-skel adm-ord-skel--row" /></td></tr>;
}

export default function AdminOrders() {
  const [params, setParams] = useSearchParams();

  // ── URL state (survives refresh + back/forward) ────────────────
  const search = params.get('search') || '';
  const status = params.get('status') || 'all';
  const branchId = params.get('branch') || '';
  const datePreset = params.get('date') || 'all';
  const dateFrom = params.get('from') || '';
  const dateTo = params.get('to') || '';
  const sort = params.get('sort') || 'date';
  const order = params.get('order') || 'desc';
  const page = Math.max(1, Number(params.get('page') || 1) || 1);
  const limit = PAGE_SIZES.includes(Number(params.get('limit'))) ? Number(params.get('limit')) : 10;

  const [searchInput, setSearchInput] = useState(search);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [branches, setBranches] = useState([]);
  const requestId = useRef(0);

  useEffect(() => { setSearchInput(search); }, [search]);

  // ── branches for the filter (real records) ──────────────────────
  useEffect(() => {
    let alive = true;
    apiFetch('/admin/branches')
      .then((rows) => { if (alive) setBranches(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (alive) setBranches([]); });
    return () => { alive = false; };
  }, []);

  // ── URL helpers ────────────────────────────────────────────────
  const updateParams = useCallback((patch, { resetPage = true } = {}) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => {
      if (value === '' || value == null || value === 'all') next.delete(key);
      else next.set(key, String(value));
    });
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  }, [params, setParams]);

  // ── debounced search (trimmed, case-insensitive server-side) ────
  useEffect(() => {
    const value = searchInput.trim();
    if (value === search) return undefined;
    const id = setTimeout(() => updateParams({ search: value }), 350);
    return () => clearTimeout(id);
  }, [searchInput, search, updateParams]);

  // ── data fetch ─────────────────────────────────────────────────
  const range = useMemo(
    () => resolveDateRange(datePreset, dateFrom, dateTo),
    [datePreset, dateFrom, dateTo]
  );

  const queryString = useMemo(() => {
    const q = new URLSearchParams();
    if (search.trim()) q.set('search', search.trim());
    if (status && status !== 'all') q.set('status', status);
    if (branchId) q.set('branch_id', branchId);
    if (range.date_from) q.set('date_from', range.date_from);
    if (range.date_to) q.set('date_to', range.date_to);
    q.set('page', String(page));
    q.set('limit', String(limit));
    q.set('sort', sort);
    q.set('order', order);
    return q.toString();
  }, [search, status, branchId, range.date_from, range.date_to, page, limit, sort, order]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/admin/transactions?${queryString}`);
      if (id !== requestId.current) return; // a newer request already answered
      setData(res);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e.message || 'Failed to load orders');
      setData(null);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [queryString]);

  useEffect(() => { load(); }, [load]);

  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, limit, total: 0, total_pages: 1 };
  const summary = data?.summary || null;
  const counts = summary?.status_counts || {};

  // Keep the page inside the real result set (e.g. after a deep link to
  // ?page=9 on a single-page result) instead of showing an empty table.
  useEffect(() => {
    if (loading || !data) return;
    const totalPages = pagination.total_pages || 1;
    if (pagination.total > 0 && pagination.page > totalPages) {
      updateParams({ page: totalPages }, { resetPage: false });
    }
  }, [loading, data, pagination.page, pagination.total_pages, pagination.total, updateParams]);

  const total = pagination.total || 0;
  const fromRow = total === 0 ? 0 : ((pagination.page - 1) * pagination.limit) + 1;
  const toRow = Math.min(total, pagination.page * pagination.limit);

  const branchName = useMemo(() => {
    if (!branchId) return '';
    return branches.find((b) => b.id === branchId)?.name || '';
  }, [branches, branchId]);

  const hasFilters = Boolean(search.trim() || status !== 'all' || branchId || datePreset !== 'all');

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

  const setPage = (p) => updateParams({ page: Math.min(Math.max(1, p), Math.max(1, pagination.total_pages || 1)) }, { resetPage: false });

  const pageButtons = useMemo(() => {
    const totalPages = Math.max(1, pagination.total_pages || 1);
    const current = pagination.page || 1;
    const out = [];
    const start = Math.max(1, Math.min(current - 2, totalPages - 4));
    const end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i += 1) out.push(i);
    return out;
  }, [pagination.page, pagination.total_pages]);

  const scopeNote = [
    branchName ? `Branch: ${branchName}` : null,
    datePreset !== 'all' ? DATE_PRESETS.find((d) => d.value === datePreset)?.label : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="adm-ord">
      {/* ── KPI cards ─────────────────────────────────────────── */}
      <div className="adm-ord-kpis">
        {loading && !data ? (
          <>
            <KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton />
          </>
        ) : (
          <>
            <article className="adm-ord-kpi adm-ord-kpi--blue">
              <div className="adm-ord-kpi__icon"><ShoppingCart size={17} /></div>
              <div className="adm-ord-kpi__body">
                <span className="adm-ord-kpi__label">Total Orders</span>
                <strong className="adm-ord-kpi__value">{summary?.total_orders ?? 0}</strong>
                <span className="adm-ord-kpi__note">
                  {summary?.branches_in_scope ?? 0} branch{(summary?.branches_in_scope ?? 0) === 1 ? '' : 'es'} in scope
                </span>
              </div>
            </article>

            <article className="adm-ord-kpi adm-ord-kpi--green">
              <div className="adm-ord-kpi__icon"><Wallet size={17} /></div>
              <div className="adm-ord-kpi__body">
                <span className="adm-ord-kpi__label">Total Sales</span>
                <strong className="adm-ord-kpi__value">{peso(summary?.total_sales ?? 0)}</strong>
                <span className="adm-ord-kpi__note adm-ord-kpi__note--green">
                  Recognized · {summary?.paid_orders ?? 0} paid order{(summary?.paid_orders ?? 0) === 1 ? '' : 's'}
                </span>
              </div>
            </article>

            <article className="adm-ord-kpi adm-ord-kpi--gold">
              <div className="adm-ord-kpi__icon"><Hourglass size={17} /></div>
              <div className="adm-ord-kpi__body">
                <span className="adm-ord-kpi__label">Pending Orders</span>
                <strong className="adm-ord-kpi__value">{summary?.pending ?? 0}</strong>
                <span className="adm-ord-kpi__note adm-ord-kpi__note--gold">Awaiting payment</span>
              </div>
            </article>

            <article className="adm-ord-kpi adm-ord-kpi--green">
              <div className="adm-ord-kpi__icon"><CheckCircle2 size={17} /></div>
              <div className="adm-ord-kpi__body">
                <span className="adm-ord-kpi__label">Completed Orders</span>
                <strong className="adm-ord-kpi__value">{summary?.completed ?? 0}</strong>
                <span className="adm-ord-kpi__note adm-ord-kpi__note--green">
                  {summary?.completion_rate ?? 0}% completion rate
                </span>
              </div>
            </article>
          </>
        )}
      </div>

      {/* ── Filter toolbar ────────────────────────────────────── */}
      <div className="adm-ord-toolbar">
        <div className="adm-ord-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by transaction ID, customer, or item..."
            aria-label="Search orders by transaction ID, customer, or item"
          />
        </div>

        <div className="adm-ord-select">
          <CalendarDays size={15} aria-hidden="true" />
          <select
            value={datePreset}
            onChange={(e) => updateParams({ date: e.target.value })}
            aria-label="Filter orders by date"
          >
            {DATE_PRESETS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>

        {datePreset === 'custom' && (
          <>
            <input
              type="date"
              className="adm-ord-date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => updateParams({ from: e.target.value, to: dateTo })}
              aria-label="Custom range start date"
            />
            <input
              type="date"
              className="adm-ord-date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => updateParams({ from: dateFrom, to: e.target.value })}
              aria-label="Custom range end date"
            />
          </>
        )}

        <div className="adm-ord-select">
          <Building2 size={15} aria-hidden="true" />
          <select
            value={branchId}
            onChange={(e) => updateParams({ branch: e.target.value })}
            aria-label="Filter orders by branch"
          >
            <option value="">All Branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        <div className="adm-ord-select">
          <Filter size={15} aria-hidden="true" />
          <select
            value={status}
            onChange={(e) => updateParams({ status: e.target.value })}
            aria-label="Filter orders by status"
          >
            {ORDER_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <button type="button" className="adm-ord-reset" onClick={handleReset} disabled={!hasFilters}>
          <RotateCcw size={14} /> Reset
        </button>
      </div>

      {scopeNote && <p className="adm-ord-scope">{scopeNote}</p>}

      {/* ── Status tabs ───────────────────────────────────────── */}
      <div className="adm-ord-tabs" role="group" aria-label="Order status tabs">
        {ORDER_STATUS_TABS.map((tab) => {
          const count = counts[tab.value] ?? 0;
          const active = status === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              className={`adm-ord-tab adm-ord-tab--${tab.tone}${active ? ' is-active' : ''}`}
              onClick={() => updateParams({ status: tab.value })}
              aria-pressed={active}
            >
              {tab.label}
              <span className="adm-ord-tab__count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* ── Table ─────────────────────────────────────────────── */}
      <div className="adm-ord-table-wrap">
        {error ? (
          <div className="adm-ord-error">
            <AlertTriangle size={16} />
            <div>
              <strong>Unable to load orders.</strong>
              <span>{error}</span>
            </div>
            <button type="button" className="adm-ord-retry" onClick={load}>Retry</button>
          </div>
        ) : loading && !data ? (
          <table className="adm-ord-table">
            <thead>
              <tr>
                <th scope="col">Transaction ID</th>
                <th scope="col">Customer</th>
                <th scope="col">Item</th>
                <th scope="col">Amount</th>
                <th scope="col">Branch</th>
                <th scope="col">Status</th>
                <th scope="col">Date</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => <RowSkeleton key={i} />)}
            </tbody>
          </table>
        ) : items.length ? (
          <table className="adm-ord-table">
            <thead>
              <tr>
                <th scope="col" aria-sort={sort === 'transaction' ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button
                    type="button"
                    className={`adm-ord-sort${sort === 'transaction' ? ' is-active' : ''}`}
                    onClick={() => handleSort('transaction')}
                    aria-label="Sort by transaction ID"
                  >
                    Transaction ID
                    {sort === 'transaction'
                      ? (order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
                      : <span className="adm-ord-sort__idle" aria-hidden="true">⇅</span>}
                  </button>
                </th>
                <th scope="col">Customer</th>
                <th scope="col">Item</th>
                {[
                  { key: 'amount', label: 'Amount' },
                  { key: 'branch', label: 'Branch' },
                  { key: 'status', label: 'Status' },
                  { key: 'date', label: 'Date' },
                ].map(({ key, label }) => {
                  const active = sort === key;
                  return (
                    <th key={key} scope="col" aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button
                        type="button"
                        className={`adm-ord-sort${active ? ' is-active' : ''}`}
                        onClick={() => handleSort(key)}
                        aria-label={`Sort by ${label.toLowerCase()}`}
                      >
                        {label}
                        {active
                          ? (order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
                          : <span className="adm-ord-sort__idle" aria-hidden="true">⇅</span>}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id}>
                  <td className="adm-ord-table__id">{o.transaction_code || o.id.slice(0, 8).toUpperCase()}</td>
                  <td>{o.customer || '—'}</td>
                  <td>{o.item || '—'}</td>
                  <td className="adm-ord-table__amount">{peso(o.amount)}</td>
                  <td>{o.branch || '—'}</td>
                  <td>
                    <span className={`adm-ord-badge adm-ord-badge--${orderStatusTone(o.status)}`}>
                      {orderStatusLabel(o.status)}
                    </span>
                  </td>
                  <td className="adm-ord-table__date">{formatOrderDate(o.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="adm-ord-empty">
            <Inbox size={20} />
            <strong>No orders match the current filters.</strong>
            <span>Try adjusting your search, branch, date, or status filters.</span>
            <button type="button" className="adm-ord-retry" onClick={handleReset}>Clear filters</button>
          </div>
        )}
      </div>

      {/* ── Pagination ────────────────────────────────────────── */}
      <div className="adm-ord-pager">
        <span className="adm-ord-pager__info">
          {loading && !data
            ? 'Loading orders…'
            : `Showing ${fromRow} to ${toRow} of ${total} order${total === 1 ? '' : 's'}`}
        </span>
        <div className="adm-ord-pager__controls">
          <button
            type="button"
            className="adm-ord-page-btn"
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
              className={`adm-ord-page-btn adm-ord-page-btn--num${p === pagination.page ? ' is-active' : ''}`}
              onClick={() => setPage(p)}
              aria-label={`Page ${p}`}
              aria-current={p === pagination.page ? 'page' : undefined}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            className="adm-ord-page-btn"
            onClick={() => setPage(pagination.page + 1)}
            disabled={(pagination.page || 1) >= (pagination.total_pages || 1)}
            aria-label="Next page"
          >
            <ChevronRight size={15} />
          </button>
          <div className="adm-ord-select adm-ord-select--pages">
            <select
              value={String(limit)}
              onChange={(e) => updateParams({ limit: e.target.value })}
              aria-label="Orders per page"
            >
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
