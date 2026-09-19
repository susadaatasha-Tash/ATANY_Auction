// frontend/src/roles/customer/pages/Favorites.jsx
import { useFavorites } from '../hooks/useFavorites';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';

function peso(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '₱—';
  return '₱' + num.toLocaleString();
}

export default function Favorites() {
  const { items: favorites, setItems, refresh, error } = useFavorites();
  const showToast = useToast();
  const onRemove = async (productId) => {
    const prev = favorites;
    setItems((cur) => cur.filter((w) => w.product_id !== productId));
    try {
      await apiFetch(`/customer/favorites/${productId}`, { method: 'DELETE' });
      await refresh();
      showToast('Removed from favorites');
    } catch (e) {
      console.error('remove failed', e);
      setItems(prev);
      showToast('Failed to remove');
    }
  };
  if (error) return <div className="panel"><div className="empty-state" style={{ color: 'var(--danger)' }}><p>Error loading favorites: {error}</p><button className="btn btn-outline" onClick={refresh} style={{ marginTop: 8 }}>Retry</button></div></div>;
  return (
    <div className="panel">
      <div className="panel-head"><div><h2>Your Favorites</h2><p>Items you liked — saved for later.</p></div></div>
      <div className="watch-grid">
        {(favorites || []).length ? (favorites || []).map((w) => (
          <div key={w.product_id} className="watch-card">
            <img src={w.img || w.image_url} alt={w.name} />
            <div className="watch-card-body">
              <h4>{w.name}</h4>
              {w.branch_name && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>📍 Pickup at {w.branch_name}</div>}
              <div className="price">Current bid: <b>{peso(w.currentBid ?? w.current_bid ?? w.price)}</b></div>
              {w.auction_status && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Status: {w.auction_status}</div>}
              <div className="watch-card-actions">
                <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => window.location.href = '/customer/live'}>View Auction</button>
                <button type="button" className="btn btn-outline" onClick={() => onRemove(w.product_id)}>Remove</button>
              </div>
            </div>
          </div>
        )) : <div className="empty-state" style={{ gridColumn: '1/-1' }}><p>Your favorites is empty — click ♡ on Live Auctions to save items here.</p></div>}
      </div>
    </div>
  );
}
