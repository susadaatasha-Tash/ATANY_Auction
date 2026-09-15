// frontend/src/roles/shop-owner/pages/SalesPayouts.jsx
// GET /shop-owner/sales with fulfillment actions: pending→preparing→ready_pickup→completed (payment gated)
import { useState, useEffect } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { Modal } from '../../../shared/components/Modal';

function peso(n) { return '₱' + Number(n).toLocaleString(); }
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

export default function SalesPayouts() {
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
      showToast(e.message || 'Failed to load sales');
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
      <div className="table-wrap">
        <table>
          <thead><tr><th>Order ID</th><th>Item</th><th>Buyer</th><th>Sale Amount</th><th>Your Payout</th><th>Payment</th><th>Status</th><th>Action</th><th>Date</th></tr></thead>
          <tbody>{filtered.length ? filtered.map((s) => {
            const displayStatus = mapStatus(s.status);
            const act = actionFor(s);
            const isPayPending = s.payment_status !== 'paid';
            return (
              <tr key={s.id}>
                <td className="cell-main">{s.transaction_code || s.id.slice(0,8).toUpperCase()}</td>
                <td>{s.item}</td>
                <td>{s.buyer}</td>
                <td>{peso(s.amount)}</td>
                <td className="cell-main">{peso(s.payout ?? Math.round(s.amount * 0.9))}</td>
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
          }) : <tr><td colSpan={9}><div className="empty-state"><p>No sales yet.</p></div></td></tr>}</tbody>
        </table>
      </div>
      <div className="pager"><span>{filtered.length} sale{filtered.length===1?'':'s'}</span></div>
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)', background: 'rgba(199,166,106,.06)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
        <b style={{ color: 'var(--navy)' }}>Payout note:</b> Your Payout is <b>90%</b> of Sale Amount (10% platform commission). Payment must be <b>Paid</b> before <b>Start Preparing</b>.
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
