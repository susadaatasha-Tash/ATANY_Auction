// frontend/src/roles/shop-owner/components/AuctionWizard.jsx
// ONE auction wizard, two modes:
//   mode="create" → publish a brand new lot (POST /shop-owner/auctions)
//   mode="relist" → create a NEW auction from an ended lot
//                    (POST /shop-owner/auctions/:id/relist)
//
// Both modes share the same 4 steps (Lot Details → Schedule → Bidding Rules →
// Review), the same schedule picker (AuctionScheduleStep), the same validation
// helpers (auctionScheduleUtils) and the same stepper (WizardStepper). No
// business logic is duplicated between the two flows.
//
// Relist rules enforced here:
//  - the ORIGINAL ended auction is never mutated; a new auction row is created
//  - lot details are READ-ONLY in relist mode: the product row is shared with
//    the historical auction, so editing it would rewrite history
//  - schedule + bidding rules are prefilled from the source and editable
import { useState, useEffect, useMemo, useRef } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { AuctionScheduleStep } from './AuctionScheduleStep';
import { WizardStepper } from './WizardStepper';
import { durationText, formatTimeFromLocal, parseLocal, scheduleValidation } from './auctionScheduleUtils';

const CREATE_DRAFT_KEY = 'atany_auction_lot_draft';
const RELIST_DRAFT_PREFIX = 'atany_relist_draft:';
const CATEGORIES = ['Rings', 'Necklaces', 'Bracelets', 'Earrings', 'Pendants', 'Chains', 'Watches', 'Other'];
export const AUCTION_WIZARD_STEPS = [
  { key: 'details', label: 'Lot Details' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'bidding', label: 'Bidding Rules' },
  { key: 'review', label: 'Review' },
];

const toLocal = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function defaultSchedule() {
  const start = new Date(Date.now() + 24 * 3600 * 1000);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 7 * 86400000);
  return { start: toLocal(start), end: toLocal(end) };
}

function defaultDraft() {
  const { start, end } = defaultSchedule();
  return {
    name: '',
    category: 'Rings',
    karat: '',
    desc: '',
    start,
    end,
    startPrice: '',
    minimumBidIncrement: 1000,
    step: 0,
    imageFileName: '',
  };
}

const draftKey = (mode, sourceAuction) =>
  mode === 'relist' && sourceAuction?.id ? `${RELIST_DRAFT_PREFIX}${sourceAuction.id}` : CREATE_DRAFT_KEY;

function loadDraft(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const base = defaultDraft();
    return {
      ...base,
      ...parsed,
      step: Number.isInteger(parsed.step) ? Math.min(Math.max(parsed.step, 0), 3) : 0,
      minimumBidIncrement: parsed.minimumBidIncrement !== undefined ? Number(parsed.minimumBidIncrement) : base.minimumBidIncrement,
    };
  } catch {
    return null;
  }
}

