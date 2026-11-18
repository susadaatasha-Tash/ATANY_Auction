// frontend/src/roles/admin/pages/Orders.jsx
// Admin Orders — manage and monitor all customer orders and transactions across branches.
//
// Data:  GET /admin/transactions   (orders with customer, item, branch, amount, status, payment)
// Action: PATCH /admin/orders/:id/status  (fulfilment transitions pending → preparing → ready_pickup → completed)
// Pay:    PATCH /admin/transactions/:id/pay  (record a manual/counter payment)
// Export: client-side CSV of the rows currently rendered (filtered + paginated view)
//
// Only pre-existing endpoints are used. No new backend endpoints, no new order
// statuses, no invented business rules. 'Cancelled' is not a valid order_status
// in this system (see backend/src/db/migrations) and no cancel or invoice
// endpoint exists — those actions are intentionally not implemented here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown, Clock, CreditCard, Download, FileText, MoreVertical, RefreshCw,
  Search, Tag, X,
} from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { Drawer } from '../../../shared/components/Drawer';
import { peso } from '../lib/currency';
import './admin-orders.css';

const PAGE_SIZES = [10, 25, 50, 100];

// Tab key → order_status filter. 'processing' maps to the DB status 'preparing'
// (the fulfilment step after pending). 'cancelled' is not a valid order_status
// in this system, so its tab always resolves to zero orders — it is kept to
// match the navigation shape without inventing a status.
const TABS = [
  { key: 'all', label: 'All', status: null },
  { key: 'pending', label: 'Pending', status: 'pending' },
  { key: 'processing', label: 'Processing', status: 'preparing' },
  { key: 'completed', label: 'Completed', status: 'completed' },
  { key: 'expired', label: 'Expired', status: 'expired' },
  { key: 'cancelled', label: 'Cancelled', status: 'cancelled' },
];

