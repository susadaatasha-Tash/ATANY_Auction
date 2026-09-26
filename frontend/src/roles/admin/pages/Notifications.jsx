// frontend/src/roles/admin/pages/Notifications.jsx
// GET /admin/notifications/history — admin notification center (own + system-wide rows).
// Read/delete mutations are scoped to the authenticated admin's own rows by the backend.
// Row click marks read and navigates to an existing admin destination.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../../customer/hooks/useNotifications';
import { resolveAdminDestination } from '../../../shared/lib/notificationDestination';

export default function AdminNotifications() {
  const { notifications, unread, markAllRead, markOneRead, remove } = useNotifications('/admin/notifications/history');
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState(null);

  const handleRowClick = async (n) => {
    markOneRead(n.id);
    const destination = resolveAdminDestination(n);
    if (destination && destination !== '/admin/notifications') {
      setExpandedId(null);
      navigate(destination);
      return;
    }
    // Unknown rows keep existing expand behavior instead of a broken link
    const isExpanding = expandedId !== n.id;
    setExpandedId(isExpanding ? n.id : null);
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    try {
      await remove(id);
    } catch (err) {
      console.error('delete failed', err);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div><h2>Notifications</h2><p>System updates, winners, payouts and applications.</p></div>
        {unread > 0 && <button className="btn btn-outline" onClick={markAllRead}>Mark all as read</button>}
      </div>
      <div className="notif-list" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {notifications.length ? notifications.map(n => {
          const isExpanded = expandedId === n.id;
          return (
            <div key={n.id} onClick={() => handleRowClick(n)} className={`notif-item ${n.read ? '' : 'unread'}`} style={{ padding: 12, border: `1px solid ${n.read ? 'var(--line)' : '#0f3d2e'}`, borderRadius: 8, background: n.read ? 'var(--soft)' : '#f0fdf4', cursor: 'pointer' }}>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', fontWeight: n.read ? 400 : 600 }}>{n.message || n.text}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{n.created_at ? new Date(n.created_at).toLocaleString() : n.time} {isExpanded ? '▲' : '▼'}</div>
              {isExpanded && (
                <div style={{ marginTop: 12, padding: 12, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5 }}>
                  <div style={{ color: 'var(--muted)' }}>{n.type ? `Type: ${n.type}` : 'System update'}</div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={(e)=>{e.stopPropagation(); navigate('/admin/transactions');}}>View Orders</button>
                    <button className="btn btn-outline" style={{ fontSize: 12 }} onClick={(e)=>{e.stopPropagation(); navigate('/admin/auctions');}}>View Auctions</button>
                    <button
                      aria-label="Delete notification"
                      className="btn btn-outline"
                      style={{ fontSize: 12 }}
                      onClick={(e) => handleDelete(e, n.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        }) : <div className="empty-state"><p>No notifications.</p></div>}
      </div>
    </div>
  );
}
