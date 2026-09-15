// frontend/src/roles/customer/pages/LiveAuctions.jsx
// Branch-aware per spec: auctions → products → shops → branches (home_branch_id). No branch_id on auctions.
// Frontend filter dropdown populated from GET /branches (Open only). Selecting re-queries with ?branch_id=.
import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AuctionCard } from '../components/AuctionCard';
import { DetailModal } from '../components/DetailModal';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useBranch } from '../../../shared/hooks/useBranch';
import { useWishlist } from '../hooks/useWishlist';
import { useReminders } from '../hooks/useReminders';
import { useToast } from '../../../shared/components/Toast';

export default function LiveAuctions({ auctions: propAuctions }) {
  const { branchId: contextBranchId } = useBranch();
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [auctions, setAuctions] = useState([]);
  const [detailId, setDetailId] = useState(null);

  const { items: watchlist, toggle: toggleWatch } = useWishlist();
  const { items: reminders, toggle: toggleNotify } = useReminders();
  const showToast = useToast();
  const onToggleWatch = async (productId) => {
    const wasWatched = watchlist.some((w) => w.product_id === productId);
    try {
      await toggleWatch(productId);
      showToast(wasWatched ? 'Removed from watchlist' : 'Added to watchlist');
    } catch (e) {
      console.error('Watchlist toggle failed', e);
      showToast('Failed to update watchlist');
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
    return name.includes(q.toLowerCase()) && (!statusFilter || a.status === statusFilter) && (!branchFilter || a.branch_id === branchFilter) && (!categoryFilter || a.category === categoryFilter);
  }), [auctions, q, statusFilter, branchFilter, categoryFilter]);
  const [detailAuction, setDetailAuction] = useState(null);
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
  // Real mode: always fetch from backend (no mock fallback)
  useEffect(() => {
    const qs = branchFilter ? `?branch_id=${branchFilter}` : '';
    const path = statusFilter ? `/customer/auctions?status=${statusFilter}${branchFilter ? `&branch_id=${branchFilter}` : ''}` : `/customer/auctions${qs}`;
    apiFetch(path).then(setAuctions).catch(() => apiFetch(`/api/auctions/live${qs}`).then(setAuctions).catch(() => setAuctions([])));
  }, [statusFilter, branchFilter]);

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
          const isWatched = watchlist.some((w) => w.product_id === (a.productId || a.product_id));
          const isNotifying = reminders.some((r) => r.auction_id === a.id);
          return <AuctionCard key={a.id} auction={a} isWatched={isWatched} isNotifying={isNotifying} onOpenDetail={setDetailId} onToggleWatch={onToggleWatch} onToggleNotify={onToggleNotify} onPlaceBid={handlePlaceBid} />;
        }) : <div className="empty-state" style={{ gridColumn: '1/-1' }}><p>No auctions match your search.</p></div>}
      </div>
      {detailAuction && <DetailModal auction={detailAuction} isWatched={watchlist.some((w) => w.product_id === (detailAuction.productId || detailAuction.product_id))} isNotifying={reminders.some((r) => r.auction_id === detailAuction.id)} onClose={() => setDetailId(null)} onToggleWatch={onToggleWatch} onToggleNotify={onToggleNotify} onPlaceBid={handlePlaceBid} />}
    </div>
  );
}
