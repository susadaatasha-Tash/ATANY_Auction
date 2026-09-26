import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { useNotifications } from '../hooks/useNotifications';
import { resolveCustomerDestination } from '../../../shared/lib/notificationDestination';

export default function Notifications() {
  const { notifications, unread, markAllRead, markOneRead, remove, error } = useNotifications();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('All');

  if (error) return <div className="panel"><div className="empty-state" style={{ color: 'var(--danger)' }}><p>Error loading notifications: {error}</p><button className="btn btn-outline" onClick={()=>window.location.reload()} style={{ marginTop: 8 }}>Retry</button></div></div>;

  const getCategory = (msg) => {
    if (msg.includes('You won')) return 'Auctions';
    if (msg.includes('New Auction')) return 'Auctions';
    if (msg.toLowerCase().includes('auction') && (msg.includes('won') || msg.includes('Auction'))) return 'Auctions';
    if (msg.toLowerCase().includes('order')) return 'Orders';
    return 'System';
  };

  const counts = {
    All: notifications.length,
    Auctions: notifications.filter(n => getCategory(n.message) === 'Auctions').length,
    Orders: notifications.filter(n => getCategory(n.message) === 'Orders').length,
    System: notifications.filter(n => getCategory(n.message) === 'System').length,
  };

  const filtered = useMemo(() => {
    let list = notifications;
    if (category !== 'All') list = list.filter(n => getCategory(n.message) === category);
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter(n => n.message.toLowerCase().includes(needle));
    }
    return list;
  }, [notifications, q, category]);

  const handleNotificationClick = async (n) => {
    markOneRead(n.id);
    try {
      const destination = await resolveCustomerDestination(n);
      if (destination) navigate(destination);
    } catch {
      navigate('/customer/live');
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    try {
      await remove(id);
    } catch (err) {
      console.error('delete failed', err);
    }
  };

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header + Search on same row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#142A4A', margin: 0, lineHeight: 1.2 }}>Notifications</h2>
          <p style={{ fontSize: 12.5, color: '#7B8493', margin: '4px 0 0' }}>You won! Pickup instructions and updates.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: 'absolute', left: 10, width: 16, height: 16, color: '#9AA0AB', pointerEvents: 'none' }}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notifications..."
            aria-label="Search notifications"
            style={{ width: 280, height: 36, padding: '0 12px 0 34px', border: '1px solid #E6E2DA', borderRadius: 10, background: '#FFFFFF', fontSize: 13, color: '#142A4A', outline: 'none' }}
          />
        </div>
      </div>

      {/* Category tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid #E6E2DA', paddingBottom: 0, flexWrap: 'wrap' }}>
        {['All','Auctions','Orders','System'].map(cat => {
          const active = category === cat;
          return (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '10px 14px 10px',
                background: 'none', border: 'none', borderBottom: active ? '2px solid #C89B3C' : '2px solid transparent',
                fontSize: 13, fontWeight: active ? 700 : 500,
                color: active ? '#142A4A' : '#7B8493',
                cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -1
              }}
            >
              {cat}
              <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: active ? 'rgba(200,155,60,0.12)' : '#F3F1EC', color: active ? '#C89B3C' : '#7B8493' }}>{counts[cat]}</span>
            </button>
          );
        })}
        {unread > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingBottom: 8 }}>
            <button className="btn btn-outline" onClick={markAllRead} style={{ height: 32, fontSize: 12, padding: '0 12px' }}>Mark all as read</button>
          </div>
        )}
      </div>

      {/* Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.length ? filtered.map(n => {
          const d = parseDetails(n.message);
          const isUnread = !n.read;
          let typeLabel = getCategory(n.message);
          if (d.isWin) typeLabel = 'Auction Win';
          else if (typeLabel === 'Auctions' && n.message.includes('New Auction')) typeLabel = 'Auction Update';
          const dateStr = new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const timeStr = new Date(n.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          return (
            <div
              key={n.id}
              onClick={() => handleNotificationClick(n)}
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                padding: '14px 16px',
                background: '#FFFFFF',
                border: `1px solid ${isUnread ? '#E6E2DA' : '#EFEDE8'}`,
                borderRadius: 12,
                boxShadow: '0 1px 3px rgba(20,42,74,0.06)',
                cursor: 'pointer',
                transition: 'border-color .15s ease',
              }}
            >
              <div style={{ width: 52, height: 52, borderRadius: 10, background: '#F3F1EC', display: 'grid', placeItems: 'center', flexShrink: 0, overflow: 'hidden', border: '1px solid #E6E2DA' }}>
                {d.isWin ? <span style={{ fontSize: 22 }}>🎉</span> : typeLabel === 'Auction Update' ? <span style={{ fontSize: 18 }}>🔔</span> : typeLabel === 'Order' ? <span style={{ fontSize: 16 }}>📦</span> : <span style={{ fontSize: 14, color: '#7B8493' }}>🔔</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: isUnread ? 700 : 600, color: '#142A4A', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {d.item ? `You won "${d.item}"` : n.message.split('\n')[0].slice(0, 80)}
                </div>
                <div style={{ fontSize: 12.5, color: '#7B8493', marginTop: 3, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {n.message.split('\n').slice(1).join(' ').slice(0, 160) || d.branch || 'You have a new update.'}
                </div>
                <div style={{ marginTop: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999, background: typeLabel === 'Auction Win' ? '#FEF3C7' : typeLabel === 'Auction Update' ? '#EAF3ED' : '#F3F1EC', color: typeLabel === 'Auction Win' ? '#92400e' : typeLabel === 'Auction Update' ? '#2f5e44' : '#7B8493', border: '1px solid rgba(0,0,0,0.04)' }}>{typeLabel}</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0, textAlign: 'right', minWidth: 90 }}>
                <div style={{ fontSize: 12, color: '#142A4A', fontWeight: 600 }}>{dateStr}</div>
                <div style={{ fontSize: 11, color: '#7B8493' }}>{timeStr}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <button
                    aria-label="Delete notification"
                    onClick={(e) => handleDelete(e, n.id)}
                    style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', background: 'transparent', border: '1px solid transparent', borderRadius: 8, color: '#9AA0AB', cursor: 'pointer', transition: 'all .15s ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.borderColor = '#FECACA'; e.currentTarget.style.color = '#DC2626'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.color = '#9AA0AB'; }}
                  >
                    <Trash2 size={14} />
                  </button>
                  <div style={{ color: '#9AA0AB' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg></div>
                </div>
              </div>
            </div>
          );
        }) : (
          <div className="panel" style={{ padding: '40px 20px', textAlign: 'center', border: '1px solid #E6E2DA', borderRadius: 12, background: '#FFFFFF' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🔔</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#142A4A' }}>No notifications yet</div>
            <div style={{ fontSize: 12.5, color: '#7B8493', marginTop: 4 }}>Win an auction to see your pickup instructions here!</div>
          </div>
        )}
      </div>
    </div>
  );
}
