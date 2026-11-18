import { describe,it,expect,vi,afterEach } from 'vitest';
import { invoiceDocument,printInvoice,downloadInvoice } from '../invoice';
const data={order:{id:'stored-id',transaction_code:'TXN-real',amount:1101,status:'pending'},payment:{status:'failed'},customer:{name:'<script>unsafe</script>',email:'stored@test.invalid'},product:{name:'Actual necklace'},branch:{name:'Actual branch'}};
afterEach(()=>vi.restoreAllMocks());
describe('actual invoice actions',()=>{
  it('uses stored identifiers, amount and payment state while escaping customer content',()=>{
    const html=invoiceDocument(data);
    expect(html).toContain('TXN-real');expect(html).toContain('₱1,101');expect(html).toContain('failed');expect(html).toContain('&lt;script&gt;unsafe');expect(html).not.toContain('<script>');expect(html).not.toContain('INV-');
  });
  it('prints the actual generated document',()=>{
    const popup={opener:{},document:{write:vi.fn(),close:vi.fn()},focus:vi.fn(),print:vi.fn()};
    vi.spyOn(window,'open').mockReturnValue(popup);
    printInvoice(data);expect(popup.document.write).toHaveBeenCalledWith(expect.stringContaining('TXN-real'));expect(popup.print).toHaveBeenCalledOnce();expect(popup.opener).toBeNull();
  });
  it('reports blocked print windows',()=>{
    vi.spyOn(window,'open').mockReturnValue(null);expect(()=>printInvoice(data)).toThrow(/allow/);
  });
  it('downloads a real HTML invoice blob with a stored transaction filename',()=>{
    const create=vi.fn(()=> 'blob:invoice-fixture');URL.createObjectURL=create;URL.revokeObjectURL=vi.fn();
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(){expect(this.download).toBe('ATANY-TXN-real.html');expect(this.href).toContain('blob:invoice-fixture');});
    downloadInvoice(data);expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);expect(click).toHaveBeenCalledOnce();
  });
});
