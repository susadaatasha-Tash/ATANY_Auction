// frontend/src/roles/admin/pages/ChatbotLogs.jsx
// admin.html:1053-1069 — GET /admin/chatbot-logs (flagged sessions for staff follow-up per spec 4.8)
export default function ChatbotLogs({ sessions = [] }) {
  return (
    <div className="panel">
      <div className="panel-head"><div><h2>Chatbot Conversations</h2><p>Auto-handled sessions. Unresolved are flagged for follow-up.</p></div></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Session</th><th>User</th><th>Topic</th><th>Messages</th><th>Resolved</th><th>Last Active</th></tr></thead>
          <tbody>{(sessions || []).length ? (sessions || []).map((c) => <tr key={c.id}><td className="cell-main">{c.id}</td><td>{c.user}</td><td>{c.topic}</td><td>{c.messages}</td><td><span className={`badge ${c.resolved ? 'active' : 'pending'}`}>{c.resolved ? 'Resolved' : 'Needs Follow-up'}</span></td><td>{c.last}</td></tr>) : <tr><td colSpan={6}><div className="empty-state"><p>No chatbot sessions yet.</p></div></td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
