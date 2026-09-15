import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../hooks/useNotifications';

export default function Notifications() {
  const { notifications, unread, markAllRead, markOneRead, error } = useNotifications();
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState(null);
  if (error) return <div className="panel"><div className="empty-state" style={{ color: 'var(--danger)' }}><p>Error loading notifications: {error}</p><button className="btn btn-outline" onClick={()=>window.location.reload()} style={{ marginTop: 8 }}>Retry</button></div></div>;

  const handleExpand = (id) => {
    const isExpanding = expandedId !== id;
    setExpandedId(isExpanding ? id : null);
    if (isExpanding) {
      markOneRead(id);
    }
  };

  const displayNotifications = notifications;

  const parseDetails = (msg) => {
    const isWin = msg.includes('You won');
    return {
      isWin,
      item: (msg.match(/"([^"]+)"/)?.[1]) || null,
      amount: (msg.match(/₱[\d,]+/)?.[0]) || null,
      branch: (msg.match(/Pickup at ([^—]+) —/)?.[1]?.trim()) || (msg.match(/Pickup at ([^.]+)/)?.[1]?.trim()) || null,
    };
  };

  return (
    <div className="panel">
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
        <button onClick={() => navigate('/customer')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--navy)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          ← Back to Dashboard
        </button>
      </div>
      <div className="panel-head">
        <div><h2>Notifications</h2><p>You won! Pickup instructions and updates.</p></div>
        {unread > 0 && <button className="btn btn-outline" onClick={markAllRead}>Mark all as read</button>}
      </div>
      <div className="notif-list" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {displayNotifications.length ? displayNotifications.map(n => {
          const isExpanded = expandedId === n.id;
          const d = parseDetails(n.message);
          const isUnread = !n.read;
          return (
            <div
              key={n.id}
              onClick={() => handleExpand(n.id)}
              className={`notif-item ${n.read ? '' : 'unread'}`}
              style={{
                padding: 12, border: `1px solid ${isUnread ? '#0f3d2e' : 'var(--line)'}`, borderRadius: 8,
                background: isUnread ? '#f0fdf4' : 'var(--soft)', cursor: 'pointer'
              }}
            >
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', fontWeight: isUnread ? 600 : 400 }}>{n.message}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{new Date(n.created_at).toLocaleString()} {isExpanded ? '▲' : '▼'}</div>
              {isExpanded && (
                <div style={{ marginTop: 12, padding: 12, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5 }}>
                  {d.item && <div><strong>Item:</strong> {d.item}</div>}
                  {d.amount && <div><strong>Winning bid:</strong> {d.amount}</div>}
                  {d.branch && <div><strong>Pickup:</strong> {d.branch}</div>}
                  <div style={{ marginTop: 6, color: 'var(--muted)' }}>Bring a valid government-issued ID to claim. Claim within 7 business days.</div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={(e) => { e.stopPropagation(); navigate('/customer/purchases'); }}>Go to My Purchases</button>
                    <button className="btn btn-outline" style={{ fontSize: 12 }} onClick={(e) => { e.stopPropagation(); navigate('/customer/live'); }}>View Live Auctions</button>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 10, color: 'var(--muted)' }}>Order ref: {n.id.slice(0,8)}…</div>
                </div>
              )}
            </div>
          );
        }) : <div className="empty-state"><p>No notifications yet — win an auction to see your pickup instructions here!</p></div>}
      </div>
    </div>
  );
}
