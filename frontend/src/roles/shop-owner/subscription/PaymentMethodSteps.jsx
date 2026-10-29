// frontend/src/roles/shop-owner/subscription/PaymentMethodSteps.jsx
// Nested steps of the Update-payment-method modal: saved cards, add card,
// e-wallet chooser, QR Ph instructions, and the final review.
//
// SECURITY: card details live exclusively in the PayMongo.js secure field
// (SecureCardEntry below). React never sees PAN/CVC; the backend only ever
// receives a provider payment-method id + safe display metadata.
import { useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CreditCard,
  Info,
  Lock,
  MoreVertical,
  Plus,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { PaymentBrandLogo, QrPhWordmark, brandChipClass, brandLabel } from './paymentBrands';
import {
  CHECKOUT_TYPE,
  WALLET_LABELS,
  methodRows,
  selectionLabel,
  walletRows,
} from './paymentMethodConfig';
import { formatBillingReference } from './sellerSubscriptionSelectors';
import { intervalLabel } from '../../../shared/lib/subscriptionPlans';
import { peso } from '../../admin/lib/currency';
import {
  getPublishableKey,
  isSecureCardEntryConfigured,
  mountCardElement,
} from '../../../shared/lib/paymongoElements';

/** Back link used by every nested screen (header title + X stay in place). */
export function StepBack({ onClick, disabled, label = 'Back' }) {
  return (
    <button
      type="button"
      className="ssub-pm-back"
      data-testid="step-back"
      onClick={onClick}
      disabled={disabled}
    >
      <ArrowLeft size={16} strokeWidth={2.4} aria-hidden="true" />
      {label}
    </button>
  );
}

/**
 * Right-hand provider logo cluster for a category row (matches the approved
 * reference: wordmark for QR Ph, real local brand marks for Card and E-Wallet).
 */
function RowLogos({ id }) {
  if (id === 'qrph') {
    return (
      <span className="ssub-pm-rowlogos" data-testid="row-logos-qrph">
        <QrPhWordmark />
      </span>
    );
  }
  if (id === 'card') {
    return (
      <span className="ssub-pm-rowlogos ssub-pm-rowlogos--chips" data-testid="row-logos-card">
        <PaymentBrandLogo id="visa" size="xs" />
        <PaymentBrandLogo id="mastercard" size="xs" />
        <PaymentBrandLogo id="amex" size="xs" />
        <PaymentBrandLogo id="jcb" size="xs" />
      </span>
    );
  }
  if (id === 'ewallet') {
    return (
      <span className="ssub-pm-rowlogos ssub-pm-rowlogos--chips" data-testid="row-logos-ewallet">
        <PaymentBrandLogo id="gcash" size="xs" />
        <PaymentBrandLogo id="maya" size="xs" />
      </span>
    );
  }
  return null;
}

/** Category icon box (left of each row). */
function RowIcon({ id }) {
  if (id === 'card') {
    return (
      <span className="ssub-pm-rowicon ssub-pm-rowicon--navy" aria-hidden="true" data-testid="row-icon-card">
        <CreditCard size={20} strokeWidth={2} />
      </span>
    );
  }
  if (id === 'ewallet') {
    return (
      <span className="ssub-pm-rowicon" aria-hidden="true" data-testid="row-icon-ewallet">
        <WalletCards size={20} strokeWidth={2} />
      </span>
    );
  }
  return (
    <span className="ssub-pm-rowicon ssub-pm-rowicon--plain" aria-hidden="true" data-testid="row-icon-qrph">
      <PaymentBrandLogo id="qrph" size="md" />
    </span>
  );
}

/**
 * Method-selector rows (step: method) — QR Ph / Card / E-Wallet.
 * Selecting a row only SELECTS it; the Continue button opens the flow.
 */
export function PaymentMethodSelector({ rows, onSelect, selectedId = null, loading }) {
  if (loading) return <div className="ssub-loading">Loading payment methods…</div>;
  return (
    <div className="ssub-pm-selector" role="radiogroup" aria-label="Payment method" data-testid="method-selector">
      {rows.map((row) => {
        const selected = selectedId === row.id;
        return (
          <button
            key={row.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`ssub-pm-method ${selected ? 'is-selected' : ''}`}
            data-testid={`method-${row.id}`}
            onClick={() => onSelect(row)}
          >
            <span className={`ssub-pm-radio ${selected ? 'is-on' : ''}`} aria-hidden="true" />
            <RowIcon id={row.id} />
            <span className="ssub-pm-method__body">
              <span className="ssub-pm-method__title">{row.title}</span>
              <span className="ssub-pm-method__hint">{row.hint}</span>
            </span>
            <RowLogos id={row.id} />
            <ChevronRight className="ssub-pm-method__chev" size={18} strokeWidth={2.4} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

/** Saved-card row with radio + default chip + ⋮ menu (set default / remove). */
export function SavedCardRow({ method, selected, menuOpen, onSelect, onToggleMenu, onSetDefault, onDelete }) {
  const exp =
    method.exp_month && method.exp_year
      ? `Expires ${String(method.exp_month).padStart(2, '0')}/${String(method.exp_year).slice(-2)}`
      : '';
  return (
    <div className={`ssub-pm-cardrow ${selected ? 'is-selected' : ''}`} data-testid={`saved-method-${method.id}`}>
      <button
        type="button"
        role="radio"
        aria-checked={!!selected}
        className="ssub-pm-cardrow__select"
        onClick={() => onSelect(method)}
      >
        <span className={`ssub-pm-radio ${selected ? 'is-on' : ''}`} aria-hidden="true" />
        <PaymentBrandLogo id={method.brand || 'card'} size="sm" />
        <span className="ssub-pm-cardrow__main">
          <span className="ssub-pm-cardrow__num">{method.last4 ? `•••• ${method.last4}` : 'Card'}</span>
          <span className="ssub-pm-cardrow__exp">{exp}</span>
        </span>
      </button>
      {method.is_default && (
        <span className="ssub-chip ssub-chip--active" data-testid={`default-chip-${method.id}`}>
          Default
        </span>
      )}
      <div className="ssub-pm-menu">
        <button
          type="button"
          className="ssub-pm-menu__btn"
          aria-label={`Options for card ending ${method.last4 || ''}`.trim()}
          data-testid={`menu-${method.id}`}
          aria-expanded={menuOpen}
          onClick={() => onToggleMenu(method)}
        >
          <MoreVertical size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div className="ssub-pm-menu__pop" role="menu">
            {!method.is_default && (
              <button
                type="button"
                role="menuitem"
                data-testid={`menu-set-default-${method.id}`}
                onClick={() => onSetDefault(method)}
              >
                Set as default
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="ssub-pm-menu__danger"
              data-testid={`menu-remove-${method.id}`}
              onClick={() => onDelete(method)}
            >
              Remove card
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Step: card — saved cards + entry point to add a new card. */
export function CardMethodStep({ methods, loading, error, selectedId, menuFor, onSelect, onToggleMenu, onSetDefault, onDelete, onAddCardClick }) {
  return (
    <section aria-label="Saved cards">
      <div className="ssub-pm-stephead">
        <h4 className="ssub-pm-heading" data-testid="saved-cards-heading">Saved cards</h4>
        <button
          type="button"
          className="ssub-btn ssub-btn--outline ssub-btn--sm"
          data-testid="open-add-card"
          onClick={onAddCardClick}
        >
          <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
          Add new card
        </button>
      </div>

      {error && <div className="ssub-error" data-testid="payment-method-error">{error}</div>}

      <div className="ssub-pm-list" role="radiogroup" aria-label="Saved cards" data-testid="saved-methods-list">
        {loading && <div className="ssub-loading">Loading payment methods…</div>}
        {!loading && methods.length === 0 && (
          <div className="ssub-pm-empty" data-testid="saved-methods-empty">
            <p className="ssub-pm-empty__title">No saved payment methods yet.</p>
            <p className="ssub-pm-empty__text">
              Cards securely saved through the payment provider will appear here.
            </p>
            <button type="button" className="ssub-btn ssub-btn--outline ssub-btn--sm" data-testid="empty-add-card" onClick={onAddCardClick}>
              <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
              Add your first card
            </button>
          </div>
        )}
        {!loading &&
          methods.map((m) => (
            <SavedCardRow
              key={m.id}
              method={m}
              selected={selectedId === m.id}
              menuOpen={menuFor === m.id}
              onSelect={onSelect}
              onToggleMenu={onToggleMenu}
              onSetDefault={onSetDefault}
              onDelete={onDelete}
            />
          ))}
      </div>
    </section>
  );
}

/**
 * Secure card entry — PayMongo.js Elements card field (number | MM/YY | CVC).
 * The SDK owns the inputs; React never sees PAN/CVC.
 */
export function SecureCardEntry({ active, onReady, onError }) {
  const containerRef = useRef(null);
  const apiRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!active || !isSecureCardEntryConfigured()) {
      apiRef.current = null;
      return undefined;
    }
    (async () => {
      try {
        const mounted = await mountCardElement(containerRef.current, {
          publicKey: getPublishableKey(),
          // Abort stale async mounts (StrictMode double-effect / fast channel
          // switches) so only one card field ever occupies the container.
          isCancelled: () => cancelled,
        });
        if (cancelled) return;
        apiRef.current = mounted;
        onReady?.(mounted);
      } catch (e) {
        if (e?.code === 'MOUNT_CANCELLED') return;
        if (!cancelled) onError?.(e);
      }
    })();
    return () => {
      cancelled = true;
      try {
        apiRef.current?.card?.unmount?.();
        if (containerRef.current) containerRef.current.innerHTML = '';
      } catch {
        /* element may already be gone */
      }
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className="ssub-pm-cardfield" data-testid="secure-card-field">
      <div className="ssub-pm-cardfield__frame" ref={containerRef} />
    </div>
  );
}

/** Step: add card — secure entry + cardholder name (PAN/CVC never in React). */
export function AddCardStep({
  active,
  secureConfigured,
  configLoading,
  cardName,
  onCardNameChange,
  adding,
  error,
  elementError,
  onCardReady,
  onCardError,
  brand,
}) {
  return (
    <section aria-label="Add new card">
      <h4 className="ssub-pm-heading" data-testid="add-card-heading">Add new card</h4>
      <p className="ssub-pm-sub">
        Enter your card information using our secure payment provider.
      </p>

      {error && <div className="ssub-error" data-testid="payment-method-error">{error}</div>}

      <label className="ssub-field">
        <span>Cardholder name</span>
        <input
          type="text"
          placeholder="Juan Dela Cruz"
          value={cardName}
          onChange={(e) => onCardNameChange(e.target.value)}
          autoComplete="cc-name"
          disabled={!secureConfigured || adding}
          data-testid="cardholder-name-input"
        />
      </label>

      {configLoading ? (
        <div className="ssub-loading" data-testid="secure-entry-loading">Loading secure card entry…</div>
      ) : secureConfigured ? (
        <>
          <p className="ssub-pm-label">Card details</p>
          <SecureCardEntry active={active} onReady={onCardReady} onError={onCardError} />
          {elementError && (
            <p className="ssub-pm-hint ssub-pm-hint--error" data-testid="secure-entry-error">{elementError}</p>
          )}
          <p className="ssub-pm-lock" data-testid="secure-entry-note">
            <Lock size={13} strokeWidth={2.2} aria-hidden="true" />
            Your card details are securely encrypted by PayMongo.
          </p>
          <div className="ssub-pm-brands" aria-label="Accepted cards">
            <PaymentBrandLogo id="visa" size="sm" />
            <PaymentBrandLogo id="mastercard" size="sm" />
            <PaymentBrandLogo id="amex" size="sm" />
            <PaymentBrandLogo id="jcb" size="sm" />
          </div>
        </>
      ) : (
        <>
          <div className="ssub-pm-unavailable" data-testid="secure-entry-unavailable">
            <strong>Secure card entry is temporarily unavailable.</strong>
            <p>Please try again in a moment.</p>
          </div>
        </>
      )}
      <p className="ssub-pm-hint ssub-pm-hint--left" data-testid="add-card-security">
        ATANY never sees or stores your card number or CVC.
        {brand ? ` Detected: ${brandLabel(brand)}.` : ''}
      </p>
    </section>
  );
}

/** Step: e-wallet — GCash / Maya rows (only wallets this flow offers). */
export function WalletMethodStep({ capability, selectedWallet, onSelect, error }) {
  const wallets = walletRows(capability);
  return (
    <section aria-label="E-wallet">
      <div className="ssub-pm-stephead">
        <h4 className="ssub-pm-heading" data-testid="wallet-heading">Choose your e-wallet</h4>
      </div>
      {error && <div className="ssub-error" data-testid="payment-method-error">{error}</div>}
      <div className="ssub-pm-selector" role="radiogroup" aria-label="E-wallet" data-testid="wallet-list">
        {wallets.map((w) => {
          const selected = selectedWallet === w.id;
          return (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`ssub-pm-method ${selected ? 'is-selected' : ''}`}
              data-testid={`wallet-${w.id}`}
              onClick={() => onSelect(w)}
            >
              <PaymentBrandLogo id={w.logo} />
              <span className="ssub-pm-method__body">
                <span className="ssub-pm-method__title">{w.title}</span>
                <span className="ssub-pm-method__hint">{w.hint}</span>
              </span>
              <span className={`ssub-pm-radio ${selected ? 'is-on' : ''}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <p className="ssub-pm-hint ssub-pm-hint--left" data-testid="wallet-security">
        <ShieldCheck size={14} strokeWidth={2.2} aria-hidden="true" />
        You&apos;ll be redirected to a secure PayMongo page. ATANY never asks for your
        wallet PIN or OTP.
      </p>
    </section>
  );
}

/** Step: QR Ph — instructions only; the QR itself lives on the hosted page. */
export function QrPhStep({ onContinue, error }) {
  return (
    <section aria-label="QR Ph">
      <div className="ssub-pm-stephead">
        <h4 className="ssub-pm-heading" data-testid="qrph-heading">Pay with QR Ph</h4>
      </div>
      {error && <div className="ssub-error" data-testid="payment-method-error">{error}</div>}

      <div className="ssub-pm-qrhero" data-testid="qrph-hero">
        <PaymentBrandLogo id="qrph" size="lg" />
        <div>
          <strong>Scan the QR on the payment page</strong>
          <p>QR Ph is shown on PayMongo&apos;s secure checkout page after you continue.</p>
        </div>
      </div>

      <ol className="ssub-pm-steps" data-testid="qrph-steps">
        <li>
          <span className="ssub-pm-steps__n" aria-hidden="true">1</span>
          <span>Continue to the secure payment page.</span>
        </li>
        <li>
          <span className="ssub-pm-steps__n" aria-hidden="true">2</span>
          <span>Open your banking or e-wallet app and scan the QR Ph code.</span>
        </li>
        <li>
          <span className="ssub-pm-steps__n" aria-hidden="true">3</span>
          <span>Confirm the payment — you&apos;ll be redirected back to ATANY.</span>
        </li>
      </ol>

      <p className="ssub-pm-infoband" data-testid="qrph-notice">
        <Info size={15} strokeWidth={2.2} aria-hidden="true" />
        The QR code and its expiry are provided by PayMongo on the payment page.
      </p>
    </section>
  );
}

/** Step: review — chosen method + real subscription figures + confirm hint. */
export function PaymentReviewStep({ summary, payableRecord, selection, methodLabel }) {
  const open = summary?.open_record || null;
  const current = summary?.current_record || null;
  const nextPayment = summary?.next_payment || null;
  const planName = summary?.plan?.name || nextPayment?.plan_name || '—';
  const interval =
    nextPayment?.billing_interval || summary?.billing_interval || 'monthly';
  const amount =
    nextPayment?.amount ??
    open?.amount ??
    current?.amount ??
    (payableRecord?.amount != null ? Number(payableRecord.amount) : 0);
  const dueDate =
    nextPayment?.due_date || open?.due_date || current?.current_period_end || payableRecord?.due_date || null;
  const refRecord = open || payableRecord || current;
  const dateLabel = dueDate
    ? new Date(dueDate).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';
  const logoId = selection.category === 'ewallet' ? selection.wallet : selection.category;

  return (
    <section aria-label="Review payment">
      <h4 className="ssub-pm-heading" data-testid="review-heading">Review and confirm</h4>

      <div className="ssub-pm-reviewrow" data-testid="review-method">
        <PaymentBrandLogo id={logoId} />
        <div className="ssub-pm-reviewrow__body">
          <span className="ssub-pm-reviewrow__label">Payment method</span>
          <strong data-testid="review-method-label">{methodLabel}</strong>
        </div>
      </div>

      <dl className="ssub-pm-summary__rows ssub-pm-summary__rows--review">
        <div className="ssub-pm-summary__row">
          <dt>Plan</dt>
          <dd data-testid="review-plan">{planName} · {intervalLabel(interval)}</dd>
        </div>
        <div className="ssub-pm-summary__row">
          <dt>Amount</dt>
          <dd data-testid="review-amount">{peso(amount)}</dd>
        </div>
        <div className="ssub-pm-summary__row">
          <dt>{open ? 'Due date' : 'Next payment'}</dt>
          <dd data-testid="review-date">{dateLabel}</dd>
        </div>
        <div className="ssub-pm-summary__row">
          <dt>Reference number</dt>
          <dd data-testid="review-reference">{formatBillingReference(refRecord)}</dd>
        </div>
      </dl>

      <p className="ssub-pm-infoband" data-testid="review-note">
        <Check size={15} strokeWidth={2.4} aria-hidden="true" />
        {selection.category === 'card'
          ? 'Confirming sets this card as your default payment method.'
          : 'You’ll be redirected to PayMongo’s secure page to finish payment.'}
      </p>
    </section>
  );
}

/** Convenience: label for the current selection. */
export function currentSelectionLabel(selection) {
  if (!selection) return '—';
  return selectionLabel(selection);
}

export { CHECKOUT_TYPE, methodRows, WALLET_LABELS };
