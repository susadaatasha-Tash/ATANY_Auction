import { useRef,useState } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { PurchaseDialog } from './PurchaseDialog';
import { canCancelOrder } from '../lib/purchaseStatus';
const reasons=['Ordered by mistake','No longer interested in the item','Unable to complete payment','Other — Write my own reason'];
export function CancelOrderDialog({order,onClose,onSuccess,onRevalidate,eligible=canCancelOrder(order)}) {
  const [selected,setSelected]=useState(''),[custom,setCustom]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const lock=useRef(false);
  if(!order)return null;
  const reason=selected===reasons[3]?custom.trim():selected;
  const submit=async()=>{
    if(!reason || lock.current || !eligible)return;lock.current=true;setBusy(true);setError('');
    try {await apiFetch(`/customer/orders/${order.id}/cancel`,{method:'PATCH',body:JSON.stringify({reason})});await onSuccess?.();}
    catch(e){setError(e.message || 'Unable to cancel this order.');await onRevalidate?.();}
    finally{lock.current=false;setBusy(false);}
  };
  return <PurchaseDialog title="Cancel Order?" description="Are you sure you want to cancel this order?" onClose={onClose} busy={busy} className="od-confirm" footer={<><button className="od-button" disabled={busy} onClick={onClose}>Keep Order</button><button className="od-button od-danger" disabled={busy || !reason || !eligible} onClick={submit}>{busy?'Verifying cancellation…':'Confirm Cancellation'}</button></>}>
    <dl className="od-rows"><div><dt>Order number</dt><dd>{order.transaction_code || order.id}</dd></div><div><dt>Product</dt><dd>{order.item || order.product_name || 'Jewelry purchase'}</dd></div></dl>
    <p>We will verify payment and close active checkouts before cancelling.</p>
    <fieldset className="od-reasons" disabled={busy}><legend>Reason for Cancellation</legend>{reasons.map(r=><label key={r}><input type="radio" name="cancelReason" checked={selected===r} onChange={()=>setSelected(r)}/>{r}</label>)}{selected===reasons[3]&&<label>Your reason<textarea aria-label="Your reason" value={custom} onChange={e=>setCustom(e.target.value)} maxLength={2000} rows={3}/></label>}</fieldset>
    {error&&<p className="od-error" role="alert">{error}</p>}
  </PurchaseDialog>;
}
