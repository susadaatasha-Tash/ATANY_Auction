// frontend/src/roles/admin/pages/SellerApplications.jsx
// Admin review page for seller/shop-owner applications
import { useState, useEffect } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { Modal } from '../../../shared/components/Modal';
import { Badge } from '../../../shared/components/Badge';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

export default function SellerApplications() {
  const [applications, setApplications] = useState([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [loading, setLoading] = useState(false);
  const showToast = useToast();

  const refresh = async () => {
    try {
      const rows = await apiFetch('/admin/seller-applications');
      setApplications(rows);
    } catch (e) { showToast(e.message || 'Failed to load applications'); }
  };

  useEffect(() => { refresh(); }, []);

  const openDetail = (app) => { setSelected(app); setRejectReason(''); };
  const closeDetail = () => { setSelected(null); setRejectReason(''); };

  const handleApprove = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      await apiFetch(`/admin/seller-applications/${selected.id}/approve`, { method: 'POST' });
      showToast('Application approved');
      closeDetail();
      await refresh();
    } catch (e) { showToast(e.message || 'Failed to approve'); }
    setLoading(false);
  };

  const handleReject = async () => {
    if (!selected) return;
    if (!rejectReason.trim()) { showToast('Please provide a rejection reason'); return; }
    setLoading(true);
    try {
      await apiFetch(`/admin/seller-applications/${selected.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ rejection_reason: rejectReason.trim() }),
      });
      showToast('Application rejected');
      closeDetail();
      await refresh();
    } catch (e) { showToast(e.message || 'Failed to reject'); }
    setLoading(false);
  };

  const filtered = applications.filter(a => {
    const matchesQ = !q ||
      (a.applicant_name || '').toLowerCase().includes(q.toLowerCase()) ||
      (a.shop_name || '').toLowerCase().includes(q.toLowerCase()) ||
      (a.branch || '').toLowerCase().includes(q.toLowerCase());
    const matchesStatus = !statusFilter || a.status === statusFilter;
    return matchesQ && matchesStatus;
  });

  const detailFields = selected ? [
    { label: 'Applicant Name', value: selected.applicant_name },
    { label: 'Email', value: selected.email },
    { label: 'Phone', value: selected.phone },
    { label: 'Shop Name', value: selected.shop_name },
    { label: 'Branch', value: selected.branch },
    { label: 'Address', value: selected.address },
    { label: 'Business Type', value: selected.business_type },
    { label: 'Description', value: selected.description },
    { label: 'Date Applied', value: formatDate(selected.created_at) },
    { label: 'Status', value: selected.status },
    ...(selected.rejection_reason ? [{ label: 'Rejection Reason', value: selected.rejection_reason }] : []),
  ] : [];

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search applications..." />
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <select className="filter-select" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Applicant</th><th>Shop Name</th><th>Branch</th><th>Date Applied</th><th>Status</th></tr></thead>
          <tbody>{filtered.length ? filtered.map((a) => (
            <tr key={a.id} onClick={() => openDetail(a)} style={{ cursor:'pointer' }}>
              <td className="cell-main"><div>{a.applicant_name}</div><div style={{ fontSize:11, color:'var(--muted)', fontWeight:400 }}>{a.email}</div></td>
              <td>{a.shop_name}</td>
              <td>{a.branch}</td>
              <td>{formatDate(a.created_at)}</td>
              <td><Badge status={a.status} /></td>
            </tr>
          )) : <tr><td colSpan={5}><div className="empty-state"><p>No seller applications found.</p></div></td></tr>}</tbody>
        </table>
      </div>
      <div className="pager"><span>{filtered.length} application{filtered.length !== 1 ? 's' : ''}</span></div>

      {selected && (
        <Modal open={!!selected} onClose={closeDetail} title="Application Details"
          footer={
            selected.status === 'pending' ? (
              <>
                <button className="btn btn-outline" onClick={closeDetail} disabled={loading}>Cancel</button>
                <button className="btn" onClick={handleReject} disabled={loading}
                  style={{ background:'var(--danger)', color:'#fff' }}>Reject</button>
                <button className="btn btn-primary" onClick={handleApprove} disabled={loading}>Approve</button>
              </>
            ) : (
              <button className="btn btn-outline" onClick={closeDetail}>Close</button>
            )
          }>
          <div style={{ display:'grid', gap:12 }}>
            {detailFields.map((f) => (
              <div key={f.label}>
                <label style={{ fontSize:11, color:'var(--muted)', display:'block', marginBottom:2 }}>{f.label}</label>
                <div style={{ fontSize:14 }}>{f.value || '—'}</div>
              </div>
            ))}
            {selected.status === 'pending' && (
              <div className="form-row" style={{ marginTop:4 }}>
                <label>Rejection Reason (required to reject)</label>
                <textarea
                  value={rejectReason}
                  onChange={(e)=>setRejectReason(e.target.value)}
                  placeholder="Enter reason for rejection..."
                  rows={3}
                  style={{ resize:'vertical' }}
                />
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
