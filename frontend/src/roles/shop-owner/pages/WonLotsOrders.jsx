// frontend/src/roles/shop-owner/pages/WonLotsOrders.jsx
// Won Lots & Orders — order table for the seller's own auctions.
// GET /shop-owner/sales returns order rows (seller-scoped by shop_id).
import { useState, useEffect } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { Modal } from '../../../shared/components/Modal';

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }
function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return isNaN(date) ? d : date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}
function mapStatus(s) {
  if (s === 'pending') return 'processing';
  if (s === 'preparing') return 'preparing';
  if (s === 'ready_pickup') return 'ready';
  if (s === 'completed') return 'completed';
  return s;
}
function statusLabel(s) {
  if (s === 'pending') return 'Processing';
  if (s === 'preparing') return 'Preparing';
  if (s === 'ready_pickup') return 'Ready for Pickup';
  if (s === 'completed') return 'Completed';
  return s;
}
function paymentLabel(s) {
  if (!s) return 'No Payment';
  if (s === 'paid') return 'Paid';
  if (s === 'pending') return 'Pending';
  if (s === 'failed') return 'Failed';
  if (s === 'expired') return 'Expired';
  return s;
}

export default function WonLotsOrders() {
  const [sales, setSales] = useState([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [confirm, setConfirm] = useState(null); // { id, nextStatus, title, body }
  const [updating, setUpdating] = useState(null);
  const showToast = useToast();

  const refresh = async () => {
    try {
      const rows = await apiFetch('/shop-owner/sales');
      setSales(Array.isArray(rows) ? rows : []);
    } catch (e) {
      showToast(e.message || 'Failed to load orders');
      setSales([]);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleStatus = async () => {
    if (!confirm) return;
    setUpdating(confirm.id);
    try {
      await apiFetch(`/shop-owner/orders/${confirm.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: confirm.nextStatus }) });
      showToast(confirm.nextStatus === 'preparing' ? 'Order is now preparing' : confirm.nextStatus === 'ready_pickup' ? 'Order ready for pickup — customer notified' : 'Pickup confirmed');
      setConfirm(null);
      await refresh();
    } catch (e) {
      showToast(e.message || 'Unable to update this order. Please try again.');
    } finally {
      setUpdating(null);
    }
  };

  const filtered = sales.filter(s => {
    const code = (s.transaction_code || s.id || '').toLowerCase();
    const matchesQ = !q || code.includes(q.toLowerCase()) || s.id.toLowerCase().includes(q.toLowerCase()) || (s.item || '').toLowerCase().includes(q.toLowerCase()) || (s.buyer || '').toLowerCase().includes(q.toLowerCase());
    const displayStatus = mapStatus(s.status);
    const matchesStatus = !statusFilter || displayStatus === statusFilter;
    return matchesQ && matchesStatus;
  });

  const actionFor = (s) => {
    const pay = s.payment_status;
    const st = s.status;
    if (pay !== 'paid') return { label: null, disabled: true, reason: 'Payment Pending' };
    if (st === 'pending') return { label: 'Start Preparing', next: 'preparing', title: 'Start preparing this order?', body: `Start preparing "${s.item}" for ${s.buyer}?` };
    if (st === 'preparing') return { label: 'Ready for Pickup', next: 'ready_pickup', title: 'Mark as ready for pickup?', body: `"${s.item}" will be marked ready for pickup at branch and the customer will be notified.` };
    if (st === 'ready_pickup') return { label: 'Confirm Pickup', next: 'completed', title: 'Confirm pickup?', body: `Confirm that ${s.buyer} has picked up "${s.item}"?` };
    return { label: null };
  };

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search sales..." />
        </div>
        <select className="filter-select" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="processing">Processing</option>
          <option value="preparing">Preparing</option>
          <option value="ready">Ready for Pickup</option>
          <option value="completed">Completed</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 12, margin: '16px 0', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 150, background: 'var(--ivory)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>Total Sales</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--navy)', marginTop: 4 }}>{pso(sales.reduce((s, r) => s + Number(r.amount || 0), 0))}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>100% — all completed sales</div>
        </div>
        <div style={{ flex: 1, minWidth: 150, background: 'var(--ivory)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>Platform Commission (10%)</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#8a6d2b', marginTop: 4 }}>{pso(sales.reduce((s, r) => s + Number(r.commission ?? Math.round(Number(r.amount || 0) * 0.10)), 0))}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>ATANY keeps 10%</div>
        </div>
        <div style={{ flex: 1, minWidth: 150, background: 'var(--navy)', borderRadius: 12, padding: '14px 16px', color: '#fff' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', opacity: .8 }}>Your Total Payout (90%)</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{pso(sales.reduce((s, r) => s + Number(r.payout ?? Math.round(Number(r.amount || 0) * 0.9)), 0))}</div>
          <div style={{ fontSize: 11, opacity: .7, marginTop: 2 }}>You receive 90%</div>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Order ID</th><th>Item</th><th>Buyer</th><th>Sale Amount</th><th>Commission (10%)</th><th>Your Payout (90%)</th><th>Payment</th><th>Status</th><th>Action</th><th>Date</th></tr></thead>
          <tbody>{filtered.length ? filtered.map((s) => {
            const displayStatus = mapStatus(s.status);
            const act = actionFor(s);
            const isPayPending = s.payment_status !== 'paid';
            return (
              <tr key={s.id}>
                <td className="cell-main">{s.transaction_code || s.id.slice(0,8).toUpperCase()}</td>
                <td>{s.item}</td>
                <td>{s.buyer}</td>
                <td>{pso(s.amount)}</td>
                <td>{pso(s.commission ?? Math.round(Number(s.amount) * 0.10))}</td>
                <td className="cell-main">{pso(s.payout ?? Math.round(Number(s.amount) * 0.9))}</td>
                <td><span className={`badge ${s.payment_status === 'paid' ? 'paid' : s.payment_status === 'failed' ? 'failed' : 'pending'}`}>{paymentLabel(s.payment_status)}</span></td>
                <td><span className={`badge ${displayStatus}`}>{statusLabel(s.status)}</span></td>
                <td>
                  {act.label ? (
                    <button
                      className="btn btn-primary"
                      style={{ height: 30, padding: '0 10px', fontSize: 11 }}
                      disabled={!!updating}
                      onClick={() => setConfirm({ id: s.id, nextStatus: act.next, title: act.title, body: act.body })}
                    >
                      {updating === s.id ? '…' : act.label}
                    </button>
                  ) : isPayPending ? (
                    <span className="badge pending">Payment Pending</span>
                  ) : s.status === 'completed' ? (
                    <span className="badge completed">Completed</span>
                  ) : null}
                </td>
                <td>{formatDate(s.date || s.created_at)}</td>
              </tr>
            );
          }) : <tr><td colSpan={10}><div className="empty-state"><p>No orders yet.</p></div></td></tr>}</tbody>
        </table>
      </div>
      <div className="pager"><span>{filtered.length} order{filtered.length===1?'':'s'}</span></div>
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)', background: 'rgba(199,166,106,.06)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
        <b style={{ color: 'var(--navy)' }}>Payout note:</b> ATANY keeps <b>10% platform commission</b> from each completed sale. You receive <b>90%</b> of the Sale Amount. Payment must be <b>Paid</b> before <b>Start Preparing</b>. &nbsp; Sale Amount (100%) = Commission (10%) + Payout (90%).
      </div>

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
    </div>
  );
}

function pso(n) { return '₱' + Number(n || 0).toLocaleString(); }
