// frontend/src/roles/admin/components/AdminAuctionDrawer.jsx
// Admin → branch → Auctions → read-only monitor drawer.
//
// The admin LISTENS to the same realtime events the customer and the seller
// already use (bid:update, auction:update, auction:presence). It never bids:
// there is no bid input, no "Place bid" and no reserve control in this drawer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, Eye, Clock, Store, MapPin, UserCircle, Flag } from 'lucide-react';
import { AdminDrawer } from './AdminDrawer';
import { apiFetch } from '../../../shared/lib/apiClient';
import { socket } from '../../../shared/lib/socketClient';
import {
  peso, auctionStatusLabel, lotCode, initialsOf, timeAgo, formatDateTime,
  formatStartLabel, countdownTo,
} from '../lib/adminBranchLabels';

function Stat({ label, value, icon }) {
  return (
    <div className="adm-stat">
      <div className="adm-stat__label">{label}</div>
      <div className="adm-stat__value">
        {icon}
        {value}
      </div>
    </div>
  );
}

export function AdminAuctionDrawer({ auctionId, branch, onClose, keepRoom = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [watchers, setWatchers] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const mountedRef = useRef(true);

  const load = useCallback(async (id, { quiet } = {}) => {
    if (!id) return;
    if (!quiet) setLoading(true);
    try {
      const res = await apiFetch(`/admin/auctions/${id}`);
      if (!mountedRef.current) return;
      setData(res);
      setWatchers(Number(res?.watchers || 0));
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e.message || 'Failed to load auction');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Load the authoritative auction record whenever the drawer targets one.
  useEffect(() => {
    if (!auctionId) { setData(null); setLoading(false); return; }
    load(auctionId);
  }, [auctionId, load]);

  // Countdown ticker (cosmetic only — the server decides the winner).
  useEffect(() => {
    if (!auctionId) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [auctionId]);

  // Realtime: the admin observes the very same auction room the customer and
  // the seller use. The admin socket is an observer — it is never counted as
  // a watcher (the server only counts authenticated customers).
  useEffect(() => {
    if (!auctionId) return undefined;
    const id = String(auctionId);
    try { socket.connect(); } catch { /* the socket is optional */ }

    const onBidUpdate = (payload) => {
      if (String(payload?.auctionId || payload?.auction_id || '') !== id) return;
      load(id, { quiet: true });
    };
    const onAuctionUpdate = (payload) => {
      if (String(payload?.auction_id || payload?.id || payload?.auctionId || '') !== id) return;
      load(id, { quiet: true });
    };
    const onPresence = (payload) => {
      if (String(payload?.auctionId || payload?.auction_id || '') !== id) return;
      setWatchers(Number(payload?.watchers || 0));
    };

    try { socket.emit('join:auction', id); } catch { /* noop */ }
    socket.on('bid:update', onBidUpdate);
    socket.on('auction:update', onAuctionUpdate);
    socket.on('auction:presence', onPresence);

    return () => {
      // When the page itself owns the room (the branch page joins its live
      // auctions) the drawer must not leave it — otherwise the page would
      // silently stop receiving bid / presence updates for that auction.
      if (!keepRoom) {
        try { socket.emit('leave:auction', id); } catch { /* noop */ }
      }
      socket.off('bid:update', onBidUpdate);
      socket.off('auction:update', onAuctionUpdate);
      socket.off('auction:presence', onPresence);
    };
  }, [auctionId, load, keepRoom]);

  const open = Boolean(auctionId);
  if (!open) return null;

  const status = String(data?.status || '').toLowerCase();
  const isLive = status === 'live';
  const isPaused = status === 'paused';
  const isScheduled = status === 'scheduled';
  const isEnded = status === 'ended';
  const bids = data?.bids || [];
  const leader = data?.leader || null;
  const currentBid = data?.current_bid ?? null;
  const winner = data?.order?.buyer?.name || null;
  const finalPrice = data?.order?.amount ?? null;
  const code = lotCode(data, '—');

  const countdownTarget = isScheduled ? data?.start_time : data?.end_time;
  const countdown = isLive || isPaused
    ? countdownTo(data?.end_time, now)
    : (isScheduled ? countdownTo(data?.start_time, now) : '—');

  return (
    <AdminDrawer open={open} onClose={onClose} label={`Auction monitor — ${data?.product?.name || ''}`}>
      <div className="adm-drawer__hero">
        {data?.product?.image_url && <img src={data.product.image_url} alt="" />}
        <div className="adm-drawer__hero-scrim" />
        <div className="adm-drawer__hero-body">
          <div className="adm-drawer__tags">
            <span className="adm-drawer__lot">{code}</span>
            <span className="adm-drawer__tag">
              <i
                style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: isLive ? 'var(--success)' : isPaused ? 'var(--warn)' : 'var(--muted)',
                  display: 'block',
                }}
              />
              {auctionStatusLabel(status)}
            </span>
            <span className="adm-drawer__tag adm-drawer__tag--dark">
              <ShieldCheck size={11} /> Admin monitor
            </span>
          </div>
          <h2 className="adm-drawer__title">{data?.product?.name || (loading ? 'Loading auction…' : 'Auction')}</h2>
        </div>
      </div>

      <div className="adm-drawer__body">
        {error && <div className="adm-error">{error}</div>}

        {loading && !data ? (
          <>
            <div className="adm-skel adm-skel--line" style={{ height: 92, borderRadius: 14 }} />
            <div className="adm-skel adm-skel--line" style={{ height: 74, borderRadius: 14 }} />
            <div className="adm-skel adm-skel--line" style={{ height: 180, borderRadius: 14 }} />
          </>
        ) : (
          <>
            <div className="adm-drawer__tags" style={{ marginBottom: -6 }}>
              {(isLive || isPaused) && (
                <span className="adm-pill"><Clock size={11} /> {countdown}</span>
              )}
              {isScheduled && (
                <span className="adm-pill"><Clock size={11} /> {countdown}</span>
              )}
              <span className="adm-pill adm-pill--blue">{data?.product?.category || '—'}</span>
            </div>

            {/* Price panel */}
            <section className="adm-price-panel">
              <div className="adm-price-panel__label">
                {isEnded ? 'Final price' : 'Current / highest bid'}
              </div>
              <div className="adm-price-panel__value">
                {isScheduled
                  ? '—'
                  : (isEnded ? (finalPrice != null ? peso(finalPrice) : '—') : (currentBid != null ? peso(currentBid) : '—'))}
              </div>
              <div className="adm-price-panel__sub">
                {isScheduled && 'No bids yet · auction not started'}
                {isLive && leader && `Current leader · ${leader.name}`}
                {isPaused && leader && `Current leader · ${leader.name}`}
                {isLive && !leader && 'No bids yet · no leader'}
                {isPaused && !leader && 'No bids yet · no leader'}
                {isEnded && winner && `Winner · ${winner}`}
                {isEnded && !winner && 'Auction concluded · no winner recorded'}
              </div>
            </section>

            {/* Stat row */}
            <section className="adm-stat-row">
              <Stat label="Starting" value={data?.start_price != null ? peso(data.start_price) : '—'} />
              <Stat label="Increment" value={data?.minimum_bid_increment != null ? peso(data.minimum_bid_increment) : '—'} />
              <Stat label="Total bids" value={data?.total_bids ?? 0} />
              <Stat label="Watching" value={watchers} icon={<Eye size={13} />} />
            </section>

            {/* Seller / auction info */}
            <section>
              <h3 className="adm-section__title">Auction</h3>
              <div className="adm-field-grid">
                <div className="adm-field">
                  <div className="adm-field__label">Seller / shop</div>
                  <div className="adm-field__value">
                    <Store size={12} style={{ verticalAlign: '-2px', marginRight: 6, color: 'var(--adm-ink-soft)' }} />
                    {data?.shop?.name || '—'}
                  </div>
                </div>
                <div className="adm-field">
                  <div className="adm-field__label">Branch</div>
                  <div className="adm-field__value">
                    <MapPin size={12} style={{ verticalAlign: '-2px', marginRight: 6, color: 'var(--adm-ink-soft)' }} />
                    {data?.branch?.name || branch?.name || '—'}
                  </div>
                </div>
                <div className="adm-field">
                  <div className="adm-field__label">Auctioneer</div>
                  <div className="adm-field__value">
                    <UserCircle size={12} style={{ verticalAlign: '-2px', marginRight: 6, color: 'var(--adm-ink-soft)' }} />
                    {data?.shop?.owner_name || data?.shop?.name || '—'}
                  </div>
                </div>
                {isScheduled ? (
                  <>
                    <div className="adm-field">
                      <div className="adm-field__label">Starts</div>
                      <div className="adm-field__value">{formatStartLabel(data?.start_time)}</div>
                    </div>
                    <div className="adm-field">
                      <div className="adm-field__label">Scheduled end</div>
                      <div className="adm-field__value">{formatStartLabel(data?.end_time)}</div>
                    </div>
                  </>
                ) : (
                  <div className="adm-field">
                    <div className="adm-field__label">Ends</div>
                    <div className="adm-field__value">
                      {isPaused ? 'Paused' : isEnded ? formatDateTime(data?.end_time) : 'In session'}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Live bidders */}
            <section>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h3 className="adm-section__title" style={{ margin: 0 }}>
                  {isEnded ? 'Bid history' : 'Live bidders'}
                </h3>
                <span className="adm-pill adm-pill--grey">{bids.length} recorded</span>
              </div>
              {bids.length ? (
                <div style={{ marginTop: 10 }}>
                  <table className="adm-bidder-table">
                    <thead>
                      <tr>
                        <th>Bidder</th>
                        <th>Bid amount</th>
                        <th>Time</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bids.map((b, i) => {
                        const isLeading = !isEnded && i === 0;
                        return (
                          <tr key={`${b.rank}-${i}`}>
                            <td>
                              <span className="adm-bidder">
                                <span className="adm-bidder__avatar">{initialsOf(b.bidder_name)}</span>
                                <span className="adm-bidder__name">{b.bidder_name}</span>
                              </span>
                            </td>
                            <td><span className="adm-bidder__amount">{peso(b.amount)}</span></td>
                            <td>{timeAgo(b.created_at)}</td>
                            <td>
                              {isLeading ? (
                                <span className="adm-pill">Leading</span>
                              ) : (
                                <span className="adm-pill adm-pill--grey">Outbid</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="adm-empty">
                  <Flag size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                  {isScheduled ? 'No bidders yet — the auction has not started.' : 'No bids recorded yet.'}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <div className="adm-drawer__foot">
        <ShieldCheck size={15} />
        <span>Read-only monitoring view. Admin does not participate in bidding.</span>
      </div>
    </AdminDrawer>
  );
}

export default AdminAuctionDrawer;
