import { useEffect,useRef,useState } from 'react';
import { useNavigate,useParams } from 'react-router-dom';
import { Gem,LockKeyhole } from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { PurchaseDialog } from './PurchaseDialog';
import { useOrderData } from './useOrderData';
import { money,dateTime } from './orderPresentation';
import { canPayOrder,unavailableOrderAction } from '../lib/purchaseStatus';

function hostedCheckout(raw) {
  let url;try{url=new URL(raw);}catch{throw new Error('A secure checkout URL was not returned. Please try again or contact support.');}
  if(url.protocol!=='https:' || url.hostname!=='checkout.paymongo.com' || url.port || url.username || url.password)
    throw new Error('A valid secure checkout URL was not returned. Please contact support.');
  return url.href;
}

export default function PaymentDialog({id:explicitId,onClose,onChanged}) {
  const params=useParams(),id=explicitId || params.id,navigate=useNavigate();
  const {data,loading,error,refresh}=useOrderData(id);
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState('');
  const [imageFailed,setImageFailed]=useState(false);
  const lock=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>setImageFailed(false),[data?.product?.img]);
  useEffect(()=>{if(data)onChanged?.();},[data,onChanged]);
  useEffect(()=>{
    const restore=e=>{if(e.persisted){lock.current=false;setBusy(false);refresh(true);}};
    window.addEventListener('pageshow',restore);return()=>window.removeEventListener('pageshow',restore);
  },[refresh]);
  const close=onClose || (()=>navigate('/customer/purchases',{replace:true}));
  const order=data?.order,flat=order&&{...order,payment_status:data.payment?.status};
  const eligible=!loading&&!error&&canPayOrder(flat);
  const submit=async()=>{
    if(lock.current || !canPayOrder(flat) || loading || error)return;
    lock.current=true;setBusy(true);setActionError('');
    let navigating=false;
    try {
      // No browser amount, provider status or payment method is authoritative.
      const result=await apiFetch(`/customer/orders/${id}/payment`,{method:'POST',body:JSON.stringify({})});
      const url=hostedCheckout(result?.checkout_url);
      if(alive.current){navigating=true;window.location.assign(url);}
    } catch(e) {
      navigating=false;
      if(alive.current){setActionError(e.message || 'Unable to start secure payment. Please try again.');await refresh(true);}
    } finally {if(alive.current&&!navigating){lock.current=false;setBusy(false);}}
  };
  return <PurchaseDialog title="Complete Your Payment" description="Review your order before continuing to secure checkout." onClose={close} busy={busy} className="od-payment od-confirm"
    header={<div className="od-brand"><Gem size={32}/><div><b>ATANY</b><span>JEWELRY AUCTION</span></div></div>}
    footer={<><button className="od-button" disabled={busy} onClick={close}>Not Now</button><button className="od-button od-pay-button" disabled={!eligible||busy} onClick={submit}><LockKeyhole size={19}/>{busy?'Creating secure checkout…':'Continue to Secure Payment'}</button></>}>
    {loading?<p role="status">Loading order…</p>:error?<div role="alert" className="od-error"><p>{error}</p><button className="od-button" onClick={()=>refresh()}>Try again</button></div>:!order?<p>No order found.</p>:<>
      <div className="od-pay-product"><div className="od-pay-image">{data.product?.img&&!imageFailed?<img src={data.product.img} alt={data.product.name || 'Jewelry purchase'} onError={()=>setImageFailed(true)}/>:<Gem size={34} role="img" aria-label="Jewelry image unavailable"/>}</div><div><h2>{data.product?.name || order.product_name || 'Jewelry purchase'}</h2><small>Order number</small><p>{order.transaction_code || order.id}</p></div></div>
      <dl className="od-rows od-pay-summary"><div><dt>Winning bid</dt><dd>{money(order.amount)}</dd></div><div className="od-pay-total"><dt>Total amount</dt><dd>{money(order.amount)}</dd></div><div><dt>Payment deadline</dt><dd>{dateTime(order.payment_deadline)}</dd></div><div><dt>Current payment status</dt><dd>{data.payment?.status || 'No payment recorded'}</dd></div><div><dt>Pickup branch</dt><dd>{data.branch?.name || 'Not recorded'}</dd></div></dl>
      {!eligible&&<p role="status" className="od-action-notice">{unavailableOrderAction(flat,'payment')}</p>}
      <p>Payment methods are provided on PayMongo’s secure checkout. Continuing does not confirm payment.</p>
    </>}
    {actionError&&<p role="alert" className="od-error">{actionError}</p>}
  </PurchaseDialog>;
}
