// frontend/src/roles/customer/components/AuctionCard.jsx
// Fix: controlled bid input + validation + isSubmitting guard (Bug 3)
import { useState } from 'react';
import { formatCountdown, useAuctionCountdown } from '../../../shared/hooks/useAuctionCountdown';

function peso(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '₱—';
  return '₱' + num.toLocaleString();
}

export function AuctionCard({ auction, isWatched, isNotifying, onOpenDetail, onToggleWatch, onToggleNotify, onPlaceBid }) {
  const isLive = auction.status === 'live';
  const isEnded = auction.status === 'ended';
  const [bidAmount, setBidAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const liveSec = useAuctionCountdown(auction.endsInSec);
  const minBid = Number(auction.currentBid || 0) + 1000;
  const bidNum = Number(bidAmount);
  const isValidBid = Number.isFinite(bidNum) && bidNum >= minBid;

  const handleBid = async () => {
    if (!isValidBid || isSubmitting) return;
    setIsSubmitting(true);
    try { await onPlaceBid(auction.id, bidNum); setBidAmount(''); } catch (e) { console.error('bid failed', e); } finally { setIsSubmitting(false); }
  };

  return (
    <div className="watch-card" onClick={() => onOpenDetail(auction.id)} style={{ cursor: 'pointer' }}>
      <span className={`live-tag ${isLive ? '' : isEnded ? 'ended' : 'scheduled'}`}><span className="live-dot" />{isLive ? 'LIVE' : isEnded ? 'ENDED' : 'STARTS SOON'}</span>
      <button type="button" className={`heart-btn ${isWatched ? 'saved' : ''}`} onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleWatch(auction.productId || auction.product_id || auction.id); }} aria-label="Save to watchlist">
        <svg viewBox="0 0 24 24" fill={isWatched ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8"><path d="M20.8 8.8C20.8 13.8 12 19.1 12 19.1S3.2 13.8 3.2 8.8C3.2 5.9 5.2 4 7.9 4c1.7 0 3.2.9 4.1 2.2C12.9 4.9 14.4 4 16.1 4c2.7 0 4.7 1.9 4.7 4.8Z"/></svg>
      </button>
      <img src={auction.img} alt="" />
      <div className="watch-card-body">
        <h4>{auction.name}</h4>
        <div className="live-meta"><span>{auction.bids} bids</span><span>{isEnded ? 'Auction over' : isLive ? `${formatCountdown(liveSec)} left` : `Starts in ${formatCountdown(liveSec)}`}</span></div>
        {auction.branch_name && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>📍 Pickup at {auction.branch_name}</div>}
        <div className="price">Current bid: <b>{peso(auction.currentBid)}</b></div>
        {isEnded ? (
          <div style={{ padding: '8px 12px', background: 'var(--soft, #f5f5f5)', borderRadius: 8, textAlign: 'center', color: 'var(--muted, #888)', fontSize: 13, fontWeight: 600 }}>Auction Ended</div>
        ) : isLive ? (
          <div className="bid-box" onClick={(e) => e.stopPropagation()}>
            <input type="number" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} placeholder={`₱${minBid.toLocaleString()}+`} />
            <button type="button" className="btn btn-primary" onClick={handleBid} disabled={!isValidBid || isSubmitting} style={{ opacity: !isValidBid || isSubmitting ? 0.5 : 1 }}>{isSubmitting ? '...' : 'Bid'}</button>
          </div>
        ) : (
          <button type="button" className={`btn ${isNotifying ? 'btn-primary' : 'btn-outline'}`} style={{ width: '100%', justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleNotify(auction.id); }}>{isNotifying ? 'Notifying ✓' : 'Notify Me'}</button>
        )}
      </div>
    </div>
  );
}
