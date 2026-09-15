// frontend/src/roles/admin/components/ProductModal.jsx
// Extract from admin.html:1113-1161 productModal — POST/PUT /admin/products
import { Modal } from '../../../shared/components/Modal';

export function ProductModal({ open, onClose, initial, onSave }) {
  if (!open) return null;
  const isEdit = !!initial?.id;
  const handle = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    onSave({ name: fd.get('name'), category: fd.get('category'), karat: fd.get('karat'), price: Number(fd.get('price')), stock: Number(fd.get('stock')), desc: fd.get('desc') });
  };
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Product' : 'Add Product'}
      footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="productForm" type="submit">Save Product</button></>}>
      <form id="productForm" onSubmit={handle}>
        <div className="form-row"><label>Product Name</label><input name="name" defaultValue={initial?.name} required /></div>
        <div className="form-grid-2">
          <div className="form-row"><label>Category</label><select name="category" defaultValue={initial?.category}><option>Rings</option><option>Necklaces</option><option>Bracelets</option><option>Earrings</option><option>Watches</option></select></div>
          <div className="form-row"><label>Karat / Weight</label><input name="karat" defaultValue={initial?.karat} /></div>
        </div>
        <div className="form-grid-2">
          <div className="form-row"><label>Price (₱)</label><input name="price" type="number" defaultValue={initial?.price} /></div>
          <div className="form-row"><label>Stock Quantity</label><input name="stock" type="number" defaultValue={initial?.stock} /></div>
        </div>
        <div className="form-row"><label>Description</label><textarea name="desc" defaultValue={initial?.desc} /></div>
      </form>
    </Modal>
  );
}
