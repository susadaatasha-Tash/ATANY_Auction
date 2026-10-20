// frontend/src/roles/admin/components/BranchModal.jsx
// admin.html:1244-1295 branchModal — POST/PUT/DELETE /admin/branches (spec 4.5: admin is single source of truth)
import { Modal } from '../../../shared/components/Modal';

export function BranchModal({ open, onClose, initial, onSave }) {
  if (!open) return null;
  const handle = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    onSave({ name: fd.get('name'), address: fd.get('address'), hours: fd.get('hours'), phone: fd.get('phone'), lat: Number(fd.get('lat')), lng: Number(fd.get('lng')), status: fd.get('status') });
  };
  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit Branch' : 'Add Branch'}
      footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="branchForm" type="submit">Save Branch</button></>}>
      <form id="branchForm" onSubmit={handle}>
        <div className="form-row"><label>Branch Name</label><input name="name" defaultValue={initial?.name} required /></div>
        <div className="form-row"><label>Address</label><input name="address" defaultValue={initial?.address} required /></div>
        <div className="form-grid-2"><div className="form-row"><label>Hours</label><input name="hours" defaultValue={initial?.hours} /></div><div className="form-row"><label>Phone</label><input name="phone" defaultValue={initial?.phone} /></div></div>
        <div className="form-grid-2"><div className="form-row"><label>Latitude</label><input name="lat" type="number" step="any" defaultValue={initial?.lat} /></div><div className="form-row"><label>Longitude</label><input name="lng" type="number" step="any" defaultValue={initial?.lng} /></div></div>
        <div className="form-row"><label>Status</label><select name="status" defaultValue={initial?.status || 'Open'}><option value="Open">Open</option><option value="Temporarily Closed">Temporarily Closed</option></select></div>
        <p className="form-hint">Coordinates position this branch's pin on the customer GPS locator map.</p>
      </form>
    </Modal>
  );
}
