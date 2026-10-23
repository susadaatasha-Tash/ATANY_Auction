// frontend/src/roles/customer/pages/CompletePayment.jsx
// Dedicated full-page payment — PayMongo hosted checkout, ATANY branding
import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }
function fmtDate(d) { if (!d) return '—'; const dt = new Date(d); return isNaN(dt) ? d : dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); }
function fmtDateTime(d) { if (!d) return '—'; const dt = new Date(d); return isNaN(dt) ? d : dt.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function hoursRemaining(deadline) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / (1000 * 60 * 60)) : 0;
}

const METHODS = [
  { id: 'gcash', label: 'GCash', desc: 'Pay instantly and securely via GCash.', icon: 'GCash' },
  { id: 'maya', label: 'Maya', desc: 'Pay using your Maya account.', icon: 'Maya' },
  { id: 'card', label: 'Credit / Debit Card', desc: 'Visa, Mastercard, JCB, etc.', icon: '◧' },
];

export default function CompletePayment() {
  const { id } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [method, setMethod] = useState('gcash');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/customer/orders/${id}`).then(d => { setData(d); setErr(null); }).catch(e => setErr(e.message)).finally(() => setLoading(false));
  }, [id]);

  const handleConfirm = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await apiFetch(`/customer/orders/${id}/payment`, { method: 'POST', body: JSON.stringify({ payment_method: method }) });
      const checkoutUrl = res?.checkout_url;
      if (typeof checkoutUrl === 'string' && checkoutUrl.startsWith('https://')) {
        window.location.href = checkoutUrl;
      } else {
        showToast('Payment could not be started. Please try again.');
        setCreating(false);
      }
    } catch (e) {
      const msg = e.message || 'Payment could not be started. Please try again.';
      showToast(msg);
      // Refresh order state to reflect any backend changes (e.g., expired, reassigned)
      try {
        const refreshed = await apiFetch(`/customer/orders/${id}`);
        setData(refreshed);
      } catch {}
      setCreating(false);
    }
  };

  if (loading) return <div className="panel"><div className="empty-state"><p>Loading order…</p></div></div>;
  if (err) return <div className="panel"><div className="empty-state"><p style={{color:'var(--danger)'}}>{err}</p><Link to={`/customer/orders/${id}`} className="btn btn-outline" style={{marginTop:12}}>Back to Order Details</Link></div></div>;
  const { order, payment, product, branch } = data;
  if (payment?.status === 'paid') {
    return <div className="panel"><div className="empty-state"><p>This order is already paid.</p><Link to={`/customer/orders/${id}`} className="btn btn-primary" style={{marginTop:12}}>View Order</Link></div></div>;
  }
  const isExpired = !!order.is_expired
    || String(order.status || '').toLowerCase() === 'expired'
    || (!!order.payment_deadline && new Date(order.payment_deadline).getTime() <= Date.now());
  if (isExpired) {
    return (
      <div className="order-details-page">
        <Link to={`/customer/orders/${id}`} className="order-back">← Back to Order Details</Link>
        <div className="panel">
          <div className="empty-state" style={{ padding: '36px 22px' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fef3c7', display: 'grid', placeItems: 'center', margin: '0 auto 14px', fontSize: 26 }}>⚠</div>
            <p style={{ fontSize: 18, fontWeight: 800, color: 'var(--navy)', marginBottom: 6 }}>Payment Eligibility Expired</p>
            <p className="form-hint" style={{ maxWidth: 360, lineHeight: 1.6 }}>Your 7-day payment period has ended. The item may have been offered to the next eligible bidder.</p>
            <p className="form-hint" style={{ maxWidth: 360, lineHeight: 1.6, marginTop: 8 }}>If you believe there is an issue or have questions about this auction, please contact ATANY Support.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
              <Link to={`/customer/orders/${id}`} className="btn btn-outline">View Order Details</Link>
              <Link to={`/customer/messages?${new URLSearchParams({ order: order.transaction_code || order.id, item: product?.name || order.item || '', topic: 'expired-payment' }).toString()}`} className="btn btn-primary">Contact ATANY Support</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="order-details-page">
      <Link to={`/customer/orders/${id}`} className="order-back">← Back to Order Details</Link>
      <div className="order-header">
        <div>
          <h1>Complete Payment</h1>
          <p>Please complete your payment to confirm your order and secure your jewelry.</p>
        </div>
      </div>

      <div className="complete-two-col">
        <div className="complete-main">
          {/* Product Summary */}
          <div className="panel">
            <div style={{display:'flex', gap:16, padding:22, alignItems:'center'}}>
              <img src={product?.img || 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=200&q=70'} alt={product?.name} style={{width:110,height:110, borderRadius:12, objectFit:'cover', border:'1px solid var(--line)'}} />
              <div>
                <div style={{fontSize:11, fontWeight:700, color:'var(--gold)', letterSpacing:'.06em', textTransform:'uppercase'}}>Auction Won</div>
                <div style={{fontSize:18, fontWeight:700, color:'var(--navy)', marginTop:4}}>{product?.name || order.item}</div>
                <div style={{fontSize:12, color:'var(--muted)', marginTop:4}}>{[product?.karat_weight, product?.category].filter(Boolean).join(' · ')}</div>
                <div style={{fontSize:12, color:'var(--muted)', marginTop:6}}>Order #{order.transaction_code || order.id.slice(0,8)} · Auction Ended {fmtDate(order.auction_end || order.date)}</div>
              </div>
            </div>
          </div>

          {/* Payment Summary */}
          <div className="panel">
            <div className="panel-head"><div><h2>Payment Summary</h2></div></div>
            <div style={{padding:'16px 22px'}}>
              <div className="order-summary-row"><span>Winning Bid</span><span>{peso(order.amount)}</span></div>
              <div className="order-summary-row total"><span>Total Amount</span><span style={{fontSize:22, fontWeight:800, color:'var(--navy)'}}>{peso(order.amount)}</span></div>
              <div style={{marginTop:14, display:'flex', gap:12, alignItems:'center'}}>
                <span className="purchase-status-badge pending"><span className="purchase-status-dot" />Payment Pending</span>
                <span className="form-hint">Please complete your payment to confirm your order.</span>
              </div>
              {order.payment_deadline && (
                <div className="order-deadline-block active" style={{ marginTop: 14 }}>
                  <div className="order-deadline-label">PAYMENT DEADLINE</div>
                  <div className="order-deadline-date">{fmtDateTime(order.payment_deadline)}</div>
                  <div className="order-deadline-desc">
                    Complete your payment within 7 days to keep your winning eligibility. If payment is not completed by the deadline, your payment eligibility will expire and the item may be offered to the next eligible bidder.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Choose Payment Method */}
          <div className="panel">
            <div className="panel-head"><div><h2>Choose Payment Method</h2></div></div>
            <div style={{padding:'16px 22px', display:'flex', flexDirection:'column', gap:10}}>
              {METHODS.map(m => (
                <label key={m.id} className={`pay-method ${method === m.id ? 'selected' : ''}`} onClick={() => setMethod(m.id)} style={{cursor:'pointer'}}>
                  <div style={{width:46,height:32, borderRadius:6, background: m.id==='gcash' ? '#0072ce' : m.id==='maya' ? '#00a651' : '#fff', border:'1px solid var(--line)', display:'grid', placeItems:'center', color: m.id==='card' ? 'var(--navy)' : '#fff', fontWeight:800, fontSize:11}}>{m.icon}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700, color:'var(--navy)', fontSize:13}}>{m.label}</div>
                    <div style={{fontSize:11, color:'var(--muted)'}}>{m.desc}</div>
                  </div>
                  <input type="radio" checked={method===m.id} readOnly />
                </label>
              ))}

              <div className="pickup-note" style={{marginTop:8}}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:16,height:16}}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                You will be redirected to PayMongo&apos;s secure checkout to complete your payment. Your payment information is encrypted.
              </div>

              <button className="btn btn-primary" style={{width:'100%', height:46, justifyContent:'center', fontSize:14}} onClick={handleConfirm} disabled={creating}>
                {creating ? 'Creating secure payment…' : `Confirm Payment →  Pay ${peso(order.amount)}`}
              </button>
              <div className="form-hint" style={{textAlign:'center'}}>Secure by PayMongo • {order.transaction_code}</div>
            </div>
          </div>
        </div>

        <div className="complete-side">
          <div className="panel">
            <div className="panel-head"><div><h2>Order Timeline</h2></div></div>
            <div className="order-timeline">
              <div className="order-tl-item done"><span className="order-tl-dot" /><div><b>Auction Won</b><span>{fmtDate(order.auction_end || order.created_at)}</span></div></div>
              <div className="order-tl-item active"><span className="order-tl-dot" /><div><b>Payment Pending</b><span>Please complete your payment</span></div></div>
              <div className="order-tl-item pending"><span className="order-tl-dot" /><div><b>Payment Confirmed</b><span>After verification</span></div></div>
              <div className="order-tl-item pending"><span className="order-tl-dot" /><div><b>Preparing Your Jewelry</b><span>We&apos;ll notify you once it&apos;s ready</span></div></div>
              <div className="order-tl-item pending"><span className="order-tl-dot" /><div><b>Ready for Pickup</b><span>Bring order ID to branch</span></div></div>
              <div className="order-tl-item pending"><span className="order-tl-dot" /><div><b>Picked Up</b><span>Enjoy your new piece!</span></div></div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><div><h2>Pickup Information</h2></div></div>
            <div style={{padding:'16px 22px'}}>
              <div style={{fontSize:11, fontWeight:800, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--muted)'}}>Selected Branch</div>
              <div style={{fontWeight:700, color:'var(--navy)', marginTop:4}}>{branch?.name || order.branch}</div>
              <div className="form-hint" style={{marginTop:4}}>{branch?.address || ''}</div>
              <div className="pickup-note" style={{marginTop:12}}>Pickup only. No delivery available. Please bring your Order ID when picking up your item.</div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><div><h2>Need Help?</h2><p>Our support team is here for you.</p></div></div>
            <div style={{padding:'16px 22px'}}><Link to="/customer/messages" className="btn btn-outline" style={{width:'100%', justifyContent:'center'}}>Contact Support</Link></div>
          </div>
        </div>
      </div>
    </div>
  );
}
