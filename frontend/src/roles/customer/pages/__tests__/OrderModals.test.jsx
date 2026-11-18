import React from 'react';
import { describe,it,expect,vi,beforeEach,afterEach } from 'vitest';
import { render,screen,within,waitFor,fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter,Routes,Route,useNavigate } from 'react-router-dom';
const api=vi.hoisted(()=>vi.fn());
vi.mock('../../../../shared/lib/apiClient',()=>({apiFetch:api}));
vi.mock('../../../../shared/hooks/useAuth',()=>({useAuth:()=>({user:{id:'buyer',email:'buyer@test.invalid'},loading:false})}));
vi.mock('../../../../shared/hooks/useBranch',()=>({useBranch:()=>({branchId:'branch',branchName:'Actual branch'})}));
vi.mock('../../../../shared/components/Toast',()=>({useToast:()=>vi.fn()}));
vi.mock('../../../../shared/components/NotificationBell',()=>({NotificationBell:()=>null}));
vi.mock('../../../../shared/lib/supabaseClient',()=>({supabase:{auth:{getUser:async()=>({data:{user:{id:'buyer'}}})},channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:vi.fn()}}));
import PurchaseWorkspace from '../PurchaseWorkspace';
const fixture=()=>({order:{id:'order-1',transaction_code:'TXN-stored',status:'pending',amount:1101,auction_code:'A-stored',created_at:'2026-11-01T06:00:00Z',auction_end:'2026-11-01T06:00:00Z',payment_deadline:'2099-11-08T06:00:00Z',can_request_cancellation:true},payment:{status:'pending'},product:{name:'Stored Necklace',category:'Necklaces',karat_weight:'18K',desc:'Actual description',condition:'Good',certificate:'Included'},branch:{name:'Actual branch',address:'Actual address',lat:7,lng:125},customer:{name:'Actual Customer',email:'buyer@test.invalid'}});
let data;
const row=()=>({...data.order,item:data.product.name,payment_status:data.payment?.status,branch:data.branch.name,branch_address:data.branch.address});
function HistoryButtons(){const n=useNavigate();return <><button onClick={()=>n(-1)}>Browser Back</button><button onClick={()=>n(1)}>Browser Forward</button></>;}
function mount(initial='/customer/purchases') {
  return render(<MemoryRouter initialEntries={[initial]}><HistoryButtons/><Routes>{['/customer/purchases','/customer/orders/:id','/customer/orders/:id/invoice','/customer/orders/:id/payment','/customer/orders/:id/success'].map(path=><Route key={path} path={path} element={<PurchaseWorkspace/>}/>)}</Routes></MemoryRouter>);
}
beforeEach(()=>{
  data=fixture();data.order.can_request_payment=true;api.mockReset();
  api.mockImplementation(async(path,opts)=>{
    if(path==='/customer/orders') return [row()];
    if(path.endsWith('/payment') && opts?.method==='POST') return {checkout_url:'https://checkout.paymongo.com/fixture'};
    if(path.includes('/cancel') && opts?.method==='PATCH') {data={...data,order:{...data.order,status:'cancelled',can_request_cancellation:false,cancellation_reason:JSON.parse(opts.body).reason,cancelled_at:'2026-11-02T06:00:00Z',cancelled_by:'buyer'},cancellation_actor:{id:'buyer',name:'Actual Customer',role:'customer'}};return data.order;}
    if(path.startsWith('/customer/orders/')) return structuredClone(data);
    return [];
  });
});
afterEach(()=>vi.unstubAllGlobals());
describe('route-backed purchase dialogs',()=>{
  it('View details opens actual order over the still-mounted purchases page',async()=>{
    mount();await userEvent.click(await screen.findByRole('button',{name:/view details/i}));
    const dialog=await screen.findByRole('dialog',{name:'Order Details'});
    expect(within(dialog).getByText('TXN-stored')).toBeTruthy();
    expect(screen.getByRole('heading',{name:'My Purchases'})).toBeTruthy();
    expect(within(dialog).getByRole('button',{name:'Cancel Order'})).toBeTruthy();
  });
  it('close and Escape restore search and focus',async()=>{
    mount();const search=await screen.findByPlaceholderText(/search your purchases/i);await userEvent.type(search,'Stored');
    const trigger=screen.getByRole('button',{name:/view details/i});await userEvent.click(trigger);await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    expect(search.value).toBe('Stored');expect(document.activeElement).toBe(trigger);
  });
  it('direct URL and Browser Back/Forward work',async()=>{
    mount('/customer/orders/order-1');await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button',{name:'Close Order Details'}));
    expect(await screen.findByRole('button',{name:/view details/i})).toBeTruthy();
    await userEvent.click(screen.getByRole('button',{name:/view details/i}));await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button',{name:'Browser Back'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getByRole('button',{name:'Browser Forward'}));expect(await screen.findByRole('dialog')).toBeTruthy();
  });
  it.each(['cancelled','expired','completed'])('%s never offers cancellation',async(status)=>{
    data.order.status=status;data.order.can_request_cancellation=false;
    if(status==='cancelled') Object.assign(data,{cancellation_actor:{name:'Stored Seller',role:'shop_owner'}}),Object.assign(data.order,{cancelled_at:'2026-11-02T06:00:00Z',cancellation_reason:'Stored reason'});
    mount('/customer/orders/order-1');const dialog=await screen.findByRole('dialog');
    await within(dialog).findByText('TXN-stored');expect(within(dialog).queryByRole('button',{name:'Cancel Order'})).toBeNull();
    if(status==='cancelled') {expect(within(dialog).getByText('Shop Owner (Seller)')).toBeTruthy();expect(within(dialog).getByText('Stored reason')).toBeTruthy();}
  });
  it('Jewelry Details expands with real attributes',async()=>{
    mount('/customer/orders/order-1');const d=await screen.findByRole('dialog');const expand=await within(d).findByRole('button',{name:'Jewelry Details'});
    expect(expand.getAttribute('aria-expanded')).toBe('false');await userEvent.click(expand);expect(within(d).getByText('Included')).toBeTruthy();
  });
  it('Keep Order dismisses only the confirmation without sending a mutation',async()=>{
    mount('/customer/orders/order-1');const d=await screen.findByRole('dialog');await userEvent.click(await within(d).findByRole('button',{name:'Cancel Order'}));
    const confirmation=screen.getByRole('dialog',{name:'Cancel Order?'});
    expect(d.getAttribute('aria-hidden')).toBe('true');expect(d.getAttribute('aria-modal')).toBe('false');
    await userEvent.click(within(confirmation).getByRole('button',{name:'Keep Order'}));
    expect(screen.getByRole('dialog',{name:'Order Details'})).toBeTruthy();expect(api.mock.calls.some(([,o])=>o?.method==='PATCH')).toBe(false);
  });
  it.each(['Ordered by mistake','Other — Write my own reason'])('cancels using %s and refreshes both dialogs and purchases',async(reason)=>{
    mount('/customer/orders/order-1');const d=await screen.findByRole('dialog');await userEvent.click(await within(d).findByRole('button',{name:'Cancel Order'}));
    const confirm=screen.getByRole('dialog',{name:'Cancel Order?'});expect(within(confirm).getByRole('button',{name:'Confirm Cancellation'}).disabled).toBe(true);
    await userEvent.click(within(confirm).getByLabelText(reason));if(reason.startsWith('Other')) await userEvent.type(within(confirm).getByLabelText('Your reason'),'Stored custom reason');
    await userEvent.click(within(confirm).getByRole('button',{name:'Confirm Cancellation'}));
    await within(d).findByText('Cancellation Information');expect(within(d).queryByRole('button',{name:'Cancel Order'})).toBeNull();
    expect(api.mock.calls.some(([p,o])=>p==='/customer/orders/order-1/cancel' && o.method==='PATCH')).toBe(true);
  });
  it('provider failure preserves reason and order details',async()=>{
    const base=api.getMockImplementation();api.mockImplementation((p,o)=>p.endsWith('/cancel')?Promise.reject(new Error('Payment is processing')):base(p,o));
    mount('/customer/orders/order-1');const d=await screen.findByRole('dialog');await userEvent.click(await within(d).findByRole('button',{name:'Cancel Order'}));
    const c=screen.getByRole('dialog',{name:'Cancel Order?'});await userEvent.click(within(c).getByLabelText('Ordered by mistake'));await userEvent.click(within(c).getByRole('button',{name:'Confirm Cancellation'}));
    expect(await within(c).findByRole('alert')).toHaveTextContent('Payment is processing');expect(within(c).getByLabelText('Ordered by mistake').checked).toBe(true);
  });
  it('processing discovered during cancellation disables confirmation but preserves the reason',async()=>{
    const base=api.getMockImplementation();api.mockImplementation((p,o)=>{
      if(p.endsWith('/cancel')){data.payment.status='processing';data.order.can_request_cancellation=false;return Promise.reject(new Error('Payment is processing'));}return base(p,o);
    });
    mount('/customer/orders/order-1');const d=await screen.findByRole('dialog');await userEvent.click(await within(d).findByRole('button',{name:'Cancel Order'}));
    const c=screen.getByRole('dialog',{name:'Cancel Order?'});await userEvent.click(within(c).getByLabelText('Ordered by mistake'));await userEvent.click(within(c).getByRole('button',{name:'Confirm Cancellation'}));
    await within(c).findByRole('alert');await waitFor(()=>expect(within(c).getByRole('button',{name:'Confirm Cancellation'}).disabled).toBe(true));
    expect(within(c).getByLabelText('Ordered by mistake').checked).toBe(true);
  });
  it('View invoice opens real transaction details and print/download controls',async()=>{
    mount();await userEvent.click(await screen.findByRole('button',{name:/view invoice/i}));
    const d=await screen.findByRole('dialog',{name:'Invoice'});await within(d).findByText('TXN-stored');
    expect(within(d).getByText('Actual Customer')).toBeTruthy();expect(within(d).getByRole('button',{name:'Print Invoice'})).toBeTruthy();expect(within(d).getByRole('button',{name:'Download Invoice'})).toBeTruthy();
  });
});

