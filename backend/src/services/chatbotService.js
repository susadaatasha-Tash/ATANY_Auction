// backend/src/services/chatbotService.js
// Spec 4.8: Groq AI is primary, rule KB is fallback — key never in frontend per spec 5.6
// Role-aware (customer vs seller), history-aware, warm conversational tone.
// Conversational: continues until the customer clearly signals they are finished.
import { pool } from '../db/pool.js';
import { OFFICIAL_SUPPORT_EMAIL } from '../config/support.js';

const SUPPORT_EMAIL_LINE = `You can reach ATANY Support through the Contact form or email us directly at ${OFFICIAL_SUPPORT_EMAIL}.`;

const KB_CUSTOMER = [
  { keys: ['bid', 'how to bid', 'place a bid', 'auction work'], a: "To place a bid: open any live auction in **[Auctions](/customer/auctions)**, enter an amount above the current bid using the ₱2,000+ controls, and press **Place Bid**. You'll get an outbid alert if someone tops you.", s: ["How do I know if I won?", "What happens if I'm outbid?", "How does the minimum bid work?"] },
  { keys: ['branch', 'location', 'nearest', 'gps', 'pickup', 'pick up', 'claim'], a: 'You can find and get directions to the nearest ATANY branch on our Branch Locator page — it also shows live distance from you.', s: ["Which branch is nearest to me?", "What are the branch hours?", "What should I bring for pickup?"] },
  { keys: ['hour', 'open', 'close', 'time'], a: 'Branch hours vary by location — most are open Mon–Sat, 9am–6pm. Check the branch locator for exact hours near you.', s: ["Which branch is nearest to me?", "What should I bring for pickup?"] },
  { keys: ['payment', 'pay', 'refund', 'transaction'], a: "Once you win an auction, you'll get a payment link and pickup instructions by notification. Refunds for cancelled orders are processed within 3–5 business days.", s: ["How long do I have to pay?", "What payment methods are available?", "What happens if I miss the deadline?"] },
  { keys: ['account', 'sign up', 'register', 'login', 'password'], a: 'You can create an account from the sign-up page, or reset your password from the sign-in screen using "Forgot password?".', s: ["How do I update my profile?", "How do I reset my password?", "How can I contact ATANY Support?"] },
  { keys: ['authentic', 'real', 'certificate', 'karat', 'genuine'], a: 'Every ATANY piece is inspected and comes with a karat/weight certificate shown on its listing page.', s: ["How do I bid?", "How do I know if I won?"] },
  { keys: ['human', 'agent', 'support', 'talk to someone', 'representative'], a: SUPPORT_EMAIL_LINE, s: ["How do I use the Contact form?", "What should I include in my support message?", "How long does support take to respond?"] },
];

const KB_SELLER = [
  { keys: ['submit', 'list item', 'new item', 'create listing'], a: "To submit a new item: go to **[My Listings](/shop/listings)** → **Submit New Item**, fill in Item Name, Category, Karat/Weight, Starting Price, Auction Start/End, Photo, and Description, then Submit for Review. It's usually reviewed within 1 business day.", s: ["How do I schedule auction times?", "What happens after my item is approved?", "How do seller earnings work?"] },
  { keys: ['how long', 'approval', 'review take', 'pending'], a: "New listings are reviewed by ATANY admins before going live — usually within 1 business day. You'll get a notification when it's approved or if it needs changes.", s: ["How do I edit a rejected listing?", "What can I list for auction?", "How do seller earnings work?"] },
  { keys: ['schedule', 'auction time', 'duration', 'when live', 'start time', 'end time'], a: "When you submit, you propose an Auction Start and End time — Duration is auto-calculated as End − Start. On approval, admin confirms your schedule; the auction goes live at your start time and Live Auctions shows the countdown from your end_time.", s: ["When does my auction go live?", "How do I pause or resume an auction?", "How do seller earnings work?"] },
  { keys: ['payout', 'paid', 'when paid', 'commission', '90%', 'earnings'], a: "Seller earnings are 90% of the sale amount after the 10% platform commission. Sales show as **Processing** until recognized in **[Sales & Payouts](/shop/sales)** — ATANY does not record actual money transfers until a real disbursement exists.", s: ["Where do I see my earnings history?", "How is the 10% commission calculated?", "How do I manage my auction?"] },
  { keys: ['edit', 'resubmit', 'rejected', 'declined'], a: "If your listing was rejected, find it in **[My Listings](/shop/listings)** with status Rejected, click **Edit & Resubmit**, update the pre-filled form, and **Save & Resubmit** — it goes back to pending for re-review.", s: ["How do I submit a new item?", "What can I list for auction?", "How do seller earnings work?"] },
  { keys: ['sales', 'history', 'where sales', 'my sales'], a: "Check **[Sales & Payouts](/shop/sales)** for your shop's recognized sales — it lists only your items that were won, with Order ID TXN-..., Gross Sale, ATANY Commission, Net Earnings, and Status.", s: ["How is the 10% commission calculated?", "Where do I see my earnings history?", "How do I manage my auction?"] },
  { keys: ['human', 'agent', 'support', 'talk to someone', 'representative'], a: SUPPORT_EMAIL_LINE, s: ["How do I use the Contact form?", "What should I include in my support message?", "How do seller earnings work?"] },
];

