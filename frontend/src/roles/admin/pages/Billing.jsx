// frontend/src/roles/admin/pages/Billing.jsx
// Admin billing monitoring — seller platform maintenance fees.
// GET /billing?status=&seller_id=  PATCH /billing/:id/pay
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

const statusColors = {
  pending: { bg: '#fef3c7', text: '#92400e' },
  paid: { bg: '#d1fae5', text: '#065f46' },
  overdue: { bg: '#fee2e2', text: '#991b1b' },
  cancelled: { bg: '#e5e7eb', text: '#374151' },
};
const statusLabels = { pending: 'Pending', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled' };
const statusOptions = ['all', 'pending', 'paid', 'overdue', 'cancelled'];

export default function AdminBilling() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [payModal, setPayModal] = useState(null); // record being marked paid
  const [payRef, setPayRef] = useState('');
  const [paying, setPaying] = useState(false);
  const showToast = useToast();

  const refresh = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const qs = params.toString();
      const rows = await apiFetch('/billing' + (qs ? `?${qs}` : ''));
      setRecords(Array.isArray(rows) ? rows : []);
    } catch (e) {
      showToast(e.message || 'Failed to load billing records');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [statusFilter]);

  const filtered = useMemo(() => {
    if (!search.trim()) return records;
    const q = search.toLowerCase();
    return records.filter(r =>
      (r.seller_name || '').toLowerCase().includes(q) ||
      (r.shop_name || '').toLowerCase().includes(q) ||
      (r.billing_period || '').toLowerCase().includes(q)
    );
  }, [records, search]);

  const totalPending = records.filter(r => r.status === 'pending').reduce((s, r) => s + (r.amount || 0), 0);
  const totalOverdue = records.filter(r => r.status === 'overdue').reduce((s, r) => s + (r.amount || 0), 0);
  const totalPaid = records.filter(r => r.status === 'paid').reduce((s, r) => s + (r.amount || 0), 0);
  const totalAll = records.reduce((s, r) => s + (r.amount || 0), 0);

  const openPayModal = (record) => { setPayModal(record); setPayRef(''); };
  const closePayModal = () => { setPayModal(null); setPayRef(''); };

  const confirmPay = async () => {
    if (!payModal) return;
    setPaying(true);
    try {
      await apiFetch(`/billing/${payModal.id}/pay`, {
        method: 'PATCH',
        body: JSON.stringify({ payment_reference: payRef || undefined }),
      });
      showToast('Billing record marked as paid');
      closePayModal();
      refresh();
    } catch (e) {
      showToast(e.message || 'Failed to mark as paid');
    } finally {
      setPaying(false);
    }
  };

  return (
    <>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <SummaryCard label="Total Pending" value={peso(totalPending)} color="#92400e" bg="#fef3c7" />
        <SummaryCard label="Total Overdue" value={peso(totalOverdue)} color="#991b1b" bg="#fee2e2" />
        <SummaryCard label="Total Paid" value={peso(totalPaid)} color="#065f46" bg="#d1fae5" />
        <SummaryCard label="All Records" value={peso(totalAll)} color="#374151" bg="#f3f4f6" />
      </div>

      {/* Table panel */}
      <div className="panel">
        <div className="panel-head">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2>Seller Billing & Maintenance</h2>
              <p>Platform maintenance fees owed by sellers. Search, filter, and mark payments received.</p>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="search-input"
                placeholder="Search seller, shop, or period..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 220 }}
              />
              <select
                className="search-input"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ width: 140 }}
              >
                {statusOptions.map(s => (
                  <option key={s} value={s}>{s === 'all' ? 'All Status' : statusLabels[s]}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Seller</th>
                <th>Shop</th>
                <th>Billing Period</th>
                <th>Amount</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Paid At</th>
                <th>Payment Ref</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9}><div className="empty-state"><p>No billing records found.</p></div></td></tr>
              ) : filtered.map((r) => {
                const color = statusColors[r.status] || statusColors.pending;
                const label = statusLabels[r.status] || r.status;
                const canPay = r.status === 'pending' || r.status === 'overdue';
                return (
                  <tr key={r.id}>
                    <td className="cell-main">{r.seller_name || '—'}</td>
                    <td>{r.shop_name || '—'}</td>
                    <td>{r.billing_period || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{peso(r.amount)}</td>
                    <td>{formatDate(r.due_date)}</td>
                    <td>
                      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: color.bg, color: color.text }}>
                        {label}
                      </span>
                    </td>
                    <td>{formatDate(r.paid_at)}</td>
                    <td>{r.payment_reference || '—'}</td>
                    <td>
                      {canPay ? (
                        <button className="btn btn-sm btn-primary" onClick={() => openPayModal(r)}>
                          Mark Paid
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span>{filtered.length} record{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {/* Mark as Paid modal */}
      <Modal
        open={!!payModal}
        onClose={closePayModal}
        title="Mark Billing as Paid"
        footer={
          <>
            <button className="btn btn-outline" onClick={closePayModal}>Cancel</button>
            <button className="btn btn-primary" onClick={confirmPay} disabled={paying}>
              {paying ? 'Saving...' : 'Confirm Payment'}
            </button>
          </>
        }
      >
        {payModal && (
          <div>
            <p style={{ marginBottom: 16, color: '#374151' }}>
              Mark <strong>{peso(payModal.amount)}</strong> for <strong>{payModal.billing_period}</strong> as paid?
            </p>
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#374151' }}>Payment Reference (optional)</label>
              <input
                className="search-input"
                placeholder="e.g. GCASH-12345, BANK-REF-001"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function SummaryCard({ label, value, color, bg }) {
  return (
    <div style={{ flex: 1, minWidth: 170, padding: '20px 24px', borderRadius: 12, background: bg, border: '1px solid var(--border, #e5e7eb)' }}>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
