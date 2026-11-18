import { useEffect,useRef } from 'react';
import { useNavigate,useParams } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { PurchaseDialog } from './PurchaseDialog';
import { useOrderData } from './useOrderData';
import { canPayOrder } from '../lib/purchaseStatus';

export default function PaymentReturnDialog({id:explicitId,onClose,onChanged}) {
  const params=useParams(),id=explicitId || params.id,navigate=useNavigate();
  const {data,loading,error,refresh}=useOrderData(id),attempts=useRef(0);
  const order=data?.order,payment=data?.payment;
  useEffect(()=>{if(data)onChanged?.();},[data,onChanged]);
  useEffect(()=>{
    if(!data || ['cancelled','expired','completed'].includes(order?.status)
      || ['paid','failed','expired','cancelled'].includes(payment?.status) || attempts.current>=10)return;
    const timer=setTimeout(()=>{attempts.current++;refresh(true);},3000);
    return()=>clearTimeout(timer);
  },[data,order?.status,payment?.status,refresh]);
  // Query parameters and the provider's return route are never payment evidence.
  const title=order?.status==='cancelled'?'Order Cancelled':order?.status==='expired'||order?.is_expired?'Payment Expired':payment?.status==='paid'?'Payment Confirmed':payment?.status==='failed'?'Payment Failed':payment?.status==='expired'?'Payment Expired':payment?.status==='cancelled'?'Payment Cancelled':payment?.status==='processing'?'Payment Processing':'Payment Pending';
  const close=onClose || (()=>navigate('/customer/purchases',{replace:true}));
  const eligible=canPayOrder(order&&{...order,payment_status:payment?.status});
  return <PurchaseDialog title="Payment Status" description="Payment status verified by ATANY." onClose={close} className="od-payment-return" header={<span className="od-header-icon"><FileText size={22}/></span>}
    footer={<><button className="od-button" onClick={close}>Back to My Purchases</button>{order&&<button className="od-button" onClick={()=>navigate(`/customer/orders/${id}`,{replace:true})}>View Order Details</button>}</>}>
    {loading?<p role="status">Verifying payment…</p>:error?<p className="od-error" role="alert">{error}</p>:!order?<p>No order found.</p>:<>
      <h2>{title}</h2><p>{data.product?.name} · {order.transaction_code || order.id}</p>
      <p>{title==='Payment Confirmed'?'Your payment has been confirmed. View Order Details for your current pickup status.':order.status==='cancelled'?'Your order remains cancelled. Contact support if a payment was collected.':'Your payment has not been confirmed. If your account was debited, contact support with your payment reference.'}</p>
      <dl className="od-rows"><div><dt>Order status</dt><dd>{order.status}</dd></div><div><dt>Payment status</dt><dd>{payment?.status || 'No payment recorded'}</dd></div></dl>
      {eligible&&<button className="od-button od-pay-button" onClick={()=>navigate(`/customer/orders/${id}/payment`,{replace:true})}>Pay Now</button>}
    </>}
    <button className="od-button" disabled={loading} onClick={()=>{attempts.current=0;refresh(true);}}>Refresh Payment Status</button>
  </PurchaseDialog>;
}
