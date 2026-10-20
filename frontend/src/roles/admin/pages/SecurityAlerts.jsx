// frontend/src/roles/admin/pages/SecurityAlerts.jsx
// Rebuilt 1:1 from _legacy_html_backup/admin.html: 3 summary cards, search, 2 filters, table, review modal — wired to real data
import { useState, useEffect } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { AlertDetailModal } from '../components/AlertDetailModal';

function formatDetected(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  if (hours < 48) return 'Yesterday';
  return `${Math.floor(hours/24)} days ago`;
}

export default function SecurityAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [q, setQ] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const showToast = useToast();

  const refresh = async () => {
    try {
      const rows = await apiFetch('/admin/security-alerts');
      setAlerts(Array.isArray(rows) ? rows : []);
    } catch (e) { showToast(e.message || 'Failed to load alerts'); }
  };
  useEffect(() => { refresh(); }, []);

  const openAlerts = alerts.filter(a => a.status === 'new' || a.status === 'investigating').length;
  const highSeverity = alerts.filter(a => a.severity === 'high' && (a.status === 'new' || a.status === 'investigating')).length;
  const resolvedThisMonth = alerts.filter(a => a.status === 'resolved' && new Date(a.created_at).getMonth() === new Date().getMonth()).length;

  const filtered = alerts.filter(a => {
    const customer = a.customer || a.user_id || '';
    const matchesQ = !q || a.id.toLowerCase().includes(q.toLowerCase()) || customer.toLowerCase().includes(q.toLowerCase()) || (a.type || '').toLowerCase().includes(q.toLowerCase());
    const matchesSev = !severityFilter || a.severity === severityFilter;
    const matchesStatus = !statusFilter || a.status === statusFilter;
    return matchesQ && matchesSev && matchesStatus;
  });

  const handleStatusChange = async (id, newStatus, suspendUserId) => {
    try {
      await apiFetch(`/admin/security-alerts/${id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus, suspendUserId }) });
      showToast(`Alert ${id} ${newStatus}`);
      setSelected(null);
      await refresh();
    } catch (e) { showToast(e.message); }
  };

  return (
    <>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 22 }}>
        <div className="kpi-card">
          <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg></div></div>
          <div className="kpi-value">{openAlerts}</div><div className="kpi-label">Open Alerts</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg></div></div>
          <div className="kpi-value">{highSeverity}</div><div className="kpi-label">High Severity</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg></div></div>
          <div className="kpi-value">{resolvedThisMonth}</div><div className="kpi-label">Resolved This Month</div>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <div className="search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search alerts..." />
          </div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <select className="filter-select" value={severityFilter} onChange={(e)=>setSeverityFilter(e.target.value)}>
              <option value="">All Severity</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
            <select className="filter-select" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}>
              <option value="">All Status</option><option value="new">New</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option>
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Alert</th><th>Customer</th><th>Type</th><th>Severity</th><th>Status</th><th>Detected</th><th /></tr></thead>
            <tbody>{filtered.length ? filtered.map((a) => (
              <tr key={a.id}>
                <td className="cell-main">{a.id.slice(0,8)}</td>
                <td>{a.customer || a.user_id?.slice(0,8) || 'Unknown (Guest Checkout)'}</td>
                <td>{a.type}</td>
                <td><span className={`badge ${a.severity}`}>{a.severity.charAt(0).toUpperCase()+a.severity.slice(1)}</span></td>
                <td><span className={`badge ${a.status}`}>{a.status.charAt(0).toUpperCase()+a.status.slice(1)}</span></td>
                <td>{formatDetected(a.created_at)}</td>
                <td><button className="btn-ghost" onClick={()=>setSelected(a)}>Review</button></td>
              </tr>
            )) : <tr><td colSpan={7}><div className="empty-state"><p>No alerts — all clear.</p></div></td></tr>}</tbody>
          </table>
        </div>
        <div className="pager"><span>{filtered.length} alerts</span></div>
      </div>

      <AlertDetailModal
        alert={selected ? { ...selected, customer: selected.customer || selected.user_id || 'Unknown (Guest Checkout)', time: formatDetected(selected.created_at), trail: selected.activity_trail || [] } : null}
        open={!!selected}
        onClose={()=>setSelected(null)}
        onDismiss={(id)=>handleStatusChange(id, 'dismissed')}
        onResolve={(id)=>handleStatusChange(id, 'resolved')}
        onSuspend={(id)=>handleStatusChange(id, 'resolved', selected?.user_id)}
      />
    </>
  );
}
