// frontend/src/roles/shop-owner/subscription/PaymentMethodModal.jsx
// Update payment method — saved cards + add new card.
// Security: ATANY never stores PAN/CVC. Add-new-card requires PayMongo Elements
// (client-side tokenization). Until VITE_PAYMONGO_PUBLISHABLE_KEY + Elements are
// wired, the modal shows saved methods and explains secure checkout collection.
import { useEffect, useState } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { apiFetch } from '../../../shared/lib/apiClient';

function methodLabel(m) {
  const brand = (m.brand || m.type || 'card').toString();
  const last4 = m.last4 ? `•••• ${m.last4}` : '';
  return `${brand} ${last4}`.trim();
}

export function PaymentMethodModal({ open, onClose, showToast }) {
  const [tab, setTab] = useState('saved');
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  // "Add new card" form fields are UI-only placeholders — never POSTed to ATANY.
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [makeDefault, setMakeDefault] = useState(true);

  const publishableKey = import.meta.env?.VITE_PAYMONGO_PUBLISHABLE_KEY || '';

  const loadMethods = async () => {
    if (!open) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/billing/payment-methods');
      const list = res?.payment_methods || (Array.isArray(res) ? res : []);
      setMethods(list);
      const def = list.find((m) => m.is_default) || list[0];
      setSelectedId(def?.id || null);
    } catch (e) {
      setError(e.message || 'Failed to load payment methods');
      setMethods([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setTab('saved');
      setError('');
      loadMethods();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSetDefault = async (method) => {
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/billing/payment-methods/${method.id}/default`, { method: 'PATCH' });
      showToast?.('Default payment method updated');
      await loadMethods();
    } catch (e) {
      setError(e.message || 'Failed to set default');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (method) => {
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/billing/payment-methods/${method.id}`, { method: 'DELETE' });
      showToast?.('Payment method removed');
      await loadMethods();
    } catch (e) {
      setError(e.message || 'Failed to remove payment method');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCard = async () => {
    setError('');
    if (!publishableKey) {
      setError(
        'Adding a new saved card is not available yet. ' +
          'Card details are never sent to ATANY. Complete payments securely via PayMongo checkout.'
      );
      return;
    }
    // Elements integration point: tokenize with PayMongo.js, then:
    // await apiFetch('/billing/payment-methods/attach', { method: 'POST', body: JSON.stringify({
    //   provider_payment_method_id: pmId, brand, last4, exp_month, exp_year, make_default: makeDefault
    // })})
    setError('PayMongo Elements tokenization is not configured in this build yet.');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Update payment method"
      className="ssub-payment-modal"
      footer={
        <>
          <button type="button" className="ssub-btn ssub-btn--outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {tab === 'saved' ? (
            <button
              type="button"
              className="ssub-btn ssub-btn--gold"
              data-testid="save-payment-method-btn"
              disabled={saving || !selectedId}
              onClick={async () => {
                const method = methods.find((m) => m.id === selectedId);
                if (method && !method.is_default) {
                  await handleSetDefault(method);
                } else {
                  onClose?.();
                }
              }}
            >
              {saving ? 'Saving…' : 'Save payment method'}
            </button>
          ) : (
            <button
              type="button"
              className="ssub-btn ssub-btn--gold"
              data-testid="add-card-save-btn"
              disabled={saving}
              onClick={handleSaveCard}
            >
              {saving ? 'Saving…' : 'Save payment method'}
            </button>
          )}
        </>
      }
    >
      <div className="ssub-paymethod" data-testid="payment-method-modal">
        <div className="ssub-toggle" role="group" aria-label="Payment method tabs">
          <button
            type="button"
            className={`ssub-toggle__btn ${tab === 'saved' ? 'is-active' : ''}`}
            data-testid="tab-saved-cards"
            onClick={() => setTab('saved')}
          >
            Saved cards
          </button>
          <button
            type="button"
            className={`ssub-toggle__btn ${tab === 'add' ? 'is-active' : ''}`}
            data-testid="tab-add-card"
            onClick={() => setTab('add')}
          >
            Add new card
          </button>
        </div>

        {error && (
          <div className="ssub-error" data-testid="payment-method-error">
            {error}
          </div>
        )}

        {tab === 'saved' && (
          <div className="ssub-paymethod__list" data-testid="saved-methods-list">
            {loading && <div className="ssub-loading">Loading payment methods…</div>}
            {!loading && methods.length === 0 && (
              <div className="ssub-empty">
                <p className="ssub-empty__title">No saved payment methods</p>
                <p className="ssub-empty__text">
                  Payment method selected during checkout. Saved cards appear here when PayMongo
                  Elements is connected.
                </p>
              </div>
            )}
            {!loading &&
              methods.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`ssub-paymethod__row ${selectedId === m.id ? 'is-selected' : ''}`}
                  data-testid={`saved-method-${m.id}`}
                  onClick={() => setSelectedId(m.id)}
                >
                  <div className="ssub-paymethod__main">
                    <div className="ssub-paymethod__name">
                      {methodLabel(m)}
                      {m.is_default && (
                        <span className="ssub-chip ssub-chip--active">Default</span>
                      )}
                    </div>
                    <div className="ssub-paymethod__meta">
                      {m.type === 'card' || !m.type
                        ? `Card${m.exp_month && m.exp_year ? ` · Expires ${String(m.exp_month).padStart(2, '0')}/${String(m.exp_year).slice(-2)}` : ''}`
                        : m.type}
                    </div>
                  </div>
                  <div className="ssub-paymethod__actions">
                    {selectedId === m.id && (
                      <span className="ssub-paymethod__check" aria-hidden="true">✓</span>
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      className="ssub-paymethod__link"
                      data-testid={`set-default-${m.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!m.is_default) handleSetDefault(m);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && !m.is_default && handleSetDefault(m)}
                    >
                      {m.is_default ? 'Default' : 'Set default'}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      className="ssub-paymethod__link ssub-paymethod__link--danger"
                      data-testid={`delete-method-${m.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(m);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && handleDelete(m)}
                    >
                      Remove
                    </span>
                  </div>
                </button>
              ))}
          </div>
        )}

        {tab === 'add' && (
          <div className="ssub-paymethod__form" data-testid="add-card-form">
            <div className="ssub-manage__note" data-testid="elements-notice">
              <strong>Adding a new saved card is not available yet.</strong>
              {' '}Card numbers and CVCs are never stored by ATANY. Secure card entry requires
              PayMongo Elements (client-side tokenization) with{' '}
              <code>VITE_PAYMONGO_PUBLISHABLE_KEY</code>. Until then, complete payments securely
              via PayMongo hosted checkout. Saved methods below (if any) were attached as
              provider payment-method ids only.
            </div>
            <label className="ssub-field">
              <span>Name on card</span>
              <input
                type="text"
                placeholder="Golden Heritage Co."
                value={cardName}
                onChange={(e) => setCardName(e.target.value)}
                autoComplete="cc-name"
                disabled={!publishableKey}
              />
            </label>
            <label className="ssub-field">
              <span>Card number</span>
              <input
                type="text"
                placeholder="0000 0000 0000 0000"
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                autoComplete="cc-number"
                disabled={!publishableKey}
              />
            </label>
            <div className="ssub-field-row">
              <label className="ssub-field">
                <span>Expiry</span>
                <input
                  type="text"
                  placeholder="MM/YY"
                  value={cardExpiry}
                  onChange={(e) => setCardExpiry(e.target.value)}
                  autoComplete="cc-exp"
                  disabled={!publishableKey}
                />
              </label>
              <label className="ssub-field">
                <span>CVC</span>
                <input
                  type="password"
                  placeholder="123"
                  value={cardCvc}
                  onChange={(e) => setCardCvc(e.target.value)}
                  autoComplete="cc-csc"
                  disabled={!publishableKey}
                />
              </label>
            </div>
            <label className="ssub-checkbox">
              <input
                type="checkbox"
                checked={makeDefault}
                onChange={(e) => setMakeDefault(e.target.checked)}
              />
              Set as default payment method
            </label>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default PaymentMethodModal;
