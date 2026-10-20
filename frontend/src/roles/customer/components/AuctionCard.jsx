// frontend/src/roles/customer/components/AuctionCard.jsx
// Fix: controlled bid input + validation + isSubmitting guard (Bug 3) — now uses BidStepper
import { useState, useEffect } from 'react';
import { formatCountdown, formatOpensIn } from '../../../shared/hooks/useAuctionCountdown';
import { BidStepper } from './BidStepper';
import { useToast } from '../../../shared/components/Toast';

function peso(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '₱—';
  return '₱' + num.toLocaleString();
}
function effectiveStatus(startTime, endTime, storedStatus) {
  if (String(storedStatus || '').toLowerCase() === 'paused') return 'paused';
  const now = new Date();
  const s = new Date(startTime);
  const e = new Date(endTime);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return String(storedStatus || 'scheduled').toLowerCase();
  if (now < s) return 'scheduled';
  if (now >= e) return 'ended';
  return 'live';
}

export function AuctionCard({ auction, isFavorited, isNotifying, onOpenDetail, onToggleFavorite, onToggleNotify, onPlaceBid, onScheduledEnd }) {
  const showToast = useToast();
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const startRaw = auction.startTime ?? auction.start_time;
  const endRaw = auction.endTime ?? auction.end_time;
  const storedStatus = auction.status;
  const hasTimes = !!(startRaw && endRaw && !isNaN(new Date(startRaw).getTime()) && !isNaN(new Date(endRaw).getTime()));
  const computedStatus = hasTimes ? effectiveStatus(startRaw, endRaw, storedStatus) : String(storedStatus || 'scheduled').toLowerCase();
  const isLive = computedStatus === 'live';
  const isEnded = computedStatus === 'ended';
  const isPaused = computedStatus === 'paused';
  const [isSubmitting, setIsSubmitting] = useState(false);
  const countdownSec = (() => {
    if (!hasTimes) {
      if (isEnded) return 0;
      if (isLive) return auction.endsInSec ?? 0;
      return auction.startsInSec ?? auction.endsInSec ?? 0;
    }
    const now = new Date(nowTick);
    if (isEnded) return 0;
    if (isLive) return Math.max(0, Math.floor((new Date(endRaw) - now) / 1000));
    return Math.max(0, Math.floor((new Date(startRaw) - now) / 1000));
  })();

  const handleBid = async (amount) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onPlaceBid(auction.id, amount);
    } catch (e) {
      // Show a clear, user-facing message so the bid failure is never silent.
      const msg = e.message || 'Bid failed. Please try again.';
      showToast(msg);
      console.error('bid failed', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Scheduled countdown hit zero → ask parent to refetch so a
  // scheduled→live transition appears without a hard refresh.
  const scheduledExpired = !isLive && !isEnded && !isPaused && hasTimes && countdownSec <= 0;
  useEffect(() => {
    if (scheduledExpired) onScheduledEnd?.(auction.id);
  }, [scheduledExpired, auction.id, onScheduledEnd]);

  return (
    <div className="watch-card" onClick={() => onOpenDetail(auction.id)} style={{ cursor: 'pointer' }}>
      <span className={`live-tag ${isLive ? '' : isEnded ? 'ended' : isPaused ? 'paused' : 'scheduled'}`}><span className="live-dot" />{isLive ? 'LIVE' : isEnded ? 'ENDED' : isPaused ? 'PAUSED' : 'STARTS SOON'}</span>
      <button type="button" className={`heart-btn ${isFavorited ? 'saved' : ''}`} onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleFavorite(auction.productId || auction.product_id || auction.id); }} aria-label="Toggle favorite">
        <svg viewBox="0 0 24 24" fill={isFavorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8"><path d="M20.8 8.8C20.8 13.8 12 19.1 12 19.1S3.2 13.8 3.2 8.8C3.2 5.9 5.2 4 7.9 4c1.7 0 3.2.9 4.1 2.2C12.9 4.9 14.4 4 16.1 4c2.7 0 4.7 1.9 4.7 4.8Z"/></svg>
      </button>
      <img src={auction.img} alt="" />
      <div className="watch-card-body">
        <h4>{auction.name}</h4>
        <div className="live-meta"><span>{auction.bids} bids</span><span>{isEnded ? 'Auction over' : isLive ? `${formatCountdown(countdownSec)} left` : formatOpensIn(countdownSec * 1000)}</span></div>
        {auction.branch_name && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>📍 Pickup at {auction.branch_name}</div>}
        <div className="price">Current bid: <b>{peso(auction.currentBid)}</b></div>
        {isPaused ? (
          <div style={{ padding: '8px 12px', background: '#fff3cd', borderRadius: 8, textAlign: 'center', color: '#856404', fontSize: 13, fontWeight: 600 }}>Auction Paused</div>
        ) : isEnded ? (
          <div style={{ padding: '8px 12px', background: 'var(--soft, #f5f5f5)', borderRadius: 8, textAlign: 'center', color: 'var(--muted, #888)', fontSize: 13, fontWeight: 600 }}>Auction Ended</div>
        ) : isLive ? (
          <div className="bid-box" onClick={(e) => e.stopPropagation()}>
            <BidStepper currentBid={auction.currentBid ?? auction.current_bid} startPrice={auction.start_price ?? auction.startPrice} minimumBidIncrement={auction.minimum_bid_increment} onPlaceBid={handleBid} size="small" disabled={isSubmitting} />
          </div>
        ) : (
          <button type="button" className={`btn ${isNotifying ? 'btn-primary' : 'btn-outline'}`} style={{ width: '100%', justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleNotify(auction.id); }}>{isNotifying ? 'Notifying ✓' : 'Notify Me'}</button>
        )}
      </div>
    </div>
  );
}
