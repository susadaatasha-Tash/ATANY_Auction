// frontend/src/shared/hooks/useChatbot.js
// Role-aware + Groq AI primary (via backend /chat), KB as fallback
// Now with: localStorage persistence per user, clearHistory, contextual follow-up suggestions
// Static quick replies ONLY at conversation beginning; backend suggestions take over after.
import { useState, useCallback, useEffect, useRef } from 'react';
import { SUPPORT_EMAIL } from '../config/support';

const SUPPORT_EMAIL_LINE = `You can reach ATANY Support through the Contact form or email us directly at ${SUPPORT_EMAIL}.`;

const KB_CUSTOMER = [
  { keys: ['bid', 'how to bid', 'place a bid'], a: 'To bid: open any live auction, tap Place Bid, and enter an amount above the current bid.', s: ["How do I know if I won?", "What happens if I'm outbid?", "How does the minimum bid work?"] },
  { keys: ['branch', 'location', 'nearest', 'pickup'], a: 'Find the nearest ATANY branch on the GPS locator page — it shows live distance.', s: ["Which branch is nearest to me?", "What are the branch hours?", "What should I bring for pickup?"] },
  { keys: ['hour', 'open', 'close'], a: 'Most branches are Mon–Sat 9am–6pm. Check the branch locator for exact hours.', s: ["Which branch is nearest to me?", "What should I bring for pickup?"] },
  { keys: ['payment', 'pay', 'refund'], a: 'Payment link + pickup instructions arrive by notification. Refunds in 3–5 business days.', s: ["How long do I have to pay?", "What payment methods are available?", "What happens if I miss the deadline?"] },
  { keys: ['account', 'sign up', 'login', 'password'], a: 'Create an account from sign-up, or reset via Forgot password on sign-in.', s: ["How do I update my profile?", "How do I reset my password?", "How can I contact ATANY Support?"] },
  { keys: ['authentic', 'certificate', 'karat'], a: 'Every piece is inspected and comes with a karat/weight certificate.', s: ["How do I bid?", "How do I know if I won?"] },
  { keys: ['human', 'agent', 'support'], a: SUPPORT_EMAIL_LINE, s: ["How do I use the Contact form?", "What should I include in my support message?", "How long does support take to respond?"] },
];

