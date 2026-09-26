// frontend/src/shared/hooks/useChatbot.js
// Role-aware + Groq AI primary (via backend /chat), KB as fallback
// Now with: localStorage persistence per user, clearHistory, natural follow-up suggestions
import { useState, useCallback, useEffect, useRef } from 'react';

const KB_CUSTOMER = [
  { keys: ['bid', 'how to bid', 'place a bid'], a: 'To bid: open any live auction, tap Place Bid, and enter an amount above the current bid.' },
  { keys: ['branch', 'location', 'nearest', 'pickup'], a: 'Find the nearest ATANY branch on the GPS locator page — it shows live distance.' },
  { keys: ['hour', 'open', 'close'], a: 'Most branches are Mon–Sat 9am–6pm. Check the branch locator for exact hours.' },
  { keys: ['payment', 'pay', 'refund'], a: 'Payment link + pickup instructions arrive by notification. Refunds in 3–5 business days.' },
  { keys: ['account', 'sign up', 'login', 'password'], a: 'Create an account from sign-up, or reset via Forgot password on sign-in.' },
  { keys: ['authentic', 'certificate', 'karat'], a: 'Every piece is inspected and comes with a karat/weight certificate.' },
  { keys: ['human', 'agent', 'support'], a: 'Flagged for our team — someone will follow up shortly.' },
];

const KB_SELLER = [
  { keys: ['submit', 'list item', 'new item', 'create listing'], a: "To submit a new item: go to My Listings → Submit New Item, fill in Item Name, Category, Karat/Weight, Starting Price, Auction Start/End, Photo, and Description, then Submit for Review. It's usually reviewed within 1 business day." },
  { keys: ['how long', 'approval', 'review take', 'pending'], a: "New listings are reviewed by ATANY admins before going live — usually within 1 business day. You'll get a notification when it's approved or if it needs changes." },
  { keys: ['schedule', 'auction time', 'duration', 'when live', 'start time', 'end time'], a: "When you submit, you propose an Auction Start and End time — Duration is auto-calculated as End − Start. On approval, admin confirms your schedule; the auction goes live at your start time." },
  { keys: ['payout', 'paid', 'when paid', 'commission', '90%', 'earnings'], a: "Your payout is 90% of the sale amount (10% platform commission). Sales show as Processing until an admin marks the transaction Paid Out on Admin → Transactions, then it's sent to your Payout Method (bank/e-wallet in Shop Profile) in 1–2 business days." },
  { keys: ['edit', 'resubmit', 'rejected', 'declined'], a: "If your listing was rejected, find it in My Listings with status Rejected, click Edit & Resubmit, update the pre-filled form, and Save & Resubmit — it goes back to pending for re-review." },
  { keys: ['sales', 'history', 'where sales', 'my sales'], a: "Check Sales & Payouts for your shop's completed sales — it lists only your shop's won items with Order ID TXN-..., Sale Amount, Your Payout, and Status." },
  { keys: ['human', 'agent', 'support'], a: 'Flagged for our team — someone will follow up shortly.' },
];

function getRuleReply(text, mode = 'customer') {
  const KB = mode === 'seller' ? KB_SELLER : KB_CUSTOMER;
  const q = text.toLowerCase();
  for (const e of KB) if (e.keys.some((k) => q.includes(k))) return e.a;
  return null;
}

function getStorageKey(mode, userId) {
  const scope = userId || 'guest';
  return `atany_chat_${mode}_${scope}`;
}

function loadMessages(mode, userId) {
  try {
    const raw = localStorage.getItem(getStorageKey(mode, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return null;
}

function saveMessages(mode, userId, messages) {
  try {
    localStorage.setItem(getStorageKey(mode, userId), JSON.stringify(messages));
  } catch {}
}

export function useChatbot(mode = 'customer', userId = null) {
  const initialText = mode === 'seller'
    ? "Hi! I'm the ATANY seller assistant. Ask me about submitting items, approval times, scheduling, payouts, or your sales."
    : "Hi! I'm the ATANY assistant. Ask me about bidding, branches, payments, or your account.";

  const initialMessages = [{ who: 'bot', text: initialText, suggestions: [] }];

  const [messages, setMessages] = useState(() => {
    const saved = loadMessages(mode, userId);
    return saved || initialMessages;
  });
  const [loading, setLoading] = useState(false);
  const didRestore = useRef(false);

  // Persist messages to localStorage whenever they change (skip first render if loaded from storage)
  useEffect(() => {
    if (!didRestore.current) {
      didRestore.current = true;
      return;
    }
    saveMessages(mode, userId, messages);
  }, [messages, mode, userId]);

  const clearHistory = useCallback(() => {
    try { localStorage.removeItem(getStorageKey(mode, userId)); } catch {}
    setMessages([...initialMessages]);
  }, [mode, userId]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim()) return;
    const userMsg = { who: 'user', text, suggestions: [] };
    setMessages((m) => [...m, userMsg]);
    setLoading(true);

    // Build history for context (last 8 messages, enough for good follow-ups)
    const history = [...messages, userMsg].slice(-8).map(m => ({ role: m.who === 'user' ? 'user' : 'assistant', content: m.text }));

    try {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:4000';
      const res = await fetch(`${base}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // userId lets the server attribute this turn to the caller's chatbot session
        // (validated server-side; guests send null). No change to local history behavior.
        body: JSON.stringify({ message: text, query: text, history, mode, userId: userId || null }),
      });
      if (res.ok) {
        const data = await res.json();
        let reply = data.reply || data.response;
        let suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
        // Safety net: if suggestions block leaked into reply text, strip and parse it
        if (reply && reply.includes('---SUGGESTIONS---')) {
          const sugMatch = reply.match(/[\s\n]*---SUGGESTIONS---[\s\n]*(\[[\s\S]*?\])\s*$/);
          if (sugMatch) {
            reply = reply.slice(0, sugMatch.index).trim();
            try {
              const parsed = JSON.parse(sugMatch[1]);
              if (Array.isArray(parsed)) suggestions = parsed.filter(s => typeof s === 'string' && s.trim()).slice(0, 3);
            } catch {}
          } else {
            reply = reply.replace(/[\s\n]*---SUGGESTIONS---[\s\S]*$/, '').trim();
          }
        }
        if (reply) {
          setMessages((m) => [...m, { who: 'bot', text: reply, suggestions }]);
          setLoading(false);
          return;
        }
      }
    } catch (e) {
      console.warn('Chat backend failed, falling back to KB', e);
    }

    // Fallback to rule KB
    const rule = getRuleReply(text, mode);
    const fallback = rule || (mode === 'seller'
      ? "I'm not fully sure about that one yet — I've noted your question for our team. In the meantime, try asking about submitting listings, payouts, or your sales."
      : "I'm not fully sure about that one yet — I've noted your question for our team. In the meantime, try asking about bidding, branches, payments, or your account.");
    setTimeout(() => {
      setMessages((m) => [...m, { who: 'bot', text: fallback, suggestions: [] }]);
      setLoading(false);
    }, 380);
  }, [messages, mode, userId]);

  const quickReplies = mode === 'seller'
    ? ['How do I submit an item?', 'How long does approval take?', 'When do I get paid?', 'Edit a rejected item?']
    : ['How do I bid?', 'Find a branch', 'Payment & pickup', 'Talk to a human'];

  return { messages, sendMessage, quickReplies, loading, mode, clearHistory };
}
