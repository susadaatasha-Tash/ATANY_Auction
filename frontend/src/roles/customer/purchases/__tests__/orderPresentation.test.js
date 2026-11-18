import { describe,it,expect } from 'vitest';
import { orderPresentation } from '../orderPresentation';
describe('order status is separate from payment evidence',()=>{
  it('does not expire a paid pending order from a display-only deadline flag',()=>{
    expect(orderPresentation({status:'pending',is_expired:true},{status:'paid'})).toMatchObject({label:'Payment Confirmed',terminal:false});
  });
  it('keeps explicit cancellation terminal even with historical paid evidence',()=>{
    expect(orderPresentation({status:'cancelled'},{status:'paid'})).toMatchObject({label:'Cancelled',terminal:true});
  });
  it('never completes the payment-confirmed step for a failed payment',()=>{
    expect(orderPresentation({status:'preparing'},{status:'failed'}).stages[2].state).toBe('pending');
  });
});
