// frontend/src/roles/admin/../customer/pages/OrderDetails.jsx
// Premium order details — ATANY branding, real data via GET /customer/orders/:id
//
// The page is a MONITORING + PAYMENT surface for the CURRENT eligible winner:
//   • the deadline always comes from the server (orders.payment_deadline, or
//     (winner_confirmed_at || created_at) + 7 days)
//   • when the window closes, the payment action disappears IMMEDIATELY — the
//     frontend never decides who the next bidder is (server-side only)
//   • a terminally expired order (no eligible bidders left) says so plainly
import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../shared/lib/apiClient';

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }
function fmtDate(d) { if (!d) return '—'; const dt = new Date(d); return isNaN(dt) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtDateTime(d) { if (!d) return '—'; const dt = new Date(d); return isNaN(dt) ? d : dt.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function hoursRemaining(deadline) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / (1000 * 60 * 60)) : 0;
}

/** Human "time remaining" from the authoritative deadline. */
export function timeLeftLabel(deadline, now = Date.now()) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ${hours} hour${hours === 1 ? '' : 's'}`;
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

const STATUS_LABEL = { pending: 'Payment Pending', preparing: 'Preparing', ready_pickup: 'Ready for Pickup', completed: 'Picked Up', expired: 'Payment Expired' };
const STATUS_CLS = { pending: 'pending', preparing: 'pending', ready_pickup: 'ready', completed: 'completed', expired: 'expired' };

function statusMeta(order, payment) {
  const payPaid = payment?.status === 'paid';
  const o = order?.status;
  if (o === 'expired') return { label: 'Payment Expired', cls: 'expired' };
  if (o === 'completed') return { label: 'Picked Up', cls: 'completed' };
  if (o === 'ready_pickup') return { label: 'Ready for Pickup', cls: 'ready' };
  if (o === 'preparing') return { label: 'Preparing', cls: 'pending' };
  if (payPaid) return { label: 'Payment Confirmed', cls: 'completed' };
  return { label: 'Payment Pending', cls: 'pending' };
}

const STEPS = ['Auction Won','Payment Pending','Payment Confirmed','Preparing Your Jewelry','Ready for Pickup','Picked Up'];

function stepState(idx, order, payment) {
  const payPaid = payment?.status === 'paid';
  const o = order?.status;
  const expired = !!order.is_expired;
  // map: 0 Auction Won always done
  if (idx === 0) return 'done';
  if (idx === 1) {
    if (payPaid || ['preparing','ready_pickup','completed'].includes(o)) return 'done';
    if (expired) return 'expired';
    return 'active';
  }
  if (idx === 2) {
    if (payPaid || ['preparing','ready_pickup','completed'].includes(o)) return o === 'pending' && payPaid ? 'active' : (['preparing','ready_pickup','completed'].includes(o) ? 'done' : 'active');
  }
  if (idx === 3) {
    if (o === 'preparing' || o === 'ready_pickup' || o === 'completed') return o === 'preparing' ? 'active' : 'done';
    if (payPaid && o === 'pending') return 'pending';
    return 'pending';
  }
  if (idx === 4) {
    if (o === 'ready_pickup') return 'active';
    if (o === 'completed') return 'done';
    return 'pending';
  }
  if (idx === 5) {
    if (o === 'completed') return 'done';
    return 'pending';
  }
  return 'pending';
}

export default function OrderDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  // A ticking clock so the deadline countdown stays honest (the deadline
  // itself always comes from the server).
  const [now, setNow] = useState(() => Date.now());

  const load = () => {
    setLoading(true);
    apiFetch(`/customer/orders/${id}`).then(d => { setData(d); setErr(null); }).catch(e => setErr(e.message)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  if (loading) return <div className="panel"><div className="empty-state"><p>Loading order…</p></div></div>;
  if (err) return <div className="panel"><div className="empty-state"><p style={{color:'var(--danger)'}}>{err}</p><Link to="/customer/purchases" className="btn btn-outline" style={{marginTop:12}}>Back to My Purchases</Link></div></div>;
  if (!data?.order) return <div className="panel"><div className="empty-state"><p>Order not found</p></div></div>;

  const { order, payment, product, branch } = data;
  const meta = statusMeta(order, payment);
  const payPaid = payment?.status === 'paid';
  const isExpired = !!order.is_expired;
  // A terminally expired order (the cron found no eligible bidder left).
  const isTerminallyExpired = String(order.status || '').toLowerCase() === 'expired';
  const deadline = order.payment_deadline || null;
  const deadlinePassed = !!deadline && new Date(deadline).getTime() <= now;
  const timeLeft = timeLeftLabel(deadline, now);
  // The payment action disappears the moment the window closes — even before
  // the server has rotated the order. The frontend never picks a winner.
  const isPayable = order.status === 'pending' && !payPaid && !isExpired && !deadlinePassed;
  const hrsLeft = hoursRemaining(order.payment_deadline);
  const isUrgent = hrsLeft !== null && hrsLeft <= 24 && hrsLeft > 0;
  const supportHref = `/customer/messages?${new URLSearchParams({
    order: order.transaction_code || order.id,
    item: product?.name || order.item || '',
    topic: 'expired-payment',
  }).toString()}`;

  return (
    <div className="order-details-page">
      <Link to="/customer/purchases" className="order-back">← Back to My Purchases</Link>
      <div className="order-header">
        <div>
          <h1>Order Details</h1>
          <p>Track your order, payment status, and pickup information.</p>
        </div>
        <span className={`purchase-status-badge ${STATUS_CLS[order.status] || 'pending'}`} style={{height:'fit-content'}}><span className="purchase-status-dot" />{STATUS_LABEL[order.status] || meta.label}</span>
      </div>

      {/* Main order card */}
      <div className="order-main-card">
        <div className="order-main-left">
          <img src={product?.img || 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=400&q=70'} alt={product?.name || order.item} className="order-main-img" />
        </div>
        <div className="order-main-mid">
          <div className="order-main-title">{product?.name || order.item}</div>
          <div className="order-main-meta">{[product?.karat_weight, product?.category].filter(Boolean).join(' · ') || order.item}</div>
          {product?.desc && <p className="order-main-desc">{product.desc}</p>}
          <div className="order-main-price">{peso(order.amount)}</div>
        </div>
        <div className="order-main-right">
          <div className="order-summary-card">
            <div className="order-summary-title">Payment Summary</div>
            <div className="order-summary-row"><span>Winning Bid</span><span>{peso(order.amount)}</span></div>
            <div className="order-summary-row total"><span>Total Amount</span><span>{peso(order.amount)}</span></div>

            <div className="order-payment-status">
              <span className={`purchase-status-badge ${payPaid ? 'completed' : (isExpired || isTerminallyExpired || deadlinePassed) ? 'expired' : 'pending'}`}>
                <span className="purchase-status-dot" />
                {payPaid ? 'Payment Confirmed'
                  : isTerminallyExpired ? 'Payment Expired'
                    : (isExpired || deadlinePassed) ? 'Expired'
                      : 'Payment Pending'}
              </span>
              <p className="form-hint">
                {payPaid ? 'Your payment has been confirmed.'
                  : isTerminallyExpired ? 'Your payment period for this item has ended.'
                    : (isExpired || deadlinePassed) ? 'This payment period has expired.'
                      : 'Please complete your payment to confirm your order.'}
              </p>
            </div>

            {isPayable ? (
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={() => navigate(`/customer/orders/${order.id}/payment`)}>Pay Now →</button>
            ) : payPaid ? (
              <div className="order-paid-note">✓ Payment Confirmed — {fmtDate(payment?.paid_at || payment?.updated_at)}</div>
            ) : isTerminallyExpired ? (
              <div className="order-expired-note">
                <div>Payment no longer available — this auction has no remaining eligible bidders.</div>
                <Link to={supportHref} className="btn btn-outline" style={{ width: '100%', marginTop: 10, justifyContent: 'center' }}>
                  Contact ATANY Support
                </Link>
              </div>
            ) : (isExpired || deadlinePassed) ? (
              <div className="order-expired-note">
                <div>Payment no longer available — eligibility has expired. The item may have been offered to the next eligible bidder.</div>
                <Link to={supportHref} className="btn btn-outline" style={{ width: '100%', marginTop: 10, justifyContent: 'center' }}>
                  Contact ATANY Support
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Congratulations — You Won (the current eligible winner) */}
      {order.status === 'pending' && !payPaid && !isTerminallyExpired && (
        <div className="order-winner-card">
          <div className="order-winner-card-title">Congratulations — You Won</div>
          <div className="order-winner-card-grid">
            <div>
              <span>Winning amount</span>
              <b>{peso(order.amount)}</b>
            </div>
            <div>
              <span>Payment deadline</span>
              <b>{fmtDateTime(deadline)}</b>
            </div>
            <div>
              <span>Time remaining</span>
              <b>{timeLeft || 'Expired'}</b>
            </div>
          </div>
        </div>
      )}

      {/* Payment Deadline — separate full-width card */}
      {deadline && order.status === 'pending' && !payPaid && !isTerminallyExpired && (
        <div className={`order-deadline-card ${isExpired || deadlinePassed ? 'expired' : isUrgent ? 'urgent' : 'active'}`}>
          <div className="order-deadline-card-icon" aria-hidden="true">
            {(isExpired || deadlinePassed) ? '✕' : '⚠'}
          </div>
          <div className="order-deadline-card-body">
            <div className="order-deadline-card-label">
              {(isExpired || deadlinePassed) ? 'PAYMENT ELIGIBILITY EXPIRED' : isUrgent ? 'PAYMENT DUE SOON' : 'PAYMENT DEADLINE'}
            </div>
            <div className="order-deadline-card-date">{fmtDateTime(deadline)}</div>
            {(isExpired || deadlinePassed) ? (
              <p className="order-deadline-card-desc">
                Your 7-day payment period has ended. The item may have been offered to the next eligible bidder.
                If you believe there is an issue or have questions about this auction, please contact ATANY Support.
              </p>
            ) : isUrgent ? (
              <p className="order-deadline-card-desc">
                Complete payment before the deadline to keep your winning eligibility.
              </p>
            ) : (
              <p className="order-deadline-card-desc">
                Complete payment within your 7-day payment period. If payment is not completed by the deadline, your payment eligibility will expire and the item may be offered to the next eligible bidder.
              </p>
            )}
            {(isExpired || deadlinePassed) && (
              <Link to={supportHref} className="btn btn-outline" style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                Contact ATANY Support
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Terminal: no eligible bidders remain */}
      {isTerminallyExpired && (
        <div className="order-deadline-card expired">
          <div className="order-deadline-card-icon" aria-hidden="true">✕</div>
          <div className="order-deadline-card-body">
            <div className="order-deadline-card-label">PAYMENT PERIOD ENDED</div>
            <div className="order-deadline-card-date">{fmtDateTime(deadline)}</div>
            <p className="order-deadline-card-desc">
              There are no remaining eligible bidders for this auction. If you have questions about this order, please contact ATANY Support.
            </p>
            <Link to={supportHref} className="btn btn-outline" style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Contact ATANY Support
            </Link>
          </div>
        </div>
      )}

      {/* Payment & Pickup Process */}
      <div className="panel">
        <div className="panel-head"><div><h2>Payment & Pickup Process</h2><p>Here&apos;s the current status of your order.</p></div></div>
        <div className="order-progress">
          {STEPS.map((label, i) => {
            const state = stepState(i, order, payment);
            return (
              <div key={label} className={`order-step ${state}`}>
                <div className="order-step-icon">{state === 'done' ? '✓' : state === 'active' ? '●' : state === 'expired' ? '✕' : '○'}</div>
                <div className="order-step-label">{label}</div>
                <div className="order-step-sub">{state === 'done' ? 'Completed' : state === 'active' ? 'Current' : state === 'expired' ? 'Expired' : 'Pending'}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="order-two-col">
        <div className="order-col">
          <div className="panel">
            <div className="panel-head"><div><h2>Order Information</h2></div></div>
            <div className="order-info-grid">
              <div className="order-info-row"><span>Order Number</span><b>{order.transaction_code || order.id.slice(0,8)}</b></div>
              <div className="order-info-row"><span>Auction Title</span><b>{product?.name || order.item}</b></div>
              <div className="order-info-row"><span>Winning Bid</span><b>{peso(order.amount)}</b></div>
              <div className="order-info-row"><span>Total Amount</span><b>{peso(order.amount)}</b></div>
              <div className="order-info-row"><span>Auction Ended</span><span>{fmtDateTime(order.auction_end || order.date)}</span></div>
              <div className="order-info-row"><span>Payment Status</span><span className={`purchase-status-badge ${payment?.status === 'paid' ? 'completed' : 'pending'}`} style={{padding:'2px 8px', fontSize:11}}>{payment?.status || 'pending'}</span></div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><div><h2>Jewelry Details</h2></div></div>
            <div className="order-info-grid">
              {product?.category && <div className="order-info-row"><span>Category</span><span>{product.category}</span></div>}
              {product?.karat_weight && <div className="order-info-row"><span>Metal</span><span>{product.karat_weight}</span></div>}
              {product?.desc && <div className="order-info-row"><span>Description</span><span>{product.desc}</span></div>}
              <div className="order-info-row"><span>Condition</span><span>Excellent</span></div>
              <div className="order-info-row"><span>Certificate</span><span>Available</span></div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><div><h2>Need Help?</h2><p>Our support team is here for you.</p></div></div>
            <div style={{padding:'16px 22px'}}><Link to="/customer/messages" className="btn btn-outline" style={{width:'100%', justifyContent:'center'}}>Contact Support</Link></div>
          </div>
        </div>

        <div className="order-col">
          <div className="panel">
            <div className="panel-head"><div><h2>Pickup Information</h2></div></div>
            <div style={{padding:'16px 22px'}}>
              <div className="order-info-row"><span>Selected Branch</span><b>{branch?.name || order.branch || '—'}</b></div>
              {branch?.address && <div className="form-hint" style={{marginTop:6}}>{branch.address}</div>}
              <div className="pickup-note" style={{marginTop:14}}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:16,height:16}}><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg> Pickup only. No delivery available. Please bring your Order ID when picking up your item.</div>
              <div className="order-info-row" style={{marginTop:12}}><span>Pickup Status</span><span>{STATUS_LABEL[order.status] || order.status}</span></div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><div><h2>Order Timeline</h2></div></div>
            <div className="order-timeline">
              <div className="order-tl-item done"><span className="order-tl-dot" /> <div><b>Auction Won</b><span>{fmtDateTime(order.auction_end || order.created_at)}</span></div></div>
              <div className={`order-tl-item ${payment?.status === 'paid' ? 'done' : 'pending'}`}><span className="order-tl-dot" /> <div><b>Payment {payment?.status === 'paid' ? 'Confirmed' : 'Pending'}</b><span>{payment?.paid_at ? fmtDateTime(payment.paid_at) : 'Pending'}</span></div></div>
              <div className={`order-tl-item ${['preparing','ready_pickup','completed'].includes(order.status) ? 'done' : order.status==='preparing' ? 'active' : 'pending'}`}><span className="order-tl-dot" /> <div><b>Preparing Your Jewelry</b><span>{order.status==='preparing' ? 'In progress' : ['ready_pickup','completed'].includes(order.status) ? 'Completed' : 'After payment confirmation'}</span></div></div>
              <div className={`order-tl-item ${order.status==='ready_pickup' ? 'active' : order.status==='completed' ? 'done' : 'pending'}`}><span className="order-tl-dot" /> <div><b>Ready for Pickup</b><span>{order.status==='ready_pickup' ? 'Notify on ready' : order.status==='completed' ? 'Completed' : "We'll notify you once it's ready"}</span></div></div>
              <div className={`order-tl-item ${order.status==='completed' ? 'done' : 'pending'}`}><span className="order-tl-dot" /> <div><b>Picked Up</b><span>{order.status==='completed' ? fmtDateTime(order.updated_at) : 'Pending'}</span></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
