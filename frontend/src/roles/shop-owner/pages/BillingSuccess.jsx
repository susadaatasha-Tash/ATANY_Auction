// frontend/src/roles/shop-owner/pages/BillingSuccess.jsx
// Verifies maintenance payment via polling GET /billing/me/:id
import { useEffect, useState, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { apiFetch } from '../../../shared/lib/apiClient';

export default function BillingSuccess() {
  const [params] = useSearchParams();
  const billingId = params.get('billing_id');
  const [billing, setBilling] = useState(null);
  const [status, setStatus] = useState('verifying');
  const [err, setErr] = useState(null);
  const attempts = useRef(0);

  useEffect(() => {
    if (!billingId) { setErr('Missing billing ID'); setStatus('failed'); return; }
    let timer;
    const poll = async () => {
      try {
        const data = await apiFetch(`/billing/me/${billingId}`);
        setBilling(data);
        if (data.status === 'paid') { setStatus('paid'); return; }
        if (data.status === 'failed' || data.status === 'expired' || data.status === 'cancelled') { setStatus('failed'); return; }
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
  }, [billingId]);

  if (!billingId) return <div className="panel"><div className="empty-state"><p>Missing billing ID</p><Link to="/shop/billing" className="btn btn-outline" style={{marginTop:12}}>Back to Billing</Link></div></div>;
  if (err && !billing) return <div className="panel"><div className="empty-state"><p style={{color:'var(--danger)'}}>{err}</p><Link to="/shop/billing" className="btn btn-outline" style={{marginTop:12}}>Back to Billing</Link></div></div>;
  if (status === 'verifying' && !billing?.status) return <div className="panel"><div className="empty-state"><p>Verifying your payment…</p><p className="form-hint" style={{marginTop:6}}>Please wait while we confirm with PayMongo.</p></div></div>;

  if (status === 'paid' || billing?.status === 'paid') {
    return (
      <div className="panel">
        <div className="empty-state">
          <div style={{width:64,height:64,borderRadius:'50%',background:'#d1fae5',display:'grid',placeItems:'center',margin:'0 auto 12px',color:'#065f46',fontSize:28}}>✓</div>
          <h3 style={{color:'var(--navy)',fontWeight:800}}>Payment Successful!</h3>
          <p style={{marginTop:6}}>Your maintenance payment for <b>{billing?.billing_period}</b> of <b>₱{Number(billing?.amount||0).toLocaleString()}</b> has been received.</p>
          <p className="form-hint" style={{marginTop:4}}>Reference: {billing?.payment_reference || billing?.paymongo_checkout_session_id || '—'}</p>
          <Link to="/shop/billing" className="btn btn-primary" style={{marginTop:16}}>Back to Subscription</Link>
        </div>
      </div>
    );
  }
  if (status === 'failed') {
    return <div className="panel"><div className="empty-state"><p style={{color:'var(--danger)',fontWeight:700}}>Payment Failed</p><p className="form-hint" style={{marginTop:6}}>Your payment was not completed.</p><Link to="/shop/billing" className="btn btn-primary" style={{marginTop:12}}>Back to Subscription</Link></div></div>;
  }
  return (
    <div className="panel"><div className="empty-state">
      <p>Payment is being verified…</p>
      <p className="form-hint" style={{marginTop:6}}>If this takes longer than a minute, please check back in Billing.</p>
      <Link to="/shop/billing" className="btn btn-outline" style={{marginTop:12}}>Back to Subscription</Link>
    </div></div>
  );
}
