// frontend/src/roles/shop-owner/pages/WonLotsOrders.jsx
// Won Lots & Orders — seller fulfillment table.
// Data: GET /shop-owner/sales (shop resolved server-side from the authenticated
// user; never trusts seller_id/shop_id from the client).
// Mutations: PATCH /shop-owner/orders/:id/status
//   pending → preparing → ready_pickup → completed (server-enforced).
// Payment-before-fulfillment (payment_status must be paid) is enforced by the
// backend; the UI only mirrors that rule, it never bypasses it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, MoreVertical, Percent, TrendingUp, Wallet } from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { Modal } from '../../../shared/components/Modal';
import { Skeleton, SkeletonCircle, SkeletonRegion } from '../../../shared/ui/Skeleton';
import './won-lots-orders.css';

const PAGE_SIZES = [10, 25, 50];

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }

// Reference shows the date on the first line and a smaller time underneath.
// Local-time formatting is preserved exactly as the rest of the seller portal
// renders timestamps (en-PH, browser timezone).
function formatDateParts(d) {
  if (!d) return { date: '—', time: '' };
  const date = new Date(d);
  if (isNaN(date)) return { date: String(d), time: '' };
  return {
    date: date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }),
    time: date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }),
  };
}

// Backend order_status → display token used by the UI + badges.
function mapStatus(s) {
  if (s === 'pending') return 'processing';
  if (s === 'ready_pickup') return 'ready';
  return s; // preparing | completed | expired
}
// Deadline comes straight from the backend's orders.payment_deadline.
function formatDeadline(d) {
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

function statusLabel(s) {
  if (s === 'pending') return 'Processing';
  if (s === 'preparing') return 'Preparing';
  if (s === 'ready_pickup') return 'Ready for Pickup';
  if (s === 'completed') return 'Completed';
  if (s === 'expired') return 'Expired';
  return s;
}
function paymentLabel(s) {
  if (!s) return 'No Payment';
  if (s === 'paid') return 'Paid';
  if (s === 'pending') return 'Pending';
  if (s === 'processing') return 'Processing';
  if (s === 'failed') return 'Failed';
  if (s === 'cancelled') return 'Cancelled';
  if (s === 'expired') return 'Expired';
  return s;
}
// Visual mapping only — the backend stays authoritative for the actual values.
function paymentTone(s) {
  if (s === 'paid') return 'paid';
  if (s === 'failed' || s === 'cancelled') return 'failed';
  if (s === 'expired') return 'expired';
  return 'pending';
}
function statusTone(s) {
  if (s === 'completed') return 'completed';
  if (s === 'ready_pickup') return 'readypickup';
  if (s === 'expired') return 'expired';
  if (s === 'preparing') return 'preparing';
  return 'processing';
}

/**
 * Fulfillment action allowed by the backend transition graph
 * (pending → preparing → ready_pickup → completed). No delete/cancel/refund
 * exists in the backend, so none is invented here.
 */
function actionFor(s) {
  const paid = s.payment_status === 'paid';
  if (!paid) return { label: null, blocked: 'Payment must be paid first' };
  if (s.status === 'pending') return { label: 'Start Preparing', next: 'preparing', title: 'Start preparing this order?', body: `Start preparing "${s.item}" for ${s.buyer}?` };
  if (s.status === 'preparing') return { label: 'Ready for Pickup', next: 'ready_pickup', title: 'Mark as ready for pickup?', body: `"${s.item}" will be marked ready for pickup and the customer will be notified.` };
  if (s.status === 'ready_pickup') return { label: 'Confirm Pickup', next: 'completed', title: 'Confirm pickup?', body: `Confirm that ${s.buyer} has picked up "${s.item}"?` };
  return { label: null };
}

function orderRef(s) { return s.transaction_code || String(s.id || '').slice(0, 8).toUpperCase(); }

export default function WonLotsOrders() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [details, setDetails] = useState(null); // selected order id (never a stale snapshot)
  const [menuFor, setMenuFor] = useState(null);
  const [confirm, setConfirm] = useState(null); // { id, nextStatus, title, body }
  const [updating, setUpdating] = useState(null);
  const showToast = useToast();
  const reqSeq = useRef(0);

  const refresh = useCallback(async ({ background = false } = {}) => {
    const seq = ++reqSeq.current;
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const rows = await apiFetch('/shop-owner/sales');
      if (seq !== reqSeq.current) return; // stale response never overwrites newer state
      setSales(Array.isArray(rows) ? rows : []);
      setLoadError('');
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setLoadError(e.message || 'Unable to load your orders.');
    } finally {
      if (seq === reqSeq.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleStatus = async () => {
    if (!confirm) return;
    setUpdating(confirm.id);
    setMenuFor(null);
    try {
      await apiFetch(`/shop-owner/orders/${confirm.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: confirm.nextStatus }),
      });
      showToast(
        confirm.nextStatus === 'preparing'
          ? 'Order is now preparing'
          : confirm.nextStatus === 'ready_pickup'
            ? 'Order ready for pickup — customer notified'
            : 'Pickup confirmed'
      );
      setConfirm(null);
      // Background revalidate: keep existing rows visible (no full skeleton flash).
      await refresh({ background: true });
    } catch (e) {
      showToast(e.message || 'Unable to update this order. Please try again.');
    } finally {
      setUpdating(null);
    }
  };

  // ── search / filter / sort / paginate (client-side, as designed: the endpoint
  // returns the seller's full order set, so no duplicate search route is added)
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sales.filter((s) => {
      const matchesQ =
        !term ||
        orderRef(s).toLowerCase().includes(term) ||
        String(s.id || '').toLowerCase().includes(term) ||
        (s.item || '').toLowerCase().includes(term) ||
        (s.buyer || '').toLowerCase().includes(term);
      const matchesStatus = !statusFilter || mapStatus(s.status) === statusFilter;
      return matchesQ && matchesStatus;
    });
  }, [sales, q, statusFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return filtered.slice().sort((a, b) => {
      if (sortKey === 'id') return dir * String(orderRef(a)).localeCompare(String(orderRef(b)), undefined, { numeric: true });
      const av = new Date(a.date || a.created_at || 0).getTime();
      const bv = new Date(b.date || b.created_at || 0).getTime();
      return dir * (av - bv);
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Any query change returns the seller to page 1.
  useEffect(() => { setPage(1); }, [q, statusFilter, pageSize, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  // ── KPIs: seller-wide totals over the FULL loaded dataset (never just the
  // visible page), using the backend-authoritative commission/payout fields.
  const totals = useMemo(() => {
    let totalSales = 0; let totalCommission = 0; let totalPayout = 0;
    for (const r of sales) {
      totalSales += Number(r.amount || 0);
      totalCommission += Number(r.commission || 0);
      totalPayout += Number(r.payout || 0);
    }
    return { totalSales, totalCommission, totalPayout };
  }, [sales]);

  // Selected order always resolved from the freshest list data by id.
  const selectedOrder = details ? sales.find((s) => s.id === details.id) || null : null;

  const sortIndicator = (key) =>
    sortKey === key ? (sortDir === 'asc' ? 'asc' : 'desc') : 'none';

  const renderSkeleton = () => (
    <SkeletonRegion label="Loading your orders" className="wlo">
      <div className="wlo-toolbar">
        <div className="wlo-search"><Skeleton w="42%" h={14} /></div>
        <Skeleton w={150} h={40} r={10} />
      </div>
      <div className="wlo-kpis">
        {[0, 1, 2].map((i) => (
          <div className={`wlo-kpi${i === 2 ? ' wlo-kpi--dark' : ''}`} key={i}>
            <SkeletonCircle size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton w="52%" h={10} />
              <Skeleton w="68%" h={24} style={{ marginTop: 10 }} />
              <Skeleton w="46%" h={10} style={{ marginTop: 8 }} />
            </div>
          </div>
        ))}
      </div>
      <div className="wlo-tablecard">
        <table className="wlo-table">
          <thead>
            <tr>{['Order Id', 'Item', 'Buyer', 'Sale Amount', 'Commission (10%)', 'Your Payout (90%)', 'Payment', 'Status', 'Action', 'Date'].map((h) => (
              <th key={h}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} aria-hidden="true">
                <td><Skeleton w="74px" h={13} /></td>
                <td>
                  <span className="wlo-item">
                    <Skeleton w={38} h={38} r={8} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <Skeleton w="78%" h={12} />
                      <Skeleton w="46%" h={10} style={{ marginTop: 6 }} />
                    </span>
                  </span>
                </td>
                <td><Skeleton w="86px" h={13} /></td>
                <td><Skeleton w="62px" h={13} /></td>
                <td><Skeleton w="54px" h={13} /></td>
                <td><Skeleton w="62px" h={13} /></td>
                <td><Skeleton w={72} h={20} r="999px" /></td>
                <td><Skeleton w={86} h={20} r="999px" /></td>
                <td><Skeleton w={112} h={28} r={9} /></td>
                <td><Skeleton w="88px" h={13} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SkeletonRegion>
  );

  return (
    <div className="panel wlo">
      {loading ? renderSkeleton() : (
        <>
          {/* ── search + status ─────────────────────────────────────────── */}
          <div className="wlo-toolbar">
            <div className="wlo-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search sales, buyers, items, or order ID..."
                aria-label="Search sales, buyers, items, or order ID"
              />
            </div>
            <select
              className="wlo-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All Status</option>
              <option value="processing">Processing</option>
              <option value="preparing">Preparing</option>
              <option value="ready">Ready for Pickup</option>
              <option value="completed">Completed</option>
              <option value="expired">Expired</option>
            </select>
          </div>

          {/* ── KPIs (backend-authoritative amounts) ─────────────────────── */}
          <div className="wlo-kpis">
            <div className="wlo-kpi">
              <span className="wlo-kpi__icon" aria-hidden="true"><TrendingUp size={18} /></span>
              <div>
                <p className="wlo-kpi__label">Total Sales</p>
                <p className="wlo-kpi__value">{peso(totals.totalSales)}</p>
                <p className="wlo-kpi__sub">100% — all completed sales</p>
              </div>
            </div>
            <div className="wlo-kpi">
              <span className="wlo-kpi__icon" aria-hidden="true"><Percent size={18} /></span>
              <div>
                <p className="wlo-kpi__label">Platform Commission (10%)</p>
                <p className="wlo-kpi__value wlo-kpi__value--gold">{peso(totals.totalCommission)}</p>
                <p className="wlo-kpi__sub">ATANY keeps 10%</p>
              </div>
            </div>
            <div className="wlo-kpi wlo-kpi--dark">
              <span className="wlo-kpi__icon" aria-hidden="true"><Wallet size={18} /></span>
              <div>
                <p className="wlo-kpi__label">Your Total Payout (90%)</p>
                <p className="wlo-kpi__value">{peso(totals.totalPayout)}</p>
                <p className="wlo-kpi__sub">You receive 90%</p>
              </div>
            </div>
          </div>

          {/* ── table ───────────────────────────────────────────────────── */}
          {loadError ? (
            <div className="wlo-state" role="alert">
              <p className="wlo-state__title">Unable to load your orders.</p>
              <p className="wlo-state__sub">{loadError}</p>
              <button type="button" className="btn btn-outline" onClick={() => refresh()}>Retry</button>
            </div>
          ) : (
            <div className="wlo-tablecard">
              <div className="table-wrap">
                <table className="wlo-table">
                  <caption className="sr-only">Won lots and orders</caption>
                  <thead>
                    <tr>
                      <th aria-sort={sortIndicator('id')}>
                        <button type="button" className="wlo-sort" onClick={() => toggleSort('id')}>
                          Order Id<span aria-hidden="true" className={`wlo-sort__icon${sortKey === 'id' ? ' is-on' : ''}`}>⇅</span>
                        </button>
                      </th>
                      <th>Item</th>
                      <th>Buyer</th>
                      <th>Sale Amount</th>
                      <th>Commission (10%)</th>
                      <th>Your Payout (90%)</th>
                      <th>Payment</th>
                      <th>Status</th>
                      <th>Action</th>
                      <th aria-sort={sortIndicator('date')}>
                        <button type="button" className="wlo-sort" onClick={() => toggleSort('date')}>
                          Date<span aria-hidden="true" className={`wlo-sort__icon${sortKey === 'date' ? ' is-on' : ''}`}>⇅</span>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length ? pageRows.map((s) => {
                      const act = actionFor(s);
                      const { date, time } = formatDateParts(s.date || s.created_at);
                      return (
                        <tr key={s.id} data-testid={`order-row-${s.id}`}>
                          <td className="wlo-orderid">{orderRef(s)}</td>
                          <td>
                            <span className="wlo-item">
                              <span className="wlo-item__thumb">
                                {s.item_image ? (
                                  <img src={s.item_image} alt="" loading="lazy" />
                                ) : (
                                  <span className="wlo-item__ph" aria-hidden="true">◇</span>
                                )}
                              </span>
                              <span className="wlo-item__meta">
                                <span className="wlo-item__name" title={s.item}>{s.item}</span>
                                <span className="wlo-item__cat">{s.category || 'Jewelry'}</span>
                              </span>
                            </span>
                          </td>
                          <td>
                            {s.buyer}
                            {Number(s.winner_rank) > 1 && (
                              <span className="wlo-reassigned" title="The original winner's payment window expired and this item was reassigned">
                                Reassigned winner
                              </span>
                            )}
                            {s.payment_deadline && String(s.payment_status || '').toLowerCase() !== 'paid' && (
                              <span className="wlo-deadline" title="Payment deadline for the current eligible winner">
                                Payment due {formatDeadline(new Date(s.payment_deadline))}
                              </span>
                            )}
                          </td>
                          <td>{peso(s.amount)}</td>
                          <td>{peso(s.commission)}</td>
                          <td className="wlo-payout">{peso(s.payout)}</td>
                          <td><span className={`wlo-badge wlo-badge--${paymentTone(s.payment_status)}`}>{paymentLabel(s.payment_status)}</span></td>
                          <td><span className={`wlo-badge wlo-badge--${statusTone(s.status)}`}>{statusLabel(s.status)}</span></td>
                          <td>
                            <span className="wlo-actions">
                              {/* View is TEXT ONLY — no eye icon (approved reference) */}
                              <button
                                type="button"
                                className="wlo-btn-view"
                                onClick={() => setDetails({ id: s.id })}
                                aria-label={`View ${orderRef(s)}`}
                              >
                                View
                              </button>
                              <span className="wlo-menu">
                                <button
                                  type="button"
                                  className="wlo-menu__btn"
                                  onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}
                                  aria-label={`More actions for ${orderRef(s)}`}
                                  aria-expanded={menuFor === s.id}
                                  aria-haspopup="menu"
                                >
                                  <MoreVertical size={16} strokeWidth={2} aria-hidden="true" />
                                </button>
                                {menuFor === s.id && (
                                  <span className="wlo-menu__pop" role="menu">
                                    {act.label ? (
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => { setConfirm({ id: s.id, nextStatus: act.next, title: act.title, body: act.body }); setMenuFor(null); }}
                                      >
                                        {act.label}
                                      </button>
                                    ) : act.blocked ? (
                                      <span role="menuitem" aria-disabled="true" className="is-disabled">{act.blocked}</span>
                                    ) : (
                                      <span role="menuitem" aria-disabled="true" className="is-disabled">No actions available</span>
                                    )}
                                  </span>
                                )}
                              </span>
                            </span>
                          </td>
                          <td>
                            <span className="wlo-date">
                              <span className="wlo-date__d">{date}</span>
                              <span className="wlo-date__t">{time}</span>
                            </span>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={10}>
                          <div className="wlo-state">
                            <p className="wlo-state__title">{sales.length === 0 ? 'No sales yet.' : 'No sales match your filters.'}</p>
                            <p className="wlo-state__sub">
                              {sales.length === 0 ? 'Won lots and orders will appear here.' : 'Try adjusting your search or status filter.'}
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* ── pagination ───────────────────────────────────────────── */}
              <div className="wlo-pager">
                <span className="wlo-pager__count" aria-live="polite">
                  {sorted.length} sale{sorted.length === 1 ? '' : 's'}
                </span>
                <div className="wlo-pager__controls">
                  <button
                    type="button"
                    className="wlo-page"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    aria-label="Previous page"
                  >
                    ‹
                  </button>
                  <span className="wlo-page is-current" aria-current="page">{safePage}</span>
                  <button
                    type="button"
                    className="wlo-page"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    aria-label="Next page"
                  >
                    ›
                  </button>
                  <select
                    className="wlo-pagesize"
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    aria-label="Rows per page"
                  >
                    {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ── payout note ──────────────────────────────────────────────── */}
          <div className="wlo-note">
            <span className="wlo-note__head">
              <Info size={15} strokeWidth={2.2} aria-hidden="true" />
              <span>
              <b>Payout note:</b> ATANY keeps <b>10% platform commission</b> from each completed sale.
              You receive <b>90%</b> of the Sale Amount. Payment must be <b>Paid</b> before <b>Start Preparing</b>.
              </span>
            </span>
            <p className="wlo-note__formula">Sale Amount (100%) = Commission (10%) + Payout (90%).</p>
          </div>

          {/* ── order details (always resolved from fresh data by id) ────── */}
          <Modal
            open={!!selectedOrder}
            onClose={() => setDetails(null)}
            title={`Order ${selectedOrder ? orderRef(selectedOrder) : ''}`}
            className="wlo-details"
          >
            {selectedOrder && (
              <div className="wlo-details__grid">
                <div className="wlo-details__media">
                  <div className="wlo-details__img">
                    {selectedOrder.item_image ? (
                      <img src={selectedOrder.item_image} alt={selectedOrder.item} />
                    ) : (
                      <span className="wlo-item__ph wlo-item__ph--lg" aria-hidden="true">◇</span>
                    )}
                  </div>
                  <p className="wlo-details__name">{selectedOrder.item}</p>
                  <p className="wlo-details__cat">{selectedOrder.category || 'Jewelry'}</p>
                </div>
                <dl className="wlo-details__rows">
                  <div><dt>Order reference</dt><dd>{orderRef(selectedOrder)}</dd></div>
                  <div><dt>Buyer</dt><dd>{selectedOrder.buyer}</dd></div>
                  <div><dt>Sale amount</dt><dd>{peso(selectedOrder.amount)}</dd></div>
                  <div><dt>Platform commission (10%)</dt><dd>{peso(selectedOrder.commission)}</dd></div>
                  <div><dt>Your payout (90%)</dt><dd className="wlo-payout">{peso(selectedOrder.payout)}</dd></div>
                  <div><dt>Payment status</dt><dd>{paymentLabel(selectedOrder.payment_status)}</dd></div>
                  {selectedOrder.payment_method && (
                    <div><dt>Payment method</dt><dd>{selectedOrder.payment_method}</dd></div>
                  )}
                  <div><dt>Order status</dt><dd>{statusLabel(selectedOrder.status)}</dd></div>
                  {selectedOrder.branch_name && (
                    <div><dt>Pickup branch</dt><dd>{selectedOrder.branch_name}</dd></div>
                  )}
                  <div>
                    <dt>Order date</dt>
                    <dd>{formatDateParts(selectedOrder.date || selectedOrder.created_at).date} {formatDateParts(selectedOrder.date || selectedOrder.created_at).time}</dd>
                  </div>
                  {selectedOrder.paid_at && (
                    <div><dt>Paid at</dt><dd>{formatDateParts(selectedOrder.paid_at).date} {formatDateParts(selectedOrder.paid_at).time}</dd></div>
                  )}
                </dl>
              </div>
            )}
          </Modal>

          {/* ── fulfillment action confirmation ──────────────────────────── */}
          <Modal
            open={!!confirm}
            onClose={() => setConfirm(null)}
            title={confirm?.title}
            footer={
              <>
                <button className="btn btn-outline" onClick={() => setConfirm(null)} disabled={!!updating}>Cancel</button>
                <button className="btn btn-primary" onClick={handleStatus} disabled={!!updating}>{updating ? 'Updating…' : 'Confirm'}</button>
              </>
            }
          >
            <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{confirm?.body}</p>
          </Modal>
        </>
      )}
    </div>
  );
}