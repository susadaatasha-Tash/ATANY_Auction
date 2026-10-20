// backend/src/services/chatbotService.js
// Spec 4.8: Groq AI is primary, rule KB is fallback — key never in frontend per spec 5.6
// Now role-aware (customer vs seller) and history-aware, with warm conversational tone
import { pool } from '../db/pool.js';

const KB_CUSTOMER = [
  { keys: ['bid', 'how to bid', 'place a bid', 'auction work'], a: "To bid: open any live auction, tap \"Place Bid,\" and enter an amount above the current bid. You'll get an outbid alert if someone tops you." },
  { keys: ['branch', 'location', 'nearest', 'gps', 'pickup', 'claim'], a: 'You can find and get directions to the nearest ATANY branch on our GPS locator page — it also shows live distance from you.' },
  { keys: ['hour', 'open', 'close', 'time'], a: 'Branch hours vary by location — most are open Mon–Sat, 9am–6pm. Check the branch locator for exact hours near you.' },
  { keys: ['payment', 'pay', 'refund', 'transaction'], a: "Once you win an auction, you'll get a payment link and pickup instructions by notification. Refunds for cancelled orders are processed within 3–5 business days." },
  { keys: ['account', 'sign up', 'register', 'login', 'password'], a: 'You can create an account from the sign-up page, or reset your password from the sign-in screen using \"Forgot password?\".' },
  { keys: ['authentic', 'real', 'certificate', 'karat', 'genuine'], a: 'Every ATANY piece is inspected and comes with a karat/weight certificate shown on its listing page.' },
  { keys: ['human', 'agent', 'support', 'talk to someone', 'representative'], a: 'I can connect you with a human support agent — flagged for our team, someone will follow up shortly.' },
];

const KB_SELLER = [
  { keys: ['submit', 'list item', 'new item', 'create listing'], a: "To submit a new item: go to My Listings → Submit New Item, fill in Item Name, Category, Karat/Weight, Starting Price, Auction Start/End, Photo, and Description, then Submit for Review. It's usually reviewed within 1 business day." },
  { keys: ['how long', 'approval', 'review take', 'pending'], a: "New listings are reviewed by ATANY admins before going live — usually within 1 business day. You'll get a notification when it's approved or if it needs changes." },
  { keys: ['schedule', 'auction time', 'duration', 'when live', 'start time', 'end time'], a: "When you submit, you propose an Auction Start and End time — Duration is auto-calculated as End − Start. On approval, admin confirms your schedule; the auction goes live at your start time and Live Auctions shows the countdown from your end_time." },
  { keys: ['payout', 'paid', 'when paid', 'commission', '90%', 'earnings'], a: "Your payout is 90% of the sale amount (10% platform commission). Sales show as Processing until an admin marks the transaction Paid Out on Admin → Transactions, then it's sent to your Payout Method (bank/e-wallet in Shop Profile) in 1–2 business days." },
  { keys: ['edit', 'resubmit', 'rejected', 'declined'], a: "If your listing was rejected, find it in My Listings with status Rejected, click Edit & Resubmit, update the pre-filled form, and Save & Resubmit — it goes back to pending for re-review." },
  { keys: ['sales', 'history', 'where sales', 'my sales'], a: "Check Sales & Payouts for your shop's completed sales — it lists only your items that were won (from the same transactions table admin sees), with Order ID TXN-..., Sale Amount, Your Payout, and Status." },
  { keys: ['human', 'agent', 'support', 'talk to someone', 'representative'], a: 'I can connect you with a human support agent — flagged for our team, someone will follow up shortly.' },
];

function getRuleReply(text, mode = 'customer') {
  const KB = mode === 'seller' ? KB_SELLER : KB_CUSTOMER;
  const q = text.toLowerCase();
  for (const e of KB) if (e.keys.some((k) => q.includes(k))) return e.a;
  return null;
}

// Branch context is built per request from the SAME branches table read by the
// Branch Locator (GET /branches → SELECT * FROM branches) — never hardcoded, so the
// chatbot and the locator always agree. Placeholder is replaced at request time.
const BRANCH_CONTEXT_PLACEHOLDER = '__BRANCH_CONTEXT__';

// Shown to the model when the branch records cannot be loaded. Deliberately
// contains no branch names/addresses/hours — the model must not invent them.
const BRANCH_UNAVAILABLE = `
BRANCH INFORMATION TEMPORARILY UNAVAILABLE:
The current branch records could not be loaded. If the user asks about branches, locations, or pickup, reply with exactly this message (plus a link to the Branch Locator page): "I'm unable to retrieve the current branch information right now. Please check the Branch Locator for the latest ATANY branch details." Do not invent branch names, addresses, hours, or phone numbers.`;

// Fetch open branches and format them exactly like the Branch Locator cards:
// name — address — hours — phone. Returns null when the query fails or yields
// no usable rows, so the caller can fall back to BRANCH_UNAVAILABLE. Never throws.
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

