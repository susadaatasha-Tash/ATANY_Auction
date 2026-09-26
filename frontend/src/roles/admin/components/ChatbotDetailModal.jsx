// frontend/src/roles/admin/components/ChatbotDetailModal.jsx
// Read-only transcript viewer for one chatbot session + Resolve/Reopen.
// Same Modal pattern as AlertDetailModal.jsx.
import { useState, useEffect } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';

function fmtTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? '—' : dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function ChatbotDetailModal({ sessionId, onClose, onResolve }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    if (!sessionId) { setDetail(null); return; }
    let cancelled = false;
    setLoading(true);
    apiFetch(`/admin/chatbot-logs/${sessionId}`)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) showToast(e.message || 'Failed to load conversation'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId]);

  if (!sessionId) return null;
  const session = detail?.session || null;
  const user = detail?.user || null;
  const messages = detail?.messages || [];
  const resolved = session ? session.resolved !== false : true;

  return (
    <Modal open={!!sessionId} onClose={onClose} title="Conversation"
      footer={session ? (
        resolved
          ? <><button className="btn btn-outline" onClick={onClose}>Close</button><button className="btn btn-primary" onClick={() => onResolve(session.id, false)}>Reopen</button></>
          : <><button className="btn btn-outline" onClick={onClose}>Close</button><button className="btn btn-primary" onClick={() => onResolve(session.id, true)}>Resolve</button></>
      ) : <button className="btn btn-outline" onClick={onClose}>Close</button>}>
      {loading && !detail ? (
        <div className="empty-state"><p>Loading conversation…</p></div>
      ) : !session ? (
        <div className="empty-state"><p>Conversation not found.</p></div>
      ) : (
        <div>
          <p style={{ fontSize: 13, color: 'var(--navy)', fontWeight: 700, marginBottom: 4 }}>{session.topic || 'General question'}</p>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
            {user ? `${user.name || 'Customer'}${user.email ? ` (${user.email})` : ''}` : 'Guest'} · {session.mode === 'seller' ? 'Seller assistant' : 'Customer assistant'} · {session.message_count ?? messages.length} messages
          </p>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            Started {fmtTime(session.created_at)} · Last active {fmtTime(session.last_active)} · <span className={`badge ${resolved ? 'active' : 'pending'}`}>{resolved ? 'Resolved' : 'Needs Follow-up'}</span>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '50vh', overflowY: 'auto' }}>
            {messages.length ? messages.map((m) => (
              <div key={m.id} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: m.role === 'user' ? 'var(--navy)' : 'var(--soft)', color: m.role === 'user' ? '#fff' : 'var(--text)', borderRadius: 10, padding: '8px 12px', fontSize: 12.5, lineHeight: 1.5 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.7, marginBottom: 4 }}>{m.role === 'user' ? 'Customer' : 'ATANY Assistant'}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.message}</div>
                <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>{fmtTime(m.created_at)}</div>
              </div>
            )) : <div className="empty-state"><p>No messages in this session.</p></div>}
          </div>
        </div>
      )}
    </Modal>
  );
}
