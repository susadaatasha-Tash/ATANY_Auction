// frontend/src/roles/customer/pages/MyBids.jsx
// Customer → My Bids.
//
// The page shell (sidebar, topbar, chatbot, background) is untouched — only
// the content panel was redesigned.
//
// Real data only: GET /customer/bids returns one row per auction the customer
// has bid on, with the product, branch, authoritative current bid, total bid
// count, current leader and the authoritative order/winner state.
//
//   Summary cards   Active Bids / Winning / Past Bids  (calculated, clickable)
//   Search          name, category, karat, branch or auction code
//   Status filter   All / Active / Winning / Outbid / Won / Lost
//   Table           ITEM · YOUR BID · CURRENT BID · BIDS · ENDS · STATUS
//   Row action      live → open the auction, won → the order, else → the auction
//   Realtime        reuses the shared socket client (bid:update / auction:update)
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { peso } from '../lib/currency';
import { formatCountdownShort, formatOpensIn } from '../../../shared/hooks/useAuctionCountdown';
import { socket } from '../../../shared/lib/socketClient';
import { DetailModal } from '../components/DetailModal';
import { useFavorites } from '../hooks/useFavorites';
import { useReminders } from '../hooks/useReminders';
import { BID_STATUSES, bidDisplayStatus, bidScope, bidStatusMeta, bidSearchText } from '../lib/bidStatus';
import { Gavel, Trophy, ClipboardList, Search, ChevronRight, AlertTriangle, Store } from 'lucide-react';
import './MyBids.css';

const REFRESH_DEBOUNCE_MS = 1200;

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function SummaryCard({ icon, tone, label, value, description, active, onClick, testId }) {
  return (
    <button
      type="button"
      className={`mb-card mb-card--${tone}${active ? ' is-active' : ''}`}
      onClick={onClick}
      aria-pressed={!!active}
      data-testid={testId}
    >
      <span className={`mb-card__icon mb-card__icon--${tone}`} aria-hidden="true">{icon}</span>
      <span className="mb-card__body">
        <span className="mb-card__label">{label}</span>
        <span className="mb-card__value">{value}</span>
        <span className="mb-card__desc">{description}</span>
      </span>
      <ChevronRight size={16} className="mb-card__chev" aria-hidden="true" />
    </button>
  );
}

