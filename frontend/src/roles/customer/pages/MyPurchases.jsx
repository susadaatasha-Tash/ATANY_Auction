// frontend/src/roles/customer/pages/MyPurchases.jsx
// Premium purchase cards — navigates to Order Details → PayMongo flow (no modal)
import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../shared/lib/apiClient';

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }

function formatLongDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

const STATUS_META = {
  pending: { label: 'Pending Payment', cls: 'pending', desc: 'Complete your payment to continue your order.', action: 'Pay Now' },
  preparing: { label: 'Preparing', cls: 'pending', desc: 'Your jewelry is being prepared.', action: 'View Details' },
  ready_pickup: { label: 'Ready for Pickup', cls: 'ready', desc: 'Your order is ready for pickup. Visit the branch to claim.', action: 'View Details' },
  completed: { label: 'Completed', cls: 'completed', desc: 'Order completed — thank you for shopping with ATANY.', action: 'View Details' },
};

const FILTERS = [
  { key: 'all', label: 'All Orders' },
  { key: 'pending', label: 'Awaiting Payment' },
  { key: 'ready_pickup', label: 'Ready for Pickup' },
  { key: 'completed', label: 'Completed' },
];

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=400&q=70';

export default function MyPurchases({ orders: propOrders }) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState(propOrders || []);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!propOrders || !propOrders.length);

  useEffect(() => {
    if (propOrders && propOrders.length) {
      const mapped = propOrders.map(o => ({ ...o, displayId: o.transaction_code || o.id }));
      setOrders(mapped);
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch('/customer/orders').then(rows => {
      const mapped = (Array.isArray(rows) ? rows : []).map(r => ({
        ...r,
        displayId: r.transaction_code || r.id,
        date: r.date,
      }));
      setOrders(mapped);
      setError(null);
    }).catch(e => { setError(e.message || 'Failed to load orders'); setOrders([]); }).finally(() => setLoading(false));
  }, [propOrders]);

  const filtered = useMemo(() => {
    let list = orders;
    if (filter !== 'all') list = list.filter(o => o.status === filter);
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter(o =>
        o.displayId?.toLowerCase().includes(needle) ||
        o.id?.toLowerCase().includes(needle) ||
        (o.item || '').toLowerCase().includes(needle) ||
        (o.branch || '').toLowerCase().includes(needle)
      );
    }
    return list;
  }, [orders, q, filter]);

  if (loading) return <div className="panel"><div className="empty-state"><p>Loading your purchases…</p></div></div>;
  if (error) return <div className="panel"><div className="empty-state" style={{ color: 'var(--danger)' }}><p>Unable to load your purchases.</p><p className="form-hint" style={{ marginTop: 6 }}>{error}</p><button className="btn btn-outline" onClick={() => window.location.reload()} style={{ marginTop: 12 }}>Try Again</button></div></div>;

  return (
    <div className="purchases-page">
      {/* Filters */}
      <div className="purchases-filters">
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`purchases-filter ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key !== 'all' && (
              <span className="purchases-filter-count">{orders.filter(o => f.key === 'all' ? true : o.status === f.key).length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="purchases-search">
        <div className="search-box purchases-search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search orders..." aria-label="Search orders" />
        </div>
      </div>

      {/* Cards */}
      {filtered.length ? (
        <div className="purchase-list">
          {filtered.map(o => {
            const payPaid = o.payment_status === 'paid';
            const metaKey = payPaid && o.status === 'pending' ? 'paid_pending' : o.status;
            const meta = metaKey === 'paid_pending' ? { label: 'Payment Confirmed', cls: 'completed', desc: 'Payment confirmed — preparing your jewelry.', action: 'View Details' } : (STATUS_META[o.status] || { label: o.status, cls: 'pending', desc: '', action: 'View Details' });
            const isPayable = o.status === 'pending' && !payPaid;
            return (
              <div key={o.id} className="purchase-card">
                <img className="purchase-card-img" src={o.img || FALLBACK_IMG} alt={o.item || 'Jewelry item'} />

                <div className="purchase-card-info">
                  <div className="purchase-card-order">Order #{o.displayId}</div>
                  <div className="purchase-card-name">{o.item}</div>
                  {(o.karat_weight || o.category) && (
                    <div className="purchase-card-meta">{[o.karat_weight, o.category].filter(Boolean).join(' · ')}</div>
                  )}
                  <div className="purchase-card-price">{peso(o.amount)}</div>
                  <div className="purchase-card-date">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                    {formatLongDate(o.date)}
                  </div>
                </div>

                <div className="purchase-card-divider" aria-hidden="true" />

                <div className="purchase-card-status">
                  <span className={`purchase-status-badge ${meta.cls}`}>
                    <span className="purchase-status-dot" aria-hidden="true" />
                    {meta.label}
                  </span>
                  <p className="purchase-status-desc">{meta.desc}</p>
                  <div className="purchase-branch">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></svg>
                    <span>
                      <span className="purchase-branch-label">Pickup Branch</span>
                      <span className="purchase-branch-name">{o.branch || '—'}</span>
                    </span>
                  </div>
                  {isPayable ? (
                    <button className="btn btn-primary purchase-action" onClick={() => navigate(`/customer/orders/${o.id}`)}>Pay Now <span aria-hidden="true">→</span></button>
                  ) : (
                    <button className="btn btn-outline purchase-action" onClick={() => navigate(`/customer/orders/${o.id}`)}>View Details <span aria-hidden="true">→</span></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel">
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 44, height: 44, marginBottom: 12, opacity: .35, color: 'var(--gold)' }}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
            <h3 style={{ color: 'var(--navy)', fontWeight: 700, marginBottom: 6 }}>No purchases yet</h3>
            <p>Your jewelry purchases will appear here after you win an auction.</p>
            <Link to="/customer/live" className="btn btn-primary" style={{ marginTop: 16 }}>Explore Auctions</Link>
          </div>
        </div>
      )}
    </div>
  );
}
