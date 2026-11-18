import { useId,useState } from 'react';
import { useNavigate,useParams } from 'react-router-dom';
import { Gem,FileText,CreditCard,MapPin,Ban,Info } from 'lucide-react';
import { PurchaseDialog } from '../purchases/PurchaseDialog';
import { OrderDetailsContent } from '../purchases/OrderDetailsContent';
import { CancelOrderDialog } from '../purchases/CancelOrderDialog';
import { OrderActionUnavailableDialog } from '../purchases/OrderActionUnavailableDialog';
import { useOrderData } from '../purchases/useOrderData';
import { canCancelOrder,canPayOrder,unavailableOrderAction,buildDirectionsUrl } from '../lib/purchaseStatus';
export default function OrderDetails({id:explicitId,onClose,onChanged}) {
  const params=useParams(),id=explicitId || params.id,navigate=useNavigate();
  const {data,loading,error,refresh}=useOrderData(id),[confirm,setConfirm]=useState(false);
  const [unavailableFor,setUnavailableFor]=useState(null);
  const paymentHint=useId(),cancelHint=useId();
  const close=onClose || (()=>navigate('/customer/purchases',{replace:true}));
  const cancelled=data?.order?.status==='cancelled';
  const flat=data?.order&&{...data.order,payment_status:data.payment?.status};
  const eligible=canCancelOrder(flat),payable=canPayOrder(flat);
  const candidate=flat?.status==='pending'&&!flat.is_expired&&!['paid','processing'].includes(flat.payment_status);
  const directions=data?.order&&buildDirectionsUrl({...data.order,branch_address:data.branch?.address,branch_lat:data.branch?.lat,branch_lng:data.branch?.lng});
  const openPayment=()=>{
    if(!payable){setUnavailableFor('payment');return;}
    navigate(`/customer/orders/${id}/payment`,{state:{purchaseModal:true,paymentBackground:'details'}});
  };
  const openCancellation=()=>{
    if(!eligible){setUnavailableFor('cancellation');return;}
    setConfirm(true);
  };
  const revalidate=async()=>{const latest=await refresh(true);if(latest)onChanged?.();return latest;};
  return <><PurchaseDialog title="Order Details" description="Track your order, payment status, and pickup information." onClose={close} className={cancelled?'od-cancelled':'od-active'}
    header={cancelled?<span className="od-header-icon"><FileText size={22}/></span>:<div className="od-brand"><Gem size={38}/><div><b>ATANY</b><span>JEWELRY AUCTION</span></div></div>}
    footer={!cancelled&&!loading&&!error&&data?.order&&<>
      <button className="od-button" onClick={()=>navigate(`/customer/orders/${id}/invoice`,{state:{purchaseModal:true}})}><CreditCard size={22}/>View Invoice</button>
      {directions&&<button className="od-button" onClick={()=>window.open(directions,'_blank','noopener,noreferrer')}><MapPin size={22}/>Get Directions</button>}
      {candidate&&<button className={`od-button ${payable?'od-pay-button':'od-info-button'}`} aria-haspopup="dialog" aria-describedby={payable?undefined:paymentHint} title={payable?undefined:'View why payment is unavailable'} onClick={openPayment}>{!payable&&<Info size={18} aria-hidden="true"/>}Pay Now</button>}
      {candidate&&<button className={`od-button ${eligible?'od-danger':'od-info-button'}`} aria-haspopup="dialog" aria-describedby={eligible?undefined:cancelHint} title={eligible?undefined:'View why cancellation is unavailable'} onClick={openCancellation}>{eligible?<Ban size={22}/>:<Info size={18} aria-hidden="true"/>}Cancel Order</button>}
    </>}>
    {loading?<p role="status">Loading order…</p>:error?<div className="od-error" role="alert"><p>{error}</p><button className="od-button" onClick={()=>refresh()}>Try again</button></div>:!data?.order?<p>Order not found.</p>:<><OrderDetailsContent data={data}/>{!cancelled&&(!payable||!eligible)&&<div className="od-action-notice" role="status">
      {!payable&&<div id={paymentHint}><strong>Payment unavailable</strong><p>{unavailableOrderAction(flat,'payment')}</p></div>}
      {!eligible&&<div id={cancelHint}><strong>Cancellation unavailable</strong><p>{unavailableOrderAction(flat,'cancellation')}</p></div>}
    </div>}</>}
  </PurchaseDialog>{confirm&&<CancelOrderDialog order={data?.order&&{...data.order,item:data.product?.name}} eligible={!!eligible&&!error&&!loading} onClose={()=>setConfirm(false)} onRevalidate={()=>refresh(true)} onSuccess={async()=>{await refresh(true);setConfirm(false);onChanged?.();}}/>}
    {unavailableFor&&data?.order&&<OrderActionUnavailableDialog action={unavailableFor} order={data.order} productName={data.product?.name}
      reason={unavailableOrderAction(flat,unavailableFor)} available={!loading&&!error&&(unavailableFor==='payment'?payable:eligible)}
      onClose={()=>setUnavailableFor(null)} onRefresh={revalidate}/>}
  </>;
}
