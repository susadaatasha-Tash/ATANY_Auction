// frontend/src/shared/components/AssistantWidget.jsx
// Chat assistant with persistent history, clear button, action buttons, and follow-up suggestions
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatbot } from '../hooks/useChatbot';
import { renderMarkdown } from '../lib/renderMarkdown';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  return (
    <div className="atany-bell-wrap">
      <button className="atany-bell-btn" onClick={() => setOpen((v) => !v)} aria-label="Notifications">
        <span className="atany-bell-dot" />
        🔔
      </button>
      {open && (
        <div className="atany-notif-panel open">
          <div className="atany-notif-panel-head">Notifications</div>
          <div className="atany-notif-item">Your bid on the Rose Gold Bangle was outbid — tap to rebid.<div className="t">10 min ago</div></div>
          <div className="atany-notif-item">Auctions ending in the next hour — check your watchlist.<div className="t">2 hours ago</div></div>
          <div className="atany-notif-item">New Byzantine Gold collection just launched.<div className="t">1 day ago</div></div>
        </div>
      )}
    </div>
  );
}

export function AssistantWidget({ mode: propMode, userId }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef(null);
  const navigate = useNavigate();

  const detectedMode = (() => {
    if (propMode) return propMode;
    if (typeof window !== 'undefined' && window.ATANY_ASSISTANT_MODE) return window.ATANY_ASSISTANT_MODE;
    const p = typeof window !== 'undefined' ? window.location.pathname : '';
    if (p.includes('/shop') || p.includes('shop-owner')) return 'seller';
    return 'customer';
  })();

  const { messages, sendMessage, loading, clearHistory } = useChatbot(detectedMode, userId);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Event delegation: handle clicks on <a data-route> inline links
  const handleBodyClick = (e) => {
    const link = e.target.closest('a[data-route]');
    if (link) {
      e.preventDefault();
      navigate(link.getAttribute('data-route'));
    }
  };

  // Check if there's any saved history (for showing clear button state)
  const hasHistory = messages.length > 1;

  return (
    <>
      <button className="atany-fab" onClick={() => setOpen((v) => !v)} aria-label="Open chat assistant">
        💬<span className="fab-dot" />
      </button>
      {open && (
        <div className="atany-chat-panel open">
          <div className="atany-chat-head">
            <div><b>ATANY Assistant</b><span>Usually replies instantly</span></div>
            <button className="atany-chat-close" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="atany-chat-body" ref={bodyRef} onClick={handleBodyClick}>
            {messages.map((m, i) => (
              <div key={i} className="atany-msg-wrap">
                {m.who === 'bot' ? (
                  <div
                    className={`atany-msg ${m.who} atany-msg-md`}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }}
                  />
                ) : (
                  <div className={`atany-msg ${m.who}`}>{m.text}</div>
                )}
                {/* Show suggestions under the last bot message only */}
                {m.who === 'bot' && i === messages.length - 1 && (
                  <div className="atany-suggestions">
                    {(m.suggestions || []).map((s, si) => (
                      <button
                        key={si}
                        className="atany-suggestion-btn"
                        onClick={() => sendMessage(s)}
                        disabled={loading}
                      >
                        {s}
                      </button>
                    ))}
                    {(m.suggestions || []).length === 0 && m.conversation_state === 'closed' && (
                      <span className="atany-suggestion-empty">Conversation closed.</span>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && <div className="atany-msg bot" style={{ opacity: 0.7, fontStyle: 'italic' }}>ATANY is typing…</div>}
          </div>
          <ChatInput onSend={sendMessage} onClear={clearHistory} hasHistory={hasHistory} loading={loading} />
        </div>
      )}
    </>
  );
}

function ChatInput({ onSend, onClear, hasHistory, loading }) {
  const [val, setVal] = useState('');
  const submit = () => { if (val.trim() && !loading) { onSend(val); setVal(''); } };
  const handleClear = () => {
    if (!hasHistory || loading) return;
    if (window.confirm('Clear this conversation?')) onClear();
  };
  return (
    <div className="atany-chat-input">
      <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Ask about bids, branches, orders…" disabled={loading} />
      {hasHistory && (
        <button className="atany-chat-trash" onClick={handleClear} disabled={loading} aria-label="Clear conversation" title="Clear conversation">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      )}
      <button className="atany-chat-send" onClick={submit} aria-label="Send" disabled={loading}>➤</button>
    </div>
  );
}
