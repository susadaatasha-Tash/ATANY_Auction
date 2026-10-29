// frontend/src/roles/shop-owner/subscription/PaymentMethodModal.jsx
// Update payment method — multi-step flow:
//   method (QR Ph | Card | E-Wallet)
//     → card (saved cards) / add_card
//     → ewallet (GCash | Maya)
//     → qrph
//     → review → confirm
// Two-column layout on wide steps: left = seller subscription summary, right =
// payment-method content. Nested screens get a back link; the modal title and
// close button stay in place the whole way.
//
// SECURITY CONTRACT:
// - ATANY never collects or stores raw PAN/CVC. Card details are entered in
//   the PayMongo.js secure field; values are forwarded browser → PayMongo for
//   tokenization only. The backend only ever sees a provider payment-method
//   id + safe display metadata (brand/last4/exp).
// - The publishable key comes from GET /billing/paymongo-config (or VITE_ env
//   inside the lib). Only pk_... publishable keys ever reach the client.
// - Wallets/QR Ph/BNPL are one-time hosted checkouts — the amount, seller and
//   billing record are derived server-side; the client only sends the method
//   type. Saved cards are managed via PATCH default / DELETE.
// - E-wallets are strictly GCash and Maya. GrabPay, ShopeePay and UnionBank are
//   never offered, rendered, or accepted by the subscription checkout.
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { apiFetch } from '../../../shared/lib/apiClient';
import { supabase } from '../../../shared/lib/supabaseClient';
import {
  buildAttachPayload,
  createCardPaymentMethod,
  getPublishableKey,
  isSecureCardEntryConfigured,
  setPublishableKey,
} from '../../../shared/lib/paymongoElements';
import { PaymentBrandLogo, brandChipClass, brandLabel } from './paymentBrands';
import { CHECKOUT_TYPE, methodRows, selectionLabel } from './paymentMethodConfig';
import { SubscriptionPaymentSummary } from './SubscriptionPaymentSummary';
import {
  AddCardStep,
  CardMethodStep,
  PaymentMethodSelector,
  PaymentReviewStep,
  QrPhStep,
  StepBack,
  WalletMethodStep,
} from './PaymentMethodSteps';

// Kept for backwards compatibility (NextPaymentCard + tests import these here).
export { brandLabel, brandChipClass };
export { SecureCardEntry } from './PaymentMethodSteps';

const NARROW_STEPS = new Set(['add_card', 'qrph', 'review']);
const DEFAULT_WALLET = 'gcash';

function PaymentBody({ children, wide, summary, ...rest }) {
  if (!wide) return <div className="ssub-pm ssub-pm--narrow" data-testid="payment-method-modal" {...rest}>{children}</div>;
  // The column divider is the left panel's border-right (`.ssub-pm__left`);
  // an extra div here would steal a grid cell and break the 42/58 layout.
  return (
    <div className={`ssub-pm ssub-pm--wide`} data-testid="payment-method-modal" {...rest}>
      <div className="ssub-pm__left">{summary}</div>
      <div className="ssub-pm__right">{children}</div>
    </div>
  );
}