function saveDraft(key, draft) {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

function clearDraft(key) {
  try { localStorage.removeItem(key); } catch {}
}

function draftHasContent(d) {
  return !!(d.name || d.karat || d.desc || d.startPrice || d.imageFileName);
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const p = parseLocal(iso);
  if (p) {
    const d = new Date(iso);
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${formatTimeFromLocal(iso)}`;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function AuctionWizard({
  open,
  onClose,
  onSubmit,
  mode = 'create',
  sourceAuction = null,
}) {
  const isRelist = mode === 'relist';
  const showToast = useToast();
  const key = draftKey(mode, sourceAuction);
  const [draft, setDraft] = useState(() => loadDraft(key) || defaultDraft());
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [errors, setErrors] = useState({});
  const [publishing, setPublishing] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const [restoredNote, setRestoredNote] = useState('');
  const previewUrlRef = useRef('');
  const publishedRef = useRef(false);

  const step = draft.step;
  const duration = useMemo(() => durationText(draft.start, draft.end), [draft.start, draft.end]);
  const startPriceNum = Number(draft.startPrice);

  const resetEphemeralState = () => {
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setErrors({});
    setDraftSavedAt(null);
    setRestoredNote('');
    setPublishing(false);
  };

  // Relist prefill — real values from the source auction / its product.
  const relistPrefill = useMemo(() => {
    if (!isRelist || !sourceAuction) return null;
    const { start, end } = defaultSchedule();
    return {
      name: sourceAuction.title || sourceAuction.name || '',
      category: sourceAuction.category || 'Other',
      karat: sourceAuction.karat_weight || '',
      desc: sourceAuction.description || '',
      imageUrl: sourceAuction.image_url || sourceAuction.img || '',
      branch: sourceAuction.branch || sourceAuction.branch_name || '',
      lotCode: sourceAuction.lot_code || sourceAuction.auction_code || '',
      startPrice: sourceAuction.start_price != null ? String(sourceAuction.start_price) : '',
      minimumBidIncrement: Number(sourceAuction.minimum_bid_increment) > 0 ? Number(sourceAuction.minimum_bid_increment) : 1000,
      start,
      end,
    };
  }, [isRelist, sourceAuction]);

  // Mount/open: restore an unfinished draft (create) or prefill from the source
  // auction (relist). Always start ephemeral UI clean.
  useEffect(() => {
    if (!open) return;
    publishedRef.current = false;
    if (isRelist && relistPrefill) {
      const stored = loadDraft(key);
      const hasStored = !!(stored && draftHasContent(stored));
      setDraft(hasStored ? { ...relistPrefill, ...stored, step: stored.step } : { ...relistPrefill, step: 0 });
      setRestoredNote(hasStored ? 'Restored your unfinished relist draft — pick up right where you left off.' : '');
      setDraftSavedAt(hasStored ? (stored.savedAt || null) : null);
    } else {
      const stored = loadDraft(key);
      const hasStored = !!(stored && draftHasContent(stored));
      setDraft(hasStored ? stored : defaultDraft());
      setRestoredNote(hasStored ? 'Restored draft from this browser. Re-select the photo if needed — files cannot be saved locally.' : '');
      setDraftSavedAt(hasStored ? (stored.savedAt || null) : null);
    }
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setErrors({});
    setPublishing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, isRelist, relistPrefill]);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrl);
  }, []);

  // Persist unfinished drafts only (localStorage). Relist drafts use their own
  // key so they can never overwrite the Create Auction draft.
  useEffect(() => {
    if (!open || publishedRef.current) return;
    if (!draftHasContent(draft)) {
      clearDraft(key);
      setDraftSavedAt(null);
      return;
    }
    const payload = { ...draft, savedAt: new Date().toISOString() };
    const ok = saveDraft(key, payload);
    if (ok) setDraftSavedAt(payload.savedAt);
  }, [draft, open, key]);

  const patch = (partial) => {
    setDraft((d) => ({ ...d, ...partial }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(partial)) delete next[k];
      return next;
    });
  };

  const handleFileChange = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setDraft((d) => ({ ...d, imageFileName: f ? f.name : '' }));
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      if (!f) return '';
      return URL.createObjectURL(f);
    });
  };

  const validateStep = (idx) => {
    const next = {};
    if (idx === 0 && !isRelist) {
      if (!draft.name || !draft.name.trim()) next.name = 'Item name is required';
      else if (draft.name.length > 200) next.name = 'Item name must be at most 200 characters';
    }
    if (idx === 1) {
      const v = scheduleValidation(draft.start, draft.end);
      if (v) next.schedule = v.message;
    }
    if (idx === 2) {
      const inc = Number(draft.minimumBidIncrement);
      if (!draft.minimumBidIncrement || draft.minimumBidIncrement === '') {
        next.minimumBidIncrement = 'Enter a minimum bid increment.';
      } else if (!Number.isFinite(inc) || inc <= 0) {
        next.minimumBidIncrement = 'Minimum bid increment must be greater than ₱0.';
      }
      if (!draft.startPrice || draft.startPrice === '') next.startPrice = 'Starting price is required';
      else if (!Number.isFinite(startPriceNum) || startPriceNum <= 0) next.startPrice = 'Starting price must be greater than 0';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    patch({ step: Math.min(step + 1, AUCTION_WIZARD_STEPS.length - 1) });
  };

  const goBack = () => {
    setErrors({});
    patch({ step: Math.max(step - 1, 0) });
  };

  const jumpTo = (idx) => {
    setErrors({});
    patch({ step: idx });
  };

  const handleDiscardDraft = () => {
    publishedRef.current = false;
    clearDraft(key);
    setDraft(isRelist && relistPrefill ? { ...relistPrefill, step: 0 } : defaultDraft());
    resetEphemeralState();
  };

  const handlePublish = async () => {
    for (let i = 0; i <= 2; i++) {
      if (!validateStep(i)) {
        patch({ step: i });
        return;
      }
    }
    setPublishing(true);
    try {
      let submitStart;
      let submitEnd;
      try { if (draft.start) submitStart = new Date(draft.start).toISOString(); } catch {}
      try { if (draft.end) submitEnd = new Date(draft.end).toISOString(); } catch {}

      if (isRelist) {
        // Relist creates a NEW auction for the same lot. The original ended
        // auction and its bidding history are left untouched.
        const result = await onSubmit({
          start_time: submitStart,
          end_time: submitEnd,
          start_price: Math.round(startPriceNum),
          minimum_bid_increment: Number.isFinite(Number(draft.minimumBidIncrement)) && Number(draft.minimumBidIncrement) > 0 ? Math.round(Number(draft.minimumBidIncrement)) : 1000,
        });
        if (result !== false && result != null) {
          publishedRef.current = true;
          clearDraft(key);
          resetEphemeralState();
        }
        return;
      }

      let imageUrl = '';
      if (file && file.size > 0) {
        try {
          const { signedUrl, publicUrl } = await apiFetch('/shop-owner/upload-url', {
            method: 'POST',
            body: JSON.stringify({ filename: file.name }),
          });
          const uploadRes = await fetch(signedUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file,
          });
          if (!uploadRes.ok) throw new Error(`Upload failed ${uploadRes.status}`);
          if (!publicUrl) throw new Error('Upload succeeded but no public URL was returned');
          imageUrl = publicUrl;
        } catch (err) {
          console.error('Image upload failed', err);
          throw new Error('Image upload failed. The lot was not published — please try again.');
        }
      }
      const result = await onSubmit({
        name: draft.name.trim(),
        category: draft.category,
        karat: draft.karat || undefined,
        startPrice: Math.round(startPriceNum),
        minimum_bid_increment: Number.isFinite(Number(draft.minimumBidIncrement)) && Number(draft.minimumBidIncrement) > 0 ? Math.round(Number(draft.minimumBidIncrement)) : 1000,
        desc: draft.desc || undefined,
        image_url: imageUrl || undefined,
        start_time: submitStart,
        end_time: submitEnd,
      });
      if (result !== false && result != null) {
        publishedRef.current = true;
        clearDraft(key);
        setDraft(defaultDraft());
        resetEphemeralState();
      }
    } catch (err) {
      showToast(err?.message || (isRelist ? 'Relist failed' : 'Publish failed'));
    } finally {
      setPublishing(false);
    }
  };

  if (!open) return null;

  const stepMeta = AUCTION_WIZARD_STEPS[step];
  const showDraftBadge = draftHasContent(draft) && !!draftSavedAt;
  const sourceImage = relistPrefill?.imageUrl || '';
  const lotImage = isRelist ? sourceImage : (previewUrl || '');

  const footer = (
    <>
      <div className="wizard-foot-meta">
        <span className="wizard-step-label">Step {step + 1} of {AUCTION_WIZARD_STEPS.length} · {stepMeta.label}</span>
        {showDraftBadge && (
          <span className="wizard-draft-badge" title="Saved in this browser only">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Draft saved locally
          </span>
        )}
        {step === AUCTION_WIZARD_STEPS.length - 1 && (
          <span className="wizard-lot-ref">{isRelist ? `New auction from ${relistPrefill?.lotCode || 'this lot'}` : 'Lot ref assigned on publish'}</span>
        )}
      </div>
      <div className="wizard-foot-actions">
        {draftHasContent(draft) && (
          <button type="button" className="btn btn-outline wizard-discard" onClick={handleDiscardDraft} disabled={publishing}>
            Discard draft
          </button>
        )}
        {step > 0 && (
          <button type="button" className="btn btn-outline" onClick={goBack} disabled={publishing}>Back</button>
        )}
        {step < AUCTION_WIZARD_STEPS.length - 1 ? (
          <button type="button" className="btn btn-primary" onClick={goNext} disabled={publishing}>Continue</button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={handlePublish} disabled={publishing} aria-busy={publishing ? 'true' : undefined}>
            {publishing ? (isRelist ? 'Relisting…' : 'Publishing…') : (isRelist ? 'Relist Auction' : 'Publish lot')}
          </button>
        )}
      </div>
    </>
  );

  const title = isRelist
    ? `Relist Auction — ${sourceAuction?.title || sourceAuction?.name || 'Lot'}`
    : 'Create Auction Lot';

  return (
    <Modal open={open} onClose={onClose} title={title} className="auction-wizard-modal" footer={footer}>
      <div className="auction-wizard">
        <WizardStepper steps={AUCTION_WIZARD_STEPS} current={step} onJump={jumpTo} disabled={publishing} />

        {restoredNote && step === 0 && <p className="form-hint wizard-restored">{restoredNote}</p>}

        {step === 0 && isRelist && relistPrefill && (
          <div className="wizard-panel">
            <div className="wizard-lot-card">
              {sourceImage ? (
                <img className="wizard-lot-card__img" src={sourceImage} alt={relistPrefill.name} />
              ) : (
                <div className="wizard-lot-card__img wizard-lot-card__img--ph" aria-hidden="true">◇</div>
              )}
              <div className="wizard-lot-card__body">
                <div className="wizard-lot-card__title">{relistPrefill.name || 'Untitled lot'}</div>
                <div className="wizard-lot-card__meta">
                  {relistPrefill.category}
                  {relistPrefill.karat ? ` · ${relistPrefill.karat}` : ''}
                  {relistPrefill.branch ? ` · ${relistPrefill.branch}` : ''}
                </div>
                {relistPrefill.lotCode && (
                  <div className="wizard-lot-card__code">Original lot {relistPrefill.lotCode}</div>
                )}
                {relistPrefill.desc && <p className="wizard-lot-card__desc">{relistPrefill.desc}</p>}
              </div>
            </div>
            <p className="form-hint">
              Lot details come from the original listing and cannot be changed here — this product is shared with the
              ended auction, so editing it would rewrite its history. Schedule and bidding rules are set below.
            </p>
          </div>
        )}

        {step === 0 && !isRelist && (
          <div className="wizard-panel">
            <div className="form-row">
              <label htmlFor="wizard-lot-name">Item Name</label>
              <input
                id="wizard-lot-name"
                name="name"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="e.g. Antique Filigree Brooch"
                maxLength={200}
              />
              {errors.name && <p className="wizard-field-error">{errors.name}</p>}
            </div>
            <div className="form-grid-2">
              <div className="form-row">
                <label htmlFor="wizard-lot-category">Category</label>
                <select id="wizard-lot-category" name="category" value={draft.category} onChange={(e) => patch({ category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label htmlFor="wizard-lot-karat">Karat / Weight</label>
                <input
                  id="wizard-lot-karat"
                  name="karat"
                  value={draft.karat}
                  onChange={(e) => patch({ karat: e.target.value })}
                  placeholder="e.g. 18K · 6.5g"
                />
              </div>
            </div>
            <div className="form-row">
              <label htmlFor="wizard-lot-image">Item Photo</label>
              <input id="wizard-lot-image" name="image_file" type="file" accept="image/*" onChange={handleFileChange} />
              {draft.imageFileName && !file && (
                <p className="form-hint">Selected earlier: {draft.imageFileName} — re-select to preview or upload.</p>
              )}
              {(previewUrl || draft.imageFileName) && (
                <div className="wizard-image-preview">
                  {previewUrl ? (
                    <img src={previewUrl} alt="Lot preview" />
                  ) : (
                    <div className="wizard-image-placeholder">{draft.imageFileName}</div>
                  )}
                  <p className="form-hint">Preview uses a temporary local URL until you publish.</p>
                </div>
              )}
            </div>
            <div className="form-row">
              <label htmlFor="wizard-lot-desc">Description</label>
              <textarea
                id="wizard-lot-desc"
                name="desc"
                value={draft.desc}
                onChange={(e) => patch({ desc: e.target.value })}
                placeholder="Condition, provenance, certification…"
                maxLength={2000}
              />
            </div>
            <p className="form-hint">Your auction goes live at the start time you set — no admin approval needed.</p>
          </div>
        )}

        {step === 1 && (
          <AuctionScheduleStep draft={draft} patch={patch} errors={errors} />
        )}

        {step === 2 && (
          <div className="wizard-panel">
            <div className="form-row">
              <label htmlFor="wizard-start-price">Starting Price (₱)</label>
              <input
                id="wizard-start-price"
                name="startPrice"
                type="number"
                min="1"
                value={draft.startPrice}
                onChange={(e) => patch({ startPrice: e.target.value })}
                placeholder="0"
              />
              {errors.startPrice && <p className="wizard-field-error">{errors.startPrice}</p>}
            </div>
            <div className="form-row">
              <label htmlFor="wizard-min-increment">Minimum Bid Increment (₱)</label>
              <input
                id="wizard-min-increment"
                name="minimumBidIncrement"
                type="number"
                min="1"
                value={draft.minimumBidIncrement ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '' || !isNaN(Number(v))) patch({ minimumBidIncrement: v === '' ? undefined : Number(v) });
                }}
                placeholder="1000"
              />
              {errors.minimumBidIncrement && <p className="wizard-field-error">{errors.minimumBidIncrement}</p>}
              <span className="form-hint">Set the minimum amount each new bid must increase.</span>
            </div>
            <div className="wizard-rules">
              <div className="wizard-rule">
                <span className="wizard-rule-label">Bidding opens</span>
                <span className="wizard-rule-value">At scheduled start</span>
                <span className="form-hint">Customers can bid once the auction status becomes live.</span>
              </div>
            </div>
            <p className="form-hint">Starting price sets both the item price and the opening bid. One price drives both.</p>
          </div>
        )}

        {step === 3 && (
          <div className="wizard-panel">
            <div className="wizard-review">
              <div className="wizard-review-row">
                <div className="wizard-review-block">
                  <span className="wizard-review-label">Lot</span>
                  <div className="wizard-review-body">
                    {lotImage && <img className="wizard-review-img" src={lotImage} alt="Lot" />}
                    <div>
                      <div className="wizard-review-title">{(isRelist ? relistPrefill?.name : draft.name) || '—'}</div>
                      <div className="form-hint">
                        {(isRelist ? relistPrefill?.category : draft.category)}
                        {(isRelist ? relistPrefill?.karat : draft.karat) ? ` · ${isRelist ? relistPrefill?.karat : draft.karat}` : ''}
                        {isRelist && relistPrefill?.branch ? ` · ${relistPrefill.branch}` : ''}
                      </div>
                      {(isRelist ? relistPrefill?.desc : draft.desc) && (
                        <p className="wizard-review-desc">{isRelist ? relistPrefill?.desc : draft.desc}</p>
                      )}
                      {!isRelist && !previewUrl && draft.imageFileName && (
                        <p className="form-hint">Photo: {draft.imageFileName} (re-select on Lot Details to preview)</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="wizard-review-grid">
                <div className="wizard-review-cell">
                  <span className="wizard-review-label">Starting price</span>
                  <span className="wizard-review-value">₱{Number.isFinite(startPriceNum) && startPriceNum > 0 ? startPriceNum.toLocaleString() : '—'}</span>
                </div>
                <div className="wizard-review-cell">
                  <span className="wizard-review-label">Minimum bid increment</span>
                  <span className="wizard-review-value">₱{Number.isFinite(Number(draft.minimumBidIncrement)) && Number(draft.minimumBidIncrement) > 0 ? Number(draft.minimumBidIncrement).toLocaleString() : '1,000'}</span>
                </div>
                <div className="wizard-review-cell">
                  <span className="wizard-review-label">Start</span>
                  <span className="wizard-review-value">{formatDateTime(draft.start)}</span>
                </div>
                <div className="wizard-review-cell">
                  <span className="wizard-review-label">End</span>
                  <span className="wizard-review-value">{formatDateTime(draft.end)}</span>
                </div>
                <div className="wizard-review-cell">
                  <span className="wizard-review-label">Duration</span>
                  <span className="wizard-review-value">{duration || '—'}</span>
                </div>
                <div className="wizard-review-cell">
                  <span className="wizard-review-label">Lot reference</span>
                  <span className="wizard-review-value">
                    {isRelist ? `New lot (from ${relistPrefill?.lotCode || 'original'})` : 'Assigned on publish'}
                  </span>
                </div>
              </div>
              {isRelist && (
                <div className="wizard-notice">
                  <strong>This creates a new auction.</strong> The original ended auction and its bidding history will
                  remain unchanged.
                </div>
              )}
              <div className="wizard-review-jumps">
                <button type="button" className="btn btn-outline" onClick={() => jumpTo(0)} disabled={publishing}>Edit lot details</button>
                <button type="button" className="btn btn-outline" onClick={() => jumpTo(1)} disabled={publishing}>Edit schedule</button>
                <button type="button" className="btn btn-outline" onClick={() => jumpTo(2)} disabled={publishing}>Edit bidding rules</button>
              </div>
              <p className="form-hint">
                {isRelist
                  ? 'Relisting creates a new scheduled auction for this lot. Nothing is sent to the server until you press Relist Auction.'
                  : 'Publishing creates the item and auction together. Nothing is sent to the server until you press Publish lot.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default AuctionWizard;
