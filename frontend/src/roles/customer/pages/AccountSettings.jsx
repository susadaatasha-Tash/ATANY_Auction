// frontend/src/roles/customer/pages/AccountSettings.jsx
// Fetches real user data via GET /customer/account (filtered by auth.uid()) and branches via GET /branches
import { useState, useEffect } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';

export default function AccountSettings({ branches: propBranches }) {
  const [branches, setBranches] = useState(propBranches || []);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [acct, br] = await Promise.all([
          apiFetch('/customer/account').catch(() => null),
          propBranches?.length ? Promise.resolve(propBranches) : apiFetch('/branches').catch(() => []),
        ]);
        if (cancelled) return;
        if (acct) {
          setAccount(acct);
          setForm({ name: acct.name || '', email: acct.email || '', phone: acct.phone || '' });
        }
        if (br) setBranches(Array.isArray(br) ? br : []);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load account');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [propBranches]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await apiFetch('/customer/account', { method: 'PUT', body: JSON.stringify({ name: form.name }) });
      showToast('Profile updated');
    } catch (e) {
      showToast(e.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="panel"><div className="empty-state"><p>Loading your account…</p></div></div>;
  if (error) return <div className="panel"><div className="empty-state" style={{ color: 'var(--danger)' }}><p>Error loading account: {error}</p><p style={{ fontSize: 12 }}>Please try refreshing.</p></div></div>;
  if (!account) return <div className="panel"><div className="empty-state"><p>No account data found.</p></div></div>;

  return (
    <div className="two-col">
      <div className="panel">
        <div className="panel-head"><div><h2>Profile</h2><p>Update your personal details.</p></div></div>
        <div style={{ padding: 20 }}>
          <div className="form-grid-2">
            <div className="form-row"><label>Full Name</label><input value={form.name} onChange={(e)=>setForm({...form, name:e.target.value})} /></div>
            <div className="form-row"><label>Email Address</label><input value={form.email} onChange={(e)=>setForm({...form, email:e.target.value})} disabled title="Email cannot be changed here" style={{ background: 'var(--soft)' }} /></div>
          </div>
          <div className="form-row"><label>Phone Number</label><input value={form.phone} onChange={(e)=>setForm({...form, phone:e.target.value})} placeholder="+63 9XX XXX XXXX" /></div>
          <div className="form-row"><label>Preferred Branch</label>
            <select>{branches.map((b) => <option key={b.id}>{b.name}</option>)}</select>
          </div>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><div><h2>Security</h2><p>Manage your password.</p></div></div>
        <div style={{ padding: 20 }}>
          <div className="form-row"><label>Current Password</label><input type="password" placeholder="••••••••" /></div>
          <div className="form-row"><label>New Password</label><input type="password" placeholder="••••••••" /></div>
          <button className="btn btn-primary">Update Password</button>
        </div>
      </div>
    </div>
  );
}
