// frontend/src/roles/admin/components/AlertDetailModal.jsx
// Admin → Security Alerts → Alert Details / Review dialog.
//
// Everything shown here is REAL:
//   • the alert record (GET /admin/security-alerts/:id)
//   • the customer (name / email / account status) from public.users
//   • the related auction + item + branch, proven by the flagged bid that
//     created the alert
//   • the activity trail, built from the real bids of the alert window
//
// Review actions use the existing PATCH /admin/security-alerts/:id route.
// The customer suspension runs through the ONE shared account-status service
// on the backend (the same path Admin → Users & Roles uses).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TriangleAlert, X, Copy, Fingerprint, User, FileText, ShieldAlert,
  CalendarClock, List, ChevronRight, Package, Clock, AlertTriangle,
} from 'lucide-react';
import { Modal, ConfirmModal } from '../../../shared/components/Modal';
import { useToast } from '../../../shared/components/Toast';
import { apiFetch } from '../../../shared/lib/apiClient';
import {
  alertSeverityLabel, alertSeverityTone, alertStatusLabel, alertStatusTone,
  formatRelativeTime, formatAbsoluteTime,
} from '../lib/securityLabels';
import '../pages/alert-detail.css';

const SUSPENDABLE_ROLES = ['customer', 'shop_owner'];

/** Real explanations, keyed by the actual fraud-engine alert types. */
function riskExplanation(alert, activity) {
  const type = String(alert?.type || '');
  const bids = activity.filter((a) => a.action === 'Bid').length;
  if (type === 'Rapid High-Value Bidding') {
    return bids
      ? `This user placed ${bids} high-value bid${bids === 1 ? '' : 's'} in rapid succession, which may indicate suspicious activity.`
      : 'Multiple high-value bids were placed in rapid succession, which may indicate suspicious activity.';
  }
  if (type === 'Unusual Bidding Pattern') {
    return 'A bid was placed at an unusually large jump compared with the previous bid, which may indicate suspicious activity.';
  }
  return null;
}

function SkeletonBody() {
  return (
    <div className="adm-ad">
      <div className="adm-ad__summary">
        <div className="adm-ad__badges">
          <div className="adm-ad__skeleton adm-ad__skel-line" style={{ width: 96, height: 26, borderRadius: 999 }} />
          <div className="adm-ad__skeleton adm-ad__skel-line" style={{ width: 64, height: 26, borderRadius: 999 }} />
        </div>
        <div className="adm-ad__skeleton adm-ad__skel-line" style={{ width: 170 }} />
      </div>
      <div className="adm-ad__grid">
        <div className="adm-ad__skeleton adm-ad__skel-card" />
        <div className="adm-ad__skeleton adm-ad__skel-card" />
        <div className="adm-ad__skeleton adm-ad__skel-card" />
        <div className="adm-ad__skeleton adm-ad__skel-card" />
      </div>
      <div className="adm-ad__skeleton adm-ad__skel-trail" style={{ margin: '14px 24px 20px' }} />
    </div>
  );
}