const KB_SELLER = [
  { keys: ['submit', 'list item', 'new item', 'create listing'], a: "To submit a new item: go to My Listings → Submit New Item, fill in Item Name, Category, Karat/Weight, Starting Price, Auction Start/End, Photo, and Description, then Submit for Review. It's usually reviewed within 1 business day.", s: ["How do I schedule auction times?", "What happens after my item is approved?", "How do seller earnings work?"] },
  { keys: ['how long', 'approval', 'review take', 'pending'], a: "New listings are reviewed by ATANY admins before going live — usually within 1 business day. You'll get a notification when it's approved or if it needs changes.", s: ["How do I edit a rejected listing?", "What can I list for auction?", "How do seller earnings work?"] },
  { keys: ['schedule', 'auction time', 'duration', 'when live', 'start time', 'end time'], a: "When you submit, you propose an Auction Start and End time — Duration is auto-calculated as End − Start. On approval, admin confirms your schedule; the auction goes live at your start time.", s: ["When does my auction go live?", "How do I pause or resume an auction?", "How do seller earnings work?"] },
  { keys: ['payout', 'paid', 'when paid', 'commission', '90%', 'earnings'], a: "Seller earnings are 90% of the sale amount after the 10% platform commission. Sales show as Processing until recognized in Sales & Payouts — ATANY does not record actual money transfers until a real disbursement exists.", s: ["Where do I see my earnings history?", "How is the 10% commission calculated?", "How do I manage my auction?"] },
  { keys: ['edit', 'resubmit', 'rejected', 'declined'], a: "If your listing was rejected, find it in My Listings with status Rejected, click Edit & Resubmit, update the pre-filled form, and Save & Resubmit — it goes back to pending for re-review.", s: ["How do I submit a new item?", "What can I list for auction?", "How do seller earnings work?"] },
  { keys: ['sales', 'history', 'where sales', 'my sales'], a: "Check Sales & Payouts for your shop's completed sales — it lists only your shop's won items with Order ID TXN-..., Sale Amount, Your Payout, and Status.", s: ["How is the 10% commission calculated?", "Where do I see my earnings history?", "How do I manage my auction?"] },
  { keys: ['human', 'agent', 'support'], a: SUPPORT_EMAIL_LINE, s: ["How do I use the Contact form?", "What should I include in my support message?", "How do seller earnings work?"] },
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
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Sanitize: drop any saved bot messages with empty/null text so old
      // broken localStorage entries never render as blank bubbles.
      const sanitized = parsed.filter((m) =>
        m &&
        (m.who === 'user' || m.who === 'bot') &&
        typeof m.text === 'string' &&
        m.text.trim().length > 0
      );
      return sanitized.length > 0 ? sanitized : null;
    }
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
    ? "Hi! I'm the ATANY seller assistant. I can help with listings, auctions, earnings, subscriptions, and your shop. What would you like help with?"
    : "Hi! I'm the ATANY Assistant. I can help with auctions, bidding, payments, pickup, branches, or your account. What can I help you with today?";

  const initialSuggestions = mode === 'seller'
    ? ['How do I create a listing?', 'How do I manage my auction?', 'How do seller earnings work?']
    : ['How do I bid?', 'How do payments and pickup work?', 'Find an ATANY branch'];

  const initialMessages = [{ who: 'bot', text: initialText, suggestions: initialSuggestions }];

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

  let inFlightId = 0;

  const sendMessage = useCallback(async (text) => {
    if (!text.trim()) return;
    const userMsg = { who: 'user', text, suggestions: [] };
    setMessages((m) => [...m, userMsg]);
    setLoading(true);

    // Build history for context (last 12 messages, enough for good follow-ups)
    const history = [...messages, userMsg].slice(-12).map(m => ({ role: m.who === 'user' ? 'user' : 'assistant', content: m.text }));

    // Track recently shown suggestions to avoid immediate duplication.
    const recentSuggestions = messages
      .filter((m) => m.who === 'bot' && Array.isArray(m.suggestions))
      .flatMap((m) => m.suggestions)
      .slice(-6);

    // Request deduplication: cancel any previous in-flight request.
    const requestId = ++inFlightId;

    try {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:4000';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const res = await fetch(`${base}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, query: text, history, mode, userId: userId || null, recentSuggestions }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // If a newer request has superseded this one, ignore the result.
      if (requestId !== inFlightId) return;

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
        // Normalize and guard against empty replies — never append a blank bot bubble.
        const normalizedReply = typeof reply === 'string' ? reply.trim() : '';
        if (normalizedReply.length > 0) {
          setMessages((m) => [...m, { who: 'bot', text: normalizedReply, suggestions, conversation_state: data.conversation_state }]);
        } else {
          // Empty reply → fall through to rule KB fallback below.
          throw new Error('empty reply');
        }
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      // If a newer request superseded this one, ignore.
      if (requestId !== inFlightId) return;
      console.warn('Chat backend failed, falling back to KB', e);
    } finally {
      // If a newer request superseded this one, ignore.
      if (requestId !== inFlightId) return;
      setLoading(false);
    }

    // Fallback to rule KB — conversational with suggestions. Never uses false
    // escalation language ("noted for our team") unless an actual escalation
    // was executed.
    const rule = getRuleReply(text, mode);
    const fallback = rule || (mode === 'seller'
      ? { a: "I'm not fully sure about that one yet. In the meantime, try asking about submitting listings, payouts, or your sales.", s: ["How do I submit a new item?", "What happens after my item is approved?", "How do seller earnings work?"] }
      : { a: "I can still help with ATANY. You can ask me about bidding, winning an auction, payments, pickup, branches, or your account.", s: ["How do I bid?", "How does payment work?", "Where can I pick up my jewelry?"] });
    setMessages((m) => [...m, { who: 'bot', text: fallback.a, suggestions: fallback.s, conversation_state: 'ongoing' }]);
  }, [messages, mode, userId, inFlightId]);

  return { messages, sendMessage, loading, mode, clearHistory };
}
