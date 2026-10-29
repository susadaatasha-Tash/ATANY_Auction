// frontend/src/roles/customer/purchases/PaymentDeadlineAccordion.jsx
import { useId, useState } from 'react';
import {
  PAYMENT_WINDOW_EXPIRED_MESSAGE,
  getFallbackNotice,
  getPaymentDeadlinePolicyText,
  getPaymentDeadlineState,
} from '../lib/paymentDeadline';

export function PaymentDeadlineAccordion({ order }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const state = getPaymentDeadlineState(order);
  if (!state.visible) return null;

  const tone = state.remaining.expired ? 'expired' : state.remaining.tone === 'soft' ? 'soft' : 'warn';
  // Reassignment is informational: the holder IS the current eligible winner.
  const fallbackNotice = getFallbackNotice(order);

  return (
    <div className={`mp-deadline mp-deadline-${tone}`}>
      <button
        type="button"
        className="mp-deadline-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(v => !v)}
      >
        <span className="mp-deadline-icon" aria-hidden="true">⚠</span>
        <span className="mp-deadline-title">{state.collapsedLabel}</span>
        <span className={`mp-deadline-pill mp-pill-${state.remaining.tone}`}>{state.remaining.text}</span>
        <span className={`mp-deadline-chevron${open ? ' is-open' : ''}`} aria-hidden="true">▾</span>
      </button>
      <div
        id={panelId}
        className={`mp-deadline-panel${open ? ' is-open' : ''}`}
        hidden={!open}
      >
        <div className="mp-deadline-panel-inner">
          {fallbackNotice && (
            <p className="mp-deadline-fallback" role="status">{fallbackNotice}</p>
          )}

          <div className="mp-deadline-policy-label">PAYMENT DEADLINE POLICY</div>
          <p className="mp-deadline-policy-text">{getPaymentDeadlinePolicyText(state.expired)}</p>

          {/* The collapsed row above already shows the exact deadline from the
              server's payment_deadline; these are the supporting facts.
              Nothing here recomputes created_at + 7 days. */}
          <div className="mp-deadline-facts">
            <div className="mp-deadline-fact">
              <span className="mp-deadline-fact-label">Winner confirmed on</span>
              <span className="mp-deadline-fact-value">
                {state.wonOn ? new Date(state.wonOn).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
              </span>
            </div>
            <div className="mp-deadline-fact">
              <span className="mp-deadline-fact-label">Remaining time</span>
              <span className={`mp-deadline-fact-value mp-pill-inline mp-pill-${state.remaining.tone}`}>{state.remaining.text}</span>
            </div>
          </div>

          {state.expired && (
            <p className="mp-deadline-expired-note" role="status">{PAYMENT_WINDOW_EXPIRED_MESSAGE}</p>
          )}
        </div>
      </div>
    </div>
  );
}