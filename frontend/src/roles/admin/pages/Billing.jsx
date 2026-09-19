// frontend/src/roles/admin/pages/Billing.jsx
// Admin Seller Subscriptions — monitor monthly seller subscriptions and payments
import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { Modal } from '../../../shared/components/Modal';

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }
function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return isNaN(date) ? d : date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

const statusLabels = { pending: 'Pending', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled', active: 'Active' };
const statusOptions = ['all', 'paid', 'pending', 'overdue', 'cancelled'];

export default function AdminBilling() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const showToast = useToast();

  const refresh = async () => {
    setLoading(true);
    try {
      const rows = await apiFetch('/billing');
      setRecords(Array.isArray(rows) ? rows : []);
    } catch (e) {
      showToast(e.message || 'Failed to load subscriptions');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const openDetails = async (rec) => {
    setSelected(rec);
    try {
      const rows = await apiFetch(`/billing?seller_id=${rec.seller_id}`);
      setHistory(Array.isArray(rows) ? rows : []);
    } catch { setHistory([rec]); }
  };

  const filtered = useMemo(() => {
    let list = records;
    if (statusFilter !== 'all') {
      const map = { active: 'paid', pending: 'pending', overdue: 'overdue', cancelled: 'cancelled', paid: 'paid' };
      const target = map[statusFilter] || statusFilter;
      list = list.filter(r => r.status === target);
    }
    if (branchFilter !== 'all') list = list.filter(r => (r.branch_name || '') === branchFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        (r.seller_name || '').toLowerCase().includes(q) ||
        (r.seller_email || '').toLowerCase().includes(q) ||
        (r.shop_name || '').toLowerCase().includes(q) ||
        (r.branch_name || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [records, search, statusFilter, branchFilter]);

  const branches = useMemo(() => [...new Set(records.map(r => r.branch_name).filter(Boolean))], [records]);
  const totalSellers = useMemo(() => new Set(records.map(r => r.seller_id)).size, [records]);
  const activeCount = records.filter(r => r.status === 'paid').length;
  const pendingCount = records.filter(r => r.status === 'pending').length;
  const overdueCount = records.filter(r => r.status === 'overdue').length;
  const revenue = records.filter(r => r.status === 'paid').reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <SummaryCard label="Total Sellers" value={totalSellers} color="#1a2744" bg="#f3f4f6" />
        <SummaryCard label="Active Subscriptions" value={activeCount} color="#065f46" bg="#d1fae5" />
        <SummaryCard label="Pending Payments" value={pendingCount} color="#92400e" bg="#fef3c7" />
        <SummaryCard label="Overdue" value={overdueCount} color="#991b1b" bg="#fee2e2" />
        <SummaryCard label="Subscription Revenue" value={peso(revenue)} color="#1a2744" bg="#fef9e7" />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Seller Subscriptions</h2>
            <p>Monitor monthly seller subscriptions and payments.</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="search-input" placeholder="Search seller, email, shop, branch..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
            <select className="search-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 130 }}>
              {statusOptions.map(s => <option key={s} value={s}>{s === 'all' ? 'All Status' : statusLabels[s] || s}</option>)}
            </select>
            <select className="search-input" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} style={{ width: 140 }}>
              <option value="all">All Branches</option>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Seller</th>
                <th>Shop</th>
                <th>Branch</th>
                <th>Plan</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Billing Period</th>
                <th>Next Renewal</th>
                <th>Last Payment</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10}><div className="empty-state"><p>No seller subscriptions yet.</p></div></td></tr>
              ) : filtered.map((r) => {
                const isPaid = r.status === 'paid';
                return (
                  <tr key={r.id}>
                    <td className="cell-main">{r.seller_name || '—'}<div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{r.seller_email || ''}</div></td>
                    <td>{r.shop_name || '—'}</td>
                    <td>{r.branch_name || '—'}</td>
                    <td>Monthly Seller Subscription</td>
                    <td style={{ fontWeight: 600 }}>{peso(r.amount)}</td>
                    <td><span className={`badge ${r.status}`}>{statusLabels[r.status] || r.status}</span></td>
                    <td>{r.current_period_start && r.current_period_end ? `${formatDate(r.current_period_start)} – ${formatDate(r.current_period_end)}` : r.billing_period || '—'}</td>
                    <td>{formatDate(r.current_period_end || r.due_date)}</td>
                    <td>{r.paid_at ? formatDate(r.paid_at) : '—'}</td>
                    <td><button className="btn btn-outline" style={{ height: 28, padding: '0 10px', fontSize: 11 }} onClick={() => openDetails(r)}>View Details</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pager"><span>{filtered.length} record{filtered.length === 1 ? '' : 's'}</span></div>
      </div>

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Subscription Details" footer={<button className="btn btn-outline" onClick={() => setSelected(null)}>Close</button>}>
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Seller</div><div style={{ fontWeight: 700, color: 'var(--navy)' }}>{selected.seller_name}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{selected.seller_email}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Shop</div><div style={{ fontWeight: 700 }}>{selected.shop_name}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{selected.branch_name || '—'}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Plan</div><div>Monthly Seller Subscription</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Monthly Amount</div><div style={{ fontWeight: 700 }}>{peso(selected.amount)}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Status</div><span className={`badge ${selected.status}`}>{statusLabels[selected.status] || selected.status}</span></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Next Renewal</div><div>{formatDate(selected.current_period_end || selected.due_date)}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Current Period</div><div>{selected.current_period_start && selected.current_period_end ? `${formatDate(selected.current_period_start)} – ${formatDate(selected.current_period_end)}` : selected.billing_period}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Last Payment</div><div>{selected.paid_at ? formatDate(selected.paid_at) : '—'}</div></div>
              <div style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Payment Reference</div><div style={{ fontSize: 12, wordBreak: 'break-all' }}>{selected.payment_reference || selected.paymongo_checkout_session_id || '—'}</div></div>
              {selected.paymongo_checkout_session_id && <div style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>PayMongo Checkout Session</div><div style={{ fontSize: 11, wordBreak: 'break-all', color: 'var(--muted)' }}>{selected.paymongo_checkout_session_id}</div></div>}
            </div>
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>Payment History</div>
              {history.length ? history.map(h => (
                <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
                  <span>{h.billing_period} — {formatDate(h.current_period_start || h.created_at)} – {formatDate(h.current_period_end || h.due_date)}</span>
                  <span style={{ fontWeight: 600 }}>{peso(h.amount)}</span>
                  <span className={`badge ${h.status}`} style={{ fontSize: 10 }}>{statusLabels[h.status] || h.status}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{h.paid_at ? formatDate(h.paid_at) : '—'}</span>
                </div>
              )) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>No history</div>}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function SummaryCard({ label, value, color, bg }) {
  return (
    <div style={{ flex: 1, minWidth: 140, padding: '16px 18px', borderRadius: 12, background: bg, border: '1px solid var(--border, #e5e7eb)' }}>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, marginTop: 4 }}>{typeof value === 'number' ? value : value}</div>
    </div>
  );
}