function getRuleReply(text, mode = 'customer') {
  const KB = mode === 'seller' ? KB_SELLER : KB_CUSTOMER;
  const q = text.toLowerCase();
  for (const e of KB) if (e.keys.some((k) => q.includes(k))) return e;
  return null;
}

// ── Deterministic conversation-state detection ──────────────────────────────

// Standalone phrases that, when they are the ENTIRE user message, signal
// the customer is finished. These must NOT close when paired with a
// continuing request (e.g. "Okay, how do I pay?" stays ongoing).
const CLOSE_PHRASES = [
  'thank you', 'thanks', 'thankyou', 'thank u',
  'okay', 'ok', 'okey',
  'got it', 'understood',
  "that's all", "that is all", "thats all",
  "i'm good", "im good", "good",
  "i'm done", "im done", "done",
  "solved",
  "no more questions", "no more question",
  "bye", "goodbye", "see you",
  "salamat", "salamat kaayo", "maraming salamat",
];

// Continuation indicators: if ANY of these appear, treat as an ongoing
// request even if a closing phrase is also present.
const CONTINUE_INDICATORS = [
  '?', 'how', 'what', 'why', 'where', 'when', 'can', 'could', 'would',
  'but', 'still', 'another', 'also', 'next', 'then', 'and', 'please',
  'help me', 'i need', 'i want', 'i dont', "i don't", 'i did', 'still',
];

// Deterministic greetings — these must always get a friendly response
// even when Groq is unavailable, so the chatbot never shows
// "AI temporarily unavailable" for a simple "hi".
const GREETINGS = [
  'hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening',
  'kumusta', 'hello po', 'hi po', 'good day', 'greetings',
];

function isGreeting(message) {
  const norm = normalizeText(message);
  return GREETINGS.some((g) => norm === g || norm.startsWith(g + ' '));
}

function normalizeText(m) {
  return String(m || '')
    .toLowerCase()
    .trim()
    .replace(/[.!?,;:]+$/, '')
    .replace(/\s+/g, ' ');
}

/**
 * Deterministically detect the conversation state from the user message.
 * Returns 'closed' | 'ongoing' | 'needs_clarification' | null (let model decide).
 */
export function detectConversationState(message) {
  const norm = normalizeText(message);
  if (!norm) return null;

  // A standalone greeting is always ongoing — it starts a conversation.
  if (isGreeting(norm)) return 'ongoing';

  const hasClose = CLOSE_PHRASES.some((p) => norm === p || norm.startsWith(p + ' ') || norm.endsWith(' ' + p));
  const hasContinue = CONTINUE_INDICATORS.some((ind) => norm.includes(ind));

  // Standalone short closing phrase with no continuation → closed.
  if (hasClose && !hasContinue && norm.length <= 60) {
    return 'closed';
  }
  // Continuation indicators present → ongoing.
  if (hasContinue) {
    return 'ongoing';
  }
  // Truly unclear / very short non-question → clarification.
  if (norm.length <= 3) return 'needs_clarification';
  return null; // let Groq decide
}

// Greeting response — always works offline, never depends on Groq.
const GREETING_REPLY =
  "Hi! I'm the ATANY Assistant. How can I help you today?";
