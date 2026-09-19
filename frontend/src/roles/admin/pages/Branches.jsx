// frontend/src/roles/admin/pages/Branches.jsx
// Rebuilt 1:1 from _legacy_html_backup/admin.html: 1071-1106 — branches is single source of truth (spec 4.5)
// Full design and functionality, wired to real data via GET /branches (public) and POST/PUT/DELETE /admin/branches
import { useState, useEffect } from 'react';
import { MapPin, Clock, Phone, Image as ImageIcon, Edit, Trash2 } from 'lucide-react';
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

  const statusClass = (status) => (status === 'Open' ? 'active' : 'suspended');

  const statusLabel = (status) => status;

  const getBranchImage = (branch) => branch.branch_image_url || branch.image_url || null;

  return (
    <>
      <div className="panel" style={{ padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'flex-start', background: 'rgba(199,166,106,.08)', borderColor: 'var(--gold-light)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18, color: 'var(--navy)', flexShrink: 0, marginTop: 2 }}>
          <path d="M12 22s7-7.4 7-12.5A7 7 0 0 0 5 9.5C5 14.6 12 22 12 22Z"/>
          <circle cx="12" cy="9.5" r="2.4"/>
        </svg>
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

        <div className="branches-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 16,
          padding: '16px 20px'
        }}>
          {filtered.length ? filtered.map((b) => {
            const branchImage = getBranchImage(b);
            return (
              <article key={b.id} className="branch-card" style={{
                background: '#fff',
                border: '1px solid rgba(230,226,218,.7)',
                borderRadius: '12px',
                boxShadow: '0 1px 3px rgba(22,43,77,0.06)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
              }}>
                <div style={{
                  display: 'flex',
                  gap: 12,
                  padding: 14
                }}>
                  <div style={{
                    width: 110,
                    height: 110,
                    borderRadius: '10px',
                    overflow: 'hidden',
                    flexShrink: 0,
                    background: 'var(--soft)'
                  }}>
                    {branchImage ? (
                      <img
                        src={branchImage}
                        alt={`${b.name} branch`}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover'
                        }}
                        onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                      />
                    ) : null}
                    {!branchImage && (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--muted)',
                        fontSize: 28
                      }}>
                        <ImageIcon size={28} />
                      </div>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <h3 style={{
                          fontSize: 15,
                          fontWeight: 800,
                          color: 'var(--navy)',
                          margin: 0,
                          lineHeight: 1.3
                        }}>
                          {b.name}
                        </h3>
                        <span className={`badge ${statusClass(b.status)}`} style={{ flexShrink: 0, marginTop: 2 }}>
                          {statusLabel(b.status)}
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text)' }}>
                        {b.address && (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <MapPin size={14} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 1 }} />
                            <span style={{ wordBreak: 'break-word' }}>{b.address}</span>
                          </div>
                        )}
                        {b.hours && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Clock size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                            <span>{b.hours}</span>
                          </div>
                        )}
                        {b.phone && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Phone size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                            <span>{b.phone}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      gap: 8,
                      marginTop: 10
                    }}>
                      <button
                        className="btn-ghost"
                        onClick={() => { setEditing(b); setOpen(true); }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '7px 14px',
                          fontSize: 12,
                          fontWeight: 700,
                          border: '1px solid var(--line)',
                          borderRadius: '8px',
                          background: 'transparent',
                          color: 'var(--navy)',
                          cursor: 'pointer',
                          transition: 'all .15s ease',
                          height: 36
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.background = 'rgba(196,162,101,.08)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.background = 'transparent'; }}
                      >
                        <Edit size={13} /> Edit
                      </button>
                      <button
                        className="btn-danger-ghost"
                        onClick={() => handleDelete(b)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '7px 14px',
                          fontSize: 12,
                          fontWeight: 700,
                          border: '1px solid var(--danger)',
                          borderRadius: '8px',
                          background: 'transparent',
                          color: 'var(--danger)',
                          cursor: 'pointer',
                          transition: 'all .15s ease',
                          height: 36
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(220,38,38,.08)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          }) : (
            <div className="empty-state" style={{
              gridColumn: '1 / -1',
              textAlign: 'center',
              padding: '32px 20px',
              color: 'var(--muted)',
              background: 'var(--ivory)',
              border: '1px solid var(--line)',
              borderRadius: '12px'
            }}>
              <p>No branches match your search.</p>
            </div>
          )}
        </div>

        <div className="pager" style={{ padding: '0 22px 20px' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} branches</span>
        </div>
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