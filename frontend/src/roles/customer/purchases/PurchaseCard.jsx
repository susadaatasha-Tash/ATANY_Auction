// frontend/src/roles/customer/purchases/PurchaseCard.jsx
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from './StatusBadge';
import { PaymentDeadlineAccordion } from './PaymentDeadlineAccordion';
import { PurchaseProgress } from './PurchaseProgress';
import { buildDirectionsUrl, formatPaymentMethod, getPaymentStatusBadge, getPurchaseActions, getPurchaseStatusBadge } from '../lib/purchaseStatus';
import { formatShortDate } from '../lib/paymentDeadline';
import { peso } from '../lib/currency';

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=400&q=70';

function MetaRow({ icon, children, title }) {
  return (
    <span className="mp-meta-item" title={title}>
      <span className="mp-meta-icon" aria-hidden="true">{icon}</span>
      <span className="mp-meta-text">{children}</span>
    </span>
  );
}

const IconDoc = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></svg>
);
const IconCal = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
);
const IconPin = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>
);
const IconLot = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
);

export function PurchaseCard({ order }) {
  const navigate = useNavigate();
  const status = getPurchaseStatusBadge(order);
  const payment = getPaymentStatusBadge(order);
  const actions = getPurchaseActions(order);
  const img = order.img || FALLBACK_IMG;
  const methodLabel = formatPaymentMethod(order.payment_method);
  const directionsUrl = buildDirectionsUrl(order);

  return (
    <article className="mp-card" aria-label={`Purchase ${order.displayId || order.id}`}>
      <div className="mp-card-top">
        <img
          className="mp-card-img"
          src={img}
          alt={order.item || 'Jewelry purchase'}
          onError={(e) => { e.currentTarget.src = FALLBACK_IMG; }}
        />

        <div className="mp-card-body">
          <div className="mp-card-badges">
            {order.auction_code && (
              <span className="mp-lot">{order.auction_code}</span>
            )}
            <StatusBadge label={status.label} tone={status.tone} />
            <StatusBadge label={payment.label} tone={payment.tone} />
          </div>

          <h3 className="mp-card-title">{order.item || 'Auction purchase'}</h3>

          <div className="mp-card-meta">
            <div className="mp-meta-inline">
              <MetaRow icon={<IconDoc />} title="Order number">{order.displayId}</MetaRow>
              <span className="mp-meta-sep" aria-hidden="true">·</span>
              <MetaRow icon={<IconCal />} title="Won date">Won {formatShortDate(order.wonDate)}</MetaRow>
              {order.branch && (
                <>
                  <span className="mp-meta-sep" aria-hidden="true">·</span>
                  <MetaRow icon={<IconPin />} title="Pickup branch">{order.branch}</MetaRow>
                </>
              )}
            </div>
            {!order.auction_code && order.transaction_code && (
              <div className="mp-card-meta-line">
                <MetaRow icon={<IconLot />} title="Invoice">{order.transaction_code}</MetaRow>
              </div>
            )}
          </div>

          <PaymentDeadlineAccordion order={order} />
        </div>

        <div className="mp-card-actions">
          <div className="mp-total">
            <span className="mp-total-label">Total</span>
            <span className="mp-total-value">{peso(order.amount)}</span>
          </div>
          <div className="mp-action-list">
            {actions.map((a) => {
              if (a.kind === 'directions') {
                if (!directionsUrl) return null;
                return (
                  <button
                    key={a.key}
                    type="button"
                    className={`mp-btn mp-btn-${a.variant}`}
                    onClick={() => window.open(directionsUrl, '_blank', 'noopener,noreferrer')}
                  >
                    Get directions
                  </button>
                );
              }
              if (a.disabled) {
                return (
                  <button
                    key={a.key}
                    type="button"
                    className={`mp-btn mp-btn-${a.variant} is-disabled`}
                    disabled
                    title={a.note}
                  >
                    {a.label}
                  </button>
                );
              }
              return (
                <button
                  key={a.key}
                  type="button"
                  className={`mp-btn mp-btn-${a.variant}`}
                  onClick={() => navigate(a.to)}
                >
                  {a.label}
                </button>
              );
            })}
            {methodLabel && (order.payment_status === 'paid' || ['preparing', 'ready_pickup', 'completed'].includes(order.status)) && (
              <p className="mp-pay-method">Paid via {methodLabel}</p>
            )}
          </div>
        </div>
      </div>

      <PurchaseProgress order={order} />
    </article>
  );
}
