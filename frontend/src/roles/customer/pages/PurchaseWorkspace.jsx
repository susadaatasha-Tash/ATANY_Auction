import { useCallback,useState } from 'react';
import { useParams,useLocation,useNavigate } from 'react-router-dom';
import MyPurchases from './MyPurchases';
import OrderDetails from './OrderDetails';
import InvoiceDialog from '../purchases/InvoiceDialog';
import PaymentDialog from '../purchases/PaymentDialog';
import PaymentReturnDialog from '../purchases/PaymentReturnDialog';
export default function PurchaseWorkspace() {
  const {id}=useParams(),location=useLocation(),navigate=useNavigate();
  const [refreshKey,setRefreshKey]=useState(0);
  const changed=useCallback(()=>setRefreshKey(n=>n+1),[]);
  const close=useCallback(()=>{if(location.state?.purchaseModal)navigate(-1);else navigate('/customer/purchases',{replace:true});},[navigate,location.state]);
  const view=location.pathname.endsWith('/invoice')?'invoice':location.pathname.endsWith('/payment')?'payment':location.pathname.endsWith('/success')?'return':'details';
  const details=!!id&&(view==='details'||view==='payment'&&location.state?.paymentBackground==='details');
  return <><MyPurchases refreshKey={refreshKey}/>{details&&<OrderDetails key={`details:${id}`} id={id} onClose={close} onChanged={changed}/>}
    {id&&view==='invoice'&&<InvoiceDialog key={`invoice:${id}`} id={id} onClose={close}/>}
    {id&&view==='payment'&&<PaymentDialog key={`payment:${id}`} id={id} onClose={close} onChanged={changed}/>}
    {id&&view==='return'&&<PaymentReturnDialog key={`return:${id}`} id={id} onClose={close} onChanged={changed}/>}</>;
}