const GREETING_SUGGESTIONS = [
  'How do I bid?',
  'How do payments and pickup work?',
  'Find an ATANY branch',
];

// Guarantee a non-empty reply at every return path.
function nonEmptyReply(reply, fallback) {
  const cleaned = typeof reply === 'string' ? reply.trim() : '';
  return cleaned.length > 0 ? cleaned : fallback;
}

// ── Support metadata whitelist (no secrets) ─────────────────────────────────

const ALLOWED_METADATA_KEYS = [
  'plan', 'plan_name', 'billing_reference', 'payment_status', 'provider',
  'reference_id', 'item', 'auction', 'transaction_code',
  'expired_payment_deadline', 'winning_amount', 'role',
];
const FORBIDDEN_METADATA = /(secret|api[_-]?key|password|passcode|cvc|cvv|\bpan\b|card[_-]?number|signature|authorization|bearer|token)/i;

export function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const out = {};
  for (const key of ALLOWED_METADATA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(metadata, key)) continue;
    const value = metadata[key];
    if (value === undefined || value === null || value === '') continue;
    const str = String(value);
    if (FORBIDDEN_METADATA.test(key) || FORBIDDEN_METADATA.test(str)) continue;
    out[key] = str.slice(0, 200);
  }
  return Object.keys(out).length ? out : null;
}

// ── Branch context (DB-driven, never hardcoded) ─────────────────────────────

const BRANCH_CONTEXT_PLACEHOLDER = '__BRANCH_CONTEXT__';

const BRANCH_UNAVAILABLE = `
BRANCH INFORMATION TEMPORARILY UNAVAILABLE:
The current branch records could not be loaded. If the user asks about branches, locations, or pickup, reply with exactly this message (plus a link to the Branch Locator page): "I'm unable to retrieve the current branch information right now. Please check the Branch Locator for the latest ATANY branch details." Do not invent branch names, addresses, hours, or phone numbers.`;

async function getBranchContext() {
  try {
    const { rows } = await pool.query(
      "SELECT name, address, hours, phone FROM branches WHERE status = 'Open' ORDER BY name"
    );
    const lines = (rows || [])
      .filter((b) => b && b.name)
      .map((b, i) => {
        const parts = [b.name, b.address, b.hours, b.phone].filter((p) => p && String(p).trim());
        return `${i + 1}. ${parts.join(' — ')}`;
      });
    if (!lines.length) return null;
    return `REAL ATANY BRANCHES FROM DATABASE (quote these exactly — never invent branch names, addresses, or hours):\n${lines.join('\n')}`;
  } catch {
    return null;
  }
}

const LOCATION_SCOPE = `
ATANY LOCATION SCOPE (STRICT):
ATANY operates in Davao City, Philippines. When discussing ATANY branches, locations, store availability, branch services, auctions, purchases, or customer assistance, only provide information supported by ATANY's Davao City data. Do not recommend, invent, or refer users to Manila or other cities as ATANY locations.
If a user asks whether ATANY has a branch in Manila or another city, politely explain that ATANY's supported branch locations are in Davao City, then share the actual available Davao City branch information.
Do not mention Davao City unnecessarily when answering general questions unrelated to location.`;

const UI_ELEMENTS = `
REAL UI ELEMENTS (USE ONLY THESE — DO NOT GUESS OR INVENT ICONS/BUTTONS):
- Watchlist/Favorite: HEART icon (♥) on each auction card — tap to toggle. NOT a star. NOT a bookmark.
- Notifications: BELL icon in the top bar — shows unread count badge.
- Chat assistant: SPEECH BUBBLE (💬) floating action button in the bottom-right corner.
- Branch Locator: page with search bar, "Use My Location" button, branch cards showing name/address/phone, and a map. Each branch card links to OpenStreetMap directions.
- Search: MAGNIFYING GLASS icon next to search fields.
- Pickup location: shown as text "Pickup at {branch name}" on auction cards (with 📍 prefix).
- Bid: "Place Bid" button on auction detail page.
- Menu: HAMBURGER (☰) icon in the top-left on mobile.
- Close/dismiss: × symbol.
- Send message: Arrow (➤) button in chat input.
When describing UI actions, only reference elements listed above. For branch navigation, say "visit the Branch Locator page" or "check the branch locator" — do NOT say "tap the pin icon" or invent navigation steps.`;

