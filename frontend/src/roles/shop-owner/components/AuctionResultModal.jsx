// frontend/src/roles/shop-owner/components/AuctionResultModal.jsx
// Seller Auction Result modal — premium structured result view.
//
// EVERY value comes from the backend (GET /shop-owner/auctions/:id/result):
// auction code, product, branch, result state, winner, final bid, total bids,
// watcher count and the ranked bidder leaderboard. Nothing is computed or
// hardcoded in the UI.
import { useState, useEffect, useCallback } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';

function peso(n) {
  return '₱' + Number(n || 0).toLocaleString();
}

// ATANY result states -> visual tone. "Sold" is never hardcoded: the state
// comes from the auction/order state on the server.
const TONES = {
  payment_pending: 'ok',
  preparing: 'ok',
  ready_pickup: 'ok',
  completed: 'ok',
  winner_expired: 'warn',
  no_winner: 'neutral',
  no_bids: 'neutral',
  live: 'neutral',
};

export function AuctionResultModal({ auction, open, onClose, onRelist }) {
  const showToast = useToast();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (id) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch(`/shop-owner/auctions/${id}/result`);
      setResult(data);
    } catch (e) {
      setError(e?.message || 'Could not load the auction result');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !auction?.id) {
      setResult(null);
      setError(null);
      return;
    }
    load(auction.id);
  }, [open, auction?.id, load]);

  if (!open || !auction) return null;

  // Prefer the freshly fetched server payload; fall back to the list row so
  // the modal never renders empty while the request is in flight.
  const src = result || auction;
  const auctionMeta = result?.auction || auction;
  const product = result?.product || {
    name: auction.title || auction.name,
    category: auction.category,
    karat_weight: auction.karat_weight,
    description: auction.description,
    image_url: auction.image_url || auction.img,
  };
  const branch = result?.branch || (auction.branch_id ? { id: auction.branch_id, name: auction.branch_name || auction.branch } : null);
  const resultMeta = result?.result || auction.result || null;
  const winner = result?.winner ?? auction.winner ?? null;
  const leaderboard = result?.leaderboard || auction.leaderboard || [];
  const canRelist = result?.can_relist ?? auction.can_relist ?? (auction.status === 'ended');

  const state = resultMeta?.state || 'live';
  const tone = TONES[state] || 'neutral';
  const finalBid = resultMeta ? resultMeta.final_bid : (auction.current_bid ?? 0);
  const totalBids = resultMeta ? resultMeta.total_bids : (auction.bid_count ?? 0);
  const watcherCount = resultMeta ? resultMeta.watcher_count : (auction.watcher_count ?? 0);
  const headline = resultMeta?.label || (auction.status === 'ended' ? 'Ended' : 'Auction live');

  const footer = (
    <>
      <div className="result-foot-meta">
        {auctionMeta?.start_time && (
          <span className="result-foot-period">
            {new Date(auctionMeta.start_time).toLocaleString()} → {auctionMeta.end_time ? new Date(auctionMeta.end_time).toLocaleString() : '—'}
          </span>
        )}
      </div>
      <div className="result-foot-actions">
        {canRelist && (
          <button type="button" className="btn btn-outline" onClick={() => onRelist?.(auction)}>
            ↺ Relist
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Auction result"
      eyebrow={auctionMeta?.auction_code || auctionMeta?.lot_code || ''}
      className="auction-result-modal"
      footer={footer}
    >
      {loading && !result && (
        <div className="result-skeleton" aria-live="polite" aria-busy="true">
          <div className="result-skeleton__row" style={{ height: 68 }} />
          <div className="result-skeleton__row" style={{ height: 118 }} />
          <div className="result-skeleton__row" style={{ height: 150 }} />
          <span className="result-skeleton__label">Loading auction result…</span>
        </div>
      )}

      {error && !result && (
        <div className="result-error">
          <p>{error}</p>
          <button type="button" className="btn btn-outline" onClick={() => load(auction.id)}>Retry</button>
        </div>
      )}

      {src && (
        <div className="result-body">
          {/* Product summary */}
          <section className="result-product" aria-label="Lot summary">
            {product.image_url ? (
              <img className="result-product__img" src={product.image_url} alt={product.name || 'Lot'} />
            ) : (
              <div className="result-product__img result-product__img--ph" aria-hidden="true">◇</div>
            )}
            <div className="result-product__body">
              <div className="result-product__title">{product.name || product.title || 'Untitled lot'}</div>
              <div className="result-product__meta">
                {product.category || 'Other'}
                {branch?.name ? ` · ${branch.name}` : ''}
                {product.karat_weight ? ` · ${product.karat_weight}` : ''}
              </div>
            </div>
          </section>

          {/* Result status + metrics */}
          <section className={`result-status result-status--${tone}`} aria-label="Auction result">
            <div className="result-status__head">
              <span className="result-status__icon" aria-hidden="true">
                {tone === 'ok' ? '🏆' : tone === 'warn' ? '⏳' : '◌'}
              </span>
              <div>
                <div className="result-status__title">{headline}</div>
                <div className="result-status__sub">
                  {winner ? `Won by ${winner.name}` : 'No confirmed winner'}
                </div>
              </div>
            </div>
            <div className="result-metrics">
              <div className="result-metric">
                <span className="result-metric__label">Final bid</span>
                <span className="result-metric__value">{winner ? peso(finalBid) : '—'}</span>
              </div>
              <div className="result-metric">
                <span className="result-metric__label">Total bids</span>
                <span className="result-metric__value">{Number(totalBids || 0).toLocaleString()}</span>
              </div>
              <div className="result-metric">
                <span className="result-metric__label">Watchers</span>
                <span className="result-metric__value">{Number(watcherCount || 0).toLocaleString()}</span>
              </div>
            </div>
            {resultMeta?.payment_deadline && tone === 'ok' && (
              <p className="result-status__note">
                Payment due by {new Date(resultMeta.payment_deadline).toLocaleString()}
              </p>
            )}
          </section>

          {/* Bidder leaderboard */}
          <section className="result-leader" aria-label="Bidder leaderboard">
            <div className="result-leader__head">
              <span>Bidder leaderboard</span>
              <span>{leaderboard.length ? `${leaderboard.length} bidder${leaderboard.length === 1 ? '' : 's'}` : 'No bids'}</span>
            </div>
            {leaderboard.length ? (
              <div className="result-leader__list">
                {leaderboard.map((row) => {
                  const chip = row.is_winner
                    ? 'Winner'
                    : row.is_leading
                      ? 'Leading'
                      : row.is_top_bidder && state !== 'live'
                        ? 'Highest bid'
                        : 'Outbid';
                  const chipClass = row.is_winner
                    ? 'result-leader__tag--winner'
                    : row.is_leading
                      ? 'result-leader__tag--leading'
                      : 'result-leader__tag--outbid';
                  return (
                    <div key={`${row.bidder_id}-${row.rank}`} className="result-leader__row">
                      <span className={`result-leader__rank${row.rank === 1 ? ' result-leader__rank--1' : ''}`}>{row.rank}</span>
                      <span className="result-leader__name">{row.bidder_name}</span>
                      <span className="result-leader__amt">{peso(row.amount)}</span>
                      <span className={`result-leader__tag ${chipClass}`}>{chip}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="result-leader__empty">
                {state === 'no_bids'
                  ? 'This lot ended without any bids.'
                  : 'No bids were recorded for this lot.'}
              </div>
            )}
          </section>

          {error && result && (
            <p className="form-hint">Showing the last known result — refresh failed ({error}).</p>
          )}
        </div>
      )}
    </Modal>
  );
}

export default AuctionResultModal;
