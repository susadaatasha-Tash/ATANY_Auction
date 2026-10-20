// frontend/src/roles/shop-owner/components/LiveAuctionCard.jsx
// Compact sidebar card: authenticated seller's live auction ending soonest.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Gem } from 'lucide-react';
import { formatCountdown } from '../../../shared/hooks/useAuctionCountdown';

export function LiveAuctionCard({ auctions = [], loading = false }) {
  const navigate = useNavigate();
  const live = useMemo(() => {
    return (auctions || [])
      .filter((a) => a?.status === 'live')
      .slice()
      .sort((a, b) => new Date(a.endTime || a.endsInSec || 0) - new Date(b.endTime || b.endsInSec || 0) || (a.endsInSec || 0) - (b.endsInSec || 0));
  }, [auctions]);

  const next = live[0] || null;
  const [tick, setTick] = useState(0);

  // Live countdown tick — cosmetic only; backend closes auctions.
  useEffect(() => {
    if (!next) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [next?.id]);

  // Recompute remaining seconds from endTime when available
  const remaining = useMemo(() => {
    if (!next) return 0;
    if (next.endTime) {
      return Math.max(0, Math.floor((new Date(next.endTime).getTime() - Date.now()) / 1000));
    }
    return Number(next.endsInSec) || 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, tick]);

  if (loading && !next) {
    return (
      <div className="sdash-live-card sdash-live-card--empty">
        <div className="sdash-live-card__empty-title">Loading live auction…</div>
      </div>
    );
  }

  if (!next) {
    return (
      <div className="sdash-live-card sdash-live-card--empty">
        <div className="sdash-live-card__empty-title">No live auction</div>
        <div className="sdash-live-card__empty-text">Your live auction will appear here</div>
      </div>
    );
  }

  const name = next.name || next.item || 'Jewelry lot';
  const img = next.img || next.image_url;

  return (
    <div className="sdash-live-card">
      <span className="sdash-live-card__badge">
        <span className="sdash-live-card__dot" aria-hidden="true" />
        LIVE NOW
      </span>
      <div className="sdash-live-card__row">
        {img ? (
          <img className="sdash-live-card__img" src={img} alt="" loading="lazy" />
        ) : (
          <div className="sdash-live-card__img-fallback" aria-hidden="true">
            <Gem size={16} />
          </div>
        )}
        <div className="sdash-live-card__meta">
          <div className="sdash-live-card__name" title={name}>{name}</div>
          <div className="sdash-live-card__timer-label">Ends in:</div>
          <div className="sdash-live-card__timer">{formatCountdown(remaining) || '—'}</div>
        </div>
      </div>
      <button
        type="button"
        className="sdash-live-card__btn"
        onClick={() => navigate('/shop/auctions')}
      >
        Manage auction
        <ArrowRight size={12} />
      </button>
    </div>
  );
}

export default LiveAuctionCard;
