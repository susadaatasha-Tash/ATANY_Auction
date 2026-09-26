// frontend/src/roles/customer/pages/LiveAuctions.jsx
// Branch-aware per spec: auctions → products → shops → branches (home_branch_id). No branch_id on auctions.
// Frontend filter dropdown populated from GET /branches (Open only). Selecting re-queries with ?branch_id=.
import { useState, useMemo, useEffect, useCallback } from 'react';
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

export default function LiveAuctions({ auctions: propAuctions }) {
  const { user } = useAuth();
  const { branchId: contextBranchId } = useBranch();
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
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

  const filtered = useMemo(() => (auctions || []).filter((a) => {
    const name = (a.name || a.product || '').toLowerCase();
    return name.includes(q.toLowerCase()) && (!statusFilter || a.status === statusFilter) && (!branchFilter || String(a.branch_id) === String(branchFilter)) && (!categoryFilter || a.category === categoryFilter);
  }), [auctions, q, statusFilter, branchFilter, categoryFilter]);
  const [detailAuction, setDetailAuction] = useState(null);
  const handleCloseDetail = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setDetailId(null);
    setDetailAuction(null);
  };
  useEffect(() => {
    if (!detailId) { setDetailAuction(null); return; }
    const base = auctions.find((a) => a.id === detailId);
    setDetailAuction(base || null);
    apiFetch(`/customer/auctions/${detailId}`).then((full) => setDetailAuction(full)).catch(() => {});
  }, [detailId, auctions]);

  const handlePlaceBid = async (auctionId, amount) => {
    if (!amount || !Number.isFinite(Number(amount))) throw new Error('Enter a valid bid');
    const res = await apiFetch('/customer/bids', { method: 'POST', body: JSON.stringify({ auctionId, amount: Number(amount) }) });
    // Use server's actual current_bid from response, not client increment
    const newBidAmount = res?.bid?.amount ?? Number(amount);
    showToast('Bid placed');
    // Update local auctions immediately from server response (optimistic + confirmed)
    setAuctions((prev) => prev.map((a) => a.id === auctionId ? { ...a, currentBid: newBidAmount, current_bid: newBidAmount, bids: (a.bids || 0) + 1 } : a));
    if (detailAuction && detailAuction.id === auctionId) {
      setDetailAuction((prev) => prev ? { ...prev, currentBid: newBidAmount, current_bid: newBidAmount, bids: (prev.bids || 0) + 1 } : prev);
    }
    // Then refresh from server to ensure consistency
    const qs = branchFilter ? `?branch_id=${branchFilter}` : '';
    const path = statusFilter ? `/customer/auctions?status=${statusFilter}${branchFilter ? `&branch_id=${branchFilter}` : ''}` : `/customer/auctions${qs}`;
    try {
      const rows = await apiFetch(path);
      setAuctions(rows);
      if (detailId) {
        const full = await apiFetch(`/customer/auctions/${detailId}`).catch(() => null);
        if (full) setDetailAuction(full);
      }
    } catch {}
  };

  // Sync branch filter with context (initial load + user switch from topbar)
  useEffect(() => {
    if (contextBranchId) {
      setBranchFilter(contextBranchId);
    }
  }, [contextBranchId]);
  const fetchAuctions = useCallback(async () => {
    const qs = branchFilter ? `?branch_id=${branchFilter}` : '';
    const path = statusFilter ? `/customer/auctions?status=${statusFilter}${branchFilter ? `&branch_id=${branchFilter}` : ''}` : `/customer/auctions${qs}`;
    console.log('[LiveAuctions] fetchAuctions called', { branchFilter, statusFilter, path });
    try {
      const rows = await apiFetch(path);
      console.log('[LiveAuctions] fetchAuctions success', rows.length, 'auctions');
      setAuctions(rows);
    } catch (e) {
      console.log('[LiveAuctions] fetchAuctions failed, trying fallback', e.message);
      try {
        const rows = await apiFetch(`/api/auctions/live${qs}`);
        console.log('[LiveAuctions] fallback success', rows.length);
        setAuctions(rows);
      } catch (e2) {
        console.log('[LiveAuctions] fallback failed', e2.message);
        setAuctions([]);
      }
    }
  }, [branchFilter, statusFilter]);

  // Real mode: always fetch from backend (no mock fallback)
  useEffect(() => {
    console.log('[LiveAuctions] initial fetch', { branchFilter, statusFilter });
    fetchAuctions();
  }, [fetchAuctions]);

  // Realtime: new auction INSERT -> refresh list without page reload (reuses existing fetch)
  useEffect(() => {
    const channelName = `customer-auctions-${user?.id || 'anon'}`;
    console.log('[LiveAuctions Realtime] Creating subscription...', channelName, 'userId', user?.id, 'branchFilter', branchFilter, 'statusFilter', statusFilter);
    const channel = supabase.channel(channelName);
    console.log('[LiveAuctions Realtime] Channel created', channelName);
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auctions' }, (payload) => {
      console.log('[LiveAuctions Realtime] INSERT received', JSON.stringify({ eventType: payload.eventType, new: payload.new, table: payload.table }));
      console.log('[LiveAuctions Realtime] INSERT payload new.id', payload.new?.id, 'status', payload.new?.status, 'start_time', payload.new?.start_time, 'branch via product?', payload.new?.product_id);
      // Check if INSERT should be visible given current filters
      const newStatus = payload.new?.status;
      const newBranch = payload.new?.branch_id || 'unknown (need product→shop→branch lookup)';
      if (statusFilter && newStatus && newStatus !== statusFilter) {
        console.log('[LiveAuctions] INSERT received but filtered out - status mismatch', { newStatus, statusFilter });
      }
      if (branchFilter) {
        console.log('[LiveAuctions] INSERT received - branch filter active, will refetch and filter via backend', { branchFilter, newBranch });
      }
      console.log('[LiveAuctions] Fetching auctions after realtime INSERT');
      fetchAuctions();
    }).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'auctions' }, (payload) => {
      console.log('[LiveAuctions Realtime] UPDATE received', JSON.stringify({ eventType: payload.eventType, new: payload.new, old: payload.old }));
      console.log('[LiveAuctions Realtime] UPDATE payload new.id', payload.new?.id, 'status', payload.new?.status, 'old status', payload.old?.status);
      fetchAuctions();
    }).subscribe((status, err) => {
      console.log('[LiveAuctions Realtime] Subscription status:', status, 'channel', channelName, err || '');
      if (status === 'SUBSCRIBED') console.log('[LiveAuctions Realtime] SUBSCRIBED', channelName, 'userId', user?.id);
      if (status === 'CHANNEL_ERROR') console.warn('[LiveAuctions Realtime] CHANNEL_ERROR', channelName, err);
      if (status === 'TIMED_OUT') console.warn('[LiveAuctions Realtime] TIMED_OUT', channelName);
      if (status === 'CLOSED') console.log('[LiveAuctions Realtime] CLOSED', channelName);
    });
    return () => {
      console.log('[LiveAuctions Realtime] Cleaning up', channelName);
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [fetchAuctions, user?.id]);

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="search-box"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search live auctions…" /></div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Live & Scheduled</option><option value="live">Live Now</option><option value="scheduled">Scheduled</option><option value="ended">Ended</option>
          </select>
          <select className="filter-select" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); const p = new URLSearchParams(searchParams); if (e.target.value) p.set('category', e.target.value); else p.delete('category'); setSearchParams(p, { replace: true }); }}>
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="watch-grid">
        {filtered.length ? filtered.map((a) => {
          const isFavorited = favorites.some((w) => w.product_id === (a.productId || a.product_id));
          const isNotifying = reminders.some((r) => r.auction_id === a.id);
          return <AuctionCard key={a.id} auction={a} isFavorited={isFavorited} isNotifying={isNotifying} onOpenDetail={setDetailId} onToggleFavorite={onToggleFavorite} onToggleNotify={onToggleNotify} onPlaceBid={handlePlaceBid} />;
        }) : <div className="empty-state" style={{ gridColumn: '1/-1' }}><p>No auctions match your search.</p></div>}
      </div>
      {detailAuction && <DetailModal auction={detailAuction} isFavorited={favorites.some((w) => w.product_id === (detailAuction.productId || detailAuction.product_id))} isNotifying={reminders.some((r) => r.auction_id === detailAuction.id)} onClose={handleCloseDetail} onToggleFavorite={onToggleFavorite} onToggleNotify={onToggleNotify} onPlaceBid={handlePlaceBid} />}
    </div>
  );
}
