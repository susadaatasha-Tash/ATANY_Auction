// frontend/src/shared/components/MessagesPage.jsx
// Shared messaging page for customers and sellers.
// Two-panel layout: conversation list (left) + message thread (right).

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { socket } from '../lib/socketClient';
import { useAuth } from '../hooks/useAuth.jsx';
import { useToast } from './Toast.jsx';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000';

/* ─── colour tokens (matches cream/white/navy/gold theme) ─── */
const NAVY = '#14301f';
const CREAM = '#fffefa';
const WARM_BG = '#f7f5f0';
const BORDER = '#e5e2da';
const GOLD = '#c7a66a';
const TEXT = '#3a3a3a';
const MUTED = '#888';

/* ─── helpers ─── */
async function getToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

function truncate(str, len = 42) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

/* ═══════════════════════════════════════════════════════════════
   MessagesPage
   ═══════════════════════════════════════════════════════════════ */
export default function MessagesPage({ role = 'customer' }) {
  const { user } = useAuth();
  const showToast = useToast();

  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);

  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const prevConvoCountRef = useRef(0);

  const myId = user?.id;

  /* ─── fetch conversations ─── */
  const fetchConversations = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${apiBase}/messages/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load conversations');
      const data = await res.json();
      setConversations(data);
    } catch (err) {
      console.error('fetchConversations:', err);
    } finally {
      setLoadingConvos(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
    const id = setInterval(fetchConversations, 30000);
    return () => clearInterval(id);
  }, [fetchConversations]);

  /* ─── fetch messages for selected conversation ─── */
  const fetchMessages = useCallback(async (partnerId) => {
    if (!partnerId) return;
    setLoadingMessages(true);
    try {
      const token = await getToken();
      const res = await fetch(`${apiBase}/messages/${partnerId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load messages');
      const data = await res.json();
      setMessages(data);
      // Mark as read inline (avoids stale closure from separate useCallback)
      fetch(`${apiBase}/messages/${partnerId}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      }).then(() => fetchConversations()).catch(() => {});
    } catch (err) {
      console.error('fetchMessages:', err);
    } finally {
      setLoadingMessages(false);
    }
  }, [fetchConversations]);

  useEffect(() => {
    fetchMessages(selectedId);
  }, [selectedId, fetchMessages]);

  /* ─── mark as read ─── */
  const markAsRead = useCallback(async (partnerId) => {
    try {
      const token = await getToken();
      await fetch(`${apiBase}/messages/${partnerId}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchConversations();
    } catch (err) {
      console.error('markAsRead:', err);
    }
  }, [fetchConversations]);

  /* ─── send message ─── */
  const sendMessage = useCallback(async () => {
    if (!input.trim() || !selectedId || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    try {
      const token = await getToken();
      const res = await fetch(`${apiBase}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ receiver_id: selectedId, message: text }),
      });
      if (!res.ok) throw new Error('Failed to send');
      fetchMessages(selectedId);
      fetchConversations();
    } catch (err) {
      console.error('sendMessage:', err);
      showToast('Failed to send message');
      setInput(text);
    } finally {
      setSending(false);
    }
  }, [input, selectedId, sending, showToast, fetchMessages, fetchConversations]);

  /* ─── Socket.io: authenticated private room + listen for incoming messages ─── */
  useEffect(() => {
    if (!myId) return;
    // H1: handshake auth supplies JWT; server joins user:<authenticated-id>.
    // join:user is a no-op on the server — do not send arbitrary room ids.
    socket.connect();

    const handler = (msg) => {
      fetchConversations();
      if (msg.sender_id === selectedId || msg.receiver_id === selectedId) {
        fetchMessages(selectedId);
      }
    };
    socket.on('message:new', handler);

    return () => {
      socket.off('message:new', handler);
      socket.disconnect();
    };
  }, [myId, selectedId, fetchConversations, fetchMessages]);

  /* ─── optional context prefill (e.g. from an expired order) ───
     The caller may pass ?order=…&item=…&topic=… — ONLY safe, customer-
     visible context. The draft is prefilled once per conversation selection;
     the customer always edits it before sending. */
  const [searchParams] = useSearchParams();
  const prefillRef = useRef(null);
  const prefillText = useCallback(() => {
    const order = searchParams.get('order');
    const item = searchParams.get('item');
    const topic = searchParams.get('topic');
    if (!order && !item && !topic) return '';
    const lines = ['Hi ATANY Support,', ''];
    if (topic === 'expired-payment') {
      lines.push('I have a question about the payment period that ended on one of my auction orders.');
    }
    if (item) lines.push(`Item: ${item}`);
    if (order) lines.push(`Order: ${order}`);
    lines.push('');
    lines.push('Please let me know what happens next. Thank you.');
    return lines.join('\n');
  }, [searchParams]);

  useEffect(() => {
    if (!selectedId) return;
    const draft = prefillText();
    if (!draft) return;
    if (prefillRef.current === `${selectedId}|${draft}`) return;
    prefillRef.current = `${selectedId}|${draft}`;
    setInput((cur) => (cur && cur.trim() ? cur : draft));
  }, [selectedId, prefillText]);

  /* ─── auto-scroll ─── */  useEffect(() => {
    if (messages.length > prevConvoCountRef.current) {
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
    }
    prevConvoCountRef.current = messages.length;
  }, [messages]);

  /* ─── keyboard shortcut: Enter to send ─── */
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /* ─── derived data ─── */
  const totalUnread = conversations.reduce((s, c) => s + (c.unread_count || 0), 0);

  /* ═══════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════ */
  return (
    <div className="messages-root" style={styles.root}>
      {/* ── Left panel: conversation list ── */}
      <aside className="messages-sidebar" style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <h2 style={styles.sidebarTitle}>Messages{totalUnread > 0 ? ` (${totalUnread})` : ''}</h2>
        </div>

        {loadingConvos ? (
          <div style={styles.centerState}>Loading conversations…</div>
        ) : conversations.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>✉</div>
            <p style={styles.emptyText}>No conversations yet</p>
            <p style={styles.emptySubtext}>
              {role === 'seller'
                ? 'Messages from buyers will appear here.'
                : 'Start a conversation with a seller from an auction page.'}
            </p>
          </div>
        ) : (
          <ul style={styles.convoList}>
            {conversations.map((c) => {
              const isActive = c.partner_id === selectedId;
              const partnerName =
                c.partner_name || c.partner_email || 'Unknown User';
              return (
                <li
                  key={c.partner_id}
                  style={{
                    ...styles.convoItem,
                    ...(isActive ? styles.convoItemActive : {}),
                  }}
                  onClick={() => setSelectedId(c.partner_id)}
                >
                  <div style={styles.convoAvatar}>
                    {partnerName.charAt(0).toUpperCase()}
                  </div>
                  <div style={styles.convoBody}>
                    <div style={styles.convoTopRow}>
                      <span
                        style={{
                          ...styles.convoName,
                          ...(c.unread_count > 0 ? { fontWeight: 800 } : {}),
                        }}
                      >
                        {partnerName}
                      </span>
                      <span style={styles.convoTime}>{formatTime(c.last_message_at)}</span>
                    </div>
                    <div style={styles.convoPreview}>
                      <span
                        style={{
                          ...(c.unread_count > 0 ? { color: NAVY, fontWeight: 600 } : {}),
                        }}
                      >
                        {truncate(c.last_message)}
                      </span>
                      {c.unread_count > 0 && (
                        <span style={styles.badge}>{c.unread_count > 9 ? '9+' : c.unread_count}</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* ── Right panel: message thread ── */}
      <main className="messages-thread" style={styles.threadPanel}>
        {!selectedId ? (
          <div style={{ ...styles.centerState, ...styles.threadEmpty }}>
            <div style={styles.emptyIcon}>💬</div>
            <p style={styles.emptyText}>Select a conversation</p>
            <p style={styles.emptySubtext}>Choose from the list to start messaging</p>
          </div>
        ) : loadingMessages && messages.length === 0 ? (
          <div style={styles.centerState}>Loading messages…</div>
        ) : (
          <>
            {/* messages */}
            <div ref={threadRef} style={styles.threadScroll}>
              {messages.length === 0 && (
                <div style={{ ...styles.centerState, flex: 1 }}>
                  <p style={styles.emptyText}>No messages yet</p>
                  <p style={styles.emptySubtext}>Send the first message below</p>
                </div>
              )}
              {messages.map((m, i) => {
                const isMine =
                  m.sender_id === myId ||
                  m.sender === myId;
                return (
                  <div
                    key={m.id || i}
                    style={{
                      ...styles.bubbleRow,
                      justifyContent: isMine ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        ...styles.bubble,
                        ...(isMine ? styles.bubbleMine : styles.bubbleTheirs),
                      }}
                    >
                      <p style={styles.bubbleText}>{m.message}</p>
                      <span style={styles.bubbleTime}>{formatTime(m.created_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* input bar */}
            <div style={styles.inputBar}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message…"
                rows={1}
                style={styles.textarea}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || sending}
                style={{
                  ...styles.sendBtn,
                  opacity: input.trim() && !sending ? 1 : 0.5,
                }}
                aria-label="Send message"
              >
                {sending ? '…' : '➤'}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Inline styles
   ═══════════════════════════════════════════════════════════════ */
const styles = {
  root: {
    display: 'flex',
    height: '100%',
    minHeight: 0,
    background: CREAM,
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
  },

  /* sidebar */
  sidebar: {
    width: 340,
    minWidth: 280,
    maxWidth: 380,
    borderRight: `1px solid ${BORDER}`,
    display: 'flex',
    flexDirection: 'column',
    background: '#fff',
    overflow: 'hidden',
  },
  sidebarHeader: {
    padding: '20px 20px 14px',
    borderBottom: `1px solid ${BORDER}`,
  },
  sidebarTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: NAVY,
  },
  convoList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    overflowY: 'auto',
    flex: 1,
  },
  convoItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 20px',
    cursor: 'pointer',
    borderBottom: `1px solid ${WARM_BG}`,
    transition: 'background .12s',
  },
  convoItemActive: {
    background: WARM_BG,
  },
  convoAvatar: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: GOLD,
    color: NAVY,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 16,
    flexShrink: 0,
  },
  convoBody: {
    flex: 1,
    minWidth: 0,
  },
  convoTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 4,
  },
  convoName: {
    fontSize: 14,
    color: NAVY,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  convoTime: {
    fontSize: 11,
    color: MUTED,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  convoPreview: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: MUTED,
  },
  badge: {
    background: GOLD,
    color: NAVY,
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 800,
    minWidth: 18,
    height: 18,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 5px',
    flexShrink: 0,
  },

  /* thread panel */
  threadPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    background: WARM_BG,
  },
  threadScroll: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },

  /* bubbles */
  bubbleRow: {
    display: 'flex',
  },
  bubble: {
    maxWidth: 420,
    padding: '10px 14px',
    borderRadius: 14,
    fontSize: 14,
    lineHeight: 1.45,
    wordBreak: 'break-word',
  },
  bubbleMine: {
    background: NAVY,
    color: '#fff',
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    background: '#fff',
    color: TEXT,
    border: `1px solid ${BORDER}`,
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    margin: 0,
  },
  bubbleTime: {
    display: 'block',
    fontSize: 10,
    marginTop: 4,
    opacity: 0.6,
    textAlign: 'right',
  },

  /* input bar */
  inputBar: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 10,
    padding: '14px 24px',
    borderTop: `1px solid ${BORDER}`,
    background: '#fff',
  },
  textarea: {
    flex: 1,
    resize: 'none',
    border: `1px solid ${BORDER}`,
    borderRadius: 12,
    padding: '10px 14px',
    fontSize: 14,
    lineHeight: 1.45,
    outline: 'none',
    fontFamily: 'inherit',
    color: TEXT,
    background: CREAM,
    maxHeight: 120,
    minHeight: 42,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: '50%',
    border: 'none',
    background: NAVY,
    color: '#fff',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'opacity .15s',
  },

  /* states */
  centerState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
    color: MUTED,
    fontSize: 14,
  },
  threadEmpty: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 24px',
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 12,
    opacity: 0.4,
  },
  emptyText: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    color: NAVY,
  },
  emptySubtext: {
    margin: '4px 0 0',
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
  },
};
