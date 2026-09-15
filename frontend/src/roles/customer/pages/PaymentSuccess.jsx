// frontend/src/roles/customer/pages/PaymentSuccess.jsx
// Verifying → Payment Confirmed, polling backend truth
import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../../../shared/lib/apiClient';

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }

export default function PaymentSuccess() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('verifying'); // verifying | paid | failed | pending
  const [err, setErr] = useState(null);
  const attempts = useRef(0);

  useEffect(() => {
    let timer;
    const poll = async () => {
      try {
        const d = await apiFetch(`/customer/orders/${id}`);
        setData(d);
        const payStatus = d?.payment?.status;
        if (payStatus === 'paid') { setStatus('paid'); return; }
        if (payStatus === 'failed' || payStatus === 'cancelled' || payStatus === 'expired') { setStatus('failed'); return; }
        // still pending/processing -> keep polling up to 10 attempts
        attempts.current += 1;
        if (attempts.current >= 10) { setStatus('pending'); return; }
        timer = setTimeout(poll, 3000);
      } catch (e) {
        setErr(e.message);
        attempts.current += 1;
        if (attempts.current < 10) timer = setTimeout(poll, 3000);
        else setStatus('pending');
      }
    };
    poll();
    return () => clearTimeout(timer);
  }, [id]);

  if (err && !data) return <div className="panel"><div className="empty-state"><p style={{color:'var(--danger)'}}>{err}</p><Link to={`/customer/orders/${id}`} className="btn btn-outline" style={{marginTop:12}}>Back to Order</Link></div></div>;
  if (status === 'verifying' && !data?.payment) {
    return <div className="panel"><div className="empty-state"><p>Verifying your payment…</p><p className="form-hint" style={{marginTop:6}}>Please wait while we confirm with PayMongo. This may take a few seconds.</p></div></div>;
  }

  const order = data?.order;
  const payment = data?.payment;
  const product = data?.product;

  if (status === 'paid' || payment?.status === 'paid') {
    return (
      <div className="order-details-page">
        <Link to="/customer/purchases" className="order-back">← Back to Orders</Link>
        <div style={{textAlign:'center', padding:'28px 0 8px'}}>
          <div style={{width:64,height:64, borderRadius:'50%', background:'#eaf3ed', display:'grid', placeItems:'center', margin:'0 auto 12px', color:'var(--success)', fontSize:28}}>✓</div>
          <h1 style={{fontSize:28, fontWeight:800, color:'var(--navy)'}}>Payment Confirmed!</h1>
          <p style={{color:'var(--muted)', marginTop:6}}>Your payment has been successfully processed.</p>
          <p className="form-hint" style={{marginTop:4}}>Your order is now being prepared for pickup.</p>
        </div>

        <div className="panel">
          <div style={{padding:'16px 22px', background:'#f0fdf4', borderBottom:'1px solid #dcfce7', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <div><div style={{fontWeight:700, color:'var(--navy)'}}>Order #{order?.transaction_code || order?.id?.slice(0,8)}</div><div className="form-hint">Placed on {order?.created_at ? new Date(order.created_at).toLocaleString() : '—'}</div></div>
          </div>
          <div style={{display:'flex', gap:16, padding:22, alignItems:'center'}}>
            <img src={product?.img || 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=200&q=70'} alt={product?.name} style={{width:120,height:120, borderRadius:12, objectFit:'cover', border:'1px solid var(--line)'}} />
            <div>
              <div style={{fontWeight:700, color:'var(--navy)'}}>{product?.name || order?.item}</div>
              <div style={{fontSize:12, color:'var(--muted)', marginTop:4}}>{[product?.karat_weight, product?.category].filter(Boolean).join(' · ')}</div>
              <div style={{fontWeight:800, color:'var(--navy)', marginTop:8}}>{peso(order?.amount)}</div>
              <div className="purchase-status-badge completed" style={{marginTop:8}}><span className="purchase-status-dot" />Payment Confirmed</div>
            </div>
            <div style={{marginLeft:'auto', textAlign:'right'}}>
              <div style={{fontSize:12, color:'var(--muted)'}}>Total Amount</div>
              <div style={{fontSize:22, fontWeight:800, color:'var(--navy)'}}>{peso(order?.amount)}</div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><div><h2>Payment & Pickup Process</h2></div></div>
          <div className="order-progress">
            <div className="order-step done"><div className="order-step-icon">✓</div><div className="order-step-label">Auction Won</div></div>
            <div className="order-step done"><div className="order-step-icon">✓</div><div className="order-step-label">Payment Confirmed</div></div>
            <div className="order-step active"><div className="order-step-icon">●</div><div className="order-step-label">Preparing Your Jewelry</div></div>
            <div className="order-step pending"><div className="order-step-icon">○</div><div className="order-step-label">Ready for Pickup</div></div>
            <div className="order-step pending"><div className="order-step-icon">○</div><div className="order-step-label">Picked Up</div></div>
          </div>
        </div>

        <div style={{display:'flex', gap:12, justifyContent:'center', marginTop:18}}>
          <Link to={`/customer/orders/${id}`} className="btn btn-outline">View Order Details</Link>
          <Link to="/customer/purchases" className="btn btn-primary">Back to My Purchases</Link>
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return <div className="panel"><div className="empty-state"><p style={{color:'var(--danger)', fontWeight:700}}>Payment Failed</p><p className="form-hint" style={{marginTop:6}}>Your payment was not completed. You have not been charged.</p><Link to={`/customer/orders/${id}/payment`} className="btn btn-primary" style={{marginTop:12}}>Try Again</Link></div></div>;
  }

  // still verifying / pending
  return (
    <div className="panel">
      <div className="empty-state">
        <p>Verifying your payment…</p>
        <p className="form-hint" style={{marginTop:6}}>Payment is being verified with PayMongo. If this takes longer than a minute, your payment may still be processing.</p>
        <p className="form-hint">Order #{order?.transaction_code || id}</p>
        <Link to={`/customer/orders/${id}`} className="btn btn-outline" style={{marginTop:12}}>View Order Status</Link>
      </div>
    </div>
  );
}