const REAL_ROUTES = `
REAL APP ROUTES (use ONLY these exact paths in inline markdown links — never invent URLs):
Public:
  / (Landing page), /login (Log In), /signup (Create Account), /branches (Branch Locator / Find a Branch)
Customer (logged in as customer):
  /customer (Dashboard), /customer/auctions (Auctions — Live + Scheduled), /customer/bids (My Bids),
  /customer/watchlist (My Watchlist), /customer/purchases (My Purchases), /customer/account (Profile)
  Compatibility: /customer/live redirects to /customer/auctions
Seller (logged in as shop owner):
  /shop (Dashboard), /shop/listings (My Listings), /shop/auctions (My Auctions),
  /shop/sales (Sales & Payouts), /shop/profile (Shop Profile)`;

const INLINE_LINK_FORMAT = `
INLINE NAVIGATION LINKS (IMPORTANT — weave into your response text):
When you mention a page, feature, or action the user can take, embed a clickable inline link directly into your sentence using markdown link syntax: [Link Text](/route).
The link text should be the natural name of the page or feature — the part of your sentence the user would tap.
- Do NOT list links as separate bullet points at the end. Weave them naturally into your answer.
- Use inline links when mentioning: a specific page, a feature the user can navigate to, or an action they should take.
- For multi-step processes, embed links in the relevant step (e.g. "Go to **[My Listings](/shop/listings)** and tap **Submit New Item**").
- For simple factual answers (hours, rates), you don't need links — just answer naturally.
- You can include 0-3 inline links per response. Don't over-link — only link when it genuinely helps the user navigate.
- IMPORTANT: link text must be natural and readable (e.g. [Notifications](/customer/notifications), not [click here](/customer/notifications)).
- IMPORTANT: Always use bold **around** the link for key UI references so the link stands out: **[My Listings](/shop/listings)**.

REAL ROUTES to use (same as listed above):
  /customer/auctions, /customer/bids, /customer/watchlist, /customer/purchases, /customer/account, /customer/notifications
  /shop/listings, /shop/auctions, /shop/sales, /shop/profile
  /branches, /login, /signup
  Compatibility alias: /customer/live → /customer/auctions

Example — "How do I know if I won?":
You'll get an outbid or win notification in your **[Notifications](/customer/notifications)**. You can also check your **[My Purchases](/customer/purchases)** page to see all orders and their status.

Example — "How do I submit a listing?":
Go to **[My Listings](/shop/listings)** from your dashboard, then tap **Submit New Item** and fill in the form.`;

// ── System prompts (conversational, context-aware) ─────────────────────────

