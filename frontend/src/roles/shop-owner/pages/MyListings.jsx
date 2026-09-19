// frontend/src/roles/shop-owner/pages/MyListings.jsx
// Real mode: GET/POST /shop-owner/listings → products.status pending → admin sees it in /admin/products
// Now with Supabase Realtime (scoped to own shop) for live status updates without refresh
import { useState, useEffect, useRef } from 'react';
import { SubmitListingModal } from '../components/SubmitListingModal';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { useRealtimeProducts } from '../../../shared/hooks/useRealtimeProducts';
import { supabase } from '../../../shared/lib/supabaseClient';
import { ConfirmModal } from '../../../shared/components/Modal';

function getDisplayStatus(listing) {
  // Use backend-computed status when available (derived from auction start/end times)
  if (listing.computed_status) return listing.computed_status;
  // Fallback: compute from product proposed times
  const now = new Date();
  const start = listing.proposed_start_time ? new Date(listing.proposed_start_time) : null;
  const end = listing.proposed_end_time ? new Date(listing.proposed_end_time) : null;

  if (start && start > now) return 'scheduled';
  if (end && end < now) return 'ended';
  if (start && start <= now) return 'live';

  if (listing.status === 'approved') return 'live';
  if (listing.status === 'pending') return 'scheduled';
  if (listing.status === 'rejected') return 'ended';
  return 'scheduled';
}

export default function MyListings({ listings: propListings, onSubmit, onResubmit }) {
  const [listings, setListings] = useState(propListings || []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [highlightId, setHighlightId] = useState(null);
  const highlightTimeout = useRef(null);
  const [shopId, setShopId] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const showToast = useToast();

  const refresh = async () => {
    try {
      const rows = await apiFetch('/shop-owner/listings');
      console.log('[MyListings] GET /shop-owner/listings returned', Array.isArray(rows) ? rows.length : 0, 'rows:', rows?.slice?.(0,1));
      setListings(rows);
    } catch (e) {
      console.error('[MyListings] fetch failed', e);
      setListings(propListings || []);
    }
  };
  useEffect(() => { if (propListings && propListings.length) setListings(propListings); else refresh(); }, [propListings]);
  // Re-fetch once shopId is resolved (covers case where initial fetch happened before shop row was ensured)
  useEffect(() => {
    if (shopId && listings.length === 0) {
      console.log('[MyListings] shopId resolved, re-fetching listings for', shopId);
      refresh();
    }
  }, [shopId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Try shop-owner shop endpoint first
        const shop = await apiFetch('/shop-owner/shop').catch(() => null);
        if (!cancelled && shop?.id) {
          setShopId(shop.id);
        } else {
          // Fallback: fetch from Supabase auth
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data } = await supabase.from('shops').select('id').eq('user_id', user.id).single();
            if (data?.id && !cancelled) setShopId(data.id);
          }
        }
      } catch (e) {
        console.error('Failed to set shop ID', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const triggerHighlight = (id) => {
    setHighlightId(id);
    clearTimeout(highlightTimeout.current);
    highlightTimeout.current = setTimeout(() => setHighlightId(null), 2500);
  };

  useRealtimeProducts({
    filter: shopId ? `shop_id=eq.${shopId}` : undefined,
    enabled: !!shopId,
    onUpdate: (row) => {
      setListings((prev) => {
        const exists = prev.some(p => p.id === row.id);
        if (!exists) return prev;
        return prev.map(p => p.id === row.id ? { ...p, ...row } : p);
      });
      triggerHighlight(row.id);
      if (row.status === 'approved') showToast(`Your item was approved: ${row.name}`);
      if (row.status === 'rejected') showToast(`Your item was rejected: ${row.name}`);
    },
    onInsert: (row) => {
      setListings((prev) => prev.some(p => p.id === row.id) ? prev : [row, ...prev]);
    },
  });

  const handleSubmit = async (data) => {
    try {
      if (editing) {
        const updated = await apiFetch(`/shop-owner/listings/${editing.id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Changes saved — resubmitted for review.');
        await refresh();
        if (onResubmit) onResubmit(editing.id);
      } else {
        const created = await apiFetch('/shop-owner/listings', { method: 'POST', body: JSON.stringify(data) });
        showToast('Submitted for review — admin will approve.');
        await refresh();
        if (onSubmit) onSubmit(created);
      }
    } catch (e) { showToast(e.message || 'Submit failed'); }
    setOpen(false);
    setEditing(null);
  };
  const handleEditClick = (item) => {
    setEditing(item);
    setOpen(true);
  };
  const handleClose = () => { setOpen(false); setEditing(null); };

  const handleDeleteClick = (item) => { setDeleting(item); };
  const handleDeleteConfirm = async () => {
    if (!deleting?.auction_id) return;
    setDeletingId(deleting.auction_id);
    try {
      await apiFetch(`/shop-owner/auctions/${deleting.auction_id}`, { method: 'DELETE' });
      showToast('Auction deleted.');
      await refresh();
    } catch (e) { showToast(e.message || 'Failed to delete auction.'); }
    finally { setDeleting(null); setDeletingId(null); }
  };

  const filtered = (listings || []).filter((l) => {
    const statusOk = !filter || getDisplayStatus(l) === filter;
    const nameOk = (l.name || '').toLowerCase().includes(q.toLowerCase());
    return nameOk && statusOk;
  });
  // Debug: log listings vs filtered to identify filtering issue
  if (typeof window !== 'undefined' && listings.length && !filtered.length && filter) {
    console.warn('[MyListings] listings exist but filtered is empty — filter=', filter, 'listings statuses:', listings.map(l => ({ name: l.name, status: l.status, computed: l.computed_status, display: getDisplayStatus(l) })));
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="search-box"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your listings…" /></div>
        <select className="filter-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All Status</option><option value="live">Live</option><option value="scheduled">Scheduled</option><option value="ended">Ended</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Item</th><th>Category</th><th>Karat / Weight</th><th>Suggested Price</th><th>Status</th><th /></tr></thead>
          <tbody>{filtered.length ? filtered.map((l) => {
            const ds = getDisplayStatus(l);
            return <tr key={l.id} style={highlightId === l.id ? { background: 'rgba(199,166,106,.12)', transition: 'background .3s ease' } : undefined}><td className="cell-main"><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{l.image_url && <img src={l.image_url} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: 'cover' }} onError={(e) => e.target.style.display='none'} /> }<span>{l.name}</span></div></td><td>{l.category}</td><td>{l.karat_weight || l.karat}</td><td>₱{Number(l.price).toLocaleString()}</td><td><span className={`badge ${ds}`}>{ds === 'live' ? 'Live' : ds === 'scheduled' ? 'Scheduled' : 'Ended'}</span></td><td><div className="row-actions">{l.status === 'rejected' && <button className="btn-ghost" onClick={() => handleEditClick(l)}>Edit & Resubmit</button>}{l.auction_id && <button className="btn-danger-ghost" disabled={deletingId === l.auction_id} onClick={() => handleDeleteClick(l)}>{deletingId === l.auction_id ? 'Deleting…' : 'Delete'}</button>}</div></td></tr>;
          }) : <tr><td colSpan={6}><div className="empty-state"><p>No listings yet.</p></div></td></tr>}</tbody>
        </table>
      </div>
      <SubmitListingModal open={open} onClose={handleClose} onSubmit={handleSubmit} initial={editing} mode={editing ? 'edit' : 'create'} />
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete Auction?"
        body={<>Are you sure you want to delete <strong>{deleting?.name}</strong>?<br />This will remove the auction from your listings.</>}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
