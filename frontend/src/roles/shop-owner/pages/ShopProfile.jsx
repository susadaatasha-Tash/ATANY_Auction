// frontend/src/roles/shop-owner/pages/ShopProfile.jsx
// Fix: controlled single-select bound to shops.home_branch_id via GET /shop-owner/shop + GET /branches
import { useState, useEffect } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';

export default function ShopProfile() {
  const [shop, setShop] = useState(null);
  const [branches, setBranches] = useState([]);
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    apiFetch('/shop-owner/shop').then(setShop).catch(() => setShop(null));
    apiFetch('/branches').then((rows) => setBranches(rows.filter((b) => b.status === 'Open'))).catch(() => setBranches([]));
  }, []);

  const handleSave = async () => {
    if (!shop) return;
    setSaving(true);
    try {
      await apiFetch('/shop-owner/shop', { method: 'PUT', body: JSON.stringify({ shop_name: shop.shop_name, home_branch_id: shop.home_branch_id }) });
      showToast('Shop profile saved');
    } catch (e) { showToast(e.message); } finally { setSaving(false); }
  };

  return (
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
  );
}
