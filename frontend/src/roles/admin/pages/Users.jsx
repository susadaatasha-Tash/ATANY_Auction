// frontend/src/roles/admin/pages/Users.jsx
// Rebuilt 1:1 from _legacy_html_backup/admin.html:  Search, filters, Add User, Edit, Suspend/Reactivate, real data via GET /admin/users
import { useState, useEffect } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { Modal } from '../../../shared/components/Modal';

function formatJoined(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name:'', email:'', role:'Customer', status:'active', password:'' });
  const showToast = useToast();

  const refresh = async () => {
    try {
      const rows = await apiFetch('/admin/users');
      const mapped = rows.map((r, idx) => ({
        ...r,
        joined: formatJoined(r.created_at),
        bids: r.bids ?? 0,
        displayId: `U-${String(idx+1).padStart(2,'0')}`,
        roleLabel: r.role ? r.role.split('_').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ') : r.role,
        statusLabel: r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : r.status,
      }));
      setUsers(mapped);
    } catch (e) { showToast(e.message || 'Failed to load users'); }
  };

  useEffect(() => { refresh(); }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({ name:'', email:'', role:'customer', status:'active', password:'' });
    setModalOpen(true);
  };
  const openEdit = (u) => {
    setEditing(u);
    setForm({ name: u.name || '', email: u.email || '', role: u.role || 'customer', status: u.status || 'active', password:'' });
    setModalOpen(true);
  };
  const closeModal = () => { setModalOpen(false); setEditing(null); };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await apiFetch(`/admin/users/${editing.id}`, { method: 'PUT', body: JSON.stringify({ name: form.name, email: form.email, role: form.role, status: form.status }) });
        showToast('User updated');
      } else {
        // For Add, confirm fields needed: name, email, role, temp password, status
        if (!form.password || form.password.length < 6) {
          showToast('Temp password required (min 6 chars) for new user');
          return;
        }
        await apiFetch('/admin/users', { method: 'POST', body: JSON.stringify({ name: form.name, email: form.email, role: form.role, status: form.status, password: form.password }) });
        showToast('User created');
      }
      closeModal();
      await refresh();
    } catch (err) { showToast(err.message || 'Save failed'); }
  };

  const handleToggle = async (u) => {
    try {
      await apiFetch(`/admin/users/${u.id}/suspend`, { method: 'PATCH' });
      showToast(u.status === 'active' ? 'User suspended' : 'User reactivated');
      await refresh();
    } catch (e) { showToast(e.message || 'Failed to update status'); }
  };

  const filtered = users.filter(u => {
    const matchesQ = !q || u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase());
    const matchesRole = !roleFilter || u.role.toLowerCase() === roleFilter.toLowerCase();
    const matchesStatus = !statusFilter || u.status === statusFilter;
    return matchesQ && matchesRole && matchesStatus;
  });

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search users..." />
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <select className="filter-select" value={roleFilter} onChange={(e)=>setRoleFilter(e.target.value)}>
            <option value="">All Roles</option>
            <option value="customer">Customer</option>
            <option value="admin">Admin</option>
            <option value="shop_owner">Shop Owner</option>
          </select>
          <select className="filter-select" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <button className="btn btn-primary" onClick={openAdd}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14"/></svg>
            Add User
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Joined</th><th>Bids Placed</th><th>Status</th><th /></tr></thead>
          <tbody>{filtered.length ? filtered.map((u) => (
            <tr key={u.id}>
              <td className="cell-main"><div>{u.name}</div><div style={{ fontSize:11, color:'var(--muted)', fontWeight:400 }}>{u.displayId}</div></td>
              <td>{u.email}</td>
              <td>{u.roleLabel}</td>
              <td>{u.joined}</td>
              <td>{u.bids}</td>
              <td><span className={`badge ${u.status}`}>{u.statusLabel}</span></td>
              <td>
                <button className="btn-ghost" onClick={()=>openEdit(u)} style={{ color:'var(--muted)', fontSize:12 }}>Edit</button>
                <button className="btn-ghost" onClick={()=>handleToggle(u)} style={{ color: u.status==='active' ? 'var(--danger)' : 'var(--success)', fontSize:12, marginLeft:8 }}>
                  {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                </button>
              </td>
            </tr>
          )) : <tr><td colSpan={7}><div className="empty-state"><p>No users found.</p></div></td></tr>}</tbody>
        </table>
      </div>
      <div className="pager"><span>{filtered.length} users</span></div>

      {modalOpen && (
        <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Edit User' : 'Add User'}
          footer={<><button className="btn btn-outline" onClick={closeModal}>Cancel</button><button className="btn btn-primary" onClick={handleSave}>{editing ? 'Save User' : 'Create User'}</button></>}>
          <form onSubmit={handleSave}>
            <div className="form-row"><label>Full Name</label><input value={form.name} onChange={(e)=>setForm({...form, name:e.target.value})} placeholder="Full name" required /></div>
            <div className="form-row"><label>Email Address</label><input type="email" value={form.email} onChange={(e)=>setForm({...form, email:e.target.value})} placeholder="you@example.com" required /></div>
            <div className="form-grid-2">
              <div className="form-row"><label>Role</label><select value={form.role} onChange={(e)=>setForm({...form, role:e.target.value})}><option value="customer">Customer</option><option value="shop_owner">Shop Owner</option><option value="admin">Admin</option></select></div>
              <div className="form-row"><label>Status</label><select value={form.status} onChange={(e)=>setForm({...form, status:e.target.value})}><option value="active">Active</option><option value="suspended">Suspended</option></select></div>
            </div>
            {!editing && <div className="form-row"><label>Temp Password</label><input type="password" value={form.password} onChange={(e)=>setForm({...form, password:e.target.value})} placeholder="Min 6 chars" required /></div>}
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:6 }}>
              {editing ? 'Edit fields and save to update the user in the database.' : 'Fields needed: name, email, role, status, temp password (user will be created in both Auth and users table).'}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
