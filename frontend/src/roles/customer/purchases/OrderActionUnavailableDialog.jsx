import { useEffect,useRef,useState } from 'react';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { PurchaseDialog } from './PurchaseDialog';

// Information only: this component has no checkout/cancellation API dependency.
export function OrderActionUnavailableDialog({action,order,productName,reason,available,onClose,onRefresh}) {
  const label=action==='payment'?'Payment':'Cancellation';
  const [checking,setChecking]=useState(false),[error,setError]=useState('');
  const alive=useRef(true),lock=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const check=async()=>{
    if(lock.current)return;lock.current=true;setChecking(true);setError('');
    try {
      const latest=await onRefresh();
      if(!latest&&alive.current)setError('We could not refresh availability. Please try again or contact support.');
    } catch {
      if(alive.current)setError('We could not refresh availability. Please try again or contact support.');
    } finally {lock.current=false;if(alive.current)setChecking(false);}
  };
  return <PurchaseDialog title={`${label} ${available?'Availability':'Unavailable'}`}
    description={action==='payment'?'Pay Now can continue only after secure checkout eligibility is verified.':'Cancel Order can continue only after cancellation eligibility is verified.'}
    header={<span className="od-header-icon"><Info size={22}/></span>} className="od-confirm od-availability" onClose={onClose}
    footer={<><button className="od-button" onClick={onClose}>Back to Order Details</button><button className="od-button" disabled={checking} aria-busy={checking} onClick={check}>{checking?'Checking…':'Check Again'}</button></>}>
    <dl className="od-rows"><div><dt>Order number</dt><dd>{order.transaction_code || order.id}</dd></div><div><dt>Product</dt><dd>{productName || order.item || 'Jewelry purchase'}</dd></div></dl>
    <p role="status" className="od-action-notice">{available?`${label} is available to review. Close this message, then choose ${action==='payment'?'Pay Now':'Cancel Order'}.`:reason}</p>
    <p>{action==='payment'?'No checkout has been requested from this message.':'No cancellation has been requested from this message.'}</p>
    <Link className="od-button" to="/customer/messages">Contact Support</Link>
    {error&&<p role="alert" className="od-error">{error}</p>}
  </PurchaseDialog>;
}
