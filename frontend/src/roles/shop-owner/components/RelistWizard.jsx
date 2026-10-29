// frontend/src/roles/shop-owner/components/RelistWizard.jsx
// 2-step relist flow (Schedule → Review) for an ended auction. Reuses the real
// schedule system (AuctionScheduleStep/Calendar/TimePicker/Preview + utils) —
// no duplicated scheduling logic. Item + bidding rules are inherited read-only
// from the source auction; only the schedule is seller-editable.
// Draft is namespaced per source auction (`relist-draft:<id>`) and never
// touches the Create Auction draft. Parent owns the API call + success flow.
import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { AuctionScheduleStep } from './AuctionScheduleStep';
import {
  durationText,
  scheduleValidation,
  toLocal,
} from './auctionScheduleUtils';

const STEPS = [
  { key: 'schedule', label: 'Schedule' },
  { key: 'review', label: 'Review' },
];

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }

function formatDateTime(local) {
  const d = new Date(local);
  if (!local || Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function draftKey(sourceId) { return `relist-draft:${sourceId}`; }

function defaultSchedule(source) {
  // Preserve the source auction's duration; default start = tomorrow 10:00 AM.
  const s = source?.start_time ? new Date(source.start_time) : null;
  const e = source?.end_time ? new Date(source.end_time) : null;
  const durMs = (s && e && !Number.isNaN(s) && !Number.isNaN(e) && e > s)
    ? e.getTime() - s.getTime()
    : 7 * 86400000;
  const start = new Date(Date.now() + 24 * 3600 * 1000);
  start.setHours(10, 0, 0, 0);
  if (start.getTime() <= Date.now()) start.setDate(start.getDate() + 1);
  const end = new Date(start.getTime() + durMs);
  return { start: toLocal(start), end: toLocal(end) };
}

function loadDraft(sourceId, fallback) {
  try {
    const raw = localStorage.getItem(draftKey(sourceId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      start: typeof parsed.start === 'string' ? parsed.start : fallback.start,
      end: typeof parsed.end === 'string' ? parsed.end : fallback.end,
      step: parsed.step === 1 ? 1 : 0,
    };
  } catch {
    return fallback;
  }
}

export function RelistWizard({ open, sourceAuction, onClose, onSubmit }) {
  const sourceId = sourceAuction?.id;
  const fallback = useMemo(() => defaultSchedule(sourceAuction), [sourceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState(() => ({ ...loadDraft(sourceId, fallback), }));
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  // Only autosave after the seller actually edits (prevents re-saving a
  // cleared/default draft right after success or open).
  const dirtyRef = useRef(false);

  // (Re)load per-source draft on open; always start ephemeral UI clean.
  useEffect(() => {
    if (!open || !sourceId) return;
    const fb = defaultSchedule(sourceAuction);
    const stored = loadDraft(sourceId, fb);
    setDraft(stored);
    setDraftSavedAt(stored !== fb ? new Date().toISOString() : null);
    // A restored session keeps autosaving; a fresh default waits for edits
    // (no junk keys) and never rewrites storage after a completed submit.
    dirtyRef.current = stored !== fb;
    setErrors({});
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceId]);

  // Autosave schedule draft (namespaced — never the Create draft).
  useEffect(() => {
    if (!open || !sourceId || !dirtyRef.current) return;
    try {
      localStorage.setItem(draftKey(sourceId), JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
      setDraftSavedAt(new Date().toISOString());
    } catch {}
  }, [draft, open, sourceId]);

  const step = draft.step || 0;
  const duration = useMemo(() => durationText(draft.start, draft.end), [draft.start, draft.end]);

  const patch = (partial) => {
    dirtyRef.current = true;
    setDraft((d) => ({ ...d, ...partial }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(partial)) delete next[k];
      return next;
    });
  };

  const clearDraft = () => {
    try { localStorage.removeItem(draftKey(sourceId)); } catch {}
  };

  const goNext = () => {
    const v = scheduleValidation(draft.start, draft.end);
    if (v) { setErrors({ schedule: v.message }); return; }
    setErrors({});
    patch({ step: 1 });
  };
  const goBack = () => { setErrors({}); patch({ step: 0 }); };
  const handleDiscard = () => { clearDraft(); onClose(); };

  const handleSubmit = async () => {
    const v = scheduleValidation(draft.start, draft.end);
    if (v) { setErrors({ schedule: v.message }); patch({ step: 0 }); return; }
    setSubmitting(true);
    try {
      const ok = await onSubmit({
        start_time: new Date(draft.start).toISOString(),
        end_time: new Date(draft.end).toISOString(),
      });
      if (ok !== false && ok != null) {
        clearDraft();
        dirtyRef.current = false;
        setDraft({ ...defaultSchedule(sourceAuction) });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const startPrice = Number(sourceAuction?.start_price ?? sourceAuction?.startPrice ?? 0) || 0;
  const increment = Number(sourceAuction?.minimum_bid_increment);
  const incrementShown = Number.isInteger(increment) && increment > 0 ? increment : 1000;

  if (!open || !sourceAuction) return null;

  const footer = step === 0 ? (
    <>
      <div className="wizard-foot-meta">
        <span className="wizard-step-label">Step 1 of 2 · Schedule</span>
        {draftSavedAt && (
          <span className="wizard-draft-badge" title="Saved in this browser only">
            Draft saved locally
          </span>
        )}
      </div>
      <div className="wizard-foot-actions">
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={submitting}>Cancel</button>
        <button type="button" className="btn btn-outline wizard-discard" onClick={handleDiscard} disabled={submitting}>Discard draft</button>
        <button type="button" className="btn btn-primary" onClick={goNext} disabled={submitting}>Continue</button>
      </div>
    </>
  ) : (
    <>
      <div className="wizard-foot-meta">
        <span className="wizard-step-label">Step 2 of 2 · Review</span>
        {draftSavedAt && (
          <span className="wizard-draft-badge" title="Saved in this browser only">
            Draft saved locally
          </span>
        )}
      </div>
      <div className="wizard-foot-actions">
        <button type="button" className="btn btn-outline wizard-discard" onClick={handleDiscard} disabled={submitting}>Discard draft</button>
        <button type="button" className="btn btn-outline" onClick={goBack} disabled={submitting}>Back</button>
        <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Relisting…' : 'Relist auction'}</button>
      </div>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={<><span className="modal-eyebrow">Relist auction</span>Relist — {sourceAuction.title || sourceAuction.name || 'Auction'}</>}
      className="auction-wizard-modal relist-wizard-modal"
      footer={footer}
    >
      <div className="auction-wizard">
        <p className="form-hint" style={{ margin: 0 }}>Create a new auction from this lot. The original ended auction and its history will remain preserved.</p>
        <ol className="wizard-steps" aria-label="Relist steps">
          {STEPS.map((s, i) => {
            const state = i < step ? 'done' : i === step ? 'active' : 'todo';
            return (
              <Fragment key={s.key}>
                {i > 0 && (
                  <span className={`step-connector${i <= step ? ' is-done' : ''}`} aria-hidden="true" />
                )}
                <li className={`wizard-step ${state}`}>
                  <span className="wizard-step-btn" aria-current={i === step ? 'step' : undefined}>
                    <span className="wizard-step-num">{state === 'done' ? '✓' : i + 1}</span>
                    <span className="wizard-step-copy">
                      <span className="wizard-step-eyebrow">Step {i + 1}</span>
                      <span className="wizard-step-name">{s.label}</span>
                    </span>
                  </span>
                </li>
              </Fragment>
            );
          })}
        </ol>

        {step === 0 && (
          <AuctionScheduleStep draft={draft} patch={patch} errors={errors} />
        )}

        {step === 1 && (
          <div className="wizard-panel">
            <div className="wizard-review">
              <div className="wizard-review-row">
                <div className="wizard-review-block">
                  <span className="wizard-review-label">Item details (from original auction)</span>
                  <div className="wizard-review-body">
                    {(sourceAuction.img || sourceAuction.image_url) && (
                      <img className="wizard-review-img" src={sourceAuction.img || sourceAuction.image_url} alt="" />
                    )}
                    <div>
                      <div className="wizard-review-title">{sourceAuction.title || sourceAuction.name || '—'}</div>
                      <div className="form-hint">
                        {sourceAuction.category || 'Other'}
                        {sourceAuction.karat_weight ? ` · ${sourceAuction.karat_weight}` : ''}
                        {(sourceAuction.branch || sourceAuction.branch_name) ? ` · 📍 ${sourceAuction.branch || sourceAuction.branch_name}` : ''}
                      </div>
                      {sourceAuction.description && <p className="wizard-review-desc">{sourceAuction.description}</p>}
                      <div className="form-hint">Lot Reference: {sourceAuction.lot_code || sourceAuction.auction_code || String(sourceAuction.id).slice(0, 8).toUpperCase()}</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="wizard-review-grid">
                <div className="wizard-review-cell">
                  <span className="wizard-review-label">Starting Price</span>
                  <span className="wizard-review-value">{peso(startPrice)}</span>
                </div>
                <div className="wizard-review-cell">
                  <span className="wizard-review-label">Minimum Bid Increment</span>
                  <span className="wizard-review-value">{peso(incrementShown)}</span>
                </div>
                <div className="wizard-review-cell">
                  <span className="wizard-review-label">Start</span>
                  <span className="wizard-review-value">{formatReviewDateTime(draft.start)}</span>
                </div>
                <div className="wizard-review-cell">
                  <span className="wizard-review-label">End</span>
                  <span className="wizard-review-value">{formatReviewDateTime(draft.end)}</span>
                </div>
                <div className="wizard-review-cell">
                  <span className="wizard-review-label">Duration</span>
                  <span className="wizard-review-value">{duration || '—'}</span>
                </div>
                <div className="wizard-review-cell">
                  <span className="wizard-review-label">New schedule</span>
                  <span className="wizard-review-value"><button type="button" className="btn btn-outline" onClick={goBack} disabled={submitting}>Edit schedule</button></span>
                </div>
              </div>
              <p className="form-hint">Bidding rules are inherited from the original auction and cannot be edited.</p>
              <p className="form-hint">Relisting creates a new auction. The original ended auction and its bid history are preserved.</p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function formatReviewDateTime(local) {
  const d = new Date(local);
  if (!local || Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export default RelistWizard;
