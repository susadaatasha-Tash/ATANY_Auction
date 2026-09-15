// frontend/src/roles/admin/pages/Branches.jsx
// Rebuilt 1:1 from _legacy_html_backup/admin.html: 1071-1106 — branches is single source of truth (spec 4.5)
// Full design and functionality, wired to real data via GET /branches (public) and POST/PUT/DELETE /admin/branches
import { useState, useEffect } from 'react';
import { BranchModal } from '../components/BranchModal';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';

export default function AdminBranches() {
  const [branches, setBranches] = useState([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const showToast = useToast();

  const refresh = async () => {
    try {
      const rows = await apiFetch('/branches');
      setBranches(Array.isArray(rows) ? rows : []);
    } catch (e) {
      showToast(e.message || 'Failed to load branches');
      setBranches([]);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleSave = async (data) => {
    try {
      if (editing) {
        await apiFetch(`/admin/branches/${editing.id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Branch updated');
      } else {
        await apiFetch('/admin/branches', { method: 'POST', body: JSON.stringify(data) });
        showToast('Branch created');
      }
      setOpen(false);
      setEditing(null);
      await refresh();
    } catch (e) {
      showToast(e.message || 'Failed to save branch');
    }
  };

  const handleDelete = async (branch) => {
    if (!confirm(`Delete "${branch.name}"? This will remove a live pickup location.`)) return;
    try {
      await apiFetch(`/admin/branches/${branch.id}`, { method: 'DELETE' });
      showToast('Branch deleted');
      await refresh();
    } catch (e) {
      showToast(e.message || 'Failed to delete branch');
    }
  };

  const filtered = branches.filter(b =>
    !q || b.name.toLowerCase().includes(q.toLowerCase()) || b.address.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <>
      <div className="panel" style={{ padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'flex-start', background: 'rgba(199,166,106,.08)', borderColor: 'var(--gold-light)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18, color: 'var(--navy)', flexShrink: 0, marginTop: 2 }}><path d="M12 22s7-7.4 7-12.5A7 7 0 0 0 5 9.5C5 14.6 12 22 12 22Z"/><circle cx="12" cy="9.5" r="2.4"/></svg>
        <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>
          <b style={{ color: 'var(--navy)' }}>Branches are managed here, and only here.</b> Whatever you add, edit, or remove in this list is what appears on the customer-facing GPS locator and in the "preferred branch" pickers on the customer and shop owner dashboards — admins are the only ones who can open, close, or relocate a branch.
        </p>
      </div>

      <div className="panel">
        <div className="toolbar">
          <div className="search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search branches..." />
          </div>
          <button className="btn btn-primary" onClick={() => { setEditing(null); setOpen(true); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14"/></svg>
            Add Branch
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Branch</th><th>Address</th><th>Hours</th><th>Phone</th><th>Status</th><th /></tr></thead>
            <tbody>{filtered.length ? filtered.map((b) => (
              <tr key={b.id}>
                <td className="cell-main">{b.name}</td>
                <td>{b.address}</td>
                <td>{b.hours}</td>
                <td>{b.phone}</td>
                <td><span className={`badge ${b.status === 'Open' ? 'active' : 'suspended'}`}>{b.status}</span></td>
                <td>
                  <button className="btn-ghost" onClick={() => { setEditing(b); setOpen(true); }}>Edit</button>
                  <button className="btn-danger-ghost" onClick={() => handleDelete(b)}>Delete</button>
                </td>
              </tr>
            )) : <tr><td colSpan={6}><div className="empty-state"><p>No branches match your search.</p></div></td></tr>}</tbody>
          </table>
        </div>
        <div className="pager"><span>{filtered.length} branches</span></div>
      </div>

      <div className="panel" style={{ padding: '18px 20px' }}>
        <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          The full GPS map with live distance and directions is on the customer-facing locator page.
        </p>
        <a className="btn btn-outline" style={{ marginTop: 12 }} href="/branches">Open GPS Branch Locator →</a>
      </div>

      <BranchModal open={open} onClose={() => { setOpen(false); setEditing(null); }} initial={editing} onSave={handleSave} />
    </>
  );
}