export function PaymentMethodModal({
  open,
  onClose,
  showToast,
  payableRecord = null,
  subscriptionSummary = null,
  onChanged,
}) {
  const [step, setStep] = useState('method');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedWallet, setSelectedWallet] = useState(DEFAULT_WALLET);
  const [selectedSavedMethodId, setSelectedSavedMethodId] = useState(null);

  const [methods, setMethods] = useState([]);
  const [capability, setCapability] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState('');
  const [menuFor, setMenuFor] = useState(null);
  const [cardName, setCardName] = useState('');
  const [cardApi, setCardApi] = useState(null);
  const [elementError, setElementError] = useState('');
  const [configLoading, setConfigLoading] = useState(false);

  // Publishable key + provider capability from the backend.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setConfigLoading(true);
    setPublishableKey('');
    (async () => {
      try {
        const res = await apiFetch('/billing/paymongo-config');
        if (cancelled) return;
        setPublishableKey(res?.publishable_key || '');
        setCapability(res?.payment_methods || null);
      } catch {
        if (!cancelled) {
          setPublishableKey('');
          setCapability(null);
        }
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const secureConfigured = isSecureCardEntryConfigured();

  const loadMethods = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/billing/payment-methods');
      const list = res?.payment_methods || (Array.isArray(res) ? res : []);
      setMethods(list);
      const def = list.find((m) => m.is_default) || list[0];
      setSelectedSavedMethodId((prev) => {
        if (prev && list.some((m) => m.id === prev)) return prev;
        return def?.id || null;
      });
    } catch {
      setError('Unable to load saved payment methods.');
      setMethods([]);
    } finally {
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setStep('method');
      setSelectedCategory(null);
      setSelectedWallet(DEFAULT_WALLET);
      setError('');
      setMenuFor(null);
      setCardName('');
      setElementError('');
      setCardApi(null);
      setRedirecting(false);
      setSaving(false);
      setAdding(false);
      loadMethods();
    }
  }, [open, loadMethods]);

  const rows = useMemo(() => methodRows(capability), [capability]);
  const savedMethod = useMemo(
    () => methods.find((m) => m.id === selectedSavedMethodId) || null,
    [methods, selectedSavedMethodId]
  );
  const selection = {
    category: selectedCategory,
    wallet: selectedCategory === 'ewallet' ? selectedWallet : null,
    savedMethod: selectedCategory === 'card' ? savedMethod : null,
  };
  const methodLabel = selectionLabel(selection);

  const wide = !NARROW_STEPS.has(step);

  // ---- Navigation -----------------------------------------------------------

  const goBack = () => {
    setError('');
    setMenuFor(null);
    if (step === 'add_card') return setStep('card');
    if (step === 'card') return setStep('method');
    if (step === 'ewallet') return setStep('method');
    if (step === 'qrph') return setStep('method');
    if (step === 'review') {
      if (selectedCategory === 'card') return setStep('card');
      if (selectedCategory === 'ewallet') return setStep('ewallet');
      if (selectedCategory === 'qrph') return setStep('qrph');
      return setStep('method');
    }
    onClose?.();
  };

  // Selecting a method row only SELECTS it — Continue opens the flow.
  const handleSelectRow = (row) => {
    setError('');
    setMenuFor(null);
    setSelectedCategory(row.id);
  };

  const startSelectedFlow = () => {
    setError('');
    if (selectedCategory === 'card') return setStep('card');
    if (selectedCategory === 'ewallet') return setStep('ewallet');
    if (selectedCategory === 'qrph') return setStep('qrph');
  };

  // ---- Saved-card actions ---------------------------------------------------

  const handleSetDefault = async (method) => {
    setMenuFor(null);
    if (!method || method.is_default) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/billing/payment-methods/${method.id}/default`, { method: 'PATCH' });
      showToast?.('Payment method updated.');
      setSelectedSavedMethodId(method.id);
      await loadMethods();
      onChanged?.();
    } catch {
      setError('Unable to update payment method.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (method) => {
    setMenuFor(null);
    if (!method) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/billing/payment-methods/${method.id}`, { method: 'DELETE' });
      showToast?.('Payment method removed.');
      await loadMethods();
      onChanged?.();
    } catch {
      setError('Unable to remove payment method.');
    } finally {
      setSaving(false);
    }
  };

  // ---- Add card (secure tokenization) ---------------------------------------

  const handleAddCard = async () => {
    if (adding || !secureConfigured) return;
    if (!cardName.trim()) {
      setError('Please enter the cardholder name.');
      return;
    }
    setAdding(true);
    setError('');
    try {
      if (!cardApi?.root || !cardApi?.container) throw new Error('Secure card field is not ready');
      // billing.email is required by PayMongo for card tokenization — take it
      // from the authenticated session; never prompt the seller again.
      let billingEmail;
      try {
        const { data } = await supabase.auth.getSession();
        billingEmail = data?.session?.user?.email || undefined;
      } catch {
        billingEmail = undefined;
      }
      const tokenized = await createCardPaymentMethod({
        root: cardApi.root,
        container: cardApi.container,
        billingName: cardName.trim(),
        billingEmail,
      });
      const payload = buildAttachPayload(tokenized, { makeDefault: false });
      const res = await apiFetch('/billing/payment-methods/attach', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const created = res?.payment_method;
      await loadMethods();
      if (created?.id) setSelectedSavedMethodId(created.id);
      showToast?.('Card added.');
      onChanged?.();
      setCardName('');
      setStep('card');
    } catch (e) {
      if (e?.code === 'CARD_FIELDS_INCOMPLETE') {
        setError('Please complete all card fields.');
      } else {
        const msg = String(e?.message || '');
        if (msg.includes('DUPLICATE') || msg.toLowerCase().includes('already saved')) {
          setError('This card is already saved.');
        } else {
          setError('Unable to add card.');
        }
      }
    } finally {
      setAdding(false);
    }
  };

  // ---- Confirm (review step) -------------------------------------------------

  const handleConfirm = async () => {
    if (saving || redirecting) return;
    setError('');

    // Saved/new card → method management: set default (no charge).
    if (selectedCategory === 'card') {
      if (!savedMethod) return;
      if (savedMethod.is_default) {
        showToast?.('Payment method updated.');
        onClose?.();
        return;
      }
      setSaving(true);
      try {
        await apiFetch(`/billing/payment-methods/${savedMethod.id}/default`, { method: 'PATCH' });
        showToast?.('Payment method updated.');
        await loadMethods();
        onChanged?.();
        onClose?.();
      } catch {
        setError('Unable to update payment method.');
      } finally {
        setSaving(false);
      }
      return;
    }

    // Wallet / QR Ph / BNPL → one-time hosted checkout (amount is server-derived).
    if (!payableRecord?.id) return;
    const checkoutType =
      selectedCategory === 'ewallet'
        ? CHECKOUT_TYPE[selectedWallet]
        : CHECKOUT_TYPE[selectedCategory];
    if (!checkoutType) return;
    setRedirecting(true);
    try {
      const res = await apiFetch(`/billing/${payableRecord.id}/checkout`, {
        method: 'POST',
        body: JSON.stringify({ payment_method: checkoutType }),
      });
      if (res?.checkout_url) {
        window.location.href = res.checkout_url;
        return;
      }
      setError('Unable to start payment.');
    } catch {
      setError('Unable to start payment.');
    } finally {
      setRedirecting(false);
    }
  };

  // ---- Footer ---------------------------------------------------------------

  const closeDisabled = saving || adding || redirecting;

  let footer = null;
  if (step === 'card') {
    footer = (
      <>
        <button
          type="button"
          className="ssub-btn ssub-btn--outline"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label="Close payment method dialog"
        >
          Cancel
        </button>
        <button
          type="button"
          className="ssub-btn ssub-btn--navy"
          data-testid="continue-btn"
          disabled={closeDisabled || !savedMethod}
          onClick={() => {
            setError('');
            setStep('review');
          }}
        >
          Continue
        </button>
      </>
    );
  } else if (step === 'add_card') {
    footer = (
      <>
        <button
          type="button"
          className="ssub-btn ssub-btn--outline"
          onClick={goBack}
          disabled={closeDisabled}
          aria-label="Back to saved cards"
        >
          Back
        </button>
        <button
          type="button"
          className="ssub-btn ssub-btn--navy"
          data-testid="add-card-btn"
          disabled={adding || !secureConfigured || !cardApi}
          onClick={handleAddCard}
        >
          {adding ? 'Adding card…' : 'Add card'}
        </button>
      </>
    );
  } else if (step === 'ewallet') {
    footer = (
      <>
        <button
          type="button"
          className="ssub-btn ssub-btn--outline"
          onClick={goBack}
          disabled={closeDisabled}
          aria-label="Back to payment methods"
        >
          Back
        </button>
        <button
          type="button"
          className="ssub-btn ssub-btn--navy"
          data-testid="continue-btn"
          disabled={closeDisabled || !selectedWallet}
          onClick={() => {
            setError('');
            setStep('review');
          }}
        >
          Continue
        </button>
      </>
    );
  } else if (step === 'qrph') {
    footer = (
      <>
        <button
          type="button"
          className="ssub-btn ssub-btn--outline"
          onClick={goBack}
          disabled={closeDisabled}
          aria-label="Back to payment methods"
        >
          Back
        </button>
        <button
          type="button"
          className="ssub-btn ssub-btn--navy"
          data-testid="continue-btn"
          disabled={closeDisabled}
          onClick={() => {
            setError('');
            setStep('review');
          }}
        >
          Continue
        </button>
      </>
    );
  } else if (step === 'review') {
    const needsCheckout = selectedCategory !== 'card';
    const blocked = needsCheckout && !payableRecord?.id;
    footer = (
      <>
        <button
          type="button"
          className="ssub-btn ssub-btn--outline"
          onClick={goBack}
          disabled={closeDisabled}
          aria-label="Back"
        >
          Back
        </button>
        <button
          type="button"
          className="ssub-btn ssub-btn--navy"
          data-testid="confirm-method-btn"
          disabled={closeDisabled || blocked || (selectedCategory === 'card' && !savedMethod)}
          title={
            blocked
              ? 'No pending payment to settle right now. This method becomes available when a payment is due.'
              : undefined
          }
          onClick={handleConfirm}
        >
          {redirecting
            ? 'Redirecting…'
            : saving
              ? 'Saving…'
              : needsCheckout
                ? 'Confirm payment'
                : 'Confirm'}
        </button>
      </>
    );
  }

  // ---- Body per step --------------------------------------------------------

  const summary = (
    <SubscriptionPaymentSummary
      summary={subscriptionSummary}
      payableRecord={payableRecord}
    />
  );

  let body;
  if (step === 'method') {
    body = (
      <div className="ssub-pm-methodstep">
        <div>
          <h4 className="ssub-pm-heading" data-testid="method-heading">Choose a payment method</h4>
          {error && <div className="ssub-error" data-testid="payment-method-error">{error}</div>}
          <PaymentMethodSelector
            rows={rows}
            loading={configLoading && !capability}
            selectedId={selectedCategory}
            onSelect={handleSelectRow}
          />
        </div>
        <div className="ssub-pm-methodfoot">
          <button
            type="button"
            className="ssub-btn ssub-btn--navy ssub-btn--wide"
            data-testid="continue-btn"
            disabled={closeDisabled || !selectedCategory}
            onClick={startSelectedFlow}
          >
            Continue
            <ArrowRight size={17} strokeWidth={2.4} aria-hidden="true" />
          </button>
          <p className="ssub-pm-security" data-testid="payment-security-note">
            <LockKeyhole size={14} strokeWidth={2.2} aria-hidden="true" />
            Your payment is securely processed by ATANY. All transactions are encrypted.
          </p>
        </div>
      </div>
    );
  } else if (step === 'card') {
    body = (
      <>
        <StepBack onClick={goBack} disabled={closeDisabled} />
        <CardMethodStep
          methods={methods}
          loading={loading}
          error={error}
          selectedId={selectedSavedMethodId}
          menuFor={menuFor}
          onSelect={(m) => setSelectedSavedMethodId(m.id)}
          onToggleMenu={(m) => setMenuFor(menuFor === m.id ? null : m.id)}
          onSetDefault={handleSetDefault}
          onDelete={handleDelete}
          onAddCardClick={() => {
            setError('');
            setElementError('');
            setStep('add_card');
          }}
        />
      </>
    );
  } else if (step === 'add_card') {
    body = (
      <>
        <StepBack onClick={goBack} disabled={closeDisabled} label="Saved cards" />
        <AddCardStep
          active={open && secureConfigured}
          secureConfigured={secureConfigured}
          configLoading={configLoading}
          cardName={cardName}
          onCardNameChange={setCardName}
          adding={adding}
          error={error}
          elementError={elementError}
          onCardReady={(api) => {
            setCardApi(api);
            setElementError('');
          }}
          onCardError={(e) => {
            setCardApi(null);
            setElementError(e?.message || 'Unable to load PayMongo secure card entry.');
          }}
        />
      </>
    );
  } else if (step === 'ewallet') {
    body = (
      <>
        <StepBack onClick={goBack} disabled={closeDisabled} />
        <WalletMethodStep
          capability={capability}
          selectedWallet={selectedWallet}
          onSelect={(w) => setSelectedWallet(w.id)}
          error={error}
        />
      </>
    );
  } else if (step === 'qrph') {
    body = (
      <>
        <StepBack onClick={goBack} disabled={closeDisabled} />
        <QrPhStep error={error} />
      </>
    );
  } else {
    body = (
      <>
        <StepBack onClick={goBack} disabled={closeDisabled} />
        <PaymentReviewStep
          summary={subscriptionSummary}
          payableRecord={payableRecord}
          selection={selection}
          methodLabel={methodLabel}
        />
        {error && <div className="ssub-error" data-testid="payment-method-error">{error}</div>}
        {selectedCategory !== 'card' && !payableRecord?.id && (
          <p className="ssub-pm-hint" data-testid="no-payable-note">
            No pending payment to settle right now. This method becomes available when a
            payment is due.
          </p>
        )}
      </>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Update payment method"
      subtitle="Choose how you want to pay for your subscription."
      className={`ssub-payment-modal${NARROW_STEPS.has(step) ? ' ssub-payment-modal--narrow' : ''}`}
      footer={footer}
    >
      <PaymentBody wide={wide} summary={summary} data-step={step}>
        {body}
      </PaymentBody>
    </Modal>
  );
}

export default PaymentMethodModal;
