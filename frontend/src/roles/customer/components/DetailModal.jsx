// frontend/src/roles/customer/components/DetailModal.jsx
// Port of customer-dashboard.html:510-538 detail modal + 669-729 renderDetailModal
// Handles live vs scheduled, bidder list, pickup note, and fraud-flag surfacing — now uses BidStepper
import { useState, useEffect } from 'react';
import { BidStepper } from './BidStepper';
import { formatCountdown } from '../../../shared/hooks/useAuctionCountdown';
import { useToast } from '../../../shared/components/Toast';
import { socket } from '../../../shared/lib/socketClient';

function peso(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '₱—';
  return '₱' + num.toLocaleString();
}
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}
function effectiveStatus(startTime, endTime) {
  const now = new Date();
  const s = new Date(startTime);
  const e = new Date(endTime);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 'scheduled';
  if (now < s) return 'scheduled';
  if (now >= e) return 'ended';
  return 'live';
}
export function DetailModal({ auction, isFavorited, isNotifying, onClose, onToggleFavorite, onToggleNotify, onPlaceBid }) {
  if (!auction) return null;
  const showToast = useToast();
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [isSubmitting, setIsSubmitting] = useState(false);
  useEffect(() => { const id = setInterval(() => setNowTick(Date.now()), 1000); return () => clearInterval(id); }, []);
  const startRaw = auction.startTime ?? auction.start_time;
  const endRaw = auction.endTime ?? auction.end_time;
  const hasTimes = !!(startRaw && endRaw && !isNaN(new Date(startRaw).getTime()) && !isNaN(new Date(endRaw).getTime()));
  const computedStatus = hasTimes ? effectiveStatus(startRaw, endRaw) : (auction.status || 'scheduled');
  const isLive = computedStatus === 'live';
  const isEnded = computedStatus === 'ended';
  const countdownSecRaw = (() => {
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
  const liveSec = countdownSecRaw;
  // Live viewer presence: while a CUSTOMER has a live auction open, the socket
  // joins the auction room so the server can count this customer as a watcher
  // (the admin monitor reads the same count). Closing the detail (or switching
  // auctions) removes the viewer again — no ghost watchers.
  useEffect(() => {
    if (!isLive || !auction?.id) return undefined;
    const id = String(auction.id);
    try { socket.connect(); } catch { /* the socket is optional */ }
    try { socket.emit('join:auction', id); } catch { /* noop */ }
    return () => {
      try { socket.emit('leave:auction', id); } catch { /* noop */ }
    };
  }, [isLive, auction?.id]);
  const handleClose = (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    onClose();
  };

  const handlePlaceBid = async (amount) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onPlaceBid(auction.id, amount);
    } catch (e) {
      const msg = e.message || 'Bid failed. Please try again.';
      showToast(msg);
      console.error('bid failed', e);
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <div className="modal-overlay show" onClick={(e) => e.target === e.currentTarget && handleClose(e)}>
      <div className="modal-box detail-box" id="detailModal">
        <button type="button" className="detail-close" onClick={handleClose} aria-label="Close">×</button>
        <button type="button" className={`heart-btn heart-btn-lg ${isFavorited ? 'saved' : ''}`} style={{ top: 14, right: 58 }} onClick={(e) => { e.stopPropagation(); onToggleFavorite(auction.productId || auction.product_id || auction.id); }} aria-label="Toggle favorite">
          <svg viewBox="0 0 24 24" fill={isFavorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8"><path d="M20.8 8.8C20.8 13.8 12 19.1 12 19.1S3.2 13.8 3.2 8.8C3.2 5.9 5.2 4 7.9 4c1.7 0 3.2.9 4.1 2.2C12.9 4.9 14.4 4 16.1 4c2.7 0 4.7 1.9 4.7 4.8Z"/></svg>
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
            <div className="detail-bidbox" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Your Bid</div>
              <BidStepper
                currentBid={auction.currentBid ?? auction.current_bid}
                startPrice={auction.start_price ?? auction.startPrice}
                minimumBidIncrement={auction.minimum_bid_increment}
                onPlaceBid={handlePlaceBid}
                size="large"
                disabled={isSubmitting}
              />
            </div>
          ) : (
            <button type="button" className={`btn ${isNotifying ? 'btn-primary' : 'btn-outline'}`} style={{ width: '100%' }} onClick={() => onToggleNotify(auction.id)}>{isNotifying ? 'Notifying ✓' : 'Notify Me When Live'}</button>
          )}
          <div className="detail-section-label">Bidders</div>
          <div className="bidder-list">
            {auction.bidders?.length ? auction.bidders.map((b, i) => (
              <div key={i} className={`bidder-row ${i === 0 ? 'leader' : ''}`}>
                <div className="bidder-avatar">{(b.name || 'Unknown').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</div>
                <div><div className="bidder-name">{b.name || 'Unknown'}</div><div className="bidder-time">{timeAgo(b.time || b.created_at)}</div></div>
                <div className="bidder-amount">{peso(b.amount)}</div>
              </div>
            )) : <div className="empty-state"><p>No bids yet — be the first.</p></div>}
          </div>
        </div>
      </div>
    </div>
  );
}
