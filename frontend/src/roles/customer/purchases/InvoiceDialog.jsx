import { useState } from 'react';
import { FileText,Printer,Download } from 'lucide-react';
import { PurchaseDialog } from './PurchaseDialog';
import { useOrderData } from './useOrderData';
import { money,dateTime } from './orderPresentation';
import { printInvoice,downloadInvoice } from './invoice';
export default function InvoiceDialog({id,onClose}) {
  const {data,loading,error}=useOrderData(id),[actionError,setActionError]=useState('');
  const act=fn=>{try{fn(data);setActionError('');}catch(e){setActionError(e.message);}};
  return <PurchaseDialog title="Invoice" description="Your order, payment record, and pickup details." onClose={onClose} className="od-invoice" header={<span className="od-header-icon"><FileText size={22}/></span>} footer={!loading&&!error&&data?.order&&<><button className="od-button" onClick={()=>act(printInvoice)}><Printer size={19}/>Print Invoice</button><button className="od-button" onClick={()=>act(downloadInvoice)}><Download size={19}/>Download Invoice</button></>}>
    {loading?<p role="status">Loading invoice…</p>:error?<p role="alert">{error}</p>:!data?.order?<p>No order found.</p>:<article className="od-invoice-content"><div className="od-invoice-brand">ATANY<span>JEWELRY AUCTION</span></div><div className="od-invoice-head"><div><small>Order Number</small><h2>{data.order.transaction_code || data.order.id}</h2></div><div><small>Auction Ended</small><p>{dateTime(data.order.auction_end || data.order.created_at)}</p></div></div><section><h2>Customer</h2><p>{data.customer?.name || 'Customer details not recorded'}</p>{data.customer?.email&&<p>{data.customer.email}</p>}</section><table><thead><tr><th>Jewelry</th><th>Winning Bid</th></tr></thead><tbody><tr><td><strong>{data.product?.name}</strong><p>{[data.product?.category,data.product?.karat_weight].filter(Boolean).join(' · ')}</p></td><td>{money(data.order.amount)}</td></tr><tr><th>Total Amount</th><td><strong>{money(data.order.amount)}</strong></td></tr></tbody></table><dl className="od-rows"><div><dt>Order Status</dt><dd>{data.order.status}</dd></div><div><dt>Payment Status</dt><dd>{data.payment?.status || 'No payment recorded'}</dd></div><div><dt>Pickup Branch</dt><dd>{data.branch?.name || 'Not recorded'}</dd></div><div><dt>Branch Address</dt><dd>{data.branch?.address || 'Not recorded'}</dd></div></dl></article>}
    {actionError&&<p role="alert" className="od-error">{actionError}</p>}
  </PurchaseDialog>;
}