const STATUS_META = {
  pending: { label: 'Pending', tone: 'pending', bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
  preparing: { label: 'Processing', tone: 'processing', bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe' },
  ready_pickup: { label: 'Ready for Pickup', tone: 'ready', bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe' },
  completed: { label: 'Completed', tone: 'completed', bg: '#dcfce7', text: '#166534', border: '#bbf7d0' },
  expired: { label: 'Expired', tone: 'expired', bg: '#e5e7eb', text: '#374151', border: '#d1d5db' },
  cancelled: { label: 'Cancelled', tone: 'cancelled', bg: '#fee2e2', text: '#991b1b', border: '#fecaca' },
};

const TAB_TONE = {
  all: 'outline',
  pending: 'pending',
  processing: 'processing',
  completed: 'completed',
  expired: 'expired',
  cancelled: 'cancelled',
};

function nextStatusFor(status) {
  const map = { pending: 'preparing', preparing: 'ready_pickup', ready_pickup: 'completed' };
  return map[String(status || '').toLowerCase()] || null;
}

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [branchOptions, setBranchOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedId, setSelectedId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [markPaidBusy, setMarkPaidBusy] = useState(new Set());
  const [statusBusy, setStatusBusy] = useState(new Set());
  const showToast = useToast();
  const didMountRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch('/admin/transactions');
      const list = Array.isArray(rows) ? rows : [];
      // Unique branches that actually have orders — no extra request needed.
      const branchMap = {};
      list.forEach((o) => { if (o.branch) branchMap[o.branch] = true; });
      setBranchOptions(Object.keys(branchMap).sort());
      setOrders(list);
    } catch (e) {
      setError(e.message || 'Failed to load orders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const inRange = (iso, range) => {
    if (!iso || range === 'all') return true;
    const d = new Date(iso);
    if (range === 'today') return d >= startOfToday;
    if (range === 'week') return d >= startOfWeek;
    if (range === 'month') return d >= startOfMonth;
    return true;
  };

  const matchesSearch = (o, term) => {
    if (!term) return true;
    const t = term.toLowerCase();
    return String(o.transaction_code || '').toLowerCase().includes(t)
      || String(o.customer || '').toLowerCase().includes(t)
      || String(o.item || '').toLowerCase().includes(t)
      || String(o.id || '').toLowerCase().includes(t);
  };

  const filtered = useMemo(() => {
    const tabDef = TABS.find((t) => t.key === tab) || TABS[0];
    const tabStatus = tabDef.status;
    const dropStatus = statusFilter === 'all' ? null : TABS.find((t) => t.key === statusFilter)?.status || null;
    // Both the tab row and the toolbar dropdown filter by status; either one
    // set to a specific status narrows the table (AND logic).
    return orders.filter((o) => {
      const status = String(o.status || '').toLowerCase();
      if (tabStatus && status !== tabStatus) return false;
      if (dropStatus && status !== dropStatus) return false;
      if (!inRange(o.date, dateFilter)) return false;
      if (branchFilter !== 'all' && String(o.branch || '') !== branchFilter) return false;
      return matchesSearch(o, q);
    });
  }, [orders, tab, statusFilter, dateFilter, branchFilter, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  const paidOrders = orders.filter((o) => String(o.payment_status || '').toLowerCase() === 'paid');
  const kpis = {
    totalOrders: orders.length,
    totalSales: paidOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0),
    pendingOrders: orders.filter((o) => String(o.status || '').toLowerCase() === 'pending').length,
    completedOrders: orders.filter((o) => String(o.status || '').toLowerCase() === 'completed').length,
  };

  const tabCounts = useMemo(() => {
    const counts = {};
    TABS.forEach((t) => {
      if (t.status === null) counts[t.key] = orders.length;
      else counts[t.key] = orders.filter((o) => String(o.status || '').toLowerCase() === t.status).length;
    });
    return counts;
  }, [orders]);

  const handleMarkPaid = async (id) => {
    if (markPaidBusy.has(id)) return;
    setMarkPaidBusy((prev) => new Set([...prev, id]));
    try {
      await apiFetch(`/admin/transactions/${id}/pay`, { method: 'PATCH' });
      showToast('Payment recorded — order ready for fulfilment.');
      await refresh();
    } catch (e) {
      showToast(e.message || 'Failed to record payment.');
    } finally {
      setMarkPaidBusy((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleStatus = async (id, next) => {
    if (statusBusy.has(id)) return;
    setStatusBusy((prev) => new Set([...prev, id]));
    try {
      await apiFetch(`/admin/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      showToast(`Order moved to ${next}.`);
      await refresh();
    } catch (e) {
      showToast(e.message || 'Failed to update status.');
    } finally {
      setStatusBusy((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleToggleSelect = (id) => {
    setSelectedId((prev) => (prev === id ? null : id));
    if (id) setDetailOpen(true);
  };

  const handleSelectNone = () => { setSelectedId(null); setDetailOpen(false); };

  const handleExport = () => {
    const header = ['Transaction ID', 'Customer', 'Item', 'Amount (PHP)', 'Branch', 'Status', 'Date', 'Cancellation Reason', 'Cancelled At', 'Cancelled By'];
    const lines = filtered.map((o) => [
      o.transaction_code || o.id, o.customer || '—', o.item || '—',
      Number(o.amount || 0), o.branch || '—', String(o.status || '').toUpperCase(),
      o.date ? new Date(o.date).toLocaleDateString() : '—',
      o.cancellation_reason || '—',
      o.cancelled_at ? new Date(o.cancelled_at).toLocaleDateString() : '—',
      o.cancelled_by || '—',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atany-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${filtered.length} order${filtered.length === 1 ? '' : 's'}.`);
  };

  const handleReset = () => {
    setQ(''); setDateFilter('all'); setBranchFilter('all'); setTab('all');
    setPage(1); setSelectedId(null); setDetailOpen(false);
  };

  const selectedOrder = orders.find((o) => o.id === selectedId);

  const handleClose = () => { setSelectedId(null); setDetailOpen(false); };

  return (
    <div className="ao-page">
      <div className="ao-kpis">
        <div className="ao-kpi">
          <div className="ao-kpi__icon ao-kpi__icon--orders" aria-hidden="true"><Tag size={18} /></div>
          <div className="ao-kpi__meta">
            <p className="ao-kpi__label">Total Orders</p>
            <p className="ao-kpi__value">{kpis.totalOrders}</p>
            <p className="ao-kpi__note">orders on record</p>
          </div>
        </div>
        <div className="ao-kpi">
          <div className="ao-kpi__icon ao-kpi__icon--sales" aria-hidden="true"><CreditCard size={18} /></div>
          <div className="ao-kpi__meta">
            <p className="ao-kpi__label">Total Sales</p>
            <p className="ao-kpi__value">{peso(kpis.totalSales)}</p>
            <p className="ao-kpi__note">recognized revenue (paid payments)</p>
          </div>
        </div>
        <div className="ao-kpi">
          <div className="ao-kpi__icon ao-kpi__icon--pending" aria-hidden="true"><Clock size={18} /></div>
          <div className="ao-kpi__meta">
            <p className="ao-kpi__label">Pending Orders</p>
            <p className="ao-kpi__value">{kpis.pendingOrders}</p>
            <p className="ao-kpi__note">awaiting fulfilment</p>
          </div>
        </div>
        <div className="ao-kpi">
          <div className="ao-kpi__icon ao-kpi__icon--completed" aria-hidden="true"><FileText size={18} /></div>
          <div className="ao-kpi__meta">
            <p className="ao-kpi__label">Completed Orders</p>
            <p className="ao-kpi__value">{kpis.completedOrders}</p>
            <p className="ao-kpi__note">fulfilled and collected</p>
          </div>
        </div>
      </div>

      <div className="ao-toolbar">
        <div className="ao-search">
          <Search size={14} strokeWidth={2} aria-hidden="true" />
          <input
            className="ao-search__input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by transaction ID, customer, or item..."
            aria-label="Search orders"
          />
        </div>
        <div className="ao-filters">
          <div className="ao-filter">
            <label className="ao-filter__label">All Dates</label>
            <ChevronDown size={12} strokeWidth={2} className="ao-filter__chevron" aria-hidden="true" />
            <select className="ao-filter__select" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} aria-label="Date filter">
              <option value="all">All Dates</option>
              <option value="today">Today</option>
              <option value="week">Last 7 Days</option>
              <option value="month">Last 30 Days</option>
            </select>
          </div>
          <div className="ao-filter">
            <label className="ao-filter__label">All Branches</label>
            <ChevronDown size={12} strokeWidth={2} className="ao-filter__chevron" aria-hidden="true" />
            <select className="ao-filter__select" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label="Branch filter">
              <option value="all">All Branches</option>
              {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="ao-filter">
            <label className="ao-filter__label">All Statuses</label>
            <ChevronDown size={12} strokeWidth={2} className="ao-filter__chevron" aria-hidden="true" />
            <select className="ao-filter__select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status filter">
              <option value="all">All Statuses</option>
              {TABS.slice(1).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <button type="button" className="ao-btn ao-btn--outline" onClick={handleReset} disabled={!q && dateFilter === 'all' && branchFilter === 'all' && statusFilter === 'all' && tab === 'all'}>
            <RefreshCw size={14} strokeWidth={2} aria-hidden="true" /> Reset
          </button>
          <button type="button" className="ao-btn ao-btn--gold" onClick={handleExport} disabled={loading || !filtered.length}>
            <Download size={14} strokeWidth={2} aria-hidden="true" /> Export
          </button>
          <Link className="ao-btn ao-btn--outline" to="/admin/payment-reconciliations">Payment reconciliation</Link>
        </div>
      </div>

      <div className="ao-tabs">
        {TABS.map((t) => {
          const active = tab === t.key;
          const count = tabCounts[t.key] || 0;
          const tone = TAB_TONE[t.key];
          return (
            <button
              key={t.key}
              type="button"
              className={`ao-tab ao-tab--${tone}${active ? ' ao-tab--active' : ''}`}
              onClick={() => { setTab(t.key); setPage(1); }}
              aria-pressed={active}
            >
              <span className="ao-tab__label">{t.label}</span>
              <span className="ao-tab__count">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="ao-wrap">
        <div className="ao-table-wrap">
          <div className="ao-table-head">
            <span className="ao-table__title">Orders</span>
            <span className="ao-table__subtitle">
              {filtered.length} of {orders.length} order{orders.length === 1 ? '' : 's'}
            </span>
          </div>
          {loading ? (
            <div className="ao-skeleton-wrap">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="ao-skel-row">
                  <div className="ao-skel ao-skel--text" style={{ width: '42%', minWidth: '120px' }} />
                  <div className="ao-skel ao-skel--text" style={{ width: '30%' }} />
                  <div className="ao-skel ao-skel--text" style={{ width: '22%' }} />
                  <div className="ao-skel ao-skel--text" style={{ width: '14%', minWidth: '70px' }} />
                  <div className="ao-skel ao-skel--text" style={{ width: '16%', minWidth: '90px' }} />
                  <div className="ao-skel ao-skel--badge" style={{ width: '20%', minWidth: '110px' }} />
                  <div className="ao-skel ao-skel--text" style={{ width: '16%', minWidth: '110px' }} />
                  <div className="ao-skel ao-skel--dot" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="ao-empty">
              <h2>Unable to load orders</h2>
              <p>{error}</p>
              <button type="button" className="ao-btn ao-btn--gold" onClick={refresh}>Try again</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="ao-empty">
              <h2>No orders found</h2>
              <p>No orders match your current search and filters.</p>
              <button type="button" className="ao-btn ao-btn--outline" onClick={handleReset}>Reset filters</button>
            </div>
          ) : (
            <table className="ao-table">
              <thead>
                <tr>
                  <th className="ao-col--select"><input type="checkbox" checked={!!selectedId} onChange={handleSelectNone} aria-label="Select all" /></th>
                  <th className="ao-sortable" onClick={() => {}}>Transaction ID</th>
                  <th className="ao-sortable" onClick={() => {}}>Customer</th>
                  <th className="ao-sortable" onClick={() => {}}>Item</th>
                  <th className="ao-col--amount ao-sortable" onClick={() => {}}>Amount</th>
                  <th className="ao-col--branch">Branch</th>
                  <th className="ao-col--status">Status</th>
                  <th className="ao-col--date ao-sortable" onClick={() => {}}>Date</th>
                  <th className="ao-col--actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((o) => {
                  const status = String(o.status || '').toLowerCase();
                  const meta = STATUS_META[status] || STATUS_META.pending;
                  const isSelected = selectedId === o.id;
                  const next = nextStatusFor(status);
                  const canMarkPaid = String(o.payment_status || '').toLowerCase() !== 'paid' && status !== 'expired';
                  return (
                    <tr
                      key={o.id}
                      className={`ao-row${isSelected ? ' ao-row--selected' : ''}${canMarkPaid ? '' : ''}`}
                      onClick={(e) => { if (!e.target.closest('button,select,input,a')) handleToggleSelect(o.id); }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggleSelect(o.id); } }}
                      aria-label={`Order ${o.transaction_code || o.id}, ${selectedId === o.id ? 'selected' : 'select to view details'}`}
                    >
                      <td className="ao-col--select">
                        <input type="checkbox" checked={isSelected} onChange={(e) => { e.stopPropagation(); handleToggleSelect(o.id); }} aria-label={`Select ${o.transaction_code || o.id}`} />
                      </td>
                      <td className="ao-col--txid">{o.transaction_code || o.id}</td>
                      <td className="ao-col--customer">{o.customer || '—'}</td>
                      <td className="ao-col--item">{o.item || '—'}</td>
                      <td className="ao-col--amount">₱{Number(o.amount || 0).toLocaleString()}</td>
                      <td className="ao-col--branch">{o.branch || '—'}</td>
                      <td className="ao-col--status">
                        <span className={`ao-badge ao-badge--${meta.tone}`} style={{ backgroundColor: meta.bg, color: meta.text, borderColor: meta.border }}>{meta.label}</span>
                      </td>
                      <td className="ao-col--date">{o.date ? new Date(o.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                      <td className="ao-col--actions">
                        <div className="ao-actions">
                          {status === 'pending' && (
                            <button type="button" className="ao-btn ao-btn--ghost ao-btn--sm" disabled={statusBusy.has(o.id)} onClick={() => handleStatus(o.id, 'preparing')}>Preparing</button>
                          )}
                          {status === 'preparing' && (
                            <button type="button" className="ao-btn ao-btn--ghost ao-btn--sm" disabled={statusBusy.has(o.id)} onClick={() => handleStatus(o.id, 'ready_pickup')}>Ready</button>
                          )}
                          {status === 'ready_pickup' && (
                            <button type="button" className="ao-btn ao-btn--ghost ao-btn--sm" disabled={statusBusy.has(o.id)} onClick={() => handleStatus(o.id, 'completed')}>Completed</button>
                          )}
                          {canMarkPaid && (
                            <button type="button" className="ao-btn ao-btn--ghost ao-btn--sm" disabled={markPaidBusy.has(o.id)} onClick={() => handleMarkPaid(o.id)}>Record Payment</button>
                          )}
                          <button type="button" className="ao-btn ao-btn--icon ao-btn--sm" aria-label="More actions" onClick={(e) => { e.stopPropagation(); handleToggleSelect(o.id); }}>
                            <MoreVertical size={16} strokeWidth={2} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="ao-pager">
            <span className="ao-pager__range">
              Showing {filtered.length ? ((currentPage - 1) * pageSize + 1) : 0}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} orders
            </span>
            <div className="ao-pager__controls">
              <button type="button" className="ao-btn ao-btn--outline ao-btn--sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
              <span className="ao-pager__page">Page {currentPage} of {pageCount}</span>
              <button type="button" className="ao-btn ao-btn--outline ao-btn--sm" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
              <label className="ao-pager__label">Show
                <select className="ao-pager__size" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                  {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                per page
              </label>
            </div>
          </div>
        </div>

        {selectedOrder && detailOpen && (
          <Drawer open={detailOpen} onClose={handleClose} labelledBy="order-details-title" width="420px" className="ao-drawer">
            <div className="ao-detail">
              <div className="ao-detail__head">
                <h3 id="order-details-title" className="ao-detail__title">Order Details</h3>
                <button type="button" className="ao-detail__close" onClick={handleClose} aria-label="Close panel">
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>

              <div className="ao-detail__tabs">
                <button className="ao-detail__tab ao-detail__tab--active" onClick={() => {}}>Overview</button>
                <button className="ao-detail__tab" onClick={() => {}}>Items</button>
                <button className="ao-detail__tab" onClick={() => {}}>Payment</button>
                <button className="ao-detail__tab" onClick={() => {}}>Timeline</button>
              </div>

              <div className="ao-detail__panel">
                {/* Overview */}
                <div className="ao-detail__section">
                  <h4 className="ao-detail__section__title">Order Information</h4>
                  <div className="ao-detail__grid">
                    <div className="ao-detail__row">
                      <span className="ao-detail__label">Transaction ID</span>
                      <span className="ao-detail__value">{selectedOrder.transaction_code || selectedOrder.id}</span>
                    </div>
                    <div className="ao-detail__row">
                      <span className="ao-detail__label">Customer</span>
                      <span className="ao-detail__value">{selectedOrder.customer || '—'}</span>
                    </div>
                    <div className="ao-detail__row">
                      <span className="ao-detail__label">Branch</span>
                      <span className="ao-detail__value">{selectedOrder.branch || '—'}</span>
                    </div>
                    <div className="ao-detail__row">
                      <span className="ao-detail__label">Status</span>
                      <span className={`ao-badge ao-badge--${STATUS_META[String(selectedOrder.status)].tone}`} style={{ backgroundColor: STATUS_META[String(selectedOrder.status)].bg, color: STATUS_META[String(selectedOrder.status)].text, borderColor: STATUS_META[String(selectedOrder.status)].border }}>{STATUS_META[String(selectedOrder.status)].label}</span>
                    </div>
                    <div className="ao-detail__row">
                      <span className="ao-detail__label">Order Date</span>
                      <span className="ao-detail__value">{selectedOrder.date ? new Date(selectedOrder.date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</span>
                    </div>
                  </div>

                  {/* Cancellation info — shown only when the order is cancelled */}
                  {String(selectedOrder.status || '').toLowerCase() === 'cancelled' && (
                    <div className="ao-detail__section">
                      <h4 className="ao-detail__section__title">Cancellation</h4>
                      <div className="ao-detail__grid">
                        <div className="ao-detail__row">
                          <span className="ao-detail__label">Cancelled By</span>
                          <span className="ao-detail__value">{selectedOrder.cancellation_actor?.name || selectedOrder.cancelled_by || '—'}{selectedOrder.cancellation_actor?.role?` (${selectedOrder.cancellation_actor.role==='customer'?'Customer':selectedOrder.cancellation_actor.role==='shop_owner'?'Shop Owner (Seller)':selectedOrder.cancellation_actor.role})`:''}</span>
                        </div>
                        <div className="ao-detail__row">
                          <span className="ao-detail__label">Cancelled At</span>
                          <span className="ao-detail__value">{selectedOrder.cancelled_at ? new Date(selectedOrder.cancelled_at).toLocaleString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</span>
                        </div>
                        <div className="ao-detail__row" style={{ gridColumn: '1 / -1' }}>
                          <span className="ao-detail__label">Reason</span>
                          <span className="ao-detail__value">{selectedOrder.cancellation_reason || '—'}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <h4 className="ao-detail__section__title">Financial Details</h4>
                  <div className="ao-detail__grid">
                    <div className="ao-detail__row">
                      <span className="ao-detail__label">Item Total</span>
                      <span className="ao-detail__value">₱{Number(selectedOrder.amount || 0).toLocaleString()}</span>
                    </div>
                    <div className="ao-detail__row">
                      <span className="ao-detail__label">Platform Commission (10%)</span>
                      <span className="ao-detail__value">₱{Math.round(Number(selectedOrder.amount || 0) * 0.10).toLocaleString()}</span>
                    </div>
                    <div className="ao-detail__row">
                      <span className="ao-detail__label">Your Payout (90%)</span>
                      <span className="ao-detail__value">₱{Math.round(Number(selectedOrder.amount || 0) * 0.90).toLocaleString()}</span>
                    </div>
                  </div>

                  <h4 className="ao-detail__section__title">Item Details</h4>
                  <div className="ao-detail__item">
                    <div className="ao-detail__item__thumb" aria-hidden="true">◇</div>
                    <div className="ao-detail__item__info">
                      <div className="ao-detail__item__name">{selectedOrder.item || '—'}</div>
                      <div className="ao-detail__item__meta">
                        <span>Product ID: {selectedOrder.auction_id || selectedOrder.id}</span>
                        <span>Qty: 1</span>
                        <span>Amount: ₱{Number(selectedOrder.amount || 0).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Payment */}
                <div className="ao-detail__section ao-detail__section--hidden">
                  <h4 className="ao-detail__section__title">Payment</h4>
                  <div className="ao-detail__grid">
                    <div className="ao-detail__row">
                      <span className="ao-detail__label">Payment Status</span>
                      <span className="ao-detail__value">{String(selectedOrder.payment_status || '—').charAt(0).toUpperCase() + String(selectedOrder.payment_status || '').slice(1)}</span>
                    </div>
                    <div className="ao-detail__row">
                      <span className="ao-detail__label">Payment Method</span>
                      <span className="ao-detail__value">{selectedOrder.payment_method || '—'}</span>
                    </div>
                    <div className="ao-detail__row">
                      <span className="ao-detail__label">Paid At</span>
                      <span className="ao-detail__value">{selectedOrder.paid_at ? new Date(selectedOrder.paid_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</span>
                    </div>
                    <div className="ao-detail__row">
                      <span className="ao-detail__label">Payment Deadline</span>
                      <span className="ao-detail__value">{selectedOrder.payment_deadline ? new Date(selectedOrder.payment_deadline).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</span>
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                <div className="ao-detail__section ao-detail__section--hidden">
                  <h4 className="ao-detail__section__title">Timeline</h4>
                  <div className="ao-detail__timeline">
                    <div className="ao-timeline__event">
                      <span className="ao-timeline__time">{selectedOrder.date ? new Date(selectedOrder.date).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</span>
                      <span className="ao-timeline__label">Order created</span>
                    </div>
                    {selectedOrder.winner_confirmed_at && (
                      <div className="ao-timeline__event">
                        <span className="ao-timeline__time">{new Date(selectedOrder.winner_confirmed_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                        <span className="ao-timeline__label">Winner confirmed</span>
                      </div>
                    )}
                    {selectedOrder.payment_deadline && (
                      <div className="ao-timeline__event">
                        <span className="ao-timeline__time">{new Date(selectedOrder.payment_deadline).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                        <span className="ao-timeline__label">Payment deadline</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="ao-detail__section">
                  <h4 className="ao-detail__section__title">Actions</h4>
                  <div className="ao-detail__actions">
                    {String(selectedOrder.status || '').toLowerCase() === 'pending' && (
                      <button type="button" className="ao-btn ao-btn--gold" disabled={statusBusy.has(selectedOrder.id)} onClick={() => handleStatus(selectedOrder.id, 'preparing')}>Update Status → Preparing</button>
                    )}
                    {String(selectedOrder.status || '').toLowerCase() === 'preparing' && (
                      <button type="button" className="ao-btn ao-btn--gold" disabled={statusBusy.has(selectedOrder.id)} onClick={() => handleStatus(selectedOrder.id, 'ready_pickup')}>Update Status → Ready for Pickup</button>
                    )}
                    {String(selectedOrder.status || '').toLowerCase() === 'ready_pickup' && (
                      <button type="button" className="ao-btn ao-btn--gold" disabled={statusBusy.has(selectedOrder.id)} onClick={() => handleStatus(selectedOrder.id, 'completed')}>Update Status → Completed</button>
                    )}
                    {String(selectedOrder.payment_status || '').toLowerCase() !== 'paid' && String(selectedOrder.status || '').toLowerCase() !== 'expired' && (
                      <button type="button" className="ao-btn ao-btn--outline" disabled={markPaidBusy.has(selectedOrder.id)} onClick={() => handleMarkPaid(selectedOrder.id)}>Record Payment</button>
                    )}
                    <button type="button" className="ao-btn ao-btn--outline ao-btn--sm" onClick={handleClose}>Close panel</button>
                  </div>
                </div>
              </div>
            </div>
          </Drawer>
        )}
      </div>
    </div>
  );
}