const SYSTEM_PROMPT_CUSTOMER = `You are ATANY's helpful support assistant — warm, natural, conversational, accommodating, and patient. Use contractions and friendly phrasing. Speak like a real person helping a customer, not a stiff FAQ bot.

Scope strictly to ATANY's gold jewelry auction platform: bidding, listings/auctions, payments & pickup, branches, account. If asked outside scope (general knowledge, unrelated topics), politely decline and redirect to ATANY topics.

${BRANCH_CONTEXT_PLACEHOLDER}
${LOCATION_SCOPE}
Key facts to get right (don't hallucinate):
- Review: "usually within 1 business day" (from Submit New Item copy).
- Earnings: seller earnings are 90% of the sale amount after the 10% platform commission. Sales show as Processing until recognized; ATANY does not record actual money transfers until a real disbursement exists.
- Pickup-only, no delivery; bring valid government-issued ID to claim.
- Karat/weight certificate on each listing.
- Official support email: ${OFFICIAL_SUPPORT_EMAIL} — you may share this, but never promise a specific response time or that someone will follow up shortly unless an actual escalation was created.
${UI_ELEMENTS}
${REAL_ROUTES}
${INLINE_LINK_FORMAT}

CONVERSATION BEHAVIOR (MANDATORY):
- Answer the question fully, then OFFER 2-3 contextual follow-up suggestions the customer might want to ask next. A factual answer is NOT the end of the conversation.
- Suggestions must be phrased as real questions the customer might ask (e.g. "How do I know if I won?", "What happens if I miss the deadline?"). Never use generic labels like "Payment Information".
- Always suggest 2-3 items when meaningful follow-ups exist. Maximum 3.
- Remember the conversation context. If the user says "it", "that", "after that", "what next", resolve it from earlier turns.
- Continue until the user clearly signals they are finished (thank you, okay, bye, salamat, etc. as a standalone message).
- If the user seems confused ("I don't understand"), rephrase more simply rather than repeating.
- If the user says "that's not what I mean", acknowledge and ask ONE focused clarifying question with relevant suggestions.
- NEVER pretend a human agent or support ticket was created unless you actually did.
- NEVER invent branches, auctions, bids, orders, payment status, routes, or account info.

FORMATTING RULES:
- **Bold** for UI element names: button labels, menu items, page names (e.g. **My Listings**, **Place Bid**).
- For multi-step processes: start with a short bold intro line (e.g. **To place a bid:**), then use a numbered list. Each step = one short concise action. Embed inline links in relevant steps.
- Use bullet lists (- ) for non-sequential tips or options. Embed inline links when mentioning pages.
- For simple one-line factual answers, keep it as a natural sentence — do NOT force a list or links.
- Never use HTML tags. Only use: **bold**, numbered lists, bullet lists, [inline links](/route), and plain text.

RESPONSE STRUCTURE (MANDATORY — you must include ALL of these blocks, in order):
1) Your warm, conversational answer (markdown as above).
2) ---SUGGESTIONS---
   A JSON array of 0-3 short follow-up questions as strings. 2-3 when meaningful follow-ups exist; empty [] only when the conversation is clearly complete or closed.
3) ---STATE---
   One of: "ongoing" | "closed" | "needs_clarification".
   - "ongoing": normal conversation, customer still engaged.
   - "closed": customer clearly said thanks/bye/okay standalone with no continuing request. reply should be warm and appreciative; suggestions must be [].
   - "needs_clarification": you truly cannot tell what they need; ask ONE focused question.

Example of a normal ongoing answer:
**To place a bid:**
1. Open **[Auctions](/customer/auctions)**.
2. Select a live auction.
3. Enter a valid bid above the current bid.
4. Press **Place Bid**.

---SUGGESTIONS---
["How do I know if I won?", "What happens if I'm outbid?", "How does the minimum bid work?"]
---STATE---
ongoing

Example of a closed answer:
You're very welcome. I'm glad I could help.

---SUGGESTIONS---
[]
---STATE---
closed`;

