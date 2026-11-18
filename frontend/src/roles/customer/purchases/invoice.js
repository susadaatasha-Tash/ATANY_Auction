import { money,dateTime } from './orderPresentation';
const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function invoiceDocument(data) {
  const {order,payment,customer,product,branch}=data;
  return `<!doctype html><html><head><meta charset="utf-8"><title>ATANY — ${escape(order.transaction_code || order.id)}</title><style>body{font:15px Arial,sans-serif;color:#142a4a;max-width:760px;margin:40px auto;padding:20px}h1{border-bottom:2px solid #c89b3c;padding-bottom:20px}table{width:100%;border-collapse:collapse}td,th{padding:14px;text-align:left;border-bottom:1px solid #ddd}dt{margin-top:12px}dd{margin:4px 0}small{color:#5a6475}</style></head><body><h1>ATANY <small>JEWELRY AUCTION</small></h1><h2>Order Invoice</h2><dl><dt>Order Number</dt><dd>${escape(order.transaction_code || order.id)}</dd><dt>Customer</dt><dd>${escape(customer?.name)} ${escape(customer?.email)}</dd><dt>Order Status</dt><dd>${escape(order.status)}</dd><dt>Payment Status</dt><dd>${escape(payment?.status || 'No payment recorded')}</dd><dt>Auction Ended</dt><dd>${escape(dateTime(order.auction_end || order.created_at))}</dd><dt>Pickup Branch</dt><dd>${escape(branch?.name)} — ${escape(branch?.address)}</dd></dl><table><thead><tr><th>Jewelry</th><th>Winning Bid</th></tr></thead><tbody><tr><td>${escape(product?.name)}<br><small>${escape(product?.category)} · ${escape(product?.karat_weight)}</small></td><td>${escape(money(order.amount))}</td></tr><tr><td><strong>Total Amount</strong></td><td><strong>${escape(money(order.amount))}</strong></td></tr></tbody></table></body></html>`;
}
export function printInvoice(data) {
  const popup=window.open('','_blank','width=840,height=900');
  if(!popup)throw new Error('Please allow the invoice print window.');
  popup.opener=null;popup.document.write(invoiceDocument(data));popup.document.close();popup.focus();popup.print();
}
export function downloadInvoice(data) {
  const url=URL.createObjectURL(new Blob([invoiceDocument(data)],{type:'text/html;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`ATANY-${String(data.order.transaction_code || data.order.id).replace(/[^a-z0-9_-]/gi,'_')}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
