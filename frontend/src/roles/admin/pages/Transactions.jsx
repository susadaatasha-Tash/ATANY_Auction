// frontend/src/roles/admin/pages/Transactions.jsx
// admin.html:853-876 — GET /admin/transactions, PATCH /admin/transactions/:id/pay (markPaid -> orders.status ready_pickup)
import { useState, useEffect } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';


// ── 7-day winner state ───────────────────────────────────────────────────────
// A pending, unpaid winner is an ELIGIBLE winner: the item is not settled until
// payments.status = 'paid'. After payment it becomes a settled Winner.
function formatDeadline(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

export function winnerState(t) {
  const paid = String(t.payment_status || '').toLowerCase() === 'paid';
  const rank = Number(t.winner_rank) > 1 ? Number(t.winner_rank) : 1;
  const expired = String(t.status || '').toLowerCase() === 'expired';
  return {
    paid,
    rank,
    expired,
    label: paid ? 'Winner' : (expired ? 'No Eligible Winner' : 'Eligible Winner'),
    paymentLabel: paid ? 'Paid' : 'Awaiting Payment',
    deadline: t.payment_deadline || null,
  };
}

export default function Transactions({ txns: propTxns, onMarkPaid: propMarkPaid }) {
  const [txns, setTxns] = useState(propTxns || []);
  const [q, setQ] = useState('');
  const showToast = useToast();

  const refresh = async () => {
    try {
      const rows = await apiFetch('/admin/transactions');
      const mapped = rows.map(r => ({
        ...r,
        displayId: r.transaction_code || r.id,
        date: r.date ? new Date(r.date).toLocaleDateString() : r.created_at ? new Date(r.created_at).toLocaleDateString() : '—',
      }));
      setTxns(mapped);
    } catch (e) {
      showToast(e.message || 'Failed to load transactions');
    }
  };

  useEffect(() => {
    if (propTxns && propTxns.length) {
      const mapped = propTxns.map(r => ({ ...r, displayId: r.transaction_code || r.id }));
      setTxns(mapped);
    } else refresh();
  }, [propTxns]);

  const filtered = txns.filter(t =>
    !q || t.displayId?.toLowerCase().includes(q.toLowerCase()) ||
    t.id.toLowerCase().includes(q.toLowerCase()) ||
    (t.customer || '').toLowerCase().includes(q.toLowerCase()) ||
    (t.item || '').toLowerCase().includes(q.toLowerCase())
  );

  const handleMarkPaid = async (id) => {
    try {
      await apiFetch(`/admin/transactions/${id}/pay`, { method: 'PATCH' });
      showToast('Marked as paid — ready for pickup');
      await refresh();
      if (propMarkPaid) propMarkPaid(id);
    } catch (e) { showToast(e.message || 'Failed to mark paid'); }
  };

  const handleStatus = async (id, nextStatus) => {
    try {
      await apiFetch(`/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      showToast(`Order moved to ${nextStatus}`);
      await refresh();
    } catch (e) { showToast(e.message || 'Failed to update status'); }
  };

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search transactions..." />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Transaction ID</th><th>Eligible Winner</th><th>Item</th><th>Amount</th><th>Branch</th><th>Winner Status</th><th>Payment Deadline</th><th>Status</th><th>Date</th><th /></tr></thead>
          <tbody>{filtered.length ? filtered.map((t) => { const w = winnerState(t); return <tr key={t.id}><td className="cell-main">{t.displayId}</td><td><span className="tx-winner-label">{w.label}</span> {t.customer}{w.rank > 1 && <span className="tx-reassigned" title="Winner reassigned after the previous winner's payment window expired">Reassigned</span>}</td><td>{t.item}</td><td>₱{Number(t.amount).toLocaleString()}</td><td>{t.branch}</td><td><span className={`badge ${w.paymentLabel === 'Paid' ? 'paid' : 'pending'}`}>{w.paymentLabel}</span></td><td>{w.deadline && !w.paid ? formatDeadline(w.deadline) : '—'}</td><td><span className={`badge ${t.status}`}>{t.status}</span></td><td>{t.date}</td><td style={{display:'flex',gap:6}}>
            {t.status === 'pending' && <button className="btn-ghost" onClick={() => handleStatus(t.id,'preparing')}>Mark Preparing</button>}
            {t.status === 'preparing' && <button className="btn-ghost" onClick={() => handleStatus(t.id,'ready_pickup')}>Mark Ready</button>}
            {t.status === 'ready_pickup' && <button className="btn-ghost" onClick={() => handleStatus(t.id,'completed')}>Mark Picked Up</button>}
          </td></tr>; }) : <tr><td colSpan={10}><div className="empty-state"><p>No transactions yet.</p></div></td></tr>}</tbody>
        </table>
      </div>
      <div className="pager"><span>{filtered.length} transaction{filtered.length!==1?'s':''}</span></div>
    </div>
  );
}