// Strict geographic scope: ATANY is a Davao City portal. The rule names the scope
// and tells the model how to handle non-Davao questions using real branch data
// above — never by swapping in another city name.
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
  /customer/watchlist (My Watchlist), /customer/purchases (My Purchases), /customer/account (Account Settings)
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

const SYSTEM_PROMPT_CUSTOMER = `You are ATANY's helpful support assistant — warm, natural, conversational. Use contractions, friendly phrasing, not stiff corporate.
Scope strictly to ATANY's gold jewelry auction platform: bidding, listings/auctions, payments & pickup, branches, account. If asked outside scope (general knowledge, unrelated topics), politely decline and redirect to ATANY topics.
${BRANCH_CONTEXT_PLACEHOLDER}
${LOCATION_SCOPE}
Key facts to get right (don't hallucinate):
- Review: "usually within 1 business day" (from Submit New Item copy).
- Payout/refund: payout 90% (10% commission), Processing → Paid Out via admin Mark Paid, sent in 1–2 business days; refunds 3–5 business days.
- Pickup-only, no delivery; bring valid government-issued ID to claim.
- Karat/weight certificate on each listing.
${UI_ELEMENTS}
${REAL_ROUTES}
${INLINE_LINK_FORMAT}

FORMATTING RULES:
- **Bold** for UI element names: button labels, menu items, page names (e.g. **My Listings**, **Place Bid**).
- For multi-step processes: start with a short bold intro line (e.g. **To place a bid:**), then use a numbered list. Each step = one short concise action. Embed inline links in relevant steps.
- Use bullet lists (- ) for non-sequential tips or options. Embed inline links when mentioning pages.
- For simple one-line factual answers, keep it as a natural sentence — do NOT force a list or links.
- Never use HTML tags. Only use: **bold**, numbered lists, bullet lists, [inline links](/route), and plain text.

CLOSING RULES:
- End your response naturally based on the content. Do NOT add stock closing phrases like "Happy hunting!", "Happy bidding!", "Good luck!", "Enjoy!", or similar forced flourishes.
- If the answer is factual (branch hours, payment info, etc.), end with the fact — no sign-off needed.
- If the answer is a how-to, end after the last step or a brief note — no cheerleading.

FOLLOW-UP SUGGESTIONS (MANDATORY FORMAT):
You MUST always end every response with the suggestions block. Think of 0-3 short follow-up questions the user might want to ask next, based on what was just discussed.
- If relevant follow-ups exist, suggest them.
- If the conversation feels complete (simple fact, closing like "thanks"), output an empty array.
Format (nothing else after this block):
---SUGGESTIONS---
["question1", "question2"]
or:
---SUGGESTIONS---
[]
Example:
You'll get notified in your **[Notifications](/customer/notifications)** when you win. You can also check **[My Purchases](/customer/purchases)** anytime.
---SUGGESTIONS---
["What happens after I win?", "How do I pay?"]
Example with no follow-ups:
Most branches are open Mon–Sat, 9am–6pm.
---SUGGESTIONS---
[]`;

const SYSTEM_PROMPT_SELLER = `You are ATANY's helpful support assistant for sellers — warm, natural, conversational.
Scope strictly to ATANY seller flows: submitting listings, admin review, auction scheduling, payouts, editing rejected items, sales history, branches, account/shop. If asked outside scope, politely redirect to seller topics.
${BRANCH_CONTEXT_PLACEHOLDER}
${LOCATION_SCOPE}
Key facts:
- Submit: My Listings → Submit New Item (Item Name, Category, Karat/Weight, Starting Price, Auction Start/End, Photo, Description) → pending.
- Review: usually within 1 business day.
- Scheduling: seller proposes Start/End, Duration auto-calculated as End − Start; admin confirms on approval; countdown is end_time - NOW().
- Payout: 90% of sale (10% commission), Processing until admin Mark Paid, then Paid Out in 1–2 business days to Shop Profile payout method.
- Edit rejected: My Listings → Edit & Resubmit pre-filled form → Save & Resubmit → pending.
- Sales: Sales & Payouts shows only your shop's won items (TXN-... traceable to A-...).
Be concise, warm, use contractions.
${UI_ELEMENTS}
${REAL_ROUTES}
${INLINE_LINK_FORMAT}

FORMATTING RULES:
- **Bold** for UI element names: button labels, menu items, page names (e.g. **My Listings**, **Submit New Item**, **Shop Profile**).
- For multi-step processes: start with a short bold intro line (e.g. **To submit a listing:**), then use a numbered list. Each step = one short concise action. Embed inline links in relevant steps.
- Use bullet lists (- ) for non-sequential tips or options. Embed inline links when mentioning pages.
- For simple one-line factual answers, keep it as a natural sentence — do NOT force a list or links.
- Never use HTML tags. Only use: **bold**, numbered lists, bullet lists, [inline links](/route), and plain text.

CLOSING RULES:
- End your response naturally based on the content. Do NOT add stock closing phrases like "Happy hunting!", "Happy selling!", "Good luck!", or similar forced flourishes.
- If the answer is factual (payout rate, approval time), end with the fact — no sign-off needed.
- If the answer is a how-to, end after the last step or a brief note — no cheerleading.

FOLLOW-UP SUGGESTIONS (MANDATORY FORMAT):
You MUST always end every response with the suggestions block. Think of 0-3 short follow-up questions the user might want to ask next, based on what was just discussed.
- If relevant follow-ups exist, suggest them.
- If the conversation feels complete (simple fact, closing like "thanks"), output an empty array.
Format (nothing else after this block):
---SUGGESTIONS---
["question1", "question2"]
or:
---SUGGESTIONS---
[]
Example:
Go to **[My Listings](/shop/listings)** and tap **Submit New Item**. It's usually reviewed within 1 business day.
---SUGGESTIONS---
["How do I schedule auction times?", "What happens after my item is approved?"]
Example with no follow-ups:
Your payout is 90% of the sale amount after the 10% commission.
---SUGGESTIONS---
[]`;

