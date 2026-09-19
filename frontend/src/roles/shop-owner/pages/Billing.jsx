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
  const [payingId, setPayingId] = useState(null);
  const showToast = useToast();

  useEffect(() => {
    (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
  }, []);

  const refresh = async () => {
    try {
      const rows = await apiFetch('/billing/me');
      setRecords(Array.isArray(rows) ? rows : []);
    } catch (e) {
      showToast(e.message || 'Failed to load billing records');
    }
  };

  const handlePay = async (id) => {
    setPayingId(id);
    try {
      const res = await apiFetch(`/billing/${id}/checkout`, { method: 'POST' });
      if (res?.checkout_url) window.location.href = res.checkout_url;
      else showToast('Checkout created');
    } catch (e) {
      showToast(e.message || 'Failed to create checkout');
    } finally {
      setPayingId(null);
    }
  };

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

  const latest = records[0] || null;
  const isActive = latest?.status === 'paid';
  const isPending = latest?.status === 'pending';
  const isOverdue = latest?.status === 'overdue';
  const subscriptionStatus = !latest ? 'none' : isActive ? 'Active' : isOverdue ? 'Expired' : isPending ? 'Pending' : latest.status;
  const statusColor = isActive ? '#065f46' : isOverdue ? '#991b1b' : '#92400e';
  const statusBg = isActive ? '#d1fae5' : isOverdue ? '#fee2e2' : '#fef3c7';

  return (
    <>
      {/* Subscription header */}
      <div className="panel" style={{ padding: '20px 22px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--gold)' }}>ATANY Seller Subscription</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--navy)', marginTop: 4 }}>Monthly Seller Subscription</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>₱1,000 / month — pay monthly to keep your shop active</div>
          </div>
          <span style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: statusBg, color: statusColor, border: '1px solid rgba(0,0,0,.06)' }}>{subscriptionStatus}</span>
        </div>
        {latest ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 16 }}>
            <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Current Billing Period</div><div style={{ fontWeight: 700, color: 'var(--navy)', marginTop: 2 }}>{latest.current_period_start && latest.current_period_end ? `${formatDate(latest.current_period_start)} – ${formatDate(latest.current_period_end)}` : latest.billing_period}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Next Renewal</div><div style={{ fontWeight: 700, color: 'var(--navy)', marginTop: 2 }}>{formatDate(latest.current_period_end || latest.due_date)}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Last Payment</div><div style={{ fontWeight: 700, color: 'var(--navy)', marginTop: 2 }}>{latest.paid_at ? formatDate(latest.paid_at) : '—'}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Payment Reference</div><div style={{ fontWeight: 600, color: 'var(--navy)', marginTop: 2, fontSize: 12 }}>{latest.payment_reference || latest.paymongo_checkout_session_id || '—'}</div></div>
          </div>
        ) : (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>Your seller subscription has not been created yet. It will be created when your seller application is approved.</div>
        )}
      </div>

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
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {records.length ? records.map((r) => {
                const label = statusLabels[r.status] || r.status;
                const isPayable = r.status === 'pending' || r.status === 'overdue';
                return (
                  <tr key={r.id}>
                    <td className="cell-main">{r.billing_period || r.period || '—'}</td>
                    <td>{peso(r.amount)}</td>
                    <td>{formatDate(r.due_date)}</td>
                    <td>
                      <span className={`badge ${r.status}`}>{label}</span>
                    </td>
                    <td>{formatDate(r.paid_at)}</td>
                    <td>{r.payment_reference || '—'}</td>
                    <td>
                      {isPayable ? (
                        <button className="btn btn-primary" style={{ height: 30, padding: '0 12px', fontSize: 11 }} disabled={payingId === r.id} onClick={() => handlePay(r.id)}>
                          {payingId === r.id ? 'Redirecting…' : 'Pay Now'}
                        </button>
                      ) : r.status === 'paid' ? (
                        <span className="badge paid">Paid</span>
                      ) : null}
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={7}>
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
