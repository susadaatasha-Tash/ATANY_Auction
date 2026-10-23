// frontend/src/roles/shop-owner/pages/MyListings.jsx
// Premium grid view of seller listings with a full details modal.
// Real data only — GET /shop-owner/listings for the grid,
// GET /shop-owner/listings/:id for modal detail, DELETE /shop-owner/listings/:id for removal.
// Ownership enforced server-side; frontend never trusts shop_id from the browser.
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Gem, Search, Trash2, Eye, Clock, Loader2, Tag, MapPin, CalendarDays, FileText, Gavel, Trophy, Wallet, ClipboardCopy } from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { resolveDisplayImage } from '../../../shared/lib/defaultProductImage';
import { useToast } from '../../../shared/components/Toast';
import { useRealtimeProducts } from '../../../shared/hooks/useRealtimeProducts';
import { Modal, ConfirmModal } from '../../../shared/components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { SubmitListingModal } from '../components/SubmitListingModal';
import '../my-listings.css';

/* ── Presentation helpers (single source of truth for status labels/tones) ── */
const STATUS_TONE = {
  live: { label: 'Live', tone: 'success' },
  scheduled: { label: 'Scheduled', tone: 'warn' },
  paused: { label: 'Paused', tone: 'muted' },
  ended: { label: 'Ended', tone: 'neutral' },
};

function presentationFor(listing) {
  if (!listing) {
    return { label: 'Unknown', tone: 'neutral' };
  }
  const key = (listing.computed_status || listing.status || 'scheduled').toString().toLowerCase();
  return STATUS_TONE[key] || { label: 'Scheduled', tone: 'neutral' };
}

function cardToneClass(tone) {
  const map = { success: 'live', warn: 'scheduled', muted: 'ended', neutral: 'paused', info: 'paused', danger: 'ended' };
  return map[tone] || 'scheduled';
}

function peso(n) {
  return '₱' + Number(n || 0).toLocaleString();
}

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function shortUuid(id, len = 8) {
  if (!id) return '—';
  const s = String(id);
  return s.length > len ? s.slice(0, len) + '…' : s;
}

function hasImage(url) {
  return Boolean(url && String(url).trim().length > 0);
}

const STATUS_FILTERS = [
  { key: '', label: 'All Status' },
  { key: 'live', label: 'Live' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'paused', label: 'Paused' },
  { key: 'ended', label: 'Ended' },
];

