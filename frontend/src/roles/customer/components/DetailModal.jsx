// frontend/src/roles/customer/components/DetailModal.jsx
// Port of customer-dashboard.html:510-538 detail modal + 669-729 renderDetailModal
// Handles live vs scheduled, bidder list, pickup note, and fraud-flag surfacing
import { formatCountdown, useAuctionCountdown } from '../../../shared/hooks/useAuctionCountdown';

function peso(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '₱—';
  return '₱' + num.toLocaleString();
}

export function DetailModal({ auction, isWatched, isNotifying, onClose, onToggleWatch, onToggleNotify, onPlaceBid }) {
  if (!auction) return null;
  const isLive = auction.status === 'live';
  const isEnded = auction.status === 'ended';
  const liveSec = useAuctionCountdown(auction.endsInSec);
  return (
    <div className="modal-overlay show" onClick={(e) => e.target.id === 'detailModal' && onClose()}>
      <div className="modal-box detail-box" id="detailModal">
        <button className="detail-close" onClick={onClose}>×</button>
        <button type="button" className={`heart-btn heart-btn-lg ${isWatched ? 'saved' : ''}`} style={{ top: 14, right: 58 }} onClick={(e) => { e.stopPropagation(); onToggleWatch(auction.productId || auction.product_id || auction.id); }} aria-label="Save">
          <svg viewBox="0 0 24 24" fill={isWatched ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8"><path d="M20.8 8.8C20.8 13.8 12 19.1 12 19.1S3.2 13.8 3.2 8.8C3.2 5.9 5.2 4 7.9 4c1.7 0 3.2.9 4.1 2.2C12.9 4.9 14.4 4 16.1 4c2.7 0 4.7 1.9 4.7 4.8Z"/></svg>
        </button>
        <div className="detail-img-wrap"><img src={auction.img} alt="" /></div>
        <div className="detail-body">
          <h2>{auction.name}</h2>
          <div className="detail-sub">{isEnded ? `Ended · ${auction.bids} bids total` : isLive ? `Live · ${auction.bids} bids so far` : 'Scheduled · not yet open'} {auction.branch_name ? ` · 📍 Pickup at ${auction.branch_name}` : ''}</div>
          {auction.branch_name && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>{auction.branch_address}</div>}
          <div className="detail-stats">
            <div className="detail-stat"><b>{peso(auction.currentBid)}</b><span>Current Bid</span></div>
            <div className="detail-stat"><b>{auction.bids}</b><span>Bids</span></div>
            <div className="detail-stat"><b>{isEnded ? '---' : formatCountdown(liveSec)}</b><span>{isEnded ? 'Auction Over' : isLive ? 'Time Left' : 'Starts In'}</span></div>
          </div>
          <p className="detail-desc">{auction.desc}</p>
          {isEnded ? (
            <div style={{ padding: '12px 16px', background: 'var(--soft, #f5f5f5)', borderRadius: 8, textAlign: 'center', color: 'var(--muted, #888)', fontWeight: 600 }}>Auction Has Ended</div>
          ) : isLive ? (
            <div className="detail-bidbox">
              <input type="number" id="detailBidInput" placeholder={`₱${(auction.currentBid + 1000).toLocaleString()}+`} />
              <button className="btn btn-primary" onClick={() => {
                const v = Number(document.getElementById('detailBidInput').value);
                onPlaceBid(auction.id, v);
              }}>Place Bid</button>
            </div>
          ) : (
            <button type="button" className={`btn ${isNotifying ? 'btn-primary' : 'btn-outline'}`} style={{ width: '100%' }} onClick={() => onToggleNotify(auction.id)}>{isNotifying ? 'Notifying ✓' : 'Notify Me When Live'}</button>
          )}
          <div className="detail-section-label">Bidders</div>
          <div className="bidder-list">
            {auction.bidders?.length ? auction.bidders.map((b, i) => (
              <div key={i} className={`bidder-row ${i === 0 ? 'leader' : ''}`}>
                <div className="bidder-avatar">{b.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</div>
                <div><div className="bidder-name">{b.name}</div><div className="bidder-time">{b.time}</div></div>
                <div className="bidder-amount">{peso(b.amount)}</div>
              </div>
            )) : <div className="empty-state"><p>No bids yet — be the first.</p></div>}
          </div>
        </div>
      </div>
    </div>
  );
}
