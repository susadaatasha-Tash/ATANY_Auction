import { render,screen,waitFor } from '@testing-library/react';
import { describe,it,expect,vi } from 'vitest';
import PaymentReconciliations from '../PaymentReconciliations';
const api=vi.hoisted(()=>vi.fn());
vi.mock('../../../../shared/lib/apiClient',()=>({apiFetch:api}));
describe('Admin payment reconciliation is read-only',()=>{
  it('shows actual provider identity and money without refund or fulfill actions',async()=>{
    api.mockResolvedValue([{id:'r1',transaction_code:'TXN-real',provider_payment_id:'pay_real',checkout_session_id:'cs_real',amount_centavos:110100,currency:'PHP',reason:'ORDER_NOT_PAYABLE',state:'open',order_status:'cancelled',livemode:false}]);
    render(<PaymentReconciliations/>);
    await screen.findByText(/pay_real/);
    expect(screen.getByText('PHP 1,101.00')).toBeTruthy();
    expect(screen.queryByRole('button',{name:/refund|fulfill|mark paid/i})).toBeNull();
    expect(api).toHaveBeenCalledWith('/admin/payment-reconciliations');
  });
  it('reports unavailable evidence instead of displaying an invented empty success',async()=>{
    api.mockRejectedValue(new Error('Database upgrade required'));
    render(<PaymentReconciliations/>);
    await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Database upgrade required'));
  });
});
