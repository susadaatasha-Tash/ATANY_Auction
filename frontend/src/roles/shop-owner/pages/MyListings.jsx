// frontend/src/roles/shop-owner/pages/MyListings.jsx
// Seller inventory: premium card grid + full listing details modal.
// Data: GET /shop-owner/listings (own shop only, server-resolved ownership).
// Delete reuses DELETE /shop-owner/auctions/:id (own scheduled auction, no bids).
// Supabase Realtime (own shop scope) patches rows without refresh.
import { useState, useEffect, useMemo, useRef } from 'react';
import { SubmitListingModal } from '../components/SubmitListingModal';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { useRealtimeProducts } from '../../../shared/hooks/useRealtimeProducts';
import { supabase } from '../../../shared/lib/supabaseClient';
import { Modal } from '../../../shared/components/Modal';
import { Skeleton, SkeletonCircle } from '../../../shared/ui/Skeleton';
import './my-listings.css';

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const LISTING_STATUSES = ['live', 'scheduled', 'paused', 'ended'];

/**
 * Skeleton card count = 2 complete rows of the large-desktop grid (4 columns),
 * so the loading state never shows a narrower grid than the loaded cards and
 * the page does not jump when real data arrives.
 */
export const SKELETON_CARDS = 8;

const STATUS_META = {
  live: { label: 'Live', cls: 'live' },
  scheduled: { label: 'Scheduled', cls: 'scheduled' },
  paused: { label: 'Paused', cls: 'paused' },
  ended: { label: 'Ended', cls: 'ended' },
};

export const DELETE_BLOCKED_MESSAGE = 'This listing cannot be deleted because it already has bids.';
export const DELETE_ORDER_MESSAGE = 'This listing cannot be deleted because it is linked to an order.';

// Single deletability rule (mirrors backend delete rules — never a guess when
// the server provides can_delete). The deciding factor is BID COUNT, never
// auction status: zero bids (any status, or no auction) → deletable.
export function isDeletable(l) {
  if (!l) return false;
  if (typeof l.can_delete === 'boolean') return l.can_delete;
  const bids = Number(l.auction?.bid_count ?? 0);
  if (!l.auction && !l.auction_id) return true;
  if (!l.auction && l.auction_id) return bids === 0;
  return bids === 0;
}

export function deleteBlockedReason(l) {
  const bids = Number(l?.auction?.bid_count ?? 0);
  if (bids > 0) return 'This listing has received bids and can no longer be deleted.';
  return DELETE_BLOCKED_MESSAGE;
}

