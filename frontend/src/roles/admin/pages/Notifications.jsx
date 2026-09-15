// frontend/src/roles/admin/pages/Notifications.jsx
// admin.html:1010-1051 — POST /admin/notifications (audience + message), GET /admin/notifications/history
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function AdminNotifications({ history = [], onSend = () => {} }) {
  const navigate = useNavigate();
  const [expandedIdx, setExpandedIdx] = useState(null);
  const handle = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    onSend({ audience: fd.get('audience'), message: fd.get('message') });
    e.target.reset();
  };
  return (
    <div>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', marginBottom: 16, background: '#fff', borderRadius: 8 }}>
        <button onClick={() => navigate('/admin')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--navy)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>← Back to Dashboard</button>
      </div>
      <div className="two-col">
        <div className="panel">
          <div className="panel-head"><div><h2>Send a Notification</h2><p>Push an update to customers, bidders, or all users.</p></div></div>
          <form onSubmit={handle} style={{ padding: 20 }}>
            <div className="form-row"><label>Audience</label><select name="audience"><option>All Users</option><option>Active Bidders</option><option>Winners Awaiting Payment</option><option>Single Branch</option></select></div>
            <div className="form-row"><label>Message</label><textarea name="message" placeholder="e.g. Your auction for the Rose Gold Bangle ends in 1 hour." required /></div>
            <button className="btn btn-primary" type="submit">Send Notification</button>
          </form>
        </div>
        <div className="panel">
          <div className="panel-head"><div><h2>Sent History</h2><p>Most recent first.</p></div></div>
          <div className="activity-list">{(history || []).length ? history.map((n, i) => {
            const isExpanded = expandedIdx === i;
            return (
              <div key={i} onClick={() => setExpandedIdx(isExpanded ? null : i)} className="activity-item" style={{ cursor: 'pointer', padding: 12, border: '1px solid var(--line)', borderRadius: 8, marginBottom: 8, background: isExpanded ? '#f0fdf4' : '#fff' }}>
                <div className="activity-text"><b>{n.audience}:</b> {n.message}</div>
                <div className="activity-time">{n.time || (n.created_at && new Date(n.created_at).toLocaleString())} {isExpanded ? '▲' : '▼'}</div>
                {isExpanded && (
                  <div style={{ marginTop: 8, padding: 8, background: '#fff', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12.5 }}>
                    <div>Full message: {n.message}</div>
                    <div style={{ marginTop: 4, color: 'var(--muted)' }}>Audience: {n.audience || n.type}</div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                      <button className="btn btn-outline" style={{ fontSize: 12 }} onClick={(e)=>{e.stopPropagation(); navigate('/admin/users');}}>View Users</button>
                    </div>
                  </div>
                )}
              </div>
            );
          }) : <div className="empty-state"><p>No sent notifications yet.</p></div>}</div>
        </div>
      </div>
    </div>
  );
}
