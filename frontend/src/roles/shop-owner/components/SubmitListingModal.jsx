// frontend/src/roles/shop-owner/components/SubmitListingModal.jsx
// Port of shop-owner-dashboard.html:474-513 listingModal
// POST /shop-owner/listings -> products.status=pending (spec 4.3). Admin approves via PUT /admin/products/:id
import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { apiFetch } from '../../../shared/lib/apiClient';

export function SubmitListingModal({ open, onClose, onSubmit, initial, mode }) {
  const isEdit = !!initial || mode === 'edit';
  const toLocal = (d) => { const pad=(n)=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  // Default schedule: start tomorrow 10am, end start+7 days, or use initial values for edit — fix: ensure End = Start +7d, not same time
  const getDefaults = () => {
    const start = initial?.proposed_start_time ? new Date(initial.proposed_start_time) : (()=>{ const d=new Date(Date.now()+24*3600*1000); d.setHours(10,0,0,0); return d;})();
    const end = initial?.proposed_end_time ? new Date(initial.proposed_end_time) : new Date(start.getTime() + 7*86400000);
    return { start: toLocal(start), end: toLocal(end) };
  };
  const defaults = getDefaults();
  const [startVal, setStartVal] = useState(defaults.start);
  const [endVal, setEndVal] = useState(defaults.end);
  useEffect(()=>{ const d=getDefaults(); setStartVal(d.start); setEndVal(d.end); }, [initial?.id, open]);
  const durationDays = useMemo(()=>{
    const s=new Date(startVal), e=new Date(endVal);
    if (isNaN(s) || isNaN(e)) return 0;
    const diffMs = e - s;
    // Use actual Date subtraction for live recalculation, not stale default
    if (diffMs < 0) return -1; // End before Start
    return Math.round(diffMs / 86400000); // 0 when same
  }, [startVal, endVal]);
  const durationError = durationDays < 0 ? "End must be after Start" : null;
  const handle = async (e) => {
    e.preventDefault();
    if (durationDays < 0) {
      alert('Auction End must be after Start');
      return;
    }
    const fd = new FormData(e.target);
    let imageUrl = initial?.image_url || '';
    const file = fd.get('image_file');
    if (file && file.size > 0) {
      try {
        // Use backend signed upload URL (keeps service_role key server-side, spec 5.6)
        const { signedUrl, publicUrl } = await apiFetch('/shop-owner/upload-url', {
          method: 'POST',
          body: JSON.stringify({ filename: file.name }),
        });
        // Upload directly to Supabase signed URL
        const uploadRes = await fetch(signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!uploadRes.ok) throw new Error(`Upload failed ${uploadRes.status}`);
        imageUrl = publicUrl;
      } catch (err) {
        console.error('Image upload failed', err);
        // Do not fallback to blob: URL — it is not persistable and causes broken ? on Live Auctions.
        // Keep existing image if editing, otherwise use placeholder
        if (!imageUrl) imageUrl = 'https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=400&q=70';
      }
    }
    const startTime = fd.get('auction_start_time') || startVal || null;
    const endTime = fd.get('auction_end_time') || endVal || null;
    // Duration is derived from Start/End, not independently edited — prevents conflict where stale "7 days" mismatches actual gap
    const duration = String(durationDays);
    onSubmit({ name: fd.get('name'), category: fd.get('category'), karat: fd.get('karat'), price: Number(fd.get('price')), desc: fd.get('desc'), image_url: imageUrl, auction_start_time: startTime || undefined, auction_end_time: endTime || undefined, duration_days: duration || undefined, proposed_start_time: startTime || undefined, proposed_end_time: endTime || undefined, proposed_duration_days: duration || undefined });
    // Reset form so file input does not retain stale File / object URL for next submission
    e.target.reset();
  };

  // Rules of Hooks: hooks above must run on every render — bail out only after they're declared.
  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit & Resubmit" : "Submit New Item"}
      footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="listingForm" type="submit">{isEdit ? "Save & Resubmit" : "Submit for Review"}</button></>}>
      <form id="listingForm" onSubmit={handle}>
        <div className="form-row"><label>Item Name</label><input name="name" defaultValue={initial?.name || ''} placeholder="e.g. Antique Filigree Brooch" required /></div>
        <div className="form-grid-2">
          <div className="form-row"><label>Category</label><select name="category" defaultValue={initial?.category || 'Rings'}><option>Rings</option><option>Necklaces</option><option>Bracelets</option><option>Earrings</option><option>Watches</option></select></div>
          <div className="form-row"><label>Karat / Weight</label><input name="karat" defaultValue={initial?.karat_weight || initial?.karat || ''} placeholder="e.g. 18K · 6.5g" /></div>
        </div>
        <div className="form-row"><label>Suggested Starting Price (₱)</label><input name="price" type="number" defaultValue={initial?.price || ''} placeholder="0" /></div>
        <div className="form-grid-2">
          <div className="form-row"><label>Auction Start</label><input name="auction_start_time" type="datetime-local" value={startVal} onChange={(e)=>setStartVal(e.target.value)} required /></div>
          <div className="form-row"><label>Auction End</label><input name="auction_end_time" type="datetime-local" value={endVal} onChange={(e)=>setEndVal(e.target.value)} required /></div>
        </div>
        <div className="form-row"><label>Duration</label><div style={{padding:'8px 10px', background: durationError ? '#fee2e2' : 'var(--soft)', border: durationError ? '1px solid #fca5a5' : '1px solid var(--line)', borderRadius:7, fontSize:13, color: durationError ? '#dc2626' : undefined}}>{durationError ? durationError : `${durationDays} day${durationDays!==1?'s':''} (auto-calculated as End − Start)`}</div><input type="hidden" name="duration_days" value={durationDays < 0 ? 0 : durationDays} /></div>
        <div className="form-row"><label>Item Photo (upload from file)</label><input name="image_file" type="file" accept="image/*" />{initial?.image_url && <div style={{fontSize:11, color:'var(--muted)', marginTop:4}}>Current: <a href={initial.image_url} target="_blank" rel="noreferrer" style={{color:'var(--navy)'}}>{initial.image_url.slice(0,40)}…</a> — leave empty to keep</div>}</div>
        <div className="form-row"><label>Description</label><textarea name="desc" defaultValue={initial?.description || initial?.desc || ''} placeholder="Condition, provenance, certification…" /></div>
        <p className="form-hint">New listings are reviewed by ATANY admins before going live — usually within 1 business day.</p>
      </form>
    </Modal>
  );
}
