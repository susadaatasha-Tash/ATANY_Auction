// frontend/src/roles/shop-owner/pages/ShopProfile.jsx
// Fix: controlled single-select bound to shops.home_branch_id via GET /shop-owner/shop + GET /branches
import { useState, useEffect } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';

export default function ShopProfile() {
  const [shop, setShop] = useState(null);
  const [branches, setBranches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [branchFile, setBranchFile] = useState(null);
  const [branchPreview, setBranchPreview] = useState(null);
  const [uploadingBranch, setUploadingBranch] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    apiFetch('/shop-owner/shop').then(setShop).catch(() => setShop(null));
    apiFetch('/branches').then((rows) => setBranches(rows.filter((b) => b.status === 'Open'))).catch(() => setBranches([]));
  }, []);

  // Revoke object URL preview on unmount / replacement to avoid leaks
  useEffect(() => () => { if (branchPreview) URL.revokeObjectURL(branchPreview); }, [branchPreview]);

  const handleSave = async () => {
    if (!shop) return;
    setSaving(true);
    try {
      await apiFetch('/shop-owner/shop', { method: 'PUT', body: JSON.stringify({ shop_name: shop.shop_name, home_branch_id: shop.home_branch_id }) });
      showToast('Shop profile saved');
    } catch (e) { showToast(e.message); } finally { setSaving(false); }
  };

  const handleBranchFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    const extOk = /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!allowed.includes(file.type) && !extOk) {
      showToast('Please upload a JPG, PNG, or WEBP image under 5 MB.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('Please upload a JPG, PNG, or WEBP image under 5 MB.');
      return;
    }
    if (branchPreview) URL.revokeObjectURL(branchPreview);
    setBranchFile(file);
    setBranchPreview(URL.createObjectURL(file));
  };

  const handleBranchCancel = () => {
    if (branchPreview) URL.revokeObjectURL(branchPreview);
    setBranchFile(null);
    setBranchPreview(null);
  };

  const handleBranchSave = async () => {
    if (!branchFile) return;
    setUploadingBranch(true);
    try {
      const { signedUrl, publicUrl } = await apiFetch('/shop-owner/shop/branch-image/upload-url', {
        method: 'POST',
        body: JSON.stringify({ filename: branchFile.name }),
      });
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': branchFile.type || 'application/octet-stream' },
        body: branchFile,
      });
      if (!uploadRes.ok) throw new Error(`Upload failed ${uploadRes.status}`);
      const updated = await apiFetch('/shop-owner/shop/branch-image', {
        method: 'PUT',
        body: JSON.stringify({ imageUrl: publicUrl }),
      });
      const nextImage = updated?.branch_image_url || updated?.branch?.branch_image_url || publicUrl;
      setShop((s) => (s ? { ...s, branch_image_url: nextImage } : s));
      handleBranchCancel();
      showToast('Branch image saved');
    } catch (e) { showToast(e.message || 'Failed to save branch image'); } finally { setUploadingBranch(false); }
  };

  return (
    <>
    <div className="two-col">
      <div className="panel">
        <div className="panel-head"><div><h2>Shop Details</h2><p>How your shop appears to buyers.</p></div></div>
        <div style={{ padding: 20 }}>
          <div className="form-row"><label>Shop Name</label><input value={shop?.shop_name || ''} onChange={(e) => setShop((s) => ({ ...s, shop_name: e.target.value }))} /></div>
          <div className="form-row"><label>Contact Email</label><input value={shop?.user_email || 'contact@goldenheritage.ph'} disabled style={{ background: 'var(--soft)' }} /></div>
          <div className="form-row"><label>Home Branch (for pickups)</label>
            <select value={shop?.home_branch_id || ''} onChange={(e) => setShop((s) => ({ ...s, home_branch_id: e.target.value }))}>
              <option value="">Select branch</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><div><h2>Payout Method</h2><p>Where your earnings are sent.</p></div></div>
        <div style={{ padding: 20 }}>
          <div className="form-row"><label>Bank / E-wallet Name</label><input defaultValue="BDO Business Account" /></div>
          <div className="form-row"><label>Account Number</label><input defaultValue="•••• •••• 4821" /></div>
          <button className="btn btn-primary">Update Payout Info</button>
        </div>
      </div>
    </div>
    <BranchImagePanel
      shop={shop}
      branches={branches}
      branchFile={branchFile}
      branchPreview={branchPreview}
      uploadingBranch={uploadingBranch}
      onFile={handleBranchFile}
      onCancel={handleBranchCancel}
      onSave={handleBranchSave}
    />
    </>
  );
}

function BranchImagePanel({ shop, branches, branchFile, branchPreview, uploadingBranch, onFile, onCancel, onSave }) {
  const assigned = branches.find((b) => b.id === shop?.home_branch_id);
  const currentImage = shop?.branch_image_url || assigned?.branch_image_url || null;
  const preview = branchPreview || currentImage;
  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <div className="panel-head"><div><h2>Branch Image</h2><p>{assigned?.name || shop?.branch_name || 'Your assigned branch'} — shown on customer branch cards.</p></div></div>
      <div style={{ padding: 20 }}>
        {preview ? (
          <img src={preview} alt="Branch preview" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />
        ) : (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', background: 'var(--soft)', borderRadius: 8 }}>No branch image yet.</div>
        )}
        <div className="form-row" style={{ marginTop: 12 }}><label>Upload a new image</label><input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={onFile} /></div>
        <div className="form-hint">JPG, PNG, or WEBP up to 5 MB.</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn-outline" onClick={onCancel} disabled={!branchFile || uploadingBranch}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={!branchFile || uploadingBranch}>{uploadingBranch ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}