export default function MyListings({ listings: propListings, onSubmit, onResubmit }) {
  const showToast = useToast();

  /* ── State ── */
  const [listings, setListings] = useState(propListings || []);
  const [shopId, setShopId] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(propListings && propListings.length ? false : true);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  /* ── Fetch list ── */
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch('/shop-owner/listings');
      setListings(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e.message || 'Unable to load listings. Please try again.');
      setListings(propListings || []);
    } finally {
      setLoading(false);
    }
  }, [propListings]);

  useEffect(() => {
    if (propListings && propListings.length) {
      setListings(propListings);
      setLoading(false);
    } else {
      refresh();
    }
  }, [propListings, refresh]);

  /* ── Resolve shop (server-owned, for realtime scope) ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const shop = await apiFetch('/shop-owner/shop').catch(() => null);
        if (!cancelled && shop?.id) setShopId(shop.id);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ── Realtime product updates ── */
  useRealtimeProducts({
    filter: shopId ? `shop_id=eq.${shopId}` : undefined,
    enabled: !!shopId,
    onUpdate: (row) => {
      setListings((prev) => {
        const exists = prev.some(p => p.id === row.id);
        if (!exists) return prev;
        return prev.map(p => p.id === row.id ? { ...p, ...row } : p);
      });
    },
    onInsert: (row) => {
      setListings((prev) => prev.some(p => p.id === row.id) ? prev : [row, ...prev]);
    },
  });

  /* ── Filtered list (client-side; all listings already loaded) ── */
  const filtered = useMemo(() => {
    return (listings || []).filter((l) => {
      const statusOk = !filter || presentationFor(l).label === filter;
      const nameOk = (l.name || '').toLowerCase().includes(q.toLowerCase());
      return nameOk && statusOk;
    });
  }, [listings, q, filter]);

  /* ── Handlers ── */
  const handleViewDetails = (listing) => {
    setSelected(listing);
    setModalOpen(true);
    setModalLoading(true);
    // Detail endpoint adds branch name (not in list payload) + authoritative auction
    apiFetch(`/shop-owner/listings/${listing.id}`)
      .then((data) => {
        setSelected((prev) => ({
          ...prev,
          ...(data.listing || {}),
          branch: data.branch || null,
          auction: data.auction || null,
        }));
        setModalLoading(false);
      })
      .catch(() => {
        setModalLoading(false);
        showToast('Unable to load listing details.');
      });
  };

  const handleCloseModal = () => { setModalOpen(false); setSelected(null); setModalLoading(false); };

  const handleDeleteClick = (listing) => {
    // Delete is always visible; backend is authoritative on whether it can proceed.
    // Bid count / can_delete comes from the listing payload (backend-computed).
    if (listing.can_delete === false) return; // bids exist — backend will reject anyway
    setDeleting({ id: listing.id, name: listing.name });
  };

  const handleDeleteConfirm = async () => {
    if (!deleting) return;
    setDeletingId(deleting.id);
    try {
      await apiFetch(`/shop-owner/listings/${deleting.id}`, { method: 'DELETE' });
      showToast('Listing deleted.');
      setListings((prev) => prev.filter((l) => l.id !== deleting.id));
      setDeleting(null);
      setDeletingId(null);
      if (selected?.id === deleting.id) handleCloseModal();
    } catch (e) {
      // Friendly handling for authoritative backend 409 codes
      if (e.code === 'LISTING_HAS_BIDS') {
        showToast('This listing cannot be deleted because it already has bids.');
      } else if (e.code === 'LISTING_HAS_ORDER') {
        showToast('This listing cannot be deleted because it is linked to an order.');
      } else {
        showToast(e.message || 'Failed to delete listing.');
      }
      setDeleting(null);
      setDeletingId(null);
    }
  };

  /* ── Create / Edit submit flow ── */
  const handleSubmit = async (data) => {
    try {
      if (editing) {
        await apiFetch(`/shop-owner/listings/${editing.id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Changes saved — resubmitted for review.');
      } else {
        await apiFetch('/shop-owner/listings', { method: 'POST', body: JSON.stringify(data) });
        showToast('Submitted for review — admin will approve.');
      }
      await refresh();
      setSubmitOpen(false);
      setEditing(null);
      if (onSubmit) onSubmit();
      if (onResubmit && editing) onResubmit(editing.id);
    } catch (e) { showToast(e.message || 'Submit failed'); }
  };

  const handleEditClick = (item) => { setEditing(item); setSubmitOpen(true); };
  const handleCloseSubmit = () => { setSubmitOpen(false); setEditing(null); };

  /* ── Render listing card ── */
  const renderCard = (l) => {
    const st = presentationFor(l);
    const price = peso(l.price);
    const karat = l.karat_weight || l.karat || '—';
    // The resolved display image: the seller's own upload wins; a product
    // with no photo falls back to the ATANY default photo (never an empty box).
    const imageUrl = resolveDisplayImage(l);
    const isDeleting = deletingId === l.id;
    const canDelete = l.can_delete !== false; // backend-computed; default true if absent
    const deleteDisabled = !canDelete || isDeleting;

    return (
      <div className="ml-card" key={l.id} role="listitem" tabIndex={0} onClick={() => handleViewDetails(l)}>
        <div className="ml-card__image-wrap">
          {hasImage(imageUrl) ? (
            <img className="ml-card__image" src={imageUrl} alt={l.name} loading="lazy" />
          ) : (
            <div className="ml-card__image--fallback"><Gem size={22} /></div>
          )}
          <span className={`ml-card__status ml-card__status--${cardToneClass(st.tone)}`}>{st.label}</span>
        </div>
        <div className="ml-card__body">
          <div className="ml-card__title" title={l.name}>{l.name}</div>
          <div className="ml-card__meta">
            <span className="ml-card__category">{l.category}</span>
            <span className="ml-card__divider" aria-hidden="true" />
            <span className="ml-card__karat">◇ {karat}</span>
          </div>
          <div className="ml-card__price">{price}</div>
          <div className="ml-card__actions">
            <button className="ml-card__view" onClick={(e) => { e.stopPropagation(); handleViewDetails(l); }}>
              <Eye size={14} /> View details
            </button>
            <button
              className={`ml-card__delete ${deleteDisabled ? 'ml-card__delete--disabled' : ''}`}
              disabled={deleteDisabled}
              onClick={(e) => { e.stopPropagation(); handleDeleteClick(l); }}
              aria-label={`Delete ${l.name}`}
              title={!canDelete ? 'This listing cannot be deleted because it already has bids.' : `Delete ${l.name}`}
            >
              <Trash2 size={14} />
              {isDeleting ? ' Deleting…' : ' Delete'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  /* ── Page shell ── */
  return (
    <div className="ml-page">
      {/* Toolbar — the page title lives in the portal topbar, so the content
          starts directly with the search + status filter (no duplicate heading). */}
      <div className="ml-toolbar">
        <div className="ml-search">
          <Search size={16} className="ml-search__icon" />
          <input
            className="ml-search__input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your listings…"
            aria-label="Search your listings"
          />
        </div>
        <div className="ml-filter">
          <span className="ml-filter__label">Status</span>
          <select className="ml-filter__select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter listings by status">
            {STATUS_FILTERS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="ml-error">
          <span>{error}</span>
          <button type="button" className="ml-card__view" onClick={refresh} style={{ padding: '4px 10px', fontSize: '12px' }}>Retry</button>
        </div>
      )}

      {/* Grid */}
      <div className={loading ? 'ml-skeleton-grid' : 'ml-grid'}>
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div className="ml-skeleton-card" key={i}>
              <div className="ml-skeleton-img" />
              <div className="ml-skeleton-body">
                <div className="ml-skeleton-line ml-skeleton-line--title" />
                <div className="ml-skeleton-line ml-skeleton-line--meta" />
                <div className="ml-skeleton-line ml-skeleton-line--meta" />
                <div className="ml-skeleton-line ml-skeleton-line--price" />
                <div className="ml-skeleton-line ml-skeleton-line--actions" />
              </div>
            </div>
          ))
        ) : filtered.length ? (
          filtered.map(renderCard)
        ) : (
          <div className="ml-empty">
            <div className="ml-empty__icon"><Gem size={26} /></div>
            <h2 className="ml-empty__title">{q || filter ? 'No listings match your filters.' : 'No listings yet'}</h2>
            <p className="ml-empty__text">
              {q || filter
                ? 'Try adjusting your search or status filter.'
                : 'Add a product listing to start building your inventory.'}
            </p>
            {(!q && !filter) && (
              <button className="ml-card__view" onClick={() => setSubmitOpen(true)}>
                <Gem size={14} style={{ marginRight: 6 }} /> Create Listing
              </button>
            )}
            {(q || filter) && (
              <button className="ml-card__view" onClick={() => { setQ(''); setFilter(''); }}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Detail modal */}
      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        title="Listing Details"
        className="ml-modal-box"
      >
        <div className="ml-modal-body">
          {modalLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '40px 0' }}>
              <Loader2 size={24} />
              <span style={{ fontSize: '13px', color: '#8a919c' }}>Loading details…</span>
            </div>
          )}
          {selected && !modalLoading && (
            <>
              {/* Top Summary: Image (45%) + Info (55%) */}
              <div className="ml-modal-summary">
                <div className="ml-modal-summary-image">
                  {hasImage(resolveDisplayImage(selected)) ? (
                    <img className="ml-modal-summary-img" src={resolveDisplayImage(selected)} alt={selected.name} loading="lazy" />
                  ) : (
                    <div className="ml-modal-summary-image--fallback"><Gem size={40} /></div>
                  )}
                </div>
                <div className="ml-modal-summary-info">
                  <h2 className="ml-modal-product-name">{selected.name}</h2>
                  <div className="ml-modal-product-category">{selected.category}</div>
                  <StatusBadge status={selected.computed_status || selected.status} label={presentationFor(selected).label} tone={presentationFor(selected).tone} />

                  {/* Listing Information Panel */}
                  <div className="ml-modal-panel">
                    <div className="ml-modal-panel__head"><Tag size={14} style={{ color: '#8a6a1f' }} /> Listing Information</div>
                    <div className="ml-modal-panel__body">
                      <div className="ml-info-row">
                        <span className="ml-info-row__icon"><Gem size={14} /></span>
                        <span className="ml-info-row__label">Karat / Weight</span>
                        <span className="ml-info-row__value">{selected.karat_weight || selected.karat || '—'}</span>
                      </div>
                      <div className="ml-info-row">
                        <span className="ml-info-row__icon"><Tag size={14} /></span>
                        <span className="ml-info-row__label">Suggested Price</span>
                        <span className="ml-info-row__value ml-info-row__value--price">{peso(selected.price)}</span>
                      </div>
                      <div className="ml-info-row">
                        <span className="ml-info-row__icon"><MapPin size={14} /></span>
                        <span className="ml-info-row__label">Branch</span>
                        <span className="ml-info-row__value">{selected.branch?.name || '—'}</span>
                      </div>
                      <div className="ml-info-row">
                        <span className="ml-info-row__icon"><CalendarDays size={14} /></span>
                        <span className="ml-info-row__label">Date Created</span>
                        <span className="ml-info-row__value">{formatDate(selected.created_at)}</span>
                      </div>
                      <div className="ml-info-row">
                        <span className="ml-info-row__icon"><FileText size={14} /></span>
                        <span className="ml-info-row__label">Listing ID</span>
                        <span className="ml-info-row__value" title={selected.id || ''}>{shortUuid(selected.id)}</span>
                        {selected.id && (
                          <button className="ml-info-row__copy" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(selected.id); }} aria-label="Copy listing ID">
                            <ClipboardCopy size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Description Panel */}
              <div className="ml-modal-panel">
                <div className="ml-modal-panel__head"><FileText size={14} style={{ color: '#8a6a1f' }} /> Description</div>
                <div className="ml-modal-panel__body">
                  {selected.description ? (
                    <p className="ml-description__text">{selected.description}</p>
                  ) : (
                    <p className="ml-description__none">No description provided.</p>
                  )}
                </div>
              </div>

              {/* Auction Details Panel */}
              <div className="ml-modal-panel">
                <div className="ml-modal-panel__head"><Gavel size={14} style={{ color: '#8a6a1f' }} /> Auction Details</div>
                <div className="ml-modal-panel__body">
                  {selected.auction ? (
                    <div className="ml-auction-grid">
                      <div className="ml-auction-col">
                        <div className="ml-auction-row">
                          <span className="ml-auction-row__icon"><Clock size={14} /></span>
                          <span className="ml-auction-row__label">Status</span>
                          <span className="ml-auction-row__value">{selected.auction.status.charAt(0).toUpperCase() + selected.auction.status.slice(1)}</span>
                        </div>
                        <div className="ml-auction-row">
                          <span className="ml-auction-row__icon"><Tag size={14} /></span>
                          <span className="ml-auction-row__label">Starting Price</span>
                          <span className="ml-auction-row__value ml-auction-row__value--price">{peso(selected.auction.start_price)}</span>
                        </div>
                        <div className="ml-auction-row">
                          <span className="ml-auction-row__icon"><Gavel size={14} /></span>
                          <span className="ml-auction-row__label">Current Bid</span>
                          <span className="ml-auction-row__value ml-auction-row__value--price">{peso(selected.auction.current_bid)}</span>
                        </div>
                        <div className="ml-auction-row">
                          <span className="ml-auction-row__icon"><Trophy size={14} /></span>
                          <span className="ml-auction-row__label">Bid Count</span>
                          <span className="ml-auction-row__value">{selected.auction.bid_count || 0}</span>
                        </div>
                      </div>
                      <div className="ml-auction-col">
                        <div className="ml-auction-row">
                          <span className="ml-auction-row__icon"><CalendarDays size={14} /></span>
                          <span className="ml-auction-row__label">Started</span>
                          <span className="ml-auction-row__value">{formatDate(selected.auction.start_time)}</span>
                        </div>
                        <div className="ml-auction-row">
                          <span className="ml-auction-row__icon"><Clock size={14} /></span>
                          <span className="ml-auction-row__label">Ends</span>
                          <span className="ml-auction-row__value">{formatDate(selected.auction.end_time)}</span>
                        </div>
                        <div className="ml-auction-row">
                          <span className="ml-auction-row__icon"><Trophy size={14} /></span>
                          <span className="ml-auction-row__label">Winner</span>
                          <span className="ml-auction-row__value">—</span>
                        </div>
                        <div className="ml-auction-row">
                          <span className="ml-auction-row__icon"><Wallet size={14} /></span>
                          <span className="ml-auction-row__label">Winning Bid</span>
                          <span className="ml-auction-row__value ml-auction-row__value--price">—</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="ml-auction-empty"><Clock size={14} /> <span>No auction attached to this listing.</span></div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="ml-modal-foot">
          <button type="button" className="ml-modal-btn-close" onClick={handleCloseModal}>Close</button>
          <button
            type="button"
            className="ml-modal-btn-delete"
            onClick={(e) => { e.stopPropagation(); handleDeleteClick(selected); }}
            disabled={!(selected?.can_delete !== false) || deletingId === selected?.id}
            title={selected && selected.can_delete === false ? 'This listing has received bids and can no longer be deleted.' : `Delete ${selected?.name}`}
          >
            <Trash2 size={14} />
            {deletingId === selected?.id ? 'Deleting…' : 'Delete Listing'}
          </button>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete listing?"
        body={
          <div className="ml-confirm-body">
            <p>
              This will permanently remove <strong>{deleting?.name}</strong>{' '}
              {deleting && selected?.auction ? 'and its attached auction' : ''}. This action cannot be undone.
            </p>
          </div>
        }
        onConfirm={handleDeleteConfirm}
      />

      {/* Create / Edit listing modal (preserved flow) */}
      <SubmitListingModal
        open={submitOpen}
        onClose={handleCloseSubmit}
        onSubmit={handleSubmit}
        initial={editing}
        mode={editing ? 'edit' : 'create'}
      />
    </div>
  );
}
