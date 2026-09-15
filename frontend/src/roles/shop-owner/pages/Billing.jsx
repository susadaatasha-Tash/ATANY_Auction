// frontend/src/roles/shop-owner/pages/Billing.jsx
// Seller billing page — platform maintenance fees
// GET /billing/me
import { useState, useEffect } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';

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

const statusLabels = {
  pending: 'Pending',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

export default function Billing() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const showToast = useToast();

  useEffect(() => {
    (async () => {
      try {
        const rows = await apiFetch('/billing/me');
        setRecords(Array.isArray(rows) ? rows : []);
      } catch (e) {
        showToast(e.message || 'Failed to load billing records');
        setRecords([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalDue = records
    .filter(r => r.status === 'pending' || r.status === 'overdue')
    .reduce((sum, r) => sum + (r.amount || 0), 0);
  const totalPaid = records
    .filter(r => r.status === 'paid')
    .reduce((sum, r) => sum + (r.amount || 0), 0);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240 }}>
        <div style={{ fontSize: 14, color: 'var(--muted, #6b7280)' }}>Loading billing records...</div>
      </div>
    );
  }

  return (
    <>
      {/* Summary cards */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="kpi-card">
          <div className="kpi-value" style={{ color: 'var(--warn)' }}>{peso(totalDue)}</div>
          <div className="kpi-label">Total Due</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value" style={{ color: 'var(--success)' }}>{peso(totalPaid)}</div>
          <div className="kpi-label">Total Paid</div>
        </div>
      </div>

      {/* Billing table */}
      <div className="panel">
        <div className="panel-head">
          <div><h2>Billing Records</h2><p>Platform maintenance fees and your payment history.</p></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Billing Period</th>
                <th>Amount</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Paid At</th>
                <th>Payment Reference</th>
              </tr>
            </thead>
            <tbody>
              {records.length ? records.map((r) => {
                const color = statusColors[r.status] || statusColors.pending;
                const label = statusLabels[r.status] || r.status;
                return (
                  <tr key={r.id}>
                    <td className="cell-main">{r.billing_period || r.period || '—'}</td>
                    <td>{peso(r.amount)}</td>
                    <td>{formatDate(r.due_date)}</td>
                    <td>
                      <span className={`badge ${r.status}`}>{statusLabels[r.status] || r.status}</span>
                    </td>
                    <td>{formatDate(r.paid_at)}</td>
                    <td>{r.payment_reference || '—'}</td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <p>No billing records yet.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span>{records.length} record{records.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </>
  );
}
