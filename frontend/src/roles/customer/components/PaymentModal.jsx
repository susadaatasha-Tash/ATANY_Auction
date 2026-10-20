// frontend/src/roles/customer/components/PaymentModal.jsx
// Port of customer-dashboard.html:540-548 + 990-1069 payModal
// Spec 4.4: pickup-only — no delivery; status pending -> ready_pickup on success
import { useState } from 'react';

function peso(n) { return '₱' + Number(n).toLocaleString(); }

const PAY_METHODS = [
  { id: 'gcash', label: 'GCash' },
  { id: 'card', label: 'Credit / Debit Card' },
  { id: 'bank', label: 'Bank Transfer' },
  { id: 'counter', label: 'Pay at Branch Counter' },
];

export function PaymentModal({ order, open, onClose, onConfirm }) {
  const [method, setMethod] = useState('gcash');
  const [paid, setPaid] = useState(false);
  if (!open || !order) return null;

  if (paid) {
    return (
      <div className="modal-overlay show" onClick={(e) => e.target.id === 'payModal' && onClose()}>
        <div className="modal-box pay-box" id="payModal">
          <div className="pay-success">
            <h3>Payment Confirmed</h3>
            <p>{peso(order.amount)} paid via {PAY_METHODS.find((m) => m.id === method)?.label} for <b>{order.item}</b>.</p>
            <p>Ready for pickup at <b>{order.branch}</b> — bring ID + order <b>{order.id}</b> within 7 days.</p>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 18 }} onClick={() => { setPaid(false); onClose(); }}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay show" onClick={(e) => e.target.id === 'payModal' && onClose()}>
      <div className="modal-box pay-box" id="payModal">
        <div className="modal-box-head"><h3>Complete Payment</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-box-body">
          <div className="pay-summary">
            <div className="pay-summary-row"><span>{order.item}</span><span>{peso(order.amount)}</span></div>
            <div className="pay-summary-row total"><span>Total due</span><span>{peso(order.amount)}</span></div>
          </div>
          <div className="pickup-note">Pickup-only — no delivery. Bring valid ID + order number to <b>{order.branch}</b> within 7 days.</div>
          <div className="pay-methods">
            {PAY_METHODS.map((m) => (
              <label key={m.id} className={`pay-method ${method === m.id ? 'selected' : ''}`} onClick={() => setMethod(m.id)}>
                <input type="radio" checked={method === m.id} readOnly /> {m.label}
              </label>
            ))}
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => { setPaid(true); onConfirm(order.id, method); }}>Pay {peso(order.amount)}</button>
        </div>
      </div>
    </div>
  );
}
