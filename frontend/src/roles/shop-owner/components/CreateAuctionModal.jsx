// frontend/src/roles/shop-owner/components/CreateAuctionModal.jsx
// Shop owner creates the item + auction together (POST /shop-owner/auctions) — no separate listing/approval step.
// Edit mode (PUT /shop-owner/auctions/:id) is opening-price + schedule only; allowed only for scheduled auctions with no bids.
// Image upload reuses the signed-URL flow from SubmitListingModal.jsx (POST /shop-owner/upload-url -> PUT signedUrl).
import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { apiFetch } from '../../../shared/lib/apiClient';

const toLocal = (d) => { const pad = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function CreateAuctionModal({ open, onClose, onSubmit, initial }) {
  const isEdit = !!initial?.id;

  const getDefaults = () => {
    const start = initial?.startTime ? new Date(initial.startTime) : (() => { const d = new Date(Date.now() + 24 * 3600 * 1000); d.setHours(10, 0, 0, 0); return d; })();
    const end = initial?.endTime ? new Date(initial.endTime) : new Date(start.getTime() + 7 * 86400000);
    return { start: toLocal(start), end: toLocal(end) };
  };
  const defaults = getDefaults();
  const [startVal, setStartVal] = useState(defaults.start);
  const [endVal, setEndVal] = useState(defaults.end);
  const [saving, setSaving] = useState(false);
  useEffect(() => { const d = getDefaults(); setStartVal(d.start); setEndVal(d.end); }, [initial?.id, open]);

  const durationDays = useMemo(() => {
    const s = new Date(startVal), e = new Date(endVal);
    if (isNaN(s) || isNaN(e)) return 0;
    const diffMs = e - s;
    if (diffMs < 0) return -1;
    return Math.round(diffMs / 86400000);
  }, [startVal, endVal]);
  const durationError = durationDays < 0 ? 'End must be after Start' : null;

  const handle = async (e) => {
    e.preventDefault();
    if (durationDays < 0) { alert('Auction End must be after Start'); return; }
    const fd = new FormData(e.target);
    setSaving(true);
    try {
      if (isEdit) {
        // Opening price + schedule only — item details are locked once created.
        await onSubmit({ startPrice: Number(fd.get('startPrice')), start_time: startVal || undefined, end_time: endVal || undefined });
      } else {
        let imageUrl = '';
        const file = fd.get('image_file');
        if (file && file.size > 0) {
          try {
            const { signedUrl, publicUrl } = await apiFetch('/shop-owner/upload-url', { method: 'POST', body: JSON.stringify({ filename: file.name }) });
            const uploadRes = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
            if (!uploadRes.ok) throw new Error(`Upload failed ${uploadRes.status}`);
            imageUrl = publicUrl;
          } catch (err) {
            console.error('Image upload failed', err);
            imageUrl = 'https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=400&q=70';
          }
        }
        await onSubmit({
          name: fd.get('name'), category: fd.get('category'), karat: fd.get('karat'),
          startPrice: Number(fd.get('startPrice')), desc: fd.get('desc'), image_url: imageUrl || undefined,
          start_time: startVal || undefined, end_time: endVal || undefined,
        });
        e.target.reset();
      }
    } finally { setSaving(false); }
  };

  // Rules of Hooks: all hooks above must run on every render — only bail out (return null)
  // after they're declared, never before, or React throws "Expected static flag was missing".
  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Auction' : 'Create Auction'}
      footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="createAuctionForm" type="submit" disabled={saving || !!durationError}>{saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create Auction')}</button></>}>
      <form id="createAuctionForm" onSubmit={handle}>
        {isEdit ? (
          <div className="form-row"><label>Item</label><div style={{ padding: '8px 10px', background: 'var(--soft)', border: '1px solid var(--line)', borderRadius: 7, fontSize: 13 }}>{initial?.name}{initial?.category ? ` · ${initial.category}` : ''}</div></div>
        ) : (
          <>
            <div className="form-row"><label>Item Name</label><input name="name" placeholder="e.g. Antique Filigree Brooch" required /></div>
            <div className="form-grid-2">
              <div className="form-row"><label>Category</label><select name="category" defaultValue="Rings"><option>Rings</option><option>Necklaces</option><option>Bracelets</option><option>Earrings</option><option>Watches</option></select></div>
              <div className="form-row"><label>Karat / Weight</label><input name="karat" placeholder="e.g. 18K · 6.5g" /></div>
            </div>
          </>
        )}
        <div className="form-row"><label>Starting Price (₱)</label><input name="startPrice" type="number" min="1" defaultValue={initial?.startPrice || ''} placeholder="0" required /></div>
        <div className="form-grid-2">
          <div className="form-row"><label>Auction Start</label><input name="auction_start_time" type="datetime-local" value={startVal} onChange={(e) => setStartVal(e.target.value)} required /></div>
          <div className="form-row"><label>Auction End</label><input name="auction_end_time" type="datetime-local" value={endVal} onChange={(e) => setEndVal(e.target.value)} required /></div>
        </div>
        <div className="form-row"><label>Duration</label><div style={{ padding: '8px 10px', background: durationError ? '#fee2e2' : 'var(--soft)', border: durationError ? '1px solid #fca5a5' : '1px solid var(--line)', borderRadius: 7, fontSize: 13, color: durationError ? '#dc2626' : undefined }}>{durationError ? durationError : `${durationDays} day${durationDays !== 1 ? 's' : ''} (auto-calculated as End − Start)`}</div></div>
        {!isEdit && <>
          <div className="form-row"><label>Item Photo (upload from file)</label><input name="image_file" type="file" accept="image/*" /></div>
          <div className="form-row"><label>Description</label><textarea name="desc" placeholder="Condition, provenance, certification…" /></div>
          <p className="form-hint">Your auction goes live at the start time you set — no admin approval needed.</p>
        </>}
        {isEdit && <p className="form-hint">You can edit the price and schedule until the first bid comes in.</p>}
      </form>
    </Modal>
  );
}