export default function MyBids() {
  const navigate = useNavigate();
  const showToast = useToast();
  const { items: favorites, toggle: toggleFavorite } = useFavorites();
  const { items: reminders, toggle: toggleNotify } = useReminders();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [cardFilter, setCardFilter] = useState('');
  const [detailAuction, setDetailAuction] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const refreshTimer = useRef(null);

  const load = useCallback(async (opts = {}) => {
    const { silent } = opts;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/customer/bids');
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || 'Unable to load your bids.');
      if (!silent) setRows([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // One shared ticker for the whole page (no interval per row).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // A live auction whose countdown reached zero may have ended server-side —
  // reconcile with the authoritative list.
  const expiredRef = useRef(new Set());
  useEffect(() => {
    const hit = rows.some((r) => {
      if (String(r.auction_status || '').toLowerCase() !== 'live') return false;
      const end = r.end_time ? new Date(r.end_time).getTime() : 0;
      return end > 0 && end <= now;
    });
    if (!hit) return;
    load({ silent: true });
  }, [rows, now, load]);

  // ── Realtime (shared socket client — no second connection) ───────────────
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => { load({ silent: true }); }, REFRESH_DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    try { socket.connect(); } catch { /* the socket is optional */ }

    const onBidUpdate = (payload) => {
      const aid = String(payload?.auctionId || payload?.auction_id || payload?.id || '');
      if (!aid) return;
      const nextBid = payload?.currentBid ?? payload?.current_bid;
      setRows((prev) => prev.map((r) => {
        if (String(r.auction_id) !== aid) return r;
        if (nextBid == null) return r;
        const currentBid = Number(nextBid);
        const leading = currentBid === Number(r.yourBid) ? true : currentBid > Number(r.yourBid) ? false : r.is_leading;
        return {
          ...r,
          currentBid,
          is_leading: leading,
          total_bids: (r.total_bids || 0) + 1,
          bidsCount: (r.bidsCount || 0) + 1,
        };
      }));
      scheduleRefresh();
    };

    const onAuctionUpdate = (payload) => {
      const aid = String(payload?.auction_id || payload?.id || payload?.auctionId || '');
      if (!aid) { scheduleRefresh(); return; }
      setRows((prev) => prev.map((r) => {
        if (String(r.auction_id) !== aid) return r;
        const next = { ...r };
        if (payload.status) next.auction_status = String(payload.status).toLowerCase();
        if (payload.end_time) next.end_time = payload.end_time;
        if (payload.start_time) next.start_time = payload.start_time;
        if (payload.current_bid != null) next.currentBid = payload.current_bid;
        return next;
      }));
      scheduleRefresh();
    };

    socket.on('bid:update', onBidUpdate);
    socket.on('auction:update', onAuctionUpdate);
    return () => {
      socket.off('bid:update', onBidUpdate);
      socket.off('auction:update', onAuctionUpdate);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [scheduleRefresh]);

  // ── Derived data ─────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    let active = 0;
    let winning = 0;
    let past = 0;
    rows.forEach((r) => {
      if (bidScope(r) === 'past') { past += 1; return; }
      active += 1;
      if (bidDisplayStatus(r) === 'winning') winning += 1;
    });
    return { active, winning, past };
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (cardFilter === 'active' && bidScope(r) !== 'active') return false;
      if (cardFilter === 'past' && bidScope(r) !== 'past') return false;
      if (cardFilter === 'winning' && bidDisplayStatus(r) !== 'winning') return false;
      if (statusFilter) {
        if (statusFilter === 'active') {
          if (bidScope(r) !== 'active') return false;
        } else if (bidDisplayStatus(r) !== statusFilter) return false;
      }
      if (needle && !bidSearchText(r).includes(needle)) return false;
      return true;
    });
  }, [rows, q, statusFilter, cardFilter]);

  const endsCell = (row) => {
    const state = String(row.auction_status || '').toLowerCase();
    if (state === 'ended') return { primary: 'Ended', secondary: formatDate(row.end_time) };
    if (state === 'scheduled') {
      const start = row.start_time ? new Date(row.start_time).getTime() : 0;
      return { primary: formatOpensIn(start - now), secondary: formatDate(row.start_time) };
    }
    const end = row.end_time ? new Date(row.end_time).getTime() : 0;
    const sec = end > 0 ? Math.max(0, Math.floor((end - now) / 1000)) : 0;
    return { primary: formatCountdownShort(sec), secondary: formatDate(row.end_time) };
  };

  const actionLabel = (row) => {
    if (row.won && row.order_id) return 'View purchase';
    if (String(row.auction_status || '').toLowerCase() === 'ended') return 'View result';
    return 'View auction';
  };

  const openRow = (row) => {
    if (row.won && row.order_id) {
      navigate(`/customer/orders/${row.order_id}`);
      return;
    }
    setDetailAuction({
      id: row.auction_id,
      name: row.item,
      img: row.img,
      currentBid: row.currentBid,
      current_bid: row.currentBid,
      bids: row.total_bids,
      branch_name: row.branch_name,
      start_time: row.start_time,
      end_time: row.end_time,
      status: row.auction_status,
      minimum_bid_increment: row.minimum_bid_increment,
      start_price: row.start_price,
      product_id: row.product_id,
      desc: row.karat_weight ? `${row.karat_weight}` : '',
    });
  };

  const handlePlaceBid = async (auctionId, amount) => {
    if (!amount || !Number.isFinite(Number(amount))) throw new Error('Enter a valid bid');
    const res = await apiFetch('/customer/bids', { method: 'POST', body: JSON.stringify({ auctionId, amount: Number(amount) }) });
    showToast('Bid placed');
    await load({ silent: true });
    return res;
  };

  const handleToggleFavorite = async (productId) => {
    const wasFavorited = favorites.some((w) => w.product_id === productId);
    try {
      await toggleFavorite(productId);
      showToast(wasFavorited ? 'Removed from favorites' : 'Added to favorites');
    } catch {
      showToast('Failed to update favorites');
    }
  };

  const handleToggleNotify = async (auctionId) => {
    const wasNotifying = reminders.some((r) => r.auction_id === auctionId);
    try {
      await toggleNotify(auctionId);
      showToast(wasNotifying ? 'Removed from notifications' : "We'll notify you when live");
    } catch {
      showToast('Failed to set notification — check login');
    }
  };

  const clearFilters = () => {
    setQ('');
    setStatusFilter('');
    setCardFilter('');
  };

  // ── States ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mb-page">
        <div className="mb-cards" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="mb-card mb-card--skeleton">
              <div className="mb-skel" style={{ width: 46, height: 46, borderRadius: 999 }} />
              <div className="mb-skel" style={{ width: '55%', height: 12, marginTop: 12 }} />
              <div className="mb-skel" style={{ width: '35%', height: 26, marginTop: 8 }} />
              <div className="mb-skel" style={{ width: '75%', height: 11, marginTop: 10 }} />
            </div>
          ))}
        </div>
        <div className="mb-panel" aria-hidden="true">
          <div className="mb-toolbar">
            <div className="mb-skel" style={{ width: 320, height: 40, borderRadius: 10 }} />
            <div className="mb-skel" style={{ width: 150, height: 40, borderRadius: 10 }} />
          </div>
          <div className="mb-table-wrap">
            <table className="mb-table">
              <thead>
                <tr>
                  <th>Item</th><th>Your Bid</th><th>Current Bid</th><th>Bids</th><th>Ends</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <tr key={i}>
                    <td><div className="mb-skel" style={{ width: 220, height: 16 }} /></td>
                    <td><div className="mb-skel" style={{ width: 80, height: 16 }} /></td>
                    <td><div className="mb-skel" style={{ width: 90, height: 16 }} /></td>
                    <td><div className="mb-skel" style={{ width: 40, height: 16 }} /></td>
                    <td><div className="mb-skel" style={{ width: 90, height: 16 }} /></td>
                    <td><div className="mb-skel" style={{ width: 80, height: 22, borderRadius: 999 }} /></td>
                    <td><div className="mb-skel" style={{ width: 24, height: 24 }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-page">
        <div className="mb-panel">
          <div className="mb-empty">
            <span className="mb-empty__icon"><AlertTriangle size={20} aria-hidden="true" /></span>
            <p className="mb-empty__title">Unable to load your bids</p>
            <p className="mb-empty__text">{error}</p>
            <button type="button" className="btn btn-primary" onClick={() => load()}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const hasFilters = !!(q.trim() || statusFilter || cardFilter);

  return (
    <div className="mb-page">
      {/* Summary cards — clickable quick filters */}
      <div className="mb-cards">
        <SummaryCard
          testId="mb-card-active"
          icon={<Gavel size={20} />}
          tone="gold"
          label="Active Bids"
          value={counts.active}
          description="Bids you're currently participating in"
          active={cardFilter === 'active'}
          onClick={() => setCardFilter((c) => (c === 'active' ? '' : 'active'))}
        />
        <SummaryCard
          testId="mb-card-winning"
          icon={<Trophy size={20} />}
          tone="green"
          label="Winning"
          value={counts.winning}
          description="Items you're currently winning"
          active={cardFilter === 'winning'}
          onClick={() => setCardFilter((c) => (c === 'winning' ? '' : 'winning'))}
        />
        <SummaryCard
          testId="mb-card-past"
          icon={<ClipboardList size={20} />}
          tone="navy"
          label="Past Bids"
          value={counts.past}
          description="Completed auctions"
          active={cardFilter === 'past'}
          onClick={() => setCardFilter((c) => (c === 'past' ? '' : 'past'))}
        />
      </div>

      {/* Search + status filter */}
      <div className="mb-toolbar">
        <div className="mb-search" role="search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your bids by item name..."
            aria-label="Search your bids by item name"
          />
        </div>
        <select
          className="mb-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter bids by status"
        >
          <option value="">All Status</option>
          {BID_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="mb-panel">
        <div className="mb-table-wrap">
          <table className="mb-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Your Bid</th>
                <th scope="col">Current Bid</th>
                <th scope="col">Bids</th>
                <th scope="col">Ends</th>
                <th scope="col">Status</th>
                <th scope="col" className="mb-table__action-head"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    {rows.length === 0 ? (
                      <div className="mb-empty">
                        <span className="mb-empty__icon"><Gavel size={20} aria-hidden="true" /></span>
                        <p className="mb-empty__title">No bids yet</p>
                        <p className="mb-empty__text">You haven't placed any bids yet.</p>
                        <button type="button" className="btn btn-primary" onClick={() => navigate('/customer/auctions')}>
                          Browse Auctions
                        </button>
                      </div>
                    ) : (
                      <div className="mb-empty">
                        <p className="mb-empty__title">No bids match your filters</p>
                        <p className="mb-empty__text">Try a different search term, status or summary card.</p>
                        <button type="button" className="btn btn-outline" onClick={clearFilters}>Clear filters</button>
                      </div>
                    )}
                  </td>
                </tr>
              ) : filtered.map((row) => {
                const status = bidDisplayStatus(row);
                const meta = bidStatusMeta(status);
                const ends = endsCell(row);
                return (
                  <tr
                    key={row.auction_id}
                    className="mb-row"
                    data-testid={`mb-row-${row.auction_id}`}
                    onClick={() => openRow(row)}
                  >
                    <td data-label="Item">
                      <div className="mb-item">
                        {row.img ? (
                          <img className="mb-thumb" src={row.img} alt={row.item ? `${row.item} thumbnail` : 'Auction item'} loading="lazy" />
                        ) : (
                          <span className="mb-thumb mb-thumb--empty" aria-hidden="true"><Gavel size={16} /></span>
                        )}
                        <span className="mb-item__text">
                          <span className="mb-item__name">{row.item || 'Untitled lot'}</span>
                          <span className="mb-item__meta">
                            {[row.category, row.branch_name].filter(Boolean).join(' · ') || '—'}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td data-label="Your Bid"><span className="mb-bid">{peso(row.yourBid)}</span></td>
                    <td data-label="Current Bid"><span className="mb-bid mb-bid--current">{peso(row.currentBid)}</span></td>
                    <td data-label="Bids"><span className="mb-count">{row.total_bids ?? row.bidsCount ?? 0}</span></td>
                    <td data-label="Ends">
                      <span className="mb-ends">
                        <span className="mb-ends__primary">{ends.primary}</span>
                        {ends.secondary && <span className="mb-ends__secondary">{ends.secondary}</span>}
                      </span>
                    </td>
                    <td data-label="Status">
                      <span className={`mb-status mb-status--${meta.tone}`}>
                        <span className="mb-status__dot" aria-hidden="true" />
                        {meta.label}
                      </span>
                    </td>
                    <td className="mb-table__action">
                      <button
                        type="button"
                        className="mb-chevron"
                        aria-label={`${actionLabel(row)}: ${row.item || 'lot'}`}
                        onClick={(e) => { e.stopPropagation(); openRow(row); }}
                      >
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {detailAuction && (
        <DetailModal
          auction={detailAuction}
          isFavorited={favorites.some((w) => w.product_id === (detailAuction.product_id || detailAuction.productId))}
          isNotifying={reminders.some((r) => r.auction_id === detailAuction.id)}
          onClose={() => setDetailAuction(null)}
          onToggleFavorite={handleToggleFavorite}
          onToggleNotify={handleToggleNotify}
          onPlaceBid={handlePlaceBid}
        />
      )}
    </div>
  );
}