export function AlertDetailModal({
  alertId,
  open,
  onClose,
  onUpdated,
  onSuspended,
}) {
  const showToast = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [pending, setPending] = useState(null); // the running action (one at a time)
  const [mutationError, setMutationError] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'dismiss' | 'suspend'
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendError, setSuspendError] = useState('');
  const copyBtnRef = useRef(null);
  const busy = pending !== null;

  const load = useCallback(async () => {
    if (!alertId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(`/admin/security-alerts/${alertId}`);
      setDetail(res);
    } catch (e) {
      setLoadError(e.message || 'Unable to load alert details.');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [alertId]);

  // A new alert always loads fresh — the previous alert's details are never
  // shown while the new one loads.
  useEffect(() => {
    if (!open || !alertId) { setDetail(null); return; }
    load();
  }, [open, alertId, load]);

  const status = detail?.status || '';
  const isOpenAlert = status === 'new' || status === 'investigating';
  const canReview = status === 'new';
  const customer = detail?.customer || null;
  const related = detail?.related || null;
  const activity = Array.isArray(detail?.activity) ? detail.activity : [];
  const canSuspend = Boolean(
    customer?.id
    && SUSPENDABLE_ROLES.includes(customer.role)
    && customer.status !== 'suspended'
    && isOpenAlert
  );

  // A starting point for the reason, derived from the alert itself. The admin
  // reviews / edits it before confirming — it is never stored silently.
  const suggestedSuspendReason = detail?.type
    ? `Suspicious ${detail.type} activity.`
    : '';

  const copyId = async () => {
    if (!detail?.id) return;
    try {
      await navigator.clipboard.writeText(detail.id);
      showToast('Alert ID copied.');
    } catch {
      showToast('Could not copy the alert ID.');
    }
  };

  /** Run a status transition through the real endpoint. */
  const runStatus = async (nextStatus, action = 'review') => {
    if (!detail || busy) return;
    setPending(action);
    setMutationError(null);
    try {
      const updated = await apiFetch(`/admin/security-alerts/${detail.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
      showToast(nextStatus === 'investigating'
        ? 'Alert marked under review.'
        : nextStatus === 'resolved' ? 'Alert resolved.' : 'Alert dismissed.');
      if (onUpdated) onUpdated(updated);
    } catch (e) {
      setMutationError(e.message || 'Unable to update alert. Please try again.');
    } finally {
      setPending(null);
    }
  };

  /** Suspend the alert's customer through the shared admin path. */
  const runSuspend = async () => {
    const reason = suspendReason.trim();
    if (reason.length < 5) {
      setSuspendError('Please provide a reason for suspension (at least 5 characters).');
      return;
    }
    if (reason.length > 500) {
      setSuspendError('The reason must be at most 500 characters.');
      return;
    }
    setConfirm(null);
    if (!detail || busy) return;
    setPending('suspend');
    setMutationError(null);
    try {
      const updated = await apiFetch(`/admin/security-alerts/${detail.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: detail.status, suspendUserId: customer.id, reason }),
      });
      setDetail((prev) => (prev ? {
        ...prev,
        ...updated,
        customer: { ...(prev.customer || {}), status: updated?.suspended_user?.status || 'suspended' },
      } : prev));
      showToast('Customer suspended.');
      if (onSuspended) onSuspended(customer.id, updated);
      if (onUpdated) onUpdated(updated);
    } catch (e) {
      setMutationError(e.message || 'Unable to suspend this customer. Please try again.');
    } finally {
      setPending(null);
    }
  };

  const close = () => {
    if (busy) return; // never close during a critical mutation
    onClose?.();
  };

  const footer = (
    <div className="adm-ad__foot">
      <div className="adm-ad__actions">
        {canReview && (
          <button
            type="button"
            className="adm-ad__btn adm-ad__btn--outline adm-ad__btn--review"
            disabled={busy}
            onClick={() => runStatus('investigating', 'review')}
          >
            {pending === 'review' ? 'Updating...' : 'Mark Under Review'}
          </button>
        )}
        {isOpenAlert && (
          <button
            type="button"
            className="adm-ad__btn adm-ad__btn--ghost adm-ad__btn--dismiss"
            disabled={busy}
            onClick={() => setConfirm('dismiss')}
          >
            {pending === 'dismiss' ? 'Dismissing...' : 'Dismiss'}
          </button>
        )}
      </div>
      <div className="adm-ad__actions adm-ad__actions--right">
        {isOpenAlert && (
          <button
            type="button"
            className="adm-ad__btn adm-ad__btn--solid adm-ad__btn--resolve"
            disabled={busy}
            onClick={() => runStatus('resolved', 'resolve')}
          >
            {pending === 'resolve' ? 'Resolving...' : 'Mark Resolved'}
          </button>
        )}
        {canSuspend && (
          <button
            type="button"
            className="adm-ad__btn adm-ad__btn--danger adm-ad__btn--suspend"
            disabled={busy}
            onClick={() => {
              setSuspendReason(suggestedSuspendReason);
              setSuspendError('');
              setConfirm('suspend');
            }}
          >
            {pending === 'suspend' ? 'Suspending...' : 'Suspend Customer'}
          </button>
        )}
        {!isOpenAlert && (
          <button type="button" className="adm-ad__btn adm-ad__btn--ghost" onClick={close}>Close</button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title="Alert Details"
        subtitle="Review the security event and take an appropriate action."
        headerIcon={<TriangleAlert size={22} />}
        size="wide"
        footer={detail && !loadError ? footer : null}
      >
        {loading ? (
          <SkeletonBody />
        ) : loadError ? (
          <div className="adm-ad__error" role="alert">
            <span><AlertTriangle size={15} style={{ verticalAlign: '-3px', marginRight: 8 }} />{loadError}</span>
            <button type="button" onClick={load}>Retry</button>
          </div>
        ) : detail ? (
          <div className="adm-ad">
            {/* status / detected summary */}
            <div className="adm-ad__summary">
              <div className="adm-ad__badges">
                <span className={`adm-ad__badge adm-ad__badge--${alertSeverityTone(detail.severity)}`}>
                  {alertSeverityLabel(detail.severity)} Severity
                </span>
                <span className={`adm-ad__badge adm-ad__badge--${alertStatusTone(status)}`}>
                  {alertStatusLabel(status)}
                </span>
              </div>
              <div className="adm-ad__detected">
                <Clock size={14} aria-hidden="true" />
                <span>
                  <strong>Detected {formatRelativeTime(detail.detected_at || detail.created_at)}</strong>
                  {formatAbsoluteTime(detail.detected_at || detail.created_at)}
                </span>
              </div>
            </div>

            {mutationError && (
              <div className="adm-ad__error" role="alert">
                <span><AlertTriangle size={15} style={{ verticalAlign: '-3px', marginRight: 8 }} />{mutationError}</span>
              </div>
            )}

            {/* detail cards */}
            <div className="adm-ad__grid">
              <div className="adm-ad__card">
                <div className="adm-ad__card-head">
                  <div>
                    <div className="adm-ad__card-label"><Fingerprint size={12} aria-hidden="true" /> Alert ID</div>
                    <div className="adm-ad__card-value adm-ad__card-value--sm">{detail.id}</div>
                  </div>
                  <button
                    type="button"
                    className="adm-ad__copy"
                    ref={copyBtnRef}
                    onClick={copyId}
                    aria-label="Copy alert ID"
                  >
                    <Copy size={13} />
                  </button>
                </div>
              </div>

              <div className="adm-ad__card">
                <div className="adm-ad__card-label"><User size={12} aria-hidden="true" /> Customer</div>
                <div className="adm-ad__card-value">{customer?.name || 'Unknown customer'}</div>
                {customer?.email && <div className="adm-ad__card-sub">{customer.email}</div>}
                {customer?.status === 'suspended' && (
                  <div className="adm-ad__card-sub" style={{ color: '#c25757', fontWeight: 700 }}>Suspended</div>
                )}
              </div>

              <div className="adm-ad__card">
                <div className="adm-ad__card-label"><ShieldAlert size={12} aria-hidden="true" /> Alert type</div>
                <div className="adm-ad__card-value">{detail.type || '—'}</div>
              </div>

              <div className="adm-ad__card">
                <div className="adm-ad__card-label"><CalendarClock size={12} aria-hidden="true" /> Detected at</div>
                <div className="adm-ad__card-value">{formatAbsoluteTime(detail.detected_at || detail.created_at)}</div>
                <div className="adm-ad__card-sub">({formatRelativeTime(detail.detected_at || detail.created_at)})</div>
              </div>

              <div className="adm-ad__card">
                <div className="adm-ad__card-label"><FileText size={12} aria-hidden="true" /> Risk reason</div>
                <div className="adm-ad__reason">{detail.detail || 'No risk reason recorded.'}</div>
                {riskExplanation(detail, activity) && (
                  <p className="adm-ad__reason-text">{riskExplanation(detail, activity)}</p>
                )}
              </div>

              <div className="adm-ad__card">
                <div className="adm-ad__card-label"><Package size={12} aria-hidden="true" /> Related item</div>
                {related ? (
                  related.branch_id ? (
                    <Link
                      className="adm-ad__related"
                      to={`/admin/branches/${related.branch_id}?tab=auctions`}
                      title={`Open ${related.product_name || 'auction'} in the admin branch view`}
                    >
                      {related.image_url ? (
                        <img className="adm-ad__related-thumb" src={related.image_url} alt="" />
                      ) : (
                        <span className="adm-ad__related-thumb"><Package size={20} /></span>
                      )}
                      <span className="adm-ad__related-body">
                        <span className="adm-ad__related-name">{related.product_name || 'Untitled lot'}</span>
                        <span className="adm-ad__related-meta">
                          {related.auction_code ? `Auction Code: ${related.auction_code}` : 'Auction code unavailable'}
                          {related.branch_name ? ` · Branch: ${related.branch_name}` : ''}
                        </span>
                      </span>
                      <ChevronRight size={17} className="adm-ad__related-chevron" aria-hidden="true" />
                    </Link>
                  ) : (
                    <div className="adm-ad__related">
                      {related.image_url ? (
                        <img className="adm-ad__related-thumb" src={related.image_url} alt="" />
                      ) : (
                        <span className="adm-ad__related-thumb"><Package size={20} /></span>
                      )}
                      <span className="adm-ad__related-body">
                        <span className="adm-ad__related-name">{related.product_name || 'Untitled lot'}</span>
                        <span className="adm-ad__related-meta">
                          {related.auction_code ? `Auction Code: ${related.auction_code}` : 'Auction code unavailable'}
                        </span>
                      </span>
                    </div>
                  )
                ) : (
                  <div className="adm-ad__related-empty">No related auction/item.</div>
                )}
              </div>
            </div>

            {/* activity trail */}
            <div className="adm-ad__trail-card">
              <div className="adm-ad__trail-head">
                <div className="adm-ad__trail-title"><List size={14} aria-hidden="true" /> Activity Trail</div>
                <div className="adm-ad__trail-count">{activity.length} event{activity.length === 1 ? '' : 's'}</div>
              </div>
              {activity.length ? (
                <div className="adm-ad__trail-list">
                  {activity.map((row, i) => (
                    <div className={`adm-ad__trail-row${row.flagged ? ' adm-ad__trail-row--flagged' : ''}`} key={`${row.created_at || row.time || i}-${i}`}>
                      <span className="adm-ad__trail-dot" aria-hidden="true" />
                      <span className="adm-ad__trail-time">{row.time || '—'}</span>
                      <span className="adm-ad__trail-action">{row.action || 'Activity'}</span>
                      <span className="adm-ad__trail-amount">
                        {row.amount != null ? `₱${Number(row.amount).toLocaleString('en-PH')}` : '—'}
                      </span>
                      <span className="adm-ad__trail-item">{row.item ? `on ${row.item}` : ''}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="adm-ad__trail-empty">No related activity is available for this alert.</div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmModal
        open={confirm === 'dismiss'}
        onClose={() => setConfirm(null)}
        title="Dismiss security alert?"
        body="This alert will be marked as dismissed and removed from active review."
        confirmLabel="Dismiss Alert"
        onConfirm={() => runStatus('dismissed', 'dismiss')}
      />

      <ConfirmModal
        open={confirm === 'suspend'}
        onClose={() => { setConfirm(null); setSuspendError(''); }}
        title="Suspend customer?"
        body={(
          <div className="adm-ad__confirm">
            <p className="adm-ad__confirm-text">
              {customer?.name || 'This customer'} will lose access to protected ATANY functionality until
              reactivated by an administrator.
            </p>
            <label className="adm-ad__reason-label" htmlFor="adm-ad-suspend-reason">
              Reason for suspension <span aria-hidden="true">*</span>
            </label>
            <textarea
              id="adm-ad-suspend-reason"
              className="adm-ad__reason-input"
              rows={4}
              maxLength={500}
              value={suspendReason}
              onChange={(e) => { setSuspendReason(e.target.value); setSuspendError(''); }}
              placeholder="Enter the reason for suspending this account..."
              aria-describedby={suspendError ? 'adm-ad-suspend-reason-error' : undefined}
            />
            {suspendError && (
              <p className="adm-ad__reason-error" id="adm-ad-suspend-reason-error" role="alert">{suspendError}</p>
            )}
            <p className="adm-ad__reason-hint">
              The reason is shown to the account owner and stored in the admin audit trail.
            </p>
          </div>
        )}
        confirmLabel="Suspend Customer"
        danger
        onConfirm={runSuspend}
      />
    </>
  );
}

export default AlertDetailModal;
