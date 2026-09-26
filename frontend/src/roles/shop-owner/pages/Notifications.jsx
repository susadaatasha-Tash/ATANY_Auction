// frontend/src/roles/shop-owner/pages/Notifications.jsx
// GET /shop-owner/notifications — seller updates (listing approved/rejected, sales)
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications as useCustomerNotifications } from '../../customer/hooks/useNotifications';
import { resolveShopDestination } from '../../../shared/lib/notificationDestination';

function useShopNotifications() {
  // Reuse generic hook with shop path
  const hook = useCustomerNotifications('/shop-owner/notifications');
  return hook;
}

export default function ShopNotifications() {
  const { notifications, unread, markAllRead, markOneRead } = useShopNotifications();
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState(null);
  const handleRowClick = (n) => {
    markOneRead(n.id);
    const destination = resolveShopDestination(n);
    if (destination) {
      setExpandedId(null);
      navigate(destination);
      return;
    }
    // seller_application / unknown rows keep existing expand behavior
    const isExpanding = expandedId !== n.id;
    setExpandedId(isExpanding ? n.id : null);
  };
  return (
    <div className="panel">
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
        <button onClick={() => navigate('/shop')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--navy)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>← Back to Dashboard</button>
      </div>
      <div className="panel-head">
        <div><h2>Notifications</h2><p>Updates on your listings, auctions, payouts.</p></div>
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
                  <div style={{ color: 'var(--muted)' }}>{n.type ? `Type: ${n.type}` : 'Seller update'}</div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={(e)=>{e.stopPropagation(); navigate('/shop/listings');}}>Go to My Listings</button>
                    <button className="btn btn-outline" style={{ fontSize: 12 }} onClick={(e)=>{e.stopPropagation(); navigate('/shop/sales');}}>View Sales</button>
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
