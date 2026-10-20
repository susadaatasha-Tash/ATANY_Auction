// frontend/src/roles/shop-owner/components/CreateAuctionWizard.jsx
// 4-step Create Auction Lot wizard (Lot Details → Schedule → Bidding Rules → Review).
// Steps 1–3 are local draft state only (localStorage) — no backend calls, no auction record.
// Publish lot sends ONE request to the existing POST /shop-owner/auctions (product + auction together).
// Edit mode stays on CreateAuctionModal (PUT: opening price + schedule only).
// Image upload reuses signed-URL flow (POST /shop-owner/upload-url → PUT signedUrl).
// Lot reference (auction_code) is assigned by the DB on insert — never hardcoded here.
// Min bid increment ₱1,000 is server-enforced (backend bidLogic.js) — displayed, not editable.
import { useState, useEffect, useMemo, useRef } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { AuctionScheduleStep } from './AuctionScheduleStep';
import { durationText, formatTimeFromLocal, parseLocal, scheduleValidation } from './auctionScheduleUtils';

const DRAFT_KEY = 'atany_auction_lot_draft';
const CATEGORIES = ['Rings', 'Necklaces', 'Bracelets', 'Earrings', 'Pendants', 'Chains', 'Watches', 'Other'];
const STEPS = [
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

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
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

function saveDraft(draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
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

export function CreateAuctionWizard({ open, onClose, onSubmit }) {
  const showToast = useToast();
  const [draft, setDraft] = useState(() => loadDraft() || defaultDraft());
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [errors, setErrors] = useState({});
  const [publishing, setPublishing] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const [restoredNote, setRestoredNote] = useState('');
  const previewUrlRef = useRef('');
  // After a successful publish, block autosave until the next creation session
  // so a still-mounted wizard cannot rewrite the completed draft to localStorage.
  const publishedRef = useRef(false);

  const isEdit = false;
  const step = draft.step;
  const duration = useMemo(() => durationText(draft.start, draft.end), [draft.start, draft.end]);
  const startPriceNum = Number(draft.startPrice);

  /** Reset all ephemeral wizard UI state (file, preview, errors, notes). */
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

  // Mount/open: restore an unfinished draft only; always start ephemeral UI clean.
  // A successful publish clears localStorage and resets draft state, so the next
  // open (new Create Auction) loads defaultDraft() — never the published lot.
  useEffect(() => {
    if (!open) return;
    publishedRef.current = false;
    const stored = loadDraft();
    const hasStored = !!(stored && draftHasContent(stored));
    setDraft(hasStored ? stored : defaultDraft());
    setRestoredNote(hasStored ? 'Restored draft from this browser. Re-select the photo if needed — files cannot be saved locally.' : '');
    setDraftSavedAt(hasStored ? (stored.savedAt || null) : null);
    // Always clear file + preview on open. File objects are not persisted;
    // never reuse a previous upload/preview for a new or restored session.
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setErrors({});
    setPublishing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep preview object URL in a ref so cleanup on unmount always has the latest value.
  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  // Persist unfinished drafts only (real localStorage write — not a server autosave).
  // Empty drafts are removed so a completed/blank session never restores stale values.
  useEffect(() => {
    if (!open || publishedRef.current) return;
    if (!draftHasContent(draft)) {
      clearDraft();
      setDraftSavedAt(null);
      return;
    }
    const payload = { ...draft, savedAt: new Date().toISOString() };
    const ok = saveDraft(payload);
    if (ok) setDraftSavedAt(payload.savedAt);
  }, [draft, open]);

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
    if (idx === 0) {
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
    }
    if (idx === 2) {
      if (!draft.startPrice || draft.startPrice === '') next.startPrice = 'Starting price is required';
      else if (!Number.isFinite(startPriceNum) || startPriceNum <= 0) next.startPrice = 'Starting price must be greater than 0';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    const nxt = Math.min(step + 1, STEPS.length - 1);
    patch({ step: nxt });
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
    clearDraft();
    setDraft(defaultDraft());
    resetEphemeralState();
  };

  const handlePublish = async () => {
    // Validate all steps before the single create request.
    for (let i = 0; i <= 2; i++) {
      if (!validateStep(i)) {
        patch({ step: i });
        return;
      }
    }
    setPublishing(true);
    try {
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
          // Persist ONLY the real storage URL — never a hardcoded placeholder.
          imageUrl = publicUrl;
        } catch (err) {
          console.error('Image upload failed', err);
          throw new Error('Image upload failed. The lot was not published — please try again.');
        }
      }
      let submitStart;
      let submitEnd;
      try { if (draft.start) submitStart = new Date(draft.start).toISOString(); } catch {}
      try { if (draft.end) submitEnd = new Date(draft.end).toISOString(); } catch {}
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
      // Clear completed draft ONLY after backend publish is confirmed.
      // On failure (false/null/throw) keep draft, file, preview, and step for retry.
      if (result !== false && result != null) {
        publishedRef.current = true;
        clearDraft();
        setDraft(defaultDraft());
        resetEphemeralState();
      }
    } catch (err) {
      // Upload/storage failures (thrown before submit). Parent already toasts API save errors.
      showToast(err?.message || 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  if (!open) return null;

  const stepMeta = STEPS[step];
  const showDraftBadge = draftHasContent(draft) && !!draftSavedAt;

  const footer = (
    <>
      <div className="wizard-foot-meta">
        <span className="wizard-step-label">Step {step + 1} of {STEPS.length} · {stepMeta.label}</span>
        {showDraftBadge && (
          <span className="wizard-draft-badge" title="Saved in this browser only">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Draft saved locally
          </span>
        )}
        {step === STEPS.length - 1 && (
          <span className="wizard-lot-ref">Lot ref assigned on publish</span>
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
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn btn-primary" onClick={goNext} disabled={publishing}>Continue</button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={handlePublish} disabled={publishing}>
            {publishing ? 'Publishing…' : 'Publish lot'}
          </button>
        )}
      </div>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Auction Lot"
      className="auction-wizard-modal"
      footer={footer}
    >
      <div className="auction-wizard">
        <ol className="wizard-steps" aria-label="Auction lot steps">
          {STEPS.map((s, i) => {
            const state = i < step ? 'done' : i === step ? 'active' : 'todo';
            return (
              <li key={s.key} className={`wizard-step ${state}`}>
                <button type="button" className="wizard-step-btn" onClick={() => i < step && jumpTo(i)} disabled={i > step || publishing} aria-current={i === step ? 'step' : undefined}>
                  <span className="wizard-step-num">{state === 'done' ? '✓' : i + 1}</span>
                  <span className="wizard-step-name">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {restoredNote && step === 0 && <p className="form-hint wizard-restored">{restoredNote}</p>}

        {step === 0 && (
          <div className="wizard-panel">
            <div className="form-row">
              <label>Item Name</label>
              <input
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
                <label>Category</label>
                <select name="category" value={draft.category} onChange={(e) => patch({ category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label>Karat / Weight</label>
                <input
                  name="karat"
                  value={draft.karat}
                  onChange={(e) => patch({ karat: e.target.value })}
                  placeholder="e.g. 18K · 6.5g"
                />
              </div>
            </div>
            <div className="form-row">
              <label>Item Photo</label>
              <input name="image_file" type="file" accept="image/*" onChange={handleFileChange} />
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
              <label>Description</label>
              <textarea
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
              <label>Starting Price (₱)</label>
              <input
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
              <label>Minimum Bid Increment (₱)</label>
              <input
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
                    {previewUrl && <img className="wizard-review-img" src={previewUrl} alt="Lot" />}
                    <div>
                      <div className="wizard-review-title">{draft.name || '—'}</div>
                      <div className="form-hint">{draft.category}{draft.karat ? ` · ${draft.karat}` : ''}</div>
                      {draft.desc && <p className="wizard-review-desc">{draft.desc}</p>}
                      {!previewUrl && draft.imageFileName && (
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
                  <span className="wizard-review-value">Assigned on publish</span>
                </div>
              </div>
              <div className="wizard-review-jumps">
                <button type="button" className="btn btn-outline" onClick={() => jumpTo(0)} disabled={publishing}>Edit lot details</button>
                <button type="button" className="btn btn-outline" onClick={() => jumpTo(1)} disabled={publishing}>Edit schedule</button>
                <button type="button" className="btn btn-outline" onClick={() => jumpTo(2)} disabled={publishing}>Edit bidding rules</button>
              </div>
              <p className="form-hint">Publishing creates the item and auction together. Nothing is sent to the server until you press Publish lot.</p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