const SYSTEM_PROMPT_SELLER = `You are ATANY's helpful support assistant for sellers — warm, natural, conversational, accommodating, and patient. Use contractions and friendly phrasing. Speak like a real person helping a seller, not a stiff FAQ bot.

Scope strictly to ATANY seller flows: submitting listings, admin review, auction scheduling, payouts/earnings, editing rejected items, sales history, branches, account/shop. If asked outside scope, politely redirect to seller topics.

${BRANCH_CONTEXT_PLACEHOLDER}
${LOCATION_SCOPE}
Key facts:
- Submit: My Listings → Submit New Item (Item Name, Category, Karat/Weight, Starting Price, Auction Start/End, Photo, Description) → pending.
- Review: usually within 1 business day.
- Scheduling: seller proposes Start/End, Duration auto-calculated as End − Start; admin confirms on approval; countdown is end_time - NOW().
- Earnings: seller earnings are 90% of the sale amount after the 10% platform commission. Sales show as Processing until recognized in Sales & Payouts — ATANY does not record actual money transfers until a real disbursement exists.
- Edit rejected: My Listings → Edit & Resubmit pre-filled form → Save & Resubmit → pending.
- Official support email: ${OFFICIAL_SUPPORT_EMAIL} — you may share this, but never promise a specific response time or that someone will follow up shortly unless an actual escalation was created.
${UI_ELEMENTS}
${REAL_ROUTES}
${INLINE_LINK_FORMAT}

CONVERSATION BEHAVIOR (MANDATORY):
- Answer the question fully, then OFFER 2-3 contextual follow-up suggestions the seller might want to ask next. A factual answer is NOT the end of the conversation.
- Suggestions must be phrased as real questions the seller might ask (e.g. "How do seller earnings work?", "What happens after my item is approved?"). Never use generic labels like "Payout Information".
- Always suggest 2-3 items when meaningful follow-ups exist. Maximum 3.
- Remember the conversation context. If the user says "it", "that", "after that", "what next", resolve it from earlier turns.
- Continue until the user clearly signals they are finished.
- If the user seems confused ("I don't understand"), rephrase more simply rather than repeating.
- NEVER promise actual money was transferred unless a real disbursement exists.
- NEVER invent branches, auctions, bids, orders, payment status, routes, or account info.

FORMATTING RULES:
- **Bold** for UI element names: button labels, menu items, page names (e.g. **My Listings**, **Submit New Item**, **Shop Profile**).
- For multi-step processes: start with a short bold intro line (e.g. **To submit a listing:**), then use a numbered list. Each step = one short concise action. Embed inline links in relevant steps.
- Use bullet lists (- ) for non-sequential tips or options. Embed inline links when mentioning pages.
- For simple one-line factual answers, keep it as a natural sentence — do NOT force a list or links.
- Never use HTML tags. Only use: **bold**, numbered lists, bullet lists, [inline links](/route), and plain text.

RESPONSE STRUCTURE (MANDATORY — you must include ALL of these blocks, in order):
1) Your warm, conversational answer (markdown as above).
2) ---SUGGESTIONS---
   A JSON array of 0-3 short follow-up questions as strings. 2-3 when meaningful follow-ups exist; empty [] only when the conversation is clearly complete or closed.
3) ---STATE---
   One of: "ongoing" | "closed" | "needs_clarification".

Example of a normal ongoing answer:
Go to **[My Listings](/shop/listings)** and tap **Submit New Item**. It's usually reviewed within 1 business day.

---SUGGESTIONS---
["How do I schedule auction times?", "What happens after my item is approved?", "How do seller earnings work?"]
---STATE---
ongoing

Example of a closed answer:
You're very welcome. I'm glad I could help.

---SUGGESTIONS---
[]
---STATE---
closed`;

// ── Message parsing ─────────────────────────────────────────────────────────

/** Parse Groq raw reply into { reply, suggestions, state }. */
function parseGroqReply(raw) {
  let reply = raw;
  let suggestions = [];
  let state = 'ongoing';

  const sugMatch = raw.match(/[\s\n]*---SUGGESTIONS---[\s\n]*(\[[\s\S]*?\])\s*$/);
  if (sugMatch) {
    reply = raw.slice(0, sugMatch.index).trim();
    try {
      const parsed = JSON.parse(sugMatch[1]);
      if (Array.isArray(parsed)) {
        suggestions = parsed.filter((s) => typeof s === 'string' && s.trim()).slice(0, 3);
      }
    } catch {}
  }

  const stateMatch = raw.match(/[\s\n]*---STATE---[\s\n]*(\w+)\s*$/);
  if (stateMatch) {
    const s = stateMatch[1].toLowerCase();
    if (s === 'closed' || s === 'ongoing' || s === 'needs_clarification') state = s;
  }

  return { reply, suggestions, state };
}

// ── Groq model ──────────────────────────────────────────────────────────────

const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

