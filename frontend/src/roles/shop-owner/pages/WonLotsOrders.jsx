// frontend/src/roles/shop-owner/pages/WonLotsOrders.jsx
// Won Lots & Orders — the seller's own won lots / orders.
//
// Data (all real, seller-scoped server-side):
//   GET  /shop-owner/sales             → the seller's order rows (enriched)
//   PATCH /shop-owner/orders/:id/status → fulfillment mutation (owner + transition
//                                        + payment-before-processing validated server-side)
//
// Money rule (backend is the only source of truth): commission = 10% of the sale
// amount, payout = sale amount - commission. The frontend only aggregates the
// authoritative per-order values.
//
// The seller Portal header and sidebar are NOT touched by this page.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { Modal } from '../../../shared/components/Modal';
import {
  Search, BarChart3, Percent, Wallet, ChevronLeft, ChevronRight,
  MoreVertical, Info, ArrowUpDown, ArrowUp, ArrowDown, Package, AlertTriangle,
} from 'lucide-react';
import '../won-orders.css';

const COMMISSION_RATE = 0.10;
const PAGE_SIZES = [10, 25, 50];

function peso(n) {
  const num = Number(n || 0);
  return `₱${num.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
}

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return String(d);
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}
function formatTime(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date)) return '';
  return date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
}
function formatDateTime(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return String(d);
  return `${formatDate(d)} · ${formatTime(d)}`;
}
function formatPaymentMethod(method) {
  if (!method) return '—';
  const m = String(method).trim().toLowerCase();
  if (m === 'gcash') return 'GCash';
  if (m === 'maya') return 'Maya';
  if (m === 'card') return 'Card';
  if (m === 'bank' || m === 'bank_transfer') return 'Bank Transfer';
  if (m === 'counter' || m === 'branch_counter') return 'Branch Counter';
  return String(method).charAt(0).toUpperCase() + String(method).slice(1);
}

/** Order (fulfillment) status → display label + tone. Presentation only. */
const ORDER_STATUS = {
  pending: { label: 'Processing', tone: 'info' },
  preparing: { label: 'Preparing', tone: 'info' },
  ready_pickup: { label: 'Ready for Pickup', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  expired: { label: 'Expired', tone: 'muted' },
};
const ORDER_STATUS_OPTIONS = [
  { value: 'pending', label: 'Processing' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready_pickup', label: 'Ready for Pickup' },
  { value: 'completed', label: 'Completed' },
  { value: 'expired', label: 'Expired' },
];

/** Payment status → display label + tone. Presentation only. */
const PAYMENT_STATUS = {
  paid: { label: 'Paid', tone: 'success' },
  pending: { label: 'Pending', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
  expired: { label: 'Expired', tone: 'muted' },
};
function paymentMeta(status) {
  if (!status) return { label: 'No Payment', tone: 'warn' };
  return PAYMENT_STATUS[status] || { label: String(status), tone: 'muted' };
}

function KpiCard({ icon, tone, label, value, sub, testId }) {
  return (
    <article className={`wlo-kpi wlo-kpi--${tone}`} data-testid={testId}>
      <span className="wlo-kpi__icon" aria-hidden="true">{icon}</span>
      <span className="wlo-kpi__body">
        <span className="wlo-kpi__label">{label}</span>
        <span className="wlo-kpi__value">{value}</span>
        <span className="wlo-kpi__sub">{sub}</span>
      </span>
    </article>
  );
}

export default function WonLotsOrders() {
  const showToast = useToast();
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detailId, setDetailId] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { id, nextStatus, title, body }
  const [updating, setUpdating] = useState(null);
  const menuRef = useRef(null);

  const refresh = useCallback(async (opts = {}) => {
    const { silent } = opts;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch('/shop-owner/sales');
      setSales(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e?.message || 'Failed to load orders');
      if (!silent) setSales([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Close the three-dot menu on an outside click / Escape.
  useEffect(() => {
    if (!menuId) return undefined;
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuId(null); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuId(null); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuId]);

  // ── KPIs — the SELLER-WIDE totals over every order the seller owns
  //    (not the filtered / paginated subset). The per-order commission and
  //    payout come from the backend; the frontend only sums them.
  const totals = useMemo(() => {
    let salesTotal = 0;
    let commission = 0;
    let payout = 0;
    sales.forEach((s) => {
      salesTotal += Number(s.amount || 0);
      commission += Number(s.commission ?? Math.round(Number(s.amount || 0) * COMMISSION_RATE));
      payout += Number(s.payout ?? (Number(s.amount || 0) - (s.commission ?? Math.round(Number(s.amount || 0) * COMMISSION_RATE))));
    });
    return { salesTotal, commission, payout };
  }, [sales]);

  // ── Filtering + sorting + pagination (client-side: the API returns the
  //    seller's full order set, so no extra request per keystroke).
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = sales.filter((s) => {
      if (statusFilter && s.status !== statusFilter) return false;
      if (!needle) return true;
      const hay = [
        s.transaction_code, s.id, s.item, s.category, s.buyer,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (s) => {
      if (sortKey === 'order_id') return String(s.transaction_code || s.id || '').toLowerCase();
      if (sortKey === 'amount') return Number(s.amount || 0);
      return new Date(s.date || 0).getTime();
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [sales, q, statusFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Changing a filter or the page size always returns to page 1.
  useEffect(() => { setPage(1); }, [q, statusFilter, pageSize]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortIcon = ({ active, dir }) => {
    if (!active) return <ArrowUpDown size={12} aria-hidden="true" />;
    return dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />;
  };

  /** The fulfillment action allowed for a row by the current business rules.
   *  The backend re-validates ownership, the transition and the
   *  payment-before-processing rule before applying anything. */
  const actionFor = (s) => {
    const paid = s.payment_status === 'paid';
    if (s.status === 'pending') {
      return paid
        ? { label: 'Start Preparing', next: 'preparing', title: 'Start preparing this order?', body: `Start preparing "${s.item}" for ${s.buyer}?` }
        : { label: 'Payment pending', disabled: true, reason: 'Payment must be Paid before Start Preparing.' };
    }
    if (s.status === 'preparing') {
      return paid
        ? { label: 'Ready for Pickup', next: 'ready_pickup', title: 'Mark as ready for pickup?', body: `"${s.item}" will be marked ready for pickup and the customer will be notified.` }
        : { label: 'Payment pending', disabled: true, reason: 'Payment must be Paid before Start Preparing.' };
    }
    if (s.status === 'ready_pickup') {
      return paid
        ? { label: 'Confirm Pickup', next: 'completed', title: 'Confirm pickup?', body: `Confirm that ${s.buyer} has picked up "${s.item}"?` }
        : { label: 'Payment pending', disabled: true, reason: 'Payment must be Paid before Start Preparing.' };
    }
    return { label: null, disabled: true };
  };

  const handleStatus = async () => {
    if (!confirm) return;
    setUpdating(confirm.id);
    try {
      await apiFetch(`/shop-owner/orders/${confirm.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: confirm.nextStatus }),
      });
      showToast(confirm.nextStatus === 'preparing'
        ? 'Order is now preparing'
        : confirm.nextStatus === 'ready_pickup'
          ? 'Order ready for pickup — customer notified'
          : 'Pickup confirmed');
      setConfirm(null);
      await refresh({ silent: true });
    } catch (e) {
      showToast(e?.message || 'Unable to update this order. Please try again.');
    } finally {
      setUpdating(null);
    }
  };

  // The details modal always renders the row that was clicked (by id).
  const detailRow = detailId ? sales.find((s) => s.id === detailId) || null : null;

  if (loading) {
    return (
      <div className="wlo-page">
        <div className="wlo-toolbar-card" aria-hidden="true">
          <div className="wlo-skel" style={{ width: '55%', height: 40, borderRadius: 10 }} />
          <div className="wlo-skel" style={{ width: 150, height: 40, borderRadius: 10 }} />
        </div>
        <div className="wlo-kpi-row" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="wlo-kpi wlo-kpi--skeleton">
              <div className="wlo-skel" style={{ width: 44, height: 44, borderRadius: 12 }} />
              <div className="wlo-kpi__body">
                <div className="wlo-skel" style={{ width: '45%', height: 11 }} />
                <div className="wlo-skel" style={{ width: '60%', height: 26, marginTop: 8 }} />
                <div className="wlo-skel" style={{ width: '50%', height: 10, marginTop: 8 }} />
              </div>
            </div>
          ))}
        </div>
        <div className="wlo-table-card" aria-hidden="true">
          <div className="wlo-table-wrap">
            <table className="wlo-table">
              <thead>
                <tr>
                  <th>Order ID</th><th>Item</th><th>Buyer</th><th>Sale Amount</th>
                  <th>Commission (10%)</th><th>Your Payout (90%)</th><th>Payment</th>
                  <th>Status</th><th>Action</th><th>Date</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <tr key={i}>
                    <td><div className="wlo-skel" style={{ width: 80, height: 14 }} /></td>
                    <td><div className="wlo-skel" style={{ width: 180, height: 14 }} /></td>
                    <td><div className="wlo-skel" style={{ width: 90, height: 14 }} /></td>
                    <td><div className="wlo-skel" style={{ width: 70, height: 14 }} /></td>
                    <td><div className="wlo-skel" style={{ width: 70, height: 14 }} /></td>
                    <td><div className="wlo-skel" style={{ width: 70, height: 14 }} /></td>
                    <td><div className="wlo-skel" style={{ width: 88, height: 20, borderRadius: 999 }} /></td>
                    <td><div className="wlo-skel" style={{ width: 84, height: 20, borderRadius: 999 }} /></td>
                    <td><div className="wlo-skel" style={{ width: 96, height: 26, borderRadius: 8 }} /></td>
                    <td><div className="wlo-skel" style={{ width: 80, height: 14 }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wlo-page">
        <div className="wlo-table-card">
          <div className="wlo-empty">
            <span className="wlo-empty__icon"><AlertTriangle size={20} aria-hidden="true" /></span>
            <p className="wlo-empty__title">Unable to load your orders</p>
            <p className="wlo-empty__text">{error}</p>
            <button type="button" className="btn btn-primary" onClick={() => refresh()}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wlo-page">
      {/* Search + status */}
      <section className="wlo-toolbar-card">
        <div className="wlo-search" role="search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search sales, buyers, items, or order ID..."
            aria-label="Search sales, buyers, items, or order ID"
          />
        </div>
        <select
          className="wlo-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter orders by status"
        >
          <option value="">All Status</option>
          {ORDER_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </section>

      {/* KPI row */}
      <div className="wlo-kpi-row">
        <KpiCard
          testId="wlo-kpi-sales"
          tone="gold"
          icon={<BarChart3 size={20} />}
          label="TOTAL SALES"
          value={peso(totals.salesTotal)}
          sub="100% — all completed sales"
        />
        <KpiCard
          testId="wlo-kpi-commission"
          tone="gold"
          icon={<Percent size={20} />}
          label="PLATFORM COMMISSION (10%)"
          value={peso(totals.commission)}
          sub="ATANY keeps 10%"
        />
        <KpiCard
          testId="wlo-kpi-payout"
          tone="navy"
          icon={<Wallet size={20} />}
          label="YOUR TOTAL PAYOUT (90%)"
          value={peso(totals.payout)}
          sub="You receive 90%"
        />
      </div>

      {/* Orders table */}
      <section className="wlo-table-card">
        <div className="wlo-table-wrap">
          <table className="wlo-table">
            <thead>
              <tr>
                <th scope="col">
                  <button type="button" className={`wlo-sort${sortKey === 'order_id' ? ' is-active' : ''}`} onClick={() => toggleSort('order_id')}>
                    Order ID <SortIcon active={sortKey === 'order_id'} dir={sortDir} />
                  </button>
                </th>
                <th scope="col">Item</th>
                <th scope="col">Buyer</th>
                <th scope="col">Sale Amount</th>
                <th scope="col">Commission (10%)</th>
                <th scope="col">Your Payout (90%)</th>
                <th scope="col">Payment</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
                <th scope="col">
                  <button type="button" className={`wlo-sort${sortKey === 'date' ? ' is-active' : ''}`} onClick={() => toggleSort('date')}>
                    Date <SortIcon active={sortKey === 'date'} dir={sortDir} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <div className="wlo-empty">
                      <span className="wlo-empty__icon"><Package size={20} aria-hidden="true" /></span>
                      <p className="wlo-empty__title">No orders yet</p>
                      <p className="wlo-empty__text">
                        {sales.length === 0
                          ? 'When a lot you sold is won, the order appears here.'
                          : 'No sales match the current search or status filter.'}
                      </p>
                      {sales.length > 0 && (
                        <button type="button" className="btn btn-outline" onClick={() => { setQ(''); setStatusFilter(''); }}>
                          Clear filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : pageRows.map((s) => {
                const pay = paymentMeta(s.payment_status);
                const st = ORDER_STATUS[s.status] || { label: s.status || '—', tone: 'muted' };
                const act = actionFor(s);
                return (
                  <tr key={s.id} data-testid={`wlo-row-${s.id}`}>
                    <td data-label="Order ID">
                      <span className="wlo-order-id">{s.transaction_code || String(s.id).slice(0, 8).toUpperCase()}</span>
                    </td>
                    <td data-label="Item">
                      <div className="wlo-item">
                        {s.item_image ? (
                          <img className="wlo-thumb" src={s.item_image} alt={s.item ? `${s.item} thumbnail` : 'Item'} loading="lazy" />
                        ) : (
                          <span className="wlo-thumb wlo-thumb--empty" aria-hidden="true"><Package size={16} /></span>
                        )}
                        <span className="wlo-item__text">
                          <span className="wlo-item__name">{s.item || 'Jewelry Item'}</span>
                          {s.category && <span className="wlo-item__cat">{s.category}</span>}
                        </span>
                      </div>
                    </td>
                    <td data-label="Buyer"><span className="wlo-buyer">{s.buyer}</span></td>
                    <td data-label="Sale Amount"><span className="wlo-amount">{peso(s.amount)}</span></td>
                    <td data-label="Commission (10%)"><span className="wlo-amount wlo-amount--muted">{peso(s.commission)}</span></td>
                    <td data-label="Your Payout (90%)"><span className="wlo-payout">{peso(s.payout)}</span></td>
                    <td data-label="Payment"><span className={`wlo-pill wlo-pill--${pay.tone}`}>{pay.label}</span></td>
                    <td data-label="Status"><span className={`wlo-pill wlo-pill--${st.tone}`}>{st.label}</span></td>
                    <td data-label="Action">
                      <div className="wlo-actions">
                        <button
                          type="button"
                          className="wlo-view-btn"
                          onClick={() => { setMenuId(null); setDetailId(s.id); }}
                          aria-label={`View order ${s.transaction_code || s.id}`}
                        >
                          View
                        </button>
                        <div className="wlo-menu" ref={menuId === s.id ? menuRef : undefined}>
                          <button
                            type="button"
                            className="wlo-menu__trigger"
                            aria-label={`More actions for ${s.transaction_code || s.id}`}
                            aria-haspopup="menu"
                            aria-expanded={menuId === s.id}
                            onClick={() => setMenuId((m) => (m === s.id ? null : s.id))}
                          >
                            <MoreVertical size={15} aria-hidden="true" />
                          </button>
                          {menuId === s.id && (
                            <div className="wlo-menu__list" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                className="wlo-menu__item"
                                onClick={() => { setMenuId(null); setDetailId(s.id); }}
                              >
                                View details
                              </button>
                              {act.label && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="wlo-menu__item"
                                  disabled={!!act.disabled}
                                  title={act.reason || ''}
                                  onClick={() => {
                                    setMenuId(null);
                                    if (act.disabled) return;
                                    setConfirm({ id: s.id, nextStatus: act.next, title: act.title, body: act.body });
                                  }}
                                >
                                  {act.label}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td data-label="Date">
                      <span className="wlo-date">
                        <span className="wlo-date__day">{formatDate(s.date)}</span>
                        <span className="wlo-date__time">{formatTime(s.date)}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="wlo-table-foot">
          <span className="wlo-count">{filtered.length} sales</span>
          <div className="wlo-pager">
            <button
              type="button"
              className="wlo-pager__btn"
              aria-label="Previous page"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft size={15} aria-hidden="true" />
            </button>
            <span className="wlo-pager__page" data-testid="wlo-page">{currentPage}</span>
            <button
              type="button"
              className="wlo-pager__btn"
              aria-label="Next page"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight size={15} aria-hidden="true" />
            </button>
            <select
              className="wlo-page-size"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              aria-label="Rows per page"
            >
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* Payout note */}
      <div className="wlo-note">
        <Info size={15} aria-hidden="true" className="wlo-note__icon" />
        <p>
          <b>Payout note:</b> ATANY keeps <b>10% platform commission</b> from each completed sale.
          You receive <b>90%</b> of the Sale Amount. Payment must be <b>Paid</b> before <b>Start Preparing</b>.
          <br />
          Sale Amount (100%) = Commission (10%) + Payout (90%).
        </p>
      </div>

      {/* Order details */}
      <Modal
        open={!!detailRow}
        onClose={() => setDetailId(null)}
        title="Order details"
        eyebrow={detailRow?.transaction_code || ''}
        footer={(
          <button type="button" className="btn btn-outline" onClick={() => setDetailId(null)}>Close</button>
        )}
      >
        {detailRow && (
          <div className="wlo-detail" data-testid="wlo-detail">
            <div className="wlo-detail__item">
              {detailRow.item_image ? (
                <img className="wlo-detail__img" src={detailRow.item_image} alt={detailRow.item ? `${detailRow.item} thumbnail` : 'Item'} />
              ) : (
                <span className="wlo-detail__img wlo-thumb--empty" aria-hidden="true"><Package size={18} /></span>
              )}
              <div>
                <div className="wlo-detail__name">{detailRow.item || 'Jewelry Item'}</div>
                {detailRow.category && <div className="wlo-detail__cat">{detailRow.category}</div>}
              </div>
            </div>
            <dl className="wlo-detail__grid">
              <div><dt>Order reference</dt><dd>{detailRow.transaction_code || String(detailRow.id).slice(0, 8).toUpperCase()}</dd></div>
              <div><dt>Buyer</dt><dd>{detailRow.buyer}</dd></div>
              <div><dt>Sale amount</dt><dd>{peso(detailRow.amount)}</dd></div>
              <div><dt>Platform commission (10%)</dt><dd>{peso(detailRow.commission)}</dd></div>
              <div><dt>Your payout (90%)</dt><dd className="wlo-payout">{peso(detailRow.payout)}</dd></div>
              <div><dt>Payment status</dt><dd>{paymentMeta(detailRow.payment_status).label}</dd></div>
              <div><dt>Payment method</dt><dd>{formatPaymentMethod(detailRow.payment_method)}</dd></div>
              <div><dt>Order status</dt><dd>{(ORDER_STATUS[detailRow.status] || {}).label || detailRow.status || '—'}</dd></div>
              <div><dt>Pickup branch</dt><dd>{detailRow.branch_name || '—'}</dd></div>
              <div><dt>Order date</dt><dd>{formatDateTime(detailRow.date)}</dd></div>
              <div><dt>Paid at</dt><dd>{detailRow.paid_at ? formatDateTime(detailRow.paid_at) : '—'}</dd></div>
              <div><dt>Payment deadline</dt><dd>{detailRow.payment_deadline ? formatDateTime(detailRow.payment_deadline) : '—'}</dd></div>
            </dl>
          </div>
        )}
      </Modal>

      {/* Fulfillment confirmation */}
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.title}
        eyebrow="Won Lots & Orders"
        footer={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => setConfirm(null)} disabled={!!updating}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={handleStatus} disabled={!!updating}>
              {updating ? 'Updating…' : 'Confirm'}
            </button>
          </>
        )}
      >
        <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{confirm?.body}</p>
      </Modal>
    </div>
  );
}
