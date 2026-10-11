// frontend/src/roles/customer/pages/Watchlist.jsx
import { useWishlist } from '../hooks/useWishlist';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';

function peso(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '₱—';
  return '₱' + num.toLocaleString();
}

export default function Watchlist() {
  const { items: watchlist, refresh, error } = useWishlist();
  if (error) return <div className="panel"><div className="empty-state" style={{ color: 'var(--danger)' }}><p>Error loading watchlist: {error}</p><button className="btn btn-outline" onClick={refresh} style={{ marginTop: 8 }}>Retry</button></div></div>;
  return (
    <div className="panel">
      <div className="panel-head"><div><h2>Your Watchlist</h2><p>Auctions you participated in by bidding.</p></div></div>
      <div className="watch-grid">
        {(watchlist || []).length ? (watchlist || []).map((w) => (
          <div key={w.auction_id || w.product_id} className="watch-card">
            <img src={w.img || w.image_url} alt={w.name} />
            <div className="watch-card-body">
              <h4>{w.name}</h4>
              {w.branch_name && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>📍 Pickup at {w.branch_name}</div>}
              <div className="price">Current bid: <b>{peso(w.currentBid ?? w.current_bid ?? w.price)}</b></div>
              <div className="watch-card-actions">
                <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => window.location.href = '/customer/auctions'}>View Auction</button>
              </div>
            </div>
          </div>
        )) : <div className="empty-state" style={{ gridColumn: '1/-1' }}><p>Your watchlist is empty — place a bid on Auctions to see it here.</p></div>}
      </div>
    </div>
  );
}
