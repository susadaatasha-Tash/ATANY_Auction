// frontend/src/roles/shop-owner/pages/MyAuctions.jsx — Premium seller auction management
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { CreateAuctionModal } from '../components/CreateAuctionModal';
import { CreateAuctionWizard } from '../components/CreateAuctionWizard';
import { AuctionWizard } from '../components/AuctionWizard';
import { AuctionResultModal } from '../components/AuctionResultModal';
import { socket } from '../../../shared/lib/socketClient';
import { formatOpensIn } from '../../../shared/hooks/useAuctionCountdown';
import '../my-auctions.css';

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }
function statusLabel(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  return parts.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
}
function effectiveStatus(startTime, endTime, stored) {
  if (String(stored).toLowerCase() === 'paused') return 'paused';
  const now = new Date();
  const s = new Date(startTime);
  const e = new Date(endTime);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return String(stored || 'scheduled').toLowerCase();
  if (now < s) return 'scheduled';
  if (now >= e) return 'ended';
  return 'live';
}
function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
function AuctionTimer({ auction, onScheduledEnd }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const st = auction.status;
  const startRaw = auction.startTime ?? auction.start_time;
  const scheduledExpired = st === 'scheduled' && startRaw != null && (new Date(startRaw) - new Date(tick)) <= 0;
  useEffect(() => {
    if (scheduledExpired) onScheduledEnd?.(auction.id);
  }, [scheduledExpired, auction.id, onScheduledEnd]);
  if (st === 'ended') return <span style={{ fontSize: 12, color: '#8a919c' }}>Ended</span>;
  if (st === 'paused') return <span style={{ fontSize: 12, fontWeight: 700, color: '#8a919c' }} aria-label="Paused">Paused</span>;
  if (st === 'scheduled') {
    return <span style={{ fontSize: 12, color: '#8a6a1f' }}>{formatOpensIn(new Date(startRaw) - Date.now())}</span>;
  }
  const end = new Date(auction.endTime || auction.end_time);
  const sec = Math.max(0, Math.floor((end - new Date(tick)) / 1000));
  const urgent = sec > 0 && sec < 3600;
  if (sec <= 0) return <span className="mauc-timer__chip mauc-timer__chip--urgent">Closing…</span>;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) {
    return (
      <span className="mauc-timer" aria-label={`Closes in ${d} days ${h} hours ${m} minutes`}>
        <span className={`mauc-timer__chip ${urgent ? 'mauc-timer__chip--urgent' : ''}`}>{d}d</span>
        <span className={`mauc-timer__chip ${urgent ? 'mauc-timer__chip--urgent' : ''}`}>{String(h).padStart(2,'0')}h</span>
        <span className={`mauc-timer__chip ${urgent ? 'mauc-timer__chip--urgent' : ''}`}>{String(m).padStart(2,'0')}m</span>
      </span>
    );
  }
  if (h > 0) {
    return (
      <span className="mauc-timer" aria-label={`Closes in ${h} hours ${m} minutes ${s} seconds`}>
        <span className={`mauc-timer__chip ${urgent ? 'mauc-timer__chip--urgent' : ''}`}>{String(h).padStart(2,'0')}h</span>
        <span className={`mauc-timer__chip ${urgent ? 'mauc-timer__chip--urgent' : ''}`}>{String(m).padStart(2,'0')}m</span>
        <span className={`mauc-timer__chip ${urgent ? 'mauc-timer__chip--urgent' : ''}`}>{String(s).padStart(2,'0')}s</span>
      </span>
    );
  }
  if (m > 0) {
    return (
      <span className="mauc-timer" aria-label={`Closes in ${m} minutes ${s} seconds`}>
        <span className="mauc-timer__chip mauc-timer__chip--urgent">{String(m).padStart(2,'0')}m</span>
        <span className="mauc-timer__chip mauc-timer__chip--urgent">{String(s).padStart(2,'0')}s</span>
      </span>
    );
  }
  return (
    <span className="mauc-timer" aria-label={`Closes in ${s} seconds`}>
      <span className="mauc-timer__chip mauc-timer__chip--urgent">00m</span>
      <span className="mauc-timer__chip mauc-timer__chip--urgent">{String(s).padStart(2,'0')}s</span>
    </span>
  );
}