// Groq model selection per budget/speed — 8b-instant is fastest/cheapest, 70b is higher quality
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

export async function chatbotReply(query, { userId, mode = 'customer', history = [] } = {}) {
  // Allow explicit mode override, otherwise infer from user role if available
  let effectiveMode = mode;
  if (userId && mode === 'customer') {
    try {
      const { rows } = await pool.query('SELECT role FROM public.users WHERE id=$1', [userId]);
      if (rows[0]?.role === 'shop_owner') effectiveMode = 'seller';
    } catch {}
  }

  // Try rule KB first for instant, deterministic answers (kept for offline fallback)
  const rule = getRuleReply(query, effectiveMode);
  if (rule && !history.length) {
    // For history-aware turns, prefer Groq for context; for single-turn rule matches, return rule quickly
    // But if Groq is available, we still prefer Groq for natural tone — so only use rule if Groq key missing
    const groqKeyCheck = process.env.GROQ_API_KEY;
    if (!groqKeyCheck) {
      if (['human','agent','support'].some(k => query.toLowerCase().includes(k)) && userId) {
        await pool.query("INSERT INTO notifications (user_id, type, message) VALUES ($1,'chatbot','Human escalation flagged — staff will follow up')", [userId]).catch(()=>{});
      }
      return { source: 'rule', reply: rule, mode: effectiveMode };
    }
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return { source: 'fallback', reply: "I'm not fully sure about that one yet — I've noted your question for our team. In the meantime, try asking about bidding, branches, payments, or your account.", mode: effectiveMode };

  // Branch context comes from the live branches table (same source as Branch
  // Locator). On failure the model gets the unavailable notice instead of stale
  // hardcoded branches — it must never invent locations.
  const branchContext = (await getBranchContext()) || BRANCH_UNAVAILABLE;
  const systemPrompt = (effectiveMode === 'seller' ? SYSTEM_PROMPT_SELLER : SYSTEM_PROMPT_CUSTOMER)
    .replace(BRANCH_CONTEXT_PLACEHOLDER, branchContext);

  // Build messages with history (last 4-6 turns) for context
  const historyMessages = (Array.isArray(history) ? history.slice(-6) : []).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content || m.text || ''
  })).filter(m => m.content);

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...historyMessages,
          { role: 'user', content: query }
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Groq ${res.status}`);
    const rawReply = data.choices?.[0]?.message?.content || "I'm not sure — try asking about ATANY bidding or your account.";
    // Parse suggestions from Groq response (---SUGGESTIONS--- block at end)
    let reply = rawReply;
    let suggestions = [];
    const sugMatch = rawReply.match(/[\s\n]*---SUGGESTIONS---[\s\n]*(\[[\s\S]*?\])\s*$/);
    if (sugMatch) {
      reply = rawReply.slice(0, sugMatch.index).trim();
      try {
        const parsed = JSON.parse(sugMatch[1]);
        if (Array.isArray(parsed)) suggestions = parsed.filter(s => typeof s === 'string' && s.trim()).slice(0, 3);
      } catch {}
    }
    // Flag human escalation if needed
    if (['human','agent','support'].some(k => query.toLowerCase().includes(k)) && userId) {
      await pool.query("INSERT INTO notifications (user_id, type, message) VALUES ($1,'chatbot','Human escalation flagged — staff will follow up')", [userId]).catch(()=>{});
    }
    return { source: 'groq', reply, suggestions, mode: effectiveMode };
  } catch (e) {
    console.error('Groq error', e.message);
    // Fallback to rule or generic
    const fallback = getRuleReply(query, effectiveMode);
    if (fallback) return { source: 'rule-fallback', reply: fallback, mode: effectiveMode };
    return { source: 'error', reply: "Our AI is temporarily unavailable — I've flagged this for our team. In the meantime, try asking about ATANY bidding, listings, or branches.", mode: effectiveMode };
  }
}