export async function chatbotReply(query, { userId, mode = 'customer', history = [], recentSuggestions = [] } = {}) {
  // Allow explicit mode override, otherwise infer from user role if available
  let effectiveMode = mode;
  if (userId && mode === 'customer') {
    try {
      const { rows } = await pool.query('SELECT role FROM public.users WHERE id=$1', [userId]);
      if (rows[0]?.role === 'shop_owner') effectiveMode = 'seller';
    } catch {}
  }

  // Deterministic state detection (never rely solely on Groq for closure).
  const detected = detectConversationState(query);

  // ── Greeting: always works offline, never depends on Groq. ──
  if (detected === 'ongoing' && isGreeting(normalizeText(query))) {
    return {
      source: 'greeting',
      reply: GREETING_REPLY,
      suggestions: GREETING_SUGGESTIONS,
      conversation_state: 'ongoing',
      mode: effectiveMode,
    };
  }

  // ── Closed detection: warm appreciation, no suggestions. ──
  if (detected === 'closed') {
    return {
      source: 'closed',
      reply: "You're very welcome. I'm glad I could help.",
      suggestions: [],
      conversation_state: 'closed',
      mode: effectiveMode,
    };
  }

  // ── Rule KB FIRST: deterministic topic answers before Groq. ──
  // Known topics (bid, pay, pickup, branch, etc.) always get a real answer
  // even when Groq is unavailable or returns garbage.
  const rule = getRuleReply(query, effectiveMode);
  if (rule) {
    return {
      source: 'rule',
      reply: nonEmptyReply(rule.a, null),
      suggestions: detected === 'closed' ? [] : (rule.s || []),
      conversation_state: detected === 'closed' ? 'closed' : 'ongoing',
      mode: effectiveMode,
    };
  }

  const groqKey = process.env.GROQ_API_KEY;

  // ── Groq: primary conversational AI, with a hard timeout. ──
  // Only used for topics not covered by the rule KB.
  if (groqKey) {
    // Branch context comes from the live branches table (same source as Branch
    // Locator). On failure the model gets the unavailable notice instead of stale
    // hardcoded branches — it must never invent locations.
    let branchContext;
    try {
      branchContext = await getBranchContext();
    } catch {
      branchContext = null;
    }
    branchContext = branchContext || BRANCH_UNAVAILABLE;
    const systemPrompt = (effectiveMode === 'seller' ? SYSTEM_PROMPT_SELLER : SYSTEM_PROMPT_CUSTOMER)
      .replace(BRANCH_CONTEXT_PLACEHOLDER, branchContext);

    // Build messages with history (last 10-12 messages) for context
    const historyMessages = (Array.isArray(history) ? history.slice(-12) : []).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content || m.text || '',
    })).filter((m) => m.content);

    // Add a context hint to the user message when deterministic state detected
    const contextHint = detected
      ? `\n\n[SYSTEM CONTEXT: detected user intent is "${detected}". Respond accordingly: closed means warm appreciation with no suggestions; ongoing means answer and suggest 2-3 follow-ups; needs_clarification means ask one focused question.]`
      : '';

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            ...historyMessages,
            { role: 'user', content: query + contextHint },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || `Groq ${res.status}`);
      const rawReply = data.choices?.[0]?.message?.content || '';
      const parsed = parseGroqReply(rawReply);
      const groqReply = nonEmptyReply(parsed.reply, null);
      if (groqReply) {
        // If deterministic detection says closed, override model state and clear suggestions.
        let finalState = parsed.state;
        let finalSuggestions = parsed.suggestions;
        if (detected === 'closed') {
          finalState = 'closed';
          finalSuggestions = [];
        } else if (detected === 'ongoing') {
          finalState = 'ongoing';
        } else if (detected === 'needs_clarification') {
          finalState = 'needs_clarification';
        }

        // Avoid immediately repeating recently shown suggestions.
        const recentSet = new Set((recentSuggestions || []).map((s) => s.toLowerCase().trim()));
        finalSuggestions = finalSuggestions.filter((s) => !recentSet.has(s.toLowerCase().trim()));

        // Flag human escalation if needed (truthful: never promise follow-up unless escalation executed).
        if (['human', 'agent', 'support'].some((k) => query.toLowerCase().includes(k)) && userId) {
          await pool.query("INSERT INTO notifications (user_id, type, message) VALUES ($1,'chatbot','Human escalation flagged — staff will follow up')", [userId]).catch(() => {});
        }

        return {
          source: 'groq',
          reply: groqReply,
          suggestions: finalSuggestions,
          conversation_state: finalState,
          mode: effectiveMode,
        };
      }
      // Groq returned usable HTTP but empty/unparseable content → fall through to rule fallback.
      console.error('Groq returned empty content');
    } catch (e) {
      console.error('Groq error', e.message);
      // Fall through to rule KB below.
    }
  }

  // ── Final safety fallback: never blank, never false escalation language. ──
  const safetyFallback = detected === 'closed'
    ? "You're very welcome. I'm glad I could help."
    : "I can still help with ATANY. You can ask me about bidding, winning an auction, payments, pickup, branches, or your account.";
  return {
    source: 'safety',
    reply: safetyFallback,
    suggestions: detected === 'closed' ? [] : ["How do I bid?", "How does payment work?", "Where can I pick up my jewelry?"],
    conversation_state: detected === 'closed' ? 'closed' : 'ongoing',
    mode: effectiveMode,
  };
}