function AuctionCard({ auction, onAction, onViewResult, busyKey, onScheduledEnd }) {
  const st = auction.status;
  const leaderboard = auction.leaderboard || [];
  const isLive = st === 'live';
  const isScheduled = st === 'scheduled';
  const isEnded = st === 'ended';
  const isPaused = st === 'paused';
  const isBusy = (action) => busyKey === `${action}:${auction.id}`;
  return (
    <div className="mauc-card" data-testid={`auction-card-${auction.id}`}>
      <div className="mauc-card__top">
        {auction.img || auction.image_url ? (
          <img src={auction.img || auction.image_url} alt="" className="mauc-card__thumb" onError={(e) => { e.target.style.display = 'none'; }} />
        ) : (
          <div className="mauc-card__thumb mauc-card__thumb--ph"><span>◇</span></div>
        )}
        <div className="mauc-card__body">
          <div className="mauc-card__meta">
            <span className="mauc-card__lot">{auction.lot_code || auction.auction_code || `LOT-${String(auction.id).slice(0, 4).toUpperCase()}`} · {auction.category}</span>
            <span className={`mauc-badge mauc-badge--${st}`}>{st === 'live' ? 'Live' : st === 'paused' ? 'Paused' : statusLabel(st)}</span>
          </div>
          <div className="mauc-card__title">{auction.title || auction.name}</div>
          <div className="mauc-card__branch">📍 {auction.branch || auction.branch_name || 'Branch'}</div>
          <div className="mauc-stats">
            <div className="mauc-stat"><span className="mauc-stat__label">Current bid</span><span className="mauc-stat__value">{peso(auction.currentBid ?? auction.current_bid)}</span></div>
            <div className="mauc-stat"><span className="mauc-stat__label">Starting</span><span className="mauc-stat__value">{peso(auction.startPrice ?? auction.start_price)}</span></div>
            <div className="mauc-stat"><span className="mauc-stat__label">Bids</span><span className="mauc-stat__value">{auction.bid_count ?? auction.bids ?? 0}</span></div>
            <div className="mauc-stat"><span className="mauc-stat__label">Watchers</span><span className="mauc-stat__value">{auction.watcher_count ?? auction.watchers ?? 0}</span></div>
            <div className="mauc-stat">
              <span className="mauc-stat__label">{isLive ? 'Closes in' : isScheduled ? 'Opens in' : isPaused ? 'Paused' : 'Ended'}</span>
              <span className="mauc-stat__value"><AuctionTimer auction={auction} onScheduledEnd={onScheduledEnd} /></span>
              {isEnded && <span style={{ fontSize: 11, color: '#5c6674' }}>{auction.leaderboard?.[0]?.is_winner ? 'Sold' : 'Ended — No winning bid'}</span>}
            </div>
          </div>
          <div className="mauc-card__actions">
            {isLive && (
              <>
                <button className="mauc-btn" onClick={() => onAction('extend', auction)} disabled={isBusy('extend')} aria-label="Extend bidding by 5 minutes" aria-busy={isBusy('extend') ? 'true' : undefined}>{isBusy('extend') ? 'Extending…' : '⏱ Extend +5m'}</button>
                <button className="mauc-btn" onClick={() => onAction('pause', auction)} disabled={isBusy('pause')} aria-busy={isBusy('pause') ? 'true' : undefined}>{isBusy('pause') ? 'Pausing…' : '⏸ Pause'}</button>
                <button className="mauc-btn mauc-btn--danger" onClick={() => onAction('end', auction)} disabled={isBusy('end')} aria-label="End auction now" aria-busy={isBusy('end') ? 'true' : undefined}>{isBusy('end') ? 'Ending…' : '◉ End now'}</button>
              </>
            )}
            {isPaused && (
              <>
                <button className="mauc-btn mauc-btn--gold" onClick={() => onAction('resume', auction)} disabled={isBusy('resume')} aria-busy={isBusy('resume') ? 'true' : undefined}>{isBusy('resume') ? 'Resuming…' : '▶ Resume'}</button>
                <button className="mauc-btn mauc-btn--danger" onClick={() => onAction('end', auction)} disabled={isBusy('end')} aria-label="End auction now">{isBusy('end') ? 'Ending…' : '◉ End now'}</button>
              </>
            )}
            {isScheduled && (
              <>
                <button className="mauc-btn mauc-btn--gold" onClick={() => onAction('start', auction)} disabled={isBusy('start')} aria-busy={isBusy('start') ? 'true' : undefined}>{isBusy('start') ? 'Starting…' : '▶ Start now'}</button>
                <button className="mauc-btn" onClick={() => onAction('edit', auction)} disabled={isBusy('edit')}>✎ Edit lot</button>
              </>
            )}
            {isEnded && (
              <>
                <button className="mauc-btn mauc-btn--gold" onClick={() => onAction('relist', auction)} disabled={isBusy('relist')}>{isBusy('relist') ? 'Relisting…' : '↺ Relist'}</button>
                <button className="mauc-btn" onClick={() => onViewResult(auction)} aria-label={`View result for ${auction.title}`}>▭ View result</button>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="mauc-card__foot">
        <div className="mauc-leader__head"><span>BIDDER LEADERBOARD</span><span>{leaderboard.length ? `Top ${leaderboard.length}` : 'No bids yet'}</span></div>
        {leaderboard.length ? (
          leaderboard.slice(0, 4).map((row) => (
            <div key={row.bidder_id} className="mauc-leader__row">
              <span className={`mauc-leader__rank ${row.rank === 1 ? 'mauc-leader__rank--1' : ''}`}>{row.rank}</span>
              <span className="mauc-leader__avatar">{initials(row.bidder_name)}</span>
              <span style={{ minWidth: 0 }}>
                <div className="mauc-leader__name">{row.bidder_name}</div>
                <div className="mauc-leader__sub">{timeAgo(row.created_at)}</div>
              </span>
              <span className="mauc-leader__amt">{peso(row.amount)}</span>
              <span className={`mauc-leader__tag ${row.is_winner ? 'mauc-leader__tag--winner' : row.is_leading ? 'mauc-leader__tag--leading' : 'mauc-leader__tag--outbid'}`}>
                {row.is_winner ? 'Winner' : row.is_leading ? 'Leading' : 'Outbid'}
              </span>
            </div>
          ))
        ) : (
          <div style={{ textAlign: 'center', padding: '12px', color: '#8a919c', fontSize: 12, background: '#fff', borderRadius: 8 }}>Bidding opens when this auction goes live.</div>
        )}
      </div>
    </div>
  );
}

export default function MyAuctions() {
  const [data, setData] = useState(null);
  const [topBidders, setTopBidders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [q, setQ] = useState('');
  const [viewMode, setViewMode] = useState('list');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [createSession, setCreateSession] = useState(0);
  const [confirmEnd, setConfirmEnd] = useState(null);
  const [resultAuction, setResultAuction] = useState(null);
  const [relistTarget, setRelistTarget] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [endingBusy, setEndingBusy] = useState(false);
  const showToast = useToast();

  const fetchAll = useCallback(async () => {
    try {
      setError(null);
      const [manage, tb] = await Promise.all([
        apiFetch('/shop-owner/auctions/manage?limit=100').catch((e) => { throw e; }),
        apiFetch('/shop-owner/auctions/top-bidders').catch(() => []),
      ]);
      setData(manage);
      setTopBidders(Array.isArray(tb) ? tb : []);
    } catch (e) {
      setError(e.message || 'Failed to load auctions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // A scheduled countdown reaching zero triggers one refetch per auction so the
  // scheduled→live transition appears without a hard refresh (guarded against loops).
  const expiredRef = useRef(new Set());
  const handleScheduledEnd = useCallback((id) => {
    const key = String(id);
    if (!key || expiredRef.current.has(key)) return;
    expiredRef.current.add(key);
    fetchAll();
  }, [fetchAll]);

  const summary = data?.summary || { total: 0, live: 0, scheduled: 0, paused: 0, ended: 0 };
  const categories = data?.categories || [];
  const allAuctions = data?.auctions || [];

  const filtered = useMemo(() => {
    let list = allAuctions;
    if (statusFilter !== 'all') list = list.filter(a => a.status === statusFilter);
    if (catFilter !== 'all') list = list.filter(a => String(a.category).toLowerCase() === String(catFilter).toLowerCase());
    if (q.trim()) {
      const term = q.toLowerCase();
      list = list.filter(a =>
        (a.title || '').toLowerCase().includes(term) ||
        (a.lot_code || '').toLowerCase().includes(term) ||
        (a.category || '').toLowerCase().includes(term) ||
        (a.branch || '').toLowerCase().includes(term)
      );
    }
    return list;
  }, [allAuctions, statusFilter, catFilter, q]);

  const groups = useMemo(() => {
    const g = { live: [], scheduled: [], paused: [], ended: [] };
    for (const a of filtered) {
      if (a.status === 'live') g.live.push(a);
      else if (a.status === 'scheduled') g.scheduled.push(a);
      else if (a.status === 'paused') g.paused.push(a);
      else if (a.status === 'ended') g.ended.push(a);
    }
    return g;
  }, [filtered]);

  // Socket room subscription: join visible seller auctions (authenticated, public auction rooms)
  const prevJoinedRef = useRef(new Set());
  useEffect(() => {
    if (!filtered.length) return;
    const ids = filtered.map(a => String(a.id));
    const prev = prevJoinedRef.current;
    for (const id of ids) {
      if (!prev.has(id)) {
        try { socket.emit('join:auction', id); } catch {}
        prev.add(id);
      }
    }
    for (const id of Array.from(prev)) {
      if (!ids.includes(id)) {
        try { socket.emit('leave:auction', id); } catch {}
        prev.delete(id);
      }
    }
  }, [filtered]);

  useEffect(() => {
    return () => {
      for (const id of prevJoinedRef.current) {
        try { socket.emit('leave:auction', id); } catch {}
      }
      prevJoinedRef.current.clear();
    };
  }, []);

  // Realtime event contract: authoritative auction:update (patch trivial fields; refetch for leaderboard)
  useEffect(() => {
    function onAuctionUpdate(payload) {
      const aid = String(payload?.auction_id || payload?.id || payload?.auctionId || '');
      if (!aid) { fetchAll(); return; }
      setData((prev) => {
        if (!prev?.auctions) return prev;
        const idx = prev.auctions.findIndex(a => String(a.id) === aid);
        if (idx === -1) { fetchAll(); return prev; };
        // Ended is terminal (relist creates a NEW auction id). A stale live/
        // scheduled payload arriving after our optimistic ended patch must not
        // visibly resurrect the card; authoritative fetchAll() reconciles.
        const curStatus = String(prev.auctions[idx]?.status || '').toLowerCase();
        const incomingStatus = payload.status != null ? String(payload.status).toLowerCase() : null;
        if (curStatus === 'ended' && incomingStatus && incomingStatus !== 'ended') {
          return prev;
        }
        const patchable = ['status', 'current_bid', 'currentBid', 'bid_count', 'end_time', 'start_time', 'paused_at'];
        const hasPatchable = patchable.some(k => payload[k] != null);
        const needsLeaderboardRefetch = payload.leaderboard != null || payload.bid_count != null;
        if (hasPatchable && !needsLeaderboardRefetch) {
          const next = [...prev.auctions];
          const cur = { ...next[idx] };
          if (payload.status) cur.status = payload.status;
          if (payload.current_bid != null) { cur.current_bid = payload.current_bid; cur.currentBid = payload.current_bid; }
          if (payload.currentBid != null) { cur.current_bid = payload.currentBid; cur.currentBid = payload.currentBid; }
          if (payload.end_time) { cur.end_time = payload.end_time; cur.endTime = payload.end_time; }
          if (payload.start_time) { cur.start_time = payload.start_time; cur.startTime = payload.start_time; }
          if ('paused_at' in payload) cur.paused_at = payload.paused_at;
          next[idx] = cur;
          return { ...prev, auctions: next };
        }
        fetchAll();
        return prev;
      });
    }
    function onBidUpdate() { fetchAll(); }
    socket.on('auction:update', onAuctionUpdate);
    socket.on('bid:update', onBidUpdate);
    return () => {
      socket.off('auction:update', onAuctionUpdate);
      socket.off('bid:update', onBidUpdate);
    };
  }, [fetchAll]);

  const handleSave = async (formData) => {
    try {
      let payload;
      if (editing?.id) {
        payload = await apiFetch(`/shop-owner/auctions/${editing.id}`, { method: 'PUT', body: JSON.stringify(formData) });
        showToast('Auction updated');
      } else {
        payload = await apiFetch('/shop-owner/auctions', { method: 'POST', body: JSON.stringify(formData) });
        showToast('Auction created');
      }
      setOpen(false); setEditing(null);
      await fetchAll();
      return payload || true;
    } catch (e) { showToast(e.message || 'Save failed'); return false; }
  };

  const handleAction = async (type, auction) => {
    try {
      if (type === 'edit') { setEditing(auction); setOpen(true); return; }
      if (type === 'relist') {
        // The relist wizard prefills itself from the source auction.
        setRelistTarget(auction);
        return;
      }
      if (type === 'end') { setConfirmEnd(auction); return; }
      setBusyKey(`${type}:${auction.id}`);
      const map = { start: `/shop-owner/auctions/${auction.id}/start`, extend: `/shop-owner/auctions/${auction.id}/extend`, pause: `/shop-owner/auctions/${auction.id}/pause`, resume: `/shop-owner/auctions/${auction.id}/resume` };
      const body = type === 'extend' ? { minutes: 5 } : undefined;
      await apiFetch(map[type], { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      showToast(type === 'extend' ? 'Extended +5 minutes' : type === 'pause' ? 'Auction paused' : type === 'resume' ? 'Auction resumed' : 'Auction started');
      await fetchAll();
    } catch (e) { showToast(e.message || 'Action failed'); } finally { setBusyKey(null); }
  };

  const confirmEndNow = async () => {
    if (!confirmEnd) return;
    const endedId = confirmEnd.id;
    setEndingBusy(true);
    try {
      const result = await apiFetch(`/shop-owner/auctions/${endedId}/end`, { method: 'POST' });
      showToast('Auction ended');
      // Immediate local patch so the card moves Live → Ended without waiting
      // for the round trip; fetchAll() below reconciles authoritatively.
      setData((prev) => {
        if (!prev?.auctions) return prev;
        return {
          ...prev,
          auctions: prev.auctions.map((a) =>
            String(a.id) === String(endedId)
              ? { ...a, status: 'ended', end_time: result?.end_time || a.end_time, endTime: result?.end_time || a.endTime, paused_at: null }
              : a
          ),
        };
      });
      setConfirmEnd(null);
      await fetchAll();
    } catch (e) { showToast(e.message || 'End failed'); } finally { setEndingBusy(false); }
  };

  // Relist submission — the wizard owns validation, loading state and
  // double-submit protection. This only calls the existing relist endpoint and
  // refreshes the list, so the new auction appears in Scheduled/Live while the
  // original ended auction stays in Ended.
  const doRelist = async (payload) => {
    if (!relistTarget) return false;
    const created = await apiFetch(`/shop-owner/auctions/${relistTarget.id}/relist`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    showToast('Auction relisted');
    setRelistTarget(null);
    await fetchAll();
    return created || true;
  };

  // Modal: Escape closes, focus first button
  useEffect(() => {
    if (!confirmEnd && !resultAuction && !relistTarget) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { setConfirmEnd(null); setResultAuction(null); setRelistTarget(null); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmEnd, resultAuction, relistTarget]);

  if (loading) {
    return <div className="mauc-page"><div className="mauc-skeleton" style={{ height: 56 }} /><div className="mauc-skeleton" style={{ height: 120 }} /><div className="mauc-skeleton" style={{ height: 200 }} /></div>;
  }
  if (error) {
    return <div className="mauc-page"><div className="mauc-error"><span>{error}</span><button className="mauc-btn" onClick={() => { setLoading(true); fetchAll(); }}>Retry</button></div></div>;
  }

  const totalLots = summary.total;
  const showPausedTab = summary.paused > 0;

  return (
    <div className="mauc-page">
      {/* Toolbar */}
      <div className="mauc-toolbar">
        <div className="mauc-toolbar__left">
          <div className="mauc-search">
            <svg className="mauc-search__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input className="mauc-search__input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your auctions..." aria-label="Search your auctions" />
          </div>
        </div>
        <div className="mauc-toolbar__right">
          <div className="mauc-toggle" role="tablist" aria-label="View mode">
            <button className={`mauc-toggle__btn ${viewMode === 'list' ? 'is-active' : ''}`} onClick={() => setViewMode('list')} aria-selected={viewMode === 'list'}>☰ List</button>
            <button className="mauc-toggle__btn" disabled aria-disabled="true" aria-label="Calendar view — coming soon" title="Calendar view — coming soon (not yet available)">📅 Calendar</button>
          </div>
          <button className="btn btn-primary" onClick={() => { setEditing(null); setCreateSession(n => n + 1); setOpen(true); }}>+ Create Auction</button>
        </div>
      </div>

      <div className="mauc-summary">Your lots <b style={{ background: '#f3f0ea', padding: '2px 8px', borderRadius: 999, marginLeft: 6 }}>{totalLots} lot{totalLots === 1 ? '' : 's'}</b></div>

      {/* Status pills */}
      <div className="mauc-pillbar" role="tablist" aria-label="Auction status">
        {[
          ['all', 'All status', summary.total],
          ['live', 'Live', summary.live],
          ['scheduled', 'Scheduled', summary.scheduled],
          ...(showPausedTab ? [['paused', 'Paused', summary.paused]] : []),
          ['ended', 'Ended', summary.ended],
        ].map(([key, label, count]) => (
          <button key={key} className={`mauc-pill ${statusFilter === key ? 'is-active' : ''}`} onClick={() => setStatusFilter(key)} role="tab" aria-selected={statusFilter === key}>
            {label} <span className="mauc-pill__count">{count}</span>
          </button>
        ))}
      </div>

      {/* Category */}
      <div className="mauc-categorybar">
        <span className="mauc-catlabel">Category</span>
        <button className={`mauc-catpill ${catFilter === 'all' ? 'is-active' : ''}`} onClick={() => setCatFilter('all')}>All categories</button>
        {categories.map(c => (
          <button key={c.name} className={`mauc-catpill ${catFilter === c.name ? 'is-active' : ''}`} onClick={() => setCatFilter(c.name)}>
            {c.name} <span style={{ fontSize: 11, color: '#8a919c' }}>{c.count}</span>
          </button>
        ))}
      </div>

      <div className="mauc-layout">
        <div className="mauc-main">
          {!filtered.length ? (
            <div className="mauc-empty">
              <p style={{ fontWeight: 700, color: '#142a4a' }}>{totalLots === 0 ? 'No auctions yet' : 'No auctions match your filters.'}</p>
              <p style={{ fontSize: 12 }}>{totalLots === 0 ? 'Create your first auction to start receiving bids.' : 'Try adjusting search, status or category.'}</p>
              {totalLots === 0 && <button className="mauc-btn mauc-btn--gold" style={{ marginTop: 10 }} onClick={() => { setEditing(null); setCreateSession(n => n + 1); setOpen(true); }}>Create Auction</button>}
            </div>
          ) : (
            <>
              {groups.live.length > 0 && (
                <div className="mauc-section">
                  <div className="mauc-section__head"><span className="dot" style={{ background: '#2e9a55' }} aria-hidden="true" /> Live now <span className="count">{groups.live.length}</span></div>
                  {groups.live.map(a => <AuctionCard key={a.id} auction={a} onAction={handleAction} onViewResult={setResultAuction} busyKey={busyKey} onScheduledEnd={handleScheduledEnd} />)}
                </div>
              )}
              {groups.paused.length > 0 && (
                <div className="mauc-section">
                  <div className="mauc-section__head"><span className="dot" style={{ background: '#8a919c' }} aria-hidden="true" /> Paused <span className="count">{groups.paused.length}</span></div>
                  {groups.paused.map(a => <AuctionCard key={a.id} auction={a} onAction={handleAction} onViewResult={setResultAuction} busyKey={busyKey} onScheduledEnd={handleScheduledEnd} />)}
                </div>
              )}
              {groups.scheduled.length > 0 && (
                <div className="mauc-section">
                  <div className="mauc-section__head"><span className="dot" style={{ background: '#c4a265' }} aria-hidden="true" /> Scheduled <span className="count">{groups.scheduled.length}</span></div>
                  {groups.scheduled.map(a => <AuctionCard key={a.id} auction={a} onAction={handleAction} onViewResult={setResultAuction} busyKey={busyKey} onScheduledEnd={handleScheduledEnd} />)}
                </div>
              )}
              {groups.ended.length > 0 && (
                <div className="mauc-section">
                  <div className="mauc-section__head"><span className="dot" style={{ background: '#142a4a' }} aria-hidden="true" /> Ended <span className="count">{groups.ended.length}</span></div>
                  {groups.ended.map(a => <AuctionCard key={a.id} auction={a} onAction={handleAction} onViewResult={setResultAuction} busyKey={busyKey} onScheduledEnd={handleScheduledEnd} />)}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#8a919c', padding: '4px 2px' }}>Showing {filtered.length} of {totalLots} lot{totalLots === 1 ? '' : 's'}</div>
            </>
          )}
        </div>

        <div className="mauc-side">
          <div className="mauc-panel">
            <div className="mauc-panel__title">Top Bidders</div>
            <div className="mauc-panel__sub">Most active buyers this month</div>
            <div style={{ marginTop: 10 }}>
              {topBidders.length ? topBidders.map((b, idx) => (
                <div key={b.bidder_id} className="mauc-bidder">
                  <span style={{ width: 22, height: 22, borderRadius: '50%', background: idx === 0 ? '#c4a265' : '#f3f0ea', color: idx === 0 ? '#fff' : '#8a6a1f', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800 }}>{idx + 1}</span>
                  <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#142a4a', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800 }}>{initials(b.bidder_name)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#142a4a' }}>{b.bidder_name}</div>
                    <div style={{ fontSize: 11, color: '#8a919c' }}>{b.bids} bids · {b.lots_won} lot{b.lots_won === 1 ? '' : 's'} won</div>
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: '#142a4a' }}>{peso(b.total_won || 0)}</span>
                </div>
              )) : <div style={{ fontSize: 12, color: '#8a919c', padding: '12px 0' }}>No bidder activity this month.</div>}
            </div>
          </div>

          <div className="mauc-panel">
            <div className="mauc-panel__title">Lot controls</div>
            <div className="mauc-panel__sub">What each action does</div>
            <div className="mauc-ctrl"><span className="mauc-ctrl__icon">⏱</span><span><div className="mauc-ctrl__title">Extend bidding</div><div className="mauc-ctrl__desc">Add 5 minutes to any live lot so late bidders can join.</div></span></div>
            <div className="mauc-ctrl"><span className="mauc-ctrl__icon">⏸</span><span><div className="mauc-ctrl__title">Pause & resume</div><div className="mauc-ctrl__desc">Freeze the clock instantly without cancelling the auction.</div></span></div>
            <div className="mauc-ctrl"><span className="mauc-ctrl__icon">◎</span><span><div className="mauc-ctrl__title">Close early</div><div className="mauc-ctrl__desc">End a lot before its timer and pick the current leader.</div></span></div>
          </div>
        </div>
      </div>

      {/* Create/Edit modals */}
      {editing?.id ? (
        <CreateAuctionModal open={open} onClose={() => { setOpen(false); setEditing(null); }} initial={editing} onSubmit={handleSave} />
      ) : (
        <CreateAuctionWizard key={createSession} open={open} onClose={() => { setOpen(false); setEditing(null); }} onSubmit={handleSave} />
      )}

      {/* Confirm End — destructive, focus trap, Esc closes */}
      {confirmEnd && (
        <div className="modal-overlay show" onClick={() => !endingBusy && setConfirmEnd(null)} role="dialog" aria-modal="true" aria-labelledby="confirm-end-title">
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-box-head"><h3 id="confirm-end-title">End auction now?</h3></div>
            <div className="modal-box-body"><p style={{ fontSize: 13, color: '#5c6674' }}>This will stop bidding immediately and determine the auction result using the current valid bids.</p></div>
            <div className="modal-box-foot">
              <button className="btn btn-outline" onClick={() => setConfirmEnd(null)} disabled={endingBusy}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmEndNow} disabled={endingBusy} aria-busy={endingBusy ? 'true' : undefined} style={{ background: '#b45252', borderColor: '#b45252' }}>{endingBusy ? 'Ending…' : 'End auction'}</button>
            </div>
          </div>
        </div>
      )}

      {/* View Result — premium structured result modal, server state on open */}
      {resultAuction && (
        <AuctionResultModal
          auction={resultAuction}
          open={!!resultAuction}
          onClose={() => setResultAuction(null)}
          onRelist={(a) => { setResultAuction(null); setRelistTarget(a); }}
        />
      )}

      {/* Relist — the SAME 4-step wizard as Create Auction, prefilled from the
          original lot. The original ended auction is never modified. */}
      {relistTarget && (
        <AuctionWizard
          key={`relist-${relistTarget.id}`}
          mode="relist"
          open={!!relistTarget}
          sourceAuction={relistTarget}
          onClose={() => setRelistTarget(null)}
          onSubmit={doRelist}
        />
      )}
    </div>
  );
}