export function getDisplayStatus(listing) {
  // Backend-computed status when available (stored auction state + times —
  // stored ended/paused are terminal and never time-resurrected).
  if (listing.computed_status) return String(listing.computed_status).toLowerCase();
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

function statusBadge(status) {
  const meta = STATUS_META[status] || { label: status, cls: 'ended' };
  return <span className={`mls-badge mls-badge--${meta.cls}`}><span className="mls-badge__dot" aria-hidden="true" />{meta.label}</span>;
}

function shortId(id) {
  const s = String(id || '');
  return s.length > 8 ? s.slice(0, 8).toUpperCase() : s.toUpperCase();
}

export default function MyListings({ listings: propListings, onSubmit, onResubmit }) {
  const [listings, setListings] = useState(propListings || []);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [highlightId, setHighlightId] = useState(null);
  const highlightTimeout = useRef(null);
  // Guards against a second concurrent /shop-owner/listings fetch on mount.
  const didFetchRef = useRef(false);
  const [shopId, setShopId] = useState(null);
  const [details, setDetails] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const showToast = useToast();

  const refresh = async () => {
    didFetchRef.current = true;
    try {
      setLoadError(null);
      const rows = await apiFetch('/shop-owner/listings');
      setListings(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setLoadError(e.message || 'Unable to load listings.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (propListings && propListings.length) { setListings(propListings); setLoading(false); didFetchRef.current = true; }
    else refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propListings]);
  useEffect(() => {
    // Shop scope resolves separately; only fetch again if the initial load has
    // genuinely produced nothing, so one page visit = one listings request.
    if (shopId && !didFetchRef.current && listings.length === 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const shop = await apiFetch('/shop-owner/shop').catch(() => null);
        if (!cancelled && shop?.id) {
          setShopId(shop.id);
        } else {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data } = await supabase.from('shops').select('id').eq('user_id', user.id).single();
            if (data?.id && !cancelled) setShopId(data.id);
          }
        }
      } catch { /* shop scope optional for initial load */ }
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
        return updated;
      }
      const created = await apiFetch('/shop-owner/listings', { method: 'POST', body: JSON.stringify(data) });
      showToast('Submitted for review — admin will approve.');
      await refresh();
      if (onSubmit) onSubmit(created);
      return created;
    } catch (e) { showToast(e.message || 'Submit failed'); return false; }
    finally { setOpen(false); setEditing(null); }
  };
  const handleClose = () => { setOpen(false); setEditing(null); };
  const handleEditResubmit = (item) => { setDetails(null); setEditing(item); setOpen(true); };

  const handleDeleteConfirm = async () => {
    if (!deleting || !isDeletable(deleting)) return;
    setDeletingBusy(true);
    try {
      // Single atomic route: removes the listing and its attached auction (if
      // any). The backend recounts bids inside the transaction — a bid landing
      // after the UI check still aborts safely with 409.
      await apiFetch(`/shop-owner/listings/${deleting.id}`, { method: 'DELETE' });
      showToast('Listing deleted.');
      setListings((prev) => prev.filter((l) => l.id !== deleting.id));
      setDeleting(null);
      setDetails(null);
      await refresh();
    } catch (e) {
      // 409 = rule rejection: friendly conflict message, never raw backend
      // text. Modal stays open; nothing was deleted.
      if (e?.code === 'LISTING_HAS_BIDS') showToast(DELETE_BLOCKED_MESSAGE);
      else if (e?.code === 'LISTING_HAS_ORDER') showToast(DELETE_ORDER_MESSAGE);
      else if (e?.status === 409) showToast(DELETE_BLOCKED_MESSAGE);
      else showToast(e.message || 'Failed to delete listing.');
    }
    finally { setDeletingBusy(false); }
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (listings || []).filter((l) => {
      if (filter !== 'all' && getDisplayStatus(l) !== filter) return false;
      if (!term) return true;
      return [l.name, l.category, l.id].some((v) => String(v || '').toLowerCase().includes(term));
    });
  }, [listings, q, filter]);

  const counts = useMemo(() => {
    const c = { all: listings.length, live: 0, scheduled: 0, paused: 0, ended: 0 };
    for (const l of listings) {
      const s = getDisplayStatus(l);
      if (c[s] != null) c[s] += 1;
    }
    return c;
  }, [listings]);

  return (
    <div className="mls-page">
      <div className="mls-head">
        <div>
          <div className="mls-eyebrow">Seller portal</div>
          <h1 className="mls-title">My Listings</h1>
        </div>
      </div>

      <div className="mls-toolbar">
        <div className="mls-search">
          <svg className="mls-search__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input className="mls-search__input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your listings..." aria-label="Search your listings" />
        </div>
        <select className="mls-filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by status">
          <option value="all">All Status</option>
          <option value="live">Live</option>
          <option value="scheduled">Scheduled</option>
          <option value="paused">Paused</option>
          <option value="ended">Ended</option>
        </select>
        <button
          type="button"
          className="mls-btn mls-btn--gold mls-btn--toolbar"
          onClick={() => { setEditing(null); setOpen(true); }}
        >
          + New Listing
        </button>
      </div>

      {loading ? (
        <div className="mls-grid" aria-label="Loading listings" data-testid="listings-skeleton-grid">
          {Array.from({ length: SKELETON_CARDS }).map((_, i) => (
            <div key={i} className="mls-card mls-skel" data-testid="listing-skeleton" aria-hidden="true">
              <div className="mls-card__imgwrap mls-skel__imgwrap">
                <Skeleton w="100%" h="100%" r={0} />
                <div className="mls-card__badge"><Skeleton w={62} h={20} r="999px" /></div>
              </div>
              <div className="mls-card__body">
                <Skeleton w="78%" h={15} />
                <Skeleton w="55%" h={12} style={{ marginTop: 7 }} />
                <Skeleton w="40%" h={12} style={{ marginTop: 6 }} />
                <Skeleton w="34%" h={15} style={{ marginTop: 10 }} />
                <div className="mls-card__actions">
                  <Skeleton w="100%" h={33} r={9} style={{ flex: 1 }} />
                  <Skeleton w={38} h={33} r={9} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="mls-state">
          <p className="mls-state__title">Unable to load listings.</p>
          <p className="mls-state__sub">Please try again.</p>
          <button type="button" className="mls-btn mls-btn--outline" onClick={() => { setLoading(true); refresh(); }}>Retry</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mls-state">
          <p className="mls-state__title">{listings.length === 0 ? 'No listings yet' : 'No listings match your filters.'}</p>
          <p className="mls-state__sub">{listings.length === 0 ? 'Add a product listing to start building your inventory.' : 'Try adjusting search or status.'}</p>
          {listings.length === 0 ? (
            <button type="button" className="mls-btn mls-btn--gold" onClick={() => { setEditing(null); setOpen(true); }}>Add product listing</button>
          ) : (
            <button type="button" className="mls-btn mls-btn--outline" onClick={() => { setQ(''); setFilter('all'); }}>Clear filters</button>
          )}
        </div>
      ) : (
        <div className="mls-grid">
          {filtered.map((l) => {
            const ds = getDisplayStatus(l);
            const canDelete = isDeletable(l);
            return (
              <article key={l.id} className="mls-card" data-testid={`listing-card-${l.id}`} style={highlightId === l.id ? { outline: '2px solid var(--gold)' } : undefined}>
                <div className="mls-card__imgwrap">
                  {l.image_url ? (
                    <img src={l.image_url} alt={l.name || 'Listing image'} loading="lazy" className="mls-card__img" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  ) : null}
                  <div className="mls-card__imgfallback" aria-hidden="true"><span>◇</span></div>
                  <div className="mls-card__badge">{statusBadge(ds)}</div>
                </div>
                <div className="mls-card__body">
                  <div className="mls-card__title" title={l.name}>{l.name}</div>
                  <div className="mls-card__cat">{l.category || 'Other'}</div>
                  <div className="mls-card__karat"><span aria-hidden="true">◇</span> {l.karat_weight || l.karat || '—'}</div>
                  <div className="mls-card__price">{peso(l.price)}</div>
                  <div className="mls-card__actions">
                    <button type="button" className="mls-btn mls-btn--view" onClick={() => setDetails(l)} aria-label={`View details for ${l.name}`}>👁 View details</button>
                    <button type="button" className="mls-btn mls-btn--icon mls-btn--danger" onClick={() => canDelete && setDeleting(l)} disabled={!canDelete} aria-label={`Delete ${l.name}`} title={canDelete ? 'Delete this listing' : 'This listing cannot be deleted because it already has bids.'}>🗑</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <SubmitListingModal open={open} onClose={handleClose} onSubmit={handleSubmit} initial={editing} mode={editing ? 'edit' : 'create'} />

      <ListingDetailsModal
        listing={details}
        onClose={() => setDetails(null)}
        onDelete={(l) => setDeleting(l)}
        onEditResubmit={handleEditResubmit}
      />

      <Modal
        open={!!deleting}
        onClose={() => { if (!deletingBusy) setDeleting(null); }}
        title=""
        className="mls-confirm"
        footer={(
          <>
            <button type="button" className="mls-btn mls-btn--outline" onClick={() => setDeleting(null)} disabled={deletingBusy}>Cancel</button>
            <button type="button" className="mls-btn mls-btn--danger-solid" onClick={handleDeleteConfirm} disabled={deletingBusy} autoFocus>{deletingBusy ? 'Deleting…' : '🗑 Delete listing'}</button>
          </>
        )}
      >
        <h3 className="mls-confirm__title">Delete listing?</h3>
        <p className="mls-confirm__body">This will permanently remove <strong>{deleting?.name}</strong> and its auction if one is attached. This action cannot be undone.</p>
      </Modal>
    </div>
  );
}

function DetailRow({ icon, label, value, title }) {
  return (
    <div className="mls-detail__row">
      <span className="mls-detail__icon" aria-hidden="true">{icon}</span>
      <span className="mls-detail__label">{label}</span>
      <span className="mls-detail__value" title={title}>{value}</span>
    </div>
  );
}

export function ListingDetailsModal({ listing, onClose, onDelete, onEditResubmit }) {
  const [imgOk, setImgOk] = useState(true);
  useEffect(() => { setImgOk(true); }, [listing?.id]);
  if (!listing) return null;
  const ds = getDisplayStatus(listing);
  const auction = listing.auction || null;
  const canDelete = isDeletable(listing);
  return (
    <Modal open={!!listing} onClose={onClose} title="Listing Details" className="mls-modal">
      <div className="mls-modal__grid">
        <div className="mls-modal__left">
          <div className="mls-modal__imgwrap">
            {listing.image_url && imgOk ? (
              <img src={listing.image_url} alt={listing.name || 'Listing image'} className="mls-modal__img" onError={() => setImgOk(false)} />
            ) : (
              <div className="mls-modal__imgfallback" aria-hidden="true"><span>◇</span></div>
            )}
          </div>
        </div>
        <div className="mls-modal__right">
          <div className="mls-modal__name">{listing.name}</div>
          <div className="mls-modal__cat">{listing.category || 'Other'}</div>
          <div className="mls-modal__badge">{statusBadge(ds)}</div>
          <div className="mls-detail">
            <DetailRow icon="◇" label="Karat / Weight" value={listing.karat_weight || listing.karat || '—'} />
            <DetailRow icon="₱" label="Suggested Price" value={peso(listing.price)} />
            <DetailRow icon="○" label="Branch" value={listing.branch_name || '—'} />
            <DetailRow icon="📅" label="Date Created" value={fmtDate(listing.created_at)} />
            <DetailRow icon="▣" label="Listing ID" value={shortId(listing.id)} title={listing.id} />
          </div>
        </div>
      </div>

      <div className="mls-section">
        <h4 className="mls-section__title">Description</h4>
        <div className="mls-desc">{listing.description ? listing.description : 'No description provided.'}</div>
      </div>

      <div className="mls-section">
        <h4 className="mls-section__title"><span aria-hidden="true">🔨</span> Auction Details</h4>
        {auction ? (
          <div className="mls-auction">
            <div className="mls-auction__grid">
              <span>Status</span><b>{STATUS_META[String(auction.status).toLowerCase()]?.label || auction.status}</b>
              <span>Starting Price</span><b>{peso(auction.start_price)}</b>
              <span>Current Bid</span><b>{peso(auction.current_bid)}</b>
              <span>Bids</span><b>{auction.bid_count ?? 0}</b>
              <span>Watchers</span><b>{auction.watcher_count ?? 0}</b>
              <span>Started</span><b>{fmtDate(auction.start_time)}</b>
              <span>Ended</span><b>{fmtDate(auction.end_time)}</b>
            </div>
          </div>
        ) : (
          <div className="mls-info"><span aria-hidden="true">ⓘ</span> No auction attached to this listing.</div>
        )}
      </div>

      <div className="mls-modal__foot">
        {listing.status === 'rejected' && (
          <button type="button" className="mls-btn mls-btn--outline" onClick={() => onEditResubmit(listing)}>Edit &amp; Resubmit</button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="mls-btn mls-btn--outline" onClick={onClose}>Close</button>
        <button type="button" className="mls-btn mls-btn--danger" onClick={() => canDelete && onDelete(listing)} disabled={!canDelete} title={canDelete ? undefined : 'This listing cannot be deleted because it already has bids.'}>🗑 Delete Listing</button>
        {!canDelete && (
          <span className="mls-note" role="note">This listing has received bids and can no longer be deleted.</span>
        )}
      </div>
    </Modal>
  );
}
