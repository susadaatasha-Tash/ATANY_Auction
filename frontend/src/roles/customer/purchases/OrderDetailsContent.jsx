import { useId,useState } from 'react';
import { FileText,Gem,MapPin,Layers,AlarmClock,Ban,Headphones,ChevronDown,Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { dateTime,money,orderPresentation } from './orderPresentation';

export function OrderBadge({children,tone='gold'}) {return <span className={`od-badge od-${tone}`}><i/>{children}</span>;}
function InfoCard({title,icon:Icon,children,className=''}) {return <section className={`od-card od-info ${className}`}><h2>{Icon&&<Icon size={18}/>}<span>{title}</span></h2>{children}</section>;}
function Rows({rows}) {return <dl className="od-rows">{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value ?? 'Not recorded'}</dd></div>)}</dl>;}
export function OrderDetailsContent({data}) {
  const {order,payment,product={},branch={},cancellation_actor:actor}=data;
  const meta=orderPresentation(order,payment),cancelled=order.status==='cancelled';
  const [expanded,setExpanded]=useState(false),detailsId=useId();
  const jewelryRows=[['Category',product.category],['Metal',product.karat_weight],['Description',product.desc],['Condition',product.condition],['Certificate',typeof product.certificate==='boolean'?(product.certificate?'Available':'Not available'):product.certificate]];
  const paymentLabel=({paid:'Payment Confirmed',pending:'Payment Pending',processing:'Payment Processing',failed:'Payment Failed',expired:'Payment Expired',cancelled:'Payment Cancelled'})[payment?.status] || 'No payment recorded';
  const orderInfo=<InfoCard title="Order Information" icon={cancelled?FileText:null}><Rows rows={[
    ['Order Number',<strong>{order.transaction_code || order.id}</strong>],['Auction Title',<strong>{product.name || order.item}</strong>],['Winning Bid',<strong>{money(order.amount)}</strong>],['Total Amount',<strong>{money(order.amount)}</strong>],['Auction Ended',dateTime(order.auction_end || order.created_at)],
    [cancelled?'Historical Payment Status':'Payment Status',<OrderBadge tone={payment?.status==='paid'?'success':['failed','expired','cancelled'].includes(payment?.status)?'danger':'gold'}>{paymentLabel}</OrderBadge>]
  ]}/></InfoCard>;
  const pickup=<InfoCard title="Pickup Information" icon={cancelled?MapPin:null}><Rows rows={[
    ['Selected Branch',<strong>{branch.name || order.branch || 'Not recorded'}</strong>]
  ]}/>{branch.address&&<p className="od-address">{branch.address}</p>}<div className="od-pickup-note"><MapPin size={18}/><span>Pickup only. No delivery available. Please bring your Order ID when picking up your item.</span></div>
    {!cancelled&&<Rows rows={[["Pickup Status",order.pickup_status || ({pending:'Pending',preparing:'Preparing',ready_pickup:'Ready for Pickup',completed:'Picked Up',expired:'Expired'})[order.status] || order.status]]}/>}
  </InfoCard>;
  return <>
    <div className="od-top">
      <section className="od-product"><div className="od-product-image">{product.img?<img src={product.img} alt={product.name || 'Jewelry'}/>:<Gem size={50} aria-label="No product image available"/>}</div><div><h2>{product.name || order.item || 'Jewelry purchase'}</h2><p className="od-product-meta">{[order.auction_code || product.karat_weight,product.category].filter(Boolean).join(' · ')}</p>{product.desc&&<p className="od-product-description">{product.desc}</p>}<strong className="od-price">{money(order.amount)}</strong></div></section>
      <section className="od-card od-summary"><h2>{cancelled&&<Layers size={18}/>}Payment Summary</h2><div><span>Winning Bid</span><span>{money(order.amount)}</span></div><div className="od-summary-total"><strong>Total Amount</strong><strong>{money(order.amount)}</strong></div>{!cancelled&&<><OrderBadge tone={meta.tone}>{paymentLabel}</OrderBadge><p>{meta.message}</p></>}</section>
    </div>
    {(cancelled||meta.terminal)&&<div className={`od-state-banner ${cancelled?'od-state-cancelled':''}`}><AlarmClock size={21}/><strong>Order Status</strong><OrderBadge tone={meta.tone}>{meta.label}</OrderBadge><p>{meta.message}</p></div>}
    <section className="od-card od-process"><div className="od-process-heading">{cancelled&&<Layers size={20}/>}<div><h2>Payment &amp; Pickup Process</h2><p>Here&apos;s the current status of your order.</p></div></div><ol className="od-stages">{meta.stages.map((stage,i)=><li key={stage.title} className={`od-stage od-stage-${stage.state}`} aria-current={stage.state==='current'?'step':undefined}><span className="od-stage-circle">{stage.state==='done'?<Check size={18}/>:<i/>}</span><strong>{stage.title}</strong><small>{stage.state==='done'?'Completed':stage.state==='current'?'Current':meta.terminal?'Not reached':'Pending'}</small></li>)}</ol></section>
    {cancelled?<div className="od-information-grid">{orderInfo}<InfoCard title="Jewelry Details" icon={Gem}><Rows rows={jewelryRows}/></InfoCard>{pickup}<InfoCard title="Order Timeline" icon={FileText}><ol className="od-timeline"><li className="done"><strong>Auction Won</strong><span>{dateTime(order.auction_end || order.created_at)}</span></li>{payment?.paid_at&&<li className="done"><strong>Payment Confirmed</strong><span>{dateTime(payment.paid_at)}</span></li>}<li><strong>Payment record: {payment?.status || 'none'}</strong><span>{payment?.paid_at?'Recorded payment':'Payment not confirmed'}</span></li><li className="cancelled"><strong>Cancelled</strong><span>{dateTime(order.cancelled_at)}</span></li></ol></InfoCard></div>:<><div className="od-information-grid">{orderInfo}{pickup}</div><section className="od-card od-jewelry"><button className="od-jewelry-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={()=>setExpanded(v=>!v)}>Jewelry Details<ChevronDown size={21} style={{transform:expanded?'rotate(180deg)':undefined}}/></button>{expanded&&<div id={detailsId}><Rows rows={jewelryRows}/></div>}</section></>}
    {cancelled&&<><section className="od-cancellation"><h2><Ban size={20}/>Cancellation Information</h2><div><dl><dt>Cancelled By</dt><dd><strong>{actor?.role==='customer'?'Customer':actor?.role==='shop_owner'?'Shop Owner (Seller)':'Not recorded'}</strong>{actor?.name&&<small>{actor.name}</small>}</dd></dl><dl><dt>Reason</dt><dd>{order.cancellation_reason || 'Not recorded'}</dd></dl><dl><dt>Cancelled At</dt><dd>{dateTime(order.cancelled_at)}</dd></dl></div></section><section className="od-help"><Headphones size={26}/><div><h2>Need Help?</h2><p>Our support team is here for you.</p></div><Link className="od-button" to="/customer/messages"><Headphones size={18}/>Contact Support</Link></section></>}
  </>;
}
