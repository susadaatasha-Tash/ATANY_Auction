export const money=n=>'₱'+Number(n || 0).toLocaleString('en-PH',{maximumFractionDigits:2});
export const dateTime=value=>value?new Date(value).toLocaleString('en-US',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'—';
export function orderPresentation(order,payment) {
  const paid=payment?.status==='paid',displayExpired=order.is_expired&&!paid,terminal=['cancelled','expired'].includes(order.status)||displayExpired;
  let label=({cancelled:'Cancelled',expired:'Expired',completed:'Picked Up',ready_pickup:'Ready for Pickup',preparing:'Preparing Your Jewelry'})[order.status];
  if(!label) label=displayExpired?'Expired':paid?'Payment Confirmed':payment?.status==='processing'?'Payment Processing':payment?.status==='failed'?'Payment Failed':'Payment Pending';
  const current=terminal?-1:order.status==='completed'?5:order.status==='ready_pickup'?4:order.status==='preparing'?3:paid?2:1;
  const completed=terminal?(paid?2:0):order.status==='completed'?5:current-1;
  const stages=['Auction Won','Payment Pending','Payment Confirmed','Preparing Your Jewelry','Ready for Pickup','Picked Up'].map((title,i)=>({title,state:i===2&&!paid?'pending':i===0||i<=completed?'done':i===current?'current':'pending'}));
  return {label,paid,terminal,stages,tone:terminal?'danger':paid?'success':'gold',message:order.status==='cancelled'?'This order was cancelled. Payment history remains available for reference.':label==='Expired'?'The payment period has expired. Payment is no longer available.':paid?'Your payment has been confirmed.':'Please complete your payment to confirm your order.'};
}
