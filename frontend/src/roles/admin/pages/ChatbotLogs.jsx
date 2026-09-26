// frontend/src/roles/admin/pages/ChatbotLogs.jsx
// Admin Chatbot Logs — GET /admin/chatbot-logs (server-persisted sessions).
// Same table/search/filter/modal pattern as SecurityAlerts.jsx.
import { useState, useEffect } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { ChatbotDetailModal } from '../components/ChatbotDetailModal';

function formatActive(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  if (hours < 48) return 'Yesterday';
  return `${Math.floor(hours / 24)} days ago`;
}

export default function ChatbotLogs() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [resolvedFilter, setResolvedFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const showToast = useToast();

  const refresh = async (resolved = resolvedFilter) => {
    setLoading(true);
    setError(null);
    try {
      const qs = resolved ? `?resolved=${resolved}` : '';
      const rows = await apiFetch(`/admin/chatbot-logs${qs}`);
      setSessions(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e.message || 'Failed to load chatbot sessions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(''); }, []);

  const filtered = sessions.filter((s) => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return (s.topic || '').toLowerCase().includes(needle)
      || (s.user || '').toLowerCase().includes(needle)
      || String(s.id || '').toLowerCase().includes(needle);
  });

  const handleResolve = async (id, resolved) => {
    try {
      await apiFetch(`/admin/chatbot-logs/${id}`, { method: 'PATCH', body: JSON.stringify({ resolved }) });
      showToast(resolved ? 'Session marked resolved' : 'Session reopened');
      setSelectedId(null);
      await refresh();
    } catch (e) { showToast(e.message || 'Failed to update session'); }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div><h2>Chatbot Conversations</h2><p>Auto-handled sessions. Unresolved are flagged for follow-up.</p></div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-box"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topic, user, session…" /></div>
          <select className="filter-select" value={resolvedFilter} onChange={(e) => { setResolvedFilter(e.target.value); refresh(e.target.value); }}>
            <option value="">All Statuses</option>
            <option value="false">Needs Follow-up</option>
            <option value="true">Resolved</option>
          </select>
        </div>
      </div>
      {error ? (
        <div className="empty-state" style={{ color: 'var(--danger)' }}><p>{error}</p><button className="btn btn-outline" onClick={() => refresh()} style={{ marginTop: 8 }}>Retry</button></div>
      ) : loading ? (
        <div className="empty-state"><p>Loading chatbot sessions…</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Session</th><th>User</th><th>Topic</th><th>Messages</th><th>Resolved</th><th>Last Active</th></tr></thead>
            <tbody>{filtered.length ? filtered.map((c) => (
              <tr key={c.id} onClick={() => setSelectedId(c.id)} style={{ cursor: 'pointer' }}>
                <td className="cell-main">{String(c.id).slice(0, 8)}</td>
                <td>{c.user || 'Guest'}</td>
                <td>{c.topic || '—'}</td>
                <td>{c.messages ?? 0}</td>
                <td><span className={`badge ${c.resolved ? 'active' : 'pending'}`}>{c.resolved ? 'Resolved' : 'Needs Follow-up'}</span></td>
                <td>{formatActive(c.last || c.last_active)}</td>
              </tr>
            )) : <tr><td colSpan={6}><div className="empty-state"><p>No chatbot sessions yet.</p></div></td></tr>}</tbody>
          </table>
        </div>
      )}
      <ChatbotDetailModal sessionId={selectedId} onClose={() => setSelectedId(null)} onResolve={handleResolve} />
    </div>
  );
}
