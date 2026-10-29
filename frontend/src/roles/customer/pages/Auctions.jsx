// frontend/src/roles/customer/pages/Auctions.jsx
// Customer Auctions — intentionally supports Live + Scheduled (branch-scoped), Ended excluded.
// Paused seller auctions are excluded from browse (not shown as live).
// Reuses effectiveStatus logic; branch filtering, search+category+status compose.
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AuctionCard } from '../components/AuctionCard';
import { DetailModal } from '../components/DetailModal';
import { apiFetch } from '../../../shared/lib/apiClient';
import { supabase } from '../../../shared/lib/supabaseClient';
import { useAuth } from '../../../shared/hooks/useAuth';
import { useBranch } from '../../../shared/hooks/useBranch';
import { useFavorites } from '../hooks/useFavorites';
import { useReminders } from '../hooks/useReminders';
import { useToast } from '../../../shared/components/Toast';

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

export default function Auctions({ auctions: propAuctions }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id || null;
  const { branchId: contextBranchId, branchName, branches } = useBranch();
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // '' = All (live+scheduled)
  const [branchFilter, setBranchFilter] = useState('');
  const [auctions, setAuctions] = useState([]);
  const [detailId, setDetailId] = useState(null);

  const { items: favorites, toggle: toggleFavorite } = useFavorites();
  const { items: reminders, toggle: toggleNotify } = useReminders();
  const showToast = useToast();
  const onToggleFavorite = async (productId) => {
    const wasFavorited = favorites.some((w) => w.product_id === productId);
    try {
      await toggleFavorite(productId);
      showToast(wasFavorited ? 'Removed from favorites' : 'Added to favorites');
    } catch (e) {
      console.error('Favorites toggle failed', e);
      showToast('Failed to update favorites');
    }
  };
  const onToggleNotify = async (auctionId) => {
    const wasNotifying = reminders.some((r) => r.auction_id === auctionId);
    try {
      await toggleNotify(auctionId);
      showToast(wasNotifying ? 'Removed from notifications' : "We'll notify you when live");
    } catch (e) {
      console.error('Notify Me failed', e);
      showToast('Failed to set notification — check login');
    }
  };

  const [categoryFilter, setCategoryFilter] = useState(() => searchParams.get('category') || '');
  const categories = ['Rings', 'Necklaces', 'Bracelets', 'Earrings', 'Watches'];

  // Compute branch display name for empty states
  const activeBranchName = branchName || branches.find((b) => String(b.id) === String(branchFilter))?.name || 'your branch';

  const filtered = useMemo(() => {
    return (auctions || []).filter((a) => {
      const name = (a.name || a.product || '').toLowerCase();
      // Exclude paused and ended from customer browse (paused: show as paused is not browsable; ended excluded)
      const st = (a.startTime || a.start_time) && (a.endTime || a.end_time) ? effectiveStatus(a.startTime || a.start_time, a.endTime || a.end_time, a.status) : String(a.status || '').toLowerCase();
      if (st === 'paused' || st === 'ended') return false;
      // Status filter: '' = All (live+scheduled), else exact
      if (statusFilter && st !== statusFilter) return false;
      if (branchFilter && String(a.branch_id) !== String(branchFilter)) return false;
      if (categoryFilter && a.category !== categoryFilter) return false;
      return name.includes(q.toLowerCase());
    });
  }, [auctions, q, statusFilter, branchFilter, categoryFilter]);

  const grouped = useMemo(() => {
    const live = [];
    const scheduled = [];
    for (const a of filtered) {
      const st = effectiveStatus(a.startTime || a.start_time, a.endTime || a.end_time, a.status);
      if (st === 'live') live.push(a);
      else if (st === 'scheduled') scheduled.push(a);
    }
    return { live, scheduled };
  }, [filtered]);

  const [detailAuction, setDetailAuction] = useState(null);
  const handleCloseDetail = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setDetailId(null);
    setDetailAuction(null);
    if (searchParams.get('auction')) {
      const next = new URLSearchParams(searchParams);
      next.delete('auction');
      setSearchParams(next, { replace: true });
    }
  };
  // Deep link: /customer/auctions?auction=<id> opens that auction's detail modal.
  // This makes the customer auction page addressable from outside (e.g. the
  // landing page bid CTA and post-login redirects) WITHOUT adding a second page
  // or duplicating any bidding logic. Stale ids are cleared once the list loads.
  useEffect(() => {
    const wanted = searchParams.get('auction');
    if (wanted && wanted !== detailId) setDetailId(wanted);
    if (!wanted && detailId) { setDetailId(null); setDetailAuction(null); }
  }, [searchParams, detailId]);

  useEffect(() => {
    if (!detailId) { setDetailAuction(null); return; }
    const base = auctions.find((a) => a.id === detailId);
    setDetailAuction(base || null);
    apiFetch(`/customer/auctions/${detailId}`).then((full) => setDetailAuction(full)).catch(() => {});
  }, [detailId, auctions]);

  const handlePlaceBid = async (auctionId, amount) => {
    if (!amount || !Number.isFinite(Number(amount))) throw new Error('Enter a valid bid');
    const target = auctions.find((a) => a.id === auctionId);
    const st = target ? effectiveStatus(target.startTime || target.start_time, target.endTime || target.end_time, target.status) : 'unknown';
    if (st !== 'live') throw new Error('Bidding is only allowed on live auctions');
    const res = await apiFetch('/customer/bids', { method: 'POST', body: JSON.stringify({ auctionId, amount: Number(amount) }) });
    const newBidAmount = res?.bid?.amount ?? Number(amount);
    showToast('Bid placed');
    setAuctions((prev) => prev.map((a) => a.id === auctionId ? { ...a, currentBid: newBidAmount, current_bid: newBidAmount, bids: (a.bids || 0) + 1 } : a));
    if (detailAuction && detailAuction.id === auctionId) {
      setDetailAuction((prev) => prev ? { ...prev, currentBid: newBidAmount, current_bid: newBidAmount, bids: (prev.bids || 0) + 1 } : prev);
    }
    const qs = branchFilter ? `?branch_id=${branchFilter}` : '';
    const path = statusFilter ? `/customer/auctions?status=${statusFilter}${branchFilter ? `&branch_id=${branchFilter}` : ''}` : `/customer/auctions${qs}`;
    try {
      const rows = await apiFetch(path);
      setAuctions(rows.filter((r) => {
        const st2 = effectiveStatus(r.startTime || r.start_time, r.endTime || r.end_time, r.status);
        return st2 !== 'paused' && st2 !== 'ended';
      }));
      if (detailId) {
        const full = await apiFetch(`/customer/auctions/${detailId}`).catch(() => null);
        if (full) setDetailAuction(full);
      }
    } catch {}
  };

  useEffect(() => {
    if (contextBranchId) setBranchFilter(contextBranchId);
  }, [contextBranchId]);

  const fetchAuctions = useCallback(async () => {
    if (authLoading) return;
    if (!userId) {
      setAuctions([]);
      return;
    }
    // Use neutral endpoint /customer/auctions (supports ?status=all|live|scheduled) — compatibility fallback to /api/auctions
    const qs = branchFilter ? `?branch_id=${branchFilter}` : '';
    const path = statusFilter ? `/customer/auctions?status=${statusFilter}${branchFilter ? `&branch_id=${branchFilter}` : ''}` : `/customer/auctions${qs}`;
    try {
      const rows = await apiFetch(path);
      const visible = (rows || []).filter((r) => {
        const st = effectiveStatus(r.startTime || r.start_time, r.endTime || r.end_time, r.status);
        return st !== 'paused' && st !== 'ended';
      });
      setAuctions(visible);
    } catch (e) {
      if (e?.code === 'AUTH_REQUIRED' || e?.status === 401) {
        setAuctions([]);
        return;
      }
      try {
        const qs2 = branchFilter ? `?branch_id=${branchFilter}` : '';
        const rows = await apiFetch(`/api/auctions/live${qs2}`, { public: true });
        const visible = (rows || []).filter((r) => {
          const st = effectiveStatus(r.startTime || r.start_time, r.endTime || r.end_time, r.status);
          return st !== 'paused' && st !== 'ended';
        });
        setAuctions(visible);
      } catch (e2) {
        setAuctions([]);
      }
    }
  }, [branchFilter, statusFilter, authLoading, userId]);

  useEffect(() => { fetchAuctions(); }, [fetchAuctions]);

  // A scheduled countdown reaching zero triggers one refetch per auction so the
  // scheduled→live transition appears without a hard refresh (guarded against loops).
  const expiredRef = useRef(new Set());
  const handleScheduledEnd = useCallback((id) => {
    const key = String(id);
    if (!key || expiredRef.current.has(key)) return;
    expiredRef.current.add(key);
    fetchAuctions();
  }, [fetchAuctions]);

  // Realtime: INSERT/UPDATE -> refresh (also handles scheduled→live transition without hard refresh)
  useEffect(() => {
    const channelName = `customer-auctions-${userId || 'anon'}`;
    const channel = supabase.channel(channelName);
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auctions' }, () => { fetchAuctions(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'auctions' }, () => { fetchAuctions(); })
      .subscribe();
    return () => { try { supabase.removeChannel(channel); } catch {} };
  }, [fetchAuctions, userId]);

  // Also poll for scheduled→live transition when timer ends (fallback if realtime delayed)
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const hasTransition = auctions.some((a) => {
        const st = effectiveStatus(a.startTime || a.start_time, a.endTime || a.end_time, a.status);
        return st === 'scheduled' && new Date(a.startTime || a.start_time).getTime() <= now;
      });
      if (hasTransition) fetchAuctions();
    }, 30000);
    return () => clearInterval(id);
  }, [auctions, fetchAuctions]);

  const emptyMessage = useMemo(() => {
    if (q.trim()) return 'No auctions match your search and filters.';
    if (statusFilter === 'live') return `No live auctions are available for ${activeBranchName}.`;
    if (statusFilter === 'scheduled') return `No scheduled auctions are available for ${activeBranchName}.`;
    return `No live or scheduled auctions are available for ${activeBranchName}.`;
  }, [q, statusFilter, activeBranchName]);

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="search-box"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search auctions…" aria-label="Search auctions" /></div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="">All</option><option value="live">Live</option><option value="scheduled">Scheduled</option>
          </select>
          <select className="filter-select" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); const p = new URLSearchParams(searchParams); if (e.target.value) p.set('category', e.target.value); else p.delete('category'); setSearchParams(p, { replace: true }); }}>
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {filtered.length ? (
        <>
          {/* When All, group; when filtered to one status, show single grid */}
          {statusFilter === '' ? (
            <>
              {grouped.live.length > 0 && (
                <div style={{ padding: '12px 16px 0', fontWeight: 700, fontSize: 13, color: 'var(--navy, #142a4a)' }}>Live now — {grouped.live.length}</div>
              )}
              {grouped.live.length > 0 && (
                <div className="watch-grid">
                  {grouped.live.map((a) => {
                    const isFavorited = favorites.some((w) => w.product_id === (a.productId || a.product_id));
                    const isNotifying = reminders.some((r) => r.auction_id === a.id);
                    return <AuctionCard key={a.id} auction={a} isFavorited={isFavorited} isNotifying={isNotifying} onOpenDetail={setDetailId} onToggleFavorite={onToggleFavorite} onToggleNotify={onToggleNotify} onPlaceBid={handlePlaceBid} onScheduledEnd={handleScheduledEnd} />;
                  })}
                </div>
              )}
              {grouped.scheduled.length > 0 && (
                <div style={{ padding: '12px 16px 0', fontWeight: 700, fontSize: 13, color: 'var(--navy, #142a4a)' }}>Scheduled — {grouped.scheduled.length}</div>
              )}
              {grouped.scheduled.length > 0 && (
                <div className="watch-grid">
                  {grouped.scheduled.map((a) => {
                    const isFavorited = favorites.some((w) => w.product_id === (a.productId || a.product_id));
                    const isNotifying = reminders.some((r) => r.auction_id === a.id);
                    return <AuctionCard key={a.id} auction={a} isFavorited={isFavorited} isNotifying={isNotifying} onOpenDetail={setDetailId} onToggleFavorite={onToggleFavorite} onToggleNotify={onToggleNotify} onPlaceBid={handlePlaceBid} onScheduledEnd={handleScheduledEnd} />;
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="watch-grid">
              {filtered.map((a) => {
                const isFavorited = favorites.some((w) => w.product_id === (a.productId || a.product_id));
                const isNotifying = reminders.some((r) => r.auction_id === a.id);
                return <AuctionCard key={a.id} auction={a} isFavorited={isFavorited} isNotifying={isNotifying} onOpenDetail={setDetailId} onToggleFavorite={onToggleFavorite} onToggleNotify={onToggleNotify} onPlaceBid={handlePlaceBid} onScheduledEnd={handleScheduledEnd} />;
              })}
            </div>
          )}
        </>
      ) : (
        <div className="empty-state" style={{ gridColumn: '1/-1', padding: '32px' }}><p>{emptyMessage}</p></div>
      )}
      {detailAuction && <DetailModal auction={detailAuction} isFavorited={favorites.some((w) => w.product_id === (detailAuction.productId || detailAuction.product_id))} isNotifying={reminders.some((r) => r.auction_id === detailAuction.id)} onClose={handleCloseDetail} onToggleFavorite={onToggleFavorite} onToggleNotify={onToggleNotify} onPlaceBid={handlePlaceBid} />}
    </div>
  );
}
