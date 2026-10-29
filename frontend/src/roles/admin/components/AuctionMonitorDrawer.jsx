// frontend/src/roles/admin/components/AuctionMonitorDrawer.jsx
// Admin — Auction monitor drawer (live / paused / scheduled / ended).
//
// Read-only. The current leader is the highest ACTIVE bidder on a live or paused
// auction; a winner label is only ever shown for an ENDED auction, and it comes
// from the authoritative `orders` row written by services/auctionClosingService.js
// — this component never computes a winner.
//
// There is deliberately no bid input, Place Bid, favourite, reserve or checkout
// control anywhere in this file.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Clock, Eye, Gavel, MapPin, ShieldCheck, Store, Users,
} from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { socket } from '../../../shared/lib/socketClient';
import { Drawer } from '../../../shared/components/Drawer';
import { Skeleton, SkeletonCircle, SkeletonRegion } from '../../../shared/ui/Skeleton';
import { fmtMoney, timeAgo, capitaliseStatus, fmtWhenShort, initialsOf, countdownFrom } from '../lib/branchFormatters';
import '../pages/admin-branches.css';

const STATUS_LABEL = { live: 'Live', paused: 'Paused', scheduled: 'Scheduled', ended: 'Ended' };

export function AuctionMonitorDrawer({ auctionId, branch, onClose, onLivePatch }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const inflight = useRef(false);
  const queued = useRef(false);

  // `background: true` keeps the currently rendered monitor on screen (no
  // skeleton flash) — used for realtime refreshes after a bid or status change.
  const load = useCallback(async ({ background = false } = {}) => {
    if (inflight.current) { queued.current = true; return; }
    inflight.current = true;
    if (!background) setLoading(true);
    try {
      const row = await apiFetch(`/admin/branches/${branch.id}/auctions/${auctionId}`);
      setData(row);
      setError('');
    } catch (e) {
      setError(e.message || 'Unable to load this auction.');
    } finally {
      inflight.current = false;
      if (!background) setLoading(false);
      if (queued.current) { queued.current = false; load({ background: true }); }
    }
  }, [branch?.id, auctionId]);

  useEffect(() => { load(); }, [load]);

  // A new bid changes more than the headline price: it changes total bids, the
  // current leader and the bid history table. The realtime payload carries only
  // the new amount, so the drawer re-reads the authoritative monitor row on a
  // short debounce (never per keystroke, never a second mutation path).
  const debounceRef = useRef(null);
  const scheduleReload = useCallback(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { load({ background: true }); }, 450);
  }, [load]);
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // Same events the seller/customer screens use. Admin emits join:auction ONLY
  // (never auction:watch) so monitoring cannot inflate the customer watcher count.
  useEffect(() => {
    if (!auctionId) return undefined;
    const id = String(auctionId);
    const onBid = (p) => {
      const pid = String(p?.auctionId ?? p?.auction_id ?? '');
      if (pid !== id) return;
      const amount = Number(p?.currentBid ?? p?.current_bid ?? 0);
      setData((prev) => (prev ? { ...prev, current_bid: amount } : prev));
      onLivePatch?.({ id: auctionId, current_bid: amount });
      scheduleReload();
    };
    const onAuction = (p) => {
      const pid = String(p?.auctionId ?? p?.auction_id ?? '');
      if (pid !== id) return;
      setData((prev) => (prev ? { ...prev, status: p?.status ?? prev.status, current_bid: Number(p?.currentBid ?? p?.current_bid ?? prev.current_bid), end_time: p?.end_time ?? prev.end_time } : prev));
      onLivePatch?.({ id: auctionId, status: p?.status });
      scheduleReload();
    };
    const onWatchers = (p) => {
      const pid = String(p?.auctionId ?? p?.auction_id ?? '');
      if (pid !== id) return;
      const n = Number(p?.watcherCount ?? p?.watcher_count ?? 0);
      setData((prev) => (prev ? { ...prev, watcher_count: n } : prev));
      onLivePatch?.({ id: auctionId, watcher_count: n });
    };
    try { socket.emit('join:auction', id); } catch { /* transport not ready */ }
    socket.on('bid:update', onBid);
    socket.on('auction:update', onAuction);
    socket.on('auction:watchers', onWatchers);
    return () => {
      socket.off('bid:update', onBid);
      socket.off('auction:update', onAuction);
      socket.off('auction:watchers', onWatchers);
      try { socket.emit('leave:auction', id); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auctionId, scheduleReload]);

  const footer = (
    <p className="abx-drawer__foot">
      <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" />
      Read-only monitoring view. Admin does not participate in bidding.
    </p>
  );

  return (
    <Drawer open onClose={onClose} labelledBy="auction-drawer-title" className="abx-drawer" footer={footer}>
      {loading ? <MonitorSkeleton /> : error ? (
        <div className="abx-state" role="alert">
          <p className="abx-state__title">{error}</p>
          <button type="button" className="abx-btn" onClick={load}>Retry</button>
        </div>
      ) : data ? (
        <>
          <div className="abx-drawer__hero">
            {data.image_url ? (
              <img src={data.image_url} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ) : <span className="abx-drawer__ph" aria-hidden="true" />}
            <div className="abx-drawer__hero-text">
              <span className="abx-drawer__lot">{data.lot_id}</span>
              <span className={`abx-badge${data.status === 'live' ? ' is-open' : data.status === 'paused' ? ' is-paused' : ''}`}>
                <i aria-hidden="true" />{STATUS_LABEL[data.status] || capitaliseStatus(data.status)}
              </span>
              <span className="abx-drawer__monitor"><ShieldCheck size={13} strokeWidth={2} aria-hidden="true" />Admin monitor</span>
              <h2 id="auction-drawer-title" className="abx-drawer__title">{data.product_name}</h2>
            </div>
          </div>

          <div className="abx-tags">
            {data.status !== 'ended' ? (
              <span className="abx-tag"><Clock size={12} strokeWidth={2} aria-hidden="true" />{data.status === 'paused' ? 'Paused' : countdownFrom(data.end_time)}</span>
            ) : null}
            {data.category ? <span className="abx-tag"><Store size={12} strokeWidth={2} aria-hidden="true" />{data.category}</span> : null}
          </div>

          <section className="abx-price" aria-label="Current bid and auction statistics">
            <span className="abx-price__key">{data.status === 'ended' ? 'Final price' : 'Current / highest bid'}</span>
            <span className="abx-price__val">
              {data.status === 'scheduled' && !data.bid_count ? '—' : fmtMoney(data.current_bid)}
            </span>
            <span className="abx-price__sub">
              {data.status === 'ended'
                ? (data.result ? `Winner · ${data.result.winner}` : 'Auction concluded')
                : data.status === 'scheduled' && !data.bid_count
                  ? 'No bids yet · auction not started'
                  : `Current leader · ${data.leading_bidder || '—'}`}
            </span>
            <div className="abx-price__grid">
              <span><b>Starting</b>{fmtMoney(data.start_price)}</span>
              <span><b>Increment</b>{fmtMoney(data.minimum_bid_increment)}</span>
              <span><b>Total bids</b>{data.bid_count}</span>
              <span><b>Watching</b><i className="abx-eye"><Eye size={13} strokeWidth={2} aria-hidden="true" />{data.watcher_count}</i></span>
            </div>
          </section>

          <section className="abx-panel abx-panel--flush" aria-label="Seller and auction information">
            <div className="abx-panel__body abx-info">
              <span><b>Seller / shop</b><i><Users size={13} strokeWidth={2} aria-hidden="true" />{data.shop_name || '—'}</i></span>
              <span><b>Branch</b><i><MapPin size={13} strokeWidth={2} aria-hidden="true" />{data.branch_name || branch?.name || '—'}</i></span>
              {data.status === 'scheduled' ? (
                <>
                  <span><b>Starts</b><i><Clock size={13} strokeWidth={2} aria-hidden="true" />{fmtWhenShort(data.start_time)}</i></span>
                  <span><b>Scheduled end</b><i><Clock size={13} strokeWidth={2} aria-hidden="true" />{fmtWhenShort(data.end_time)}</i></span>
                </>
              ) : data.status === 'paused' ? (
                <span><b>Ends</b><i><Clock size={13} strokeWidth={2} aria-hidden="true" />Paused</i></span>
              ) : data.status === 'ended' ? (
                <>
                  <span><b>Ended</b><i><Clock size={13} strokeWidth={2} aria-hidden="true" />{fmtWhenShort(data.end_time)}</i></span>
                  <span><b>Winner</b><i><Users size={13} strokeWidth={2} aria-hidden="true" />{data.result?.winner || '—'}</i></span>
                </>
              ) : (
                <span><b>Ends</b><i><Clock size={13} strokeWidth={2} aria-hidden="true" />In session</i></span>
              )}
            </div>
          </section>

          <section className="abx-bidders" aria-label="Live bidders">
            <header>
              <h3>Live bidders</h3>
              <span className="abx-pill-label">{data.bidders.length} recorded</span>
            </header>
            {data.bidders.length ? (
              <table>
                <thead>
                  <tr><th>Bidder</th><th>Bid amount</th><th>Time</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {data.bidders.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <span className="abx-bidder">
                          <span className="abx-bidder__av" aria-hidden="true">{initialsOf(b.bidder_name)}</span>
                          {b.bidder_name}
                        </span>
                      </td>
                      <td>{fmtMoney(b.amount)}</td>
                      <td className="abx-muted">{timeAgo(b.created_at)}</td>
                      <td>
                        {data.status === 'ended' ? '—' : b.flagged ? (
                          <span className="abx-chip">Flagged</span>
                        ) : (
                          <span className={`abx-chip${b.is_leading ? ' abx-chip--leading' : ''}`}>
                            {b.is_leading ? 'Leading' : 'Outbid'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="abx-state abx-state--empty">
                <Gavel size={22} strokeWidth={2} aria-hidden="true" />
                <p className="abx-state__sub">No bids recorded yet.</p>
              </div>
            )}
          </section>
        </>
      ) : null}
    </Drawer>
  );
}


function MonitorSkeleton() {
  return (
    <SkeletonRegion label="Loading auction monitor" className="abx">
      <Skeleton w="100%" h={190} r={0} />
      <Skeleton w={200} h={26} r="999px" style={{ margin: 16 }} />
      <Skeleton w="100%" h={150} r={14} style={{ margin: 16 }} />
      <Skeleton w="100%" h={120} r={14} style={{ margin: 16 }} />
      <div className="abx-fields" style={{ margin: 16 }}>
        <SkeletonCircle size={38} /><SkeletonCircle size={38} /><SkeletonCircle size={38} />
      </div>
    </SkeletonRegion>
  );
}

export default AuctionMonitorDrawer;