describe('payment confirmation and action explanations',()=>{
  it('an eligible pending order with no payment record can cancel',async()=>{
    data.payment=null;mount('/customer/orders/order-1');
    const d=await screen.findByRole('dialog');
    expect(await within(d).findByRole('button',{name:'Cancel Order'})).toBeEnabled();
    await userEvent.click(within(d).getByRole('button',{name:'Cancel Order'}));
    const c=screen.getByRole('dialog',{name:'Cancel Order?'});
    expect(within(c).getByText('Are you sure you want to cancel this order?')).toBeTruthy();
    expect(within(c).getByText('TXN-stored')).toBeTruthy();
    expect(within(c).getByText('Stored Necklace')).toBeTruthy();
    expect(within(c).getByRole('button',{name:'Confirm Cancellation'})).toBeDisabled();
  });
  it.each(['Order changes are temporarily unavailable.','A previous checkout could not be verified.'])('explains blocked cancellation: %s',async reason=>{
    data.order.can_request_cancellation=false;data.order.cancellation_block_reason=reason;
    mount('/customer/orders/order-1');const d=await screen.findByRole('dialog');
    expect(await within(d).findByText(reason)).toBeTruthy();
    await userEvent.click(within(d).getByRole('button',{name:'Cancel Order'}));
    const info=screen.getByRole('dialog',{name:'Cancellation Unavailable'});
    expect(within(info).getByText(reason)).toBeTruthy();
    expect(within(info).queryByRole('button',{name:'Confirm Cancellation'})).toBeNull();
    expect(api.mock.calls.some(([,o])=>o?.method==='PATCH')).toBe(false);
  });
  it.each(['paid','processing'])('%s payment hides cancellation and blocks payment',async status=>{
    data.payment.status=status;mount('/customer/orders/order-1');const d=await screen.findByRole('dialog');
    await within(d).findByText('TXN-stored');
    expect(within(d).queryByRole('button',{name:'Cancel Order'})).toBeNull();
    expect(within(d).queryByRole('button',{name:'Pay Now'})).toBeNull();
  });
  it('card Pay now opens confirmation; Not Now restores context without payment',async()=>{
    mount();const search=await screen.findByRole('searchbox',{name:'Search your purchases'});
    await userEvent.type(search,'Necklace');const button=screen.getByRole('button',{name:/^pay now$/i});
    await userEvent.click(button);const d=await screen.findByRole('dialog',{name:'Complete Your Payment'});
    await within(d).findByText('TXN-stored');
    expect(within(d).getByText('Actual branch')).toBeTruthy();
    expect(within(d).getByText(/2099/)).toBeTruthy();
    expect(api.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
    await userEvent.click(within(d).getByRole('button',{name:'Not Now'}));
    expect(search).toHaveValue('Necklace');expect(document.activeElement).toBe(button);
  });
  it('details Pay Now uses the coordinated stack and restores focus',async()=>{
    mount('/customer/orders/order-1');const d=await screen.findByRole('dialog');
    const pay=await within(d).findByRole('button',{name:'Pay Now'});await userEvent.click(pay);
    const top=await screen.findByRole('dialog',{name:'Complete Your Payment'});
    expect(d.inert).toBe(true);expect(d).toHaveAttribute('aria-hidden','true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog',{name:'Complete Your Payment'})).toBeNull();
    expect(d.inert).toBe(false);expect(document.activeElement).toBe(pay);
  });
  it('Continue sends one payment request and redirects only to the hosted checkout',async()=>{
    const assign=vi.fn();vi.stubGlobal('location',{assign});
    let finish;const base=api.getMockImplementation();api.mockImplementation((p,o)=>p.endsWith('/payment')&&o?.method==='POST'?new Promise(r=>{finish=r;}):base(p,o));
    mount('/customer/orders/order-1/payment');const d=await screen.findByRole('dialog');
    const button=await within(d).findByRole('button',{name:'Continue to Secure Payment'});
    await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);fireEvent.click(button);
    expect(button).toBeDisabled();expect(api.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(1);
    finish({checkout_url:'https://checkout.paymongo.com/fixture'});
    await waitFor(()=>expect(assign).toHaveBeenCalledWith('https://checkout.paymongo.com/fixture'));
    expect(api.mock.calls.find(([,o])=>o?.method==='POST')[0]).toBe('/customer/orders/order-1/payment');
    expect(screen.queryByText('Payment Confirmed!')).toBeNull();
  });
  it.each(['https://evil.test/checkout','https://checkout.paymongo.com.evil.test/pay',null])('rejects missing or untrusted checkout URL %s',async url=>{
    const assign=vi.fn();vi.stubGlobal('location',{assign});const base=api.getMockImplementation();
    api.mockImplementation((p,o)=>p.endsWith('/payment')&&o?.method==='POST'?Promise.resolve({checkout_url:url}):base(p,o));
    mount('/customer/orders/order-1/payment');const d=await screen.findByRole('dialog');
    const b=await within(d).findByRole('button',{name:'Continue to Secure Payment'});await waitFor(()=>expect(b).toBeEnabled());await userEvent.click(b);
    expect(await within(d).findByRole('alert')).toHaveTextContent(/secure checkout/i);expect(assign).not.toHaveBeenCalled();
  });
  it('provider failure is displayed and a processing refresh prevents another attempt',async()=>{
    const base=api.getMockImplementation();api.mockImplementation((p,o)=>{
      if(p.endsWith('/payment')&&o?.method==='POST'){data.payment.status='processing';data.order.can_request_payment=false;return Promise.reject(new Error('Payment is being verified. Please wait.'));}return base(p,o);
    });
    mount('/customer/orders/order-1/payment');const d=await screen.findByRole('dialog');const b=await within(d).findByRole('button',{name:'Continue to Secure Payment'});
    await waitFor(()=>expect(b).toBeEnabled());await userEvent.click(b);
    expect(await within(d).findByRole('alert')).toHaveTextContent('Payment is being verified. Please wait.');
    await waitFor(()=>expect(b).toBeDisabled());
  });
  it.each(['cancelled','expired'])('%s order cannot start checkout through a direct URL',async status=>{
    data.order.status=status;mount('/customer/orders/order-1/payment');const d=await screen.findByRole('dialog');
    const b=await within(d).findByRole('button',{name:'Continue to Secure Payment'});expect(b).toBeDisabled();
    fireEvent.click(b);expect(api.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
  });
  it('unverified database readiness disables Continue with an explanation',async()=>{
    data.order.can_request_payment=false;data.order.payment_block_reason='Payments are temporarily unavailable. Please contact support.';
    mount('/customer/orders/order-1/payment');const d=await screen.findByRole('dialog');
    expect(await within(d).findByText(data.order.payment_block_reason)).toBeTruthy();
    expect(within(d).getByRole('button',{name:'Continue to Secure Payment'})).toBeDisabled();
  });
  it('missing capability flags never enable payment or cancellation',async()=>{
    delete data.order.can_request_payment;delete data.order.can_request_cancellation;
    mount('/customer/orders/order-1');const d=await screen.findByRole('dialog');
    const b=await within(d).findByRole('button',{name:'Pay Now'});
    await userEvent.click(b);
    const info=screen.getByRole('dialog',{name:'Payment Unavailable'});
    expect(within(info).queryByRole('button',{name:'Continue to Secure Payment'})).toBeNull();
    expect(api.mock.calls.some(([,o])=>['POST','PATCH'].includes(o?.method))).toBe(false);
  });
  it('blocked payment opens information, never the checkout confirmation or a mutation',async()=>{
    data.order.can_request_payment=false;data.order.payment_block_reason='Secure checkout is temporarily unavailable.';
    mount('/customer/orders/order-1');const d=await screen.findByRole('dialog');
    const pay=await within(d).findByRole('button',{name:'Pay Now'});await userEvent.click(pay);
    const info=screen.getByRole('dialog',{name:'Payment Unavailable'});
    expect(within(info).getByText('Secure checkout is temporarily unavailable.')).toBeTruthy();
    expect(within(info).getByText('TXN-stored')).toBeTruthy();
    expect(within(info).getByText('Stored Necklace')).toBeTruthy();
    expect(d.inert).toBe(true);expect(screen.queryByRole('dialog',{name:'Complete Your Payment'})).toBeNull();
    await userEvent.keyboard('{Escape}');expect(document.activeElement).toBe(pay);
    expect(api.mock.calls.some(([,o])=>['POST','PATCH'].includes(o?.method))).toBe(false);
  });
  it('availability refresh can enable a later review without starting payment automatically',async()=>{
    data.order.can_request_payment=false;mount('/customer/orders/order-1');const d=await screen.findByRole('dialog');
    await userEvent.click(await within(d).findByRole('button',{name:'Pay Now'}));
    const info=screen.getByRole('dialog',{name:'Payment Unavailable'});
    data.order.can_request_payment=true;
    await userEvent.click(within(info).getByRole('button',{name:'Check Again'}));
    expect(await within(info).findByText(/Payment is available to review/)).toBeTruthy();
    expect(api.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
    await userEvent.click(within(info).getByRole('button',{name:'Back to Order Details'}));
    await userEvent.click(within(d).getByRole('button',{name:'Pay Now'}));
    expect(await screen.findByRole('dialog',{name:'Complete Your Payment'})).toBeTruthy();
    expect(api.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
  });
  it('failed availability refresh gives an error without enabling a mutation',async()=>{
    data.order.can_request_cancellation=false;mount('/customer/orders/order-1');const d=await screen.findByRole('dialog');
    await userEvent.click(await within(d).findByRole('button',{name:'Cancel Order'}));
    const info=screen.getByRole('dialog',{name:'Cancellation Unavailable'});
    const base=api.getMockImplementation();api.mockImplementation((p,o)=>p==='/customer/orders/order-1'?Promise.reject(new Error('Network unavailable')):base(p,o));
    await userEvent.click(within(info).getByRole('button',{name:'Check Again'}));
    expect(await within(info).findByRole('alert')).toHaveTextContent(/could not refresh/i);
    expect(within(info).queryByRole('button',{name:'Confirm Cancellation'})).toBeNull();
    expect(api.mock.calls.some(([,o])=>['POST','PATCH'].includes(o?.method))).toBe(false);
  });
  it('card cancellation follows refreshed eligibility after a processing rejection',async()=>{
    const base=api.getMockImplementation();api.mockImplementation((p,o)=>{
      if(p.endsWith('/cancel')){data.payment.status='processing';data.order.can_request_cancellation=false;return Promise.reject(new Error('Payment is processing'));}return base(p,o);
    });
    mount();await userEvent.click(await screen.findByRole('button',{name:'Cancel order'}));
    const d=screen.getByRole('dialog',{name:'Cancel Order?'});
    await userEvent.click(within(d).getByLabelText('Ordered by mistake'));
    await userEvent.click(within(d).getByRole('button',{name:'Confirm Cancellation'}));
    await within(d).findByRole('alert');
    await waitFor(()=>expect(within(d).getByRole('button',{name:'Confirm Cancellation'})).toBeDisabled());
  });
  it('payment modal supports browser Back and Forward without starting checkout',async()=>{
    mount();await userEvent.click(await screen.findByRole('button',{name:/^pay now$/i}));
    await screen.findByRole('dialog',{name:'Complete Your Payment'});
    fireEvent.click(screen.getByRole('button',{name:'Browser Back'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button',{name:'Browser Forward'}));
    expect(await screen.findByRole('dialog',{name:'Complete Your Payment'})).toBeTruthy();
    expect(api.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
  });
  it('keeps search and sorting after a provider return reload',async()=>{
    const first=mount();const search=await screen.findByRole('searchbox',{name:'Search your purchases'});
    await userEvent.type(search,'Necklace');await userEvent.selectOptions(screen.getByRole('combobox',{name:'Sort purchases'}),'highest');
    first.unmount();mount('/customer/orders/order-1/success');
    await waitFor(()=>expect(screen.getByRole('searchbox',{name:'Search your purchases'})).toHaveValue('Necklace'));
    expect(screen.getByRole('combobox',{name:'Sort purchases'})).toHaveValue('highest');
  });
  it('return URL parameters never establish payment success',async()=>{
    data.payment.status='failed';mount('/customer/orders/order-1/success?paid=true');
    const d=await screen.findByRole('dialog');expect(await within(d).findByText('Payment Failed')).toBeTruthy();
    expect(within(d).queryByText('Payment Confirmed')).toBeNull();
  });
});
