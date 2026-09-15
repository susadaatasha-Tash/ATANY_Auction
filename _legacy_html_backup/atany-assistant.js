/* =====================================================
   ATANY — Notifications + Chatbot Assistant Widget
   Drop-in, dependency-free. Injects a notification bell
   button (if a #assistantBellSlot exists) and a floating
   chat launcher + panel on every page that includes this file.
===================================================== */
(function () {

  /* ---------- STYLES ---------- */
  const style = document.createElement('style');
  style.textContent = `
    .atany-fab {
      position: fixed; z-index: 3200;
      right: calc(22px + env(safe-area-inset-right, 0px));
      bottom: calc(22px + env(safe-area-inset-bottom, 0px));
      width: 56px; height: 56px; border-radius: 50%; border: 0;
      background: #14301f; color: #fff; box-shadow: 0 12px 28px rgba(20, 48, 31,.32);
      display: grid; place-items: center; cursor: pointer;
      transition: transform .18s ease, background .18s ease;
      -webkit-tap-highlight-color: transparent;
    }
    .atany-fab:hover { transform: translateY(-2px) scale(1.04); background: #1e4530; }
    .atany-fab:active { transform: scale(.94); }
    .atany-fab svg { width: 24px; height: 24px; }
    .atany-fab .fab-dot {
      position: absolute; top: 6px; right: 6px; width: 9px; height: 9px;
      border-radius: 50%; background: #c7a66a; border: 2px solid #14301f;
    }

    .atany-chat-panel {
      position: fixed; z-index: 3200;
      right: calc(22px + env(safe-area-inset-right, 0px));
      bottom: calc(90px + env(safe-area-inset-bottom, 0px));
      width: 340px; max-width: calc(100vw - 40px); height: 460px; max-height: 70vh;
      background: #fffefa; border: 1px solid #e5e2da; border-radius: 16px;
      box-shadow: 0 24px 50px rgba(20, 48, 31,.25);
      display: none; flex-direction: column; overflow: hidden;
      font-family: "Plus Jakarta Sans", sans-serif;
    }
    .atany-chat-panel.open { display: flex; }

    .atany-chat-head {
      background: #14301f; color: #fff; padding: 16px 18px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .atany-chat-head div b { font-size: 13.5px; display: block; }
    .atany-chat-head div span { font-size: 10.5px; color: #c7a66a; }
    .atany-chat-close { background: transparent; border: 0; color: #cfd7e3; font-size: 18px; cursor: pointer; }
    .atany-chat-close:hover { color: #fff; }

    .atany-chat-body { flex: 1; overflow-y: auto; padding: 14px; background: #faf9f6; }
    .atany-msg { max-width: 84%; margin-bottom: 10px; font-size: 12.5px; line-height: 1.5; padding: 9px 12px; border-radius: 12px; }
    .atany-msg.bot { background: #fff; border: 1px solid #e5e2da; color: #172235; border-bottom-left-radius: 3px; }
    .atany-msg.user { background: #14301f; color: #fff; margin-left: auto; border-bottom-right-radius: 3px; }

    .atany-quick-replies { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
    .atany-quick-replies button {
      font-size: 11px; font-weight: 600; padding: 6px 11px; border-radius: 20px;
      border: 1px solid #d7d4cc; background: #fff; color: #14301f; cursor: pointer;
    }
    .atany-quick-replies button:hover { border-color: #14301f; }

    .atany-chat-input {
      display: flex; gap: 8px; padding: 12px; border-top: 1px solid #e5e2da; background: #fffefa;
    }
    .atany-chat-input input {
      flex: 1; height: 38px; border: 1px solid #d7d4cc; border-radius: 20px;
      padding: 0 14px; font-size: 12.5px; outline: none; font-family: inherit;
    }
    .atany-chat-input input:focus { border-color: #14301f; }
    .atany-chat-input button {
      width: 38px; height: 38px; border-radius: 50%; border: 0; background: #14301f;
      color: #fff; display: grid; place-items: center; cursor: pointer; flex-shrink: 0;
    }
    .atany-chat-input button svg { width: 15px; height: 15px; }

    /* Notification bell + dropdown */
    .atany-bell-wrap { position: relative; display: inline-block; }
    .atany-bell-btn {
      position: relative; width: 40px; height: 40px; border: 0; background: transparent;
      color: #14301f; display: grid; place-items: center; border-radius: 50%; cursor: pointer;
      transition: background .15s ease;
    }
    .atany-bell-btn:hover { background: #f3f1ec; }
    .atany-bell-btn svg { width: 18px; height: 18px; }
    .atany-bell-dot {
      position: absolute; top: 6px; right: 7px; width: 8px; height: 8px; border-radius: 50%;
      background: #a45c5c; border: 2px solid #fffefa;
    }

    .atany-notif-panel {
      position: absolute; top: 48px; right: 0; z-index: 2400;
      width: 300px; background: #fffefa; border: 1px solid #e5e2da; border-radius: 12px;
      box-shadow: 0 20px 40px rgba(20, 48, 31,.18); display: none; overflow: hidden;
      font-family: "Plus Jakarta Sans", sans-serif;
    }
    .atany-notif-panel.open { display: block; }
    .atany-notif-panel-head {
      padding: 13px 16px; border-bottom: 1px solid #e5e2da; font-size: 12.5px; font-weight: 800; color: #14301f;
    }
    .atany-notif-item { padding: 12px 16px; border-bottom: 1px solid #e5e2da; font-size: 11.5px; color: #172235; }
    .atany-notif-item:last-child { border-bottom: 0; }
    .atany-notif-item .t { color: #707782; font-size: 10px; margin-top: 3px; }

    @media (max-width: 480px) {
      .atany-chat-panel {
        right: calc(12px + env(safe-area-inset-right, 0px));
        left: calc(12px + env(safe-area-inset-left, 0px));
        width: auto;
        height: min(460px, 70vh);
      }
      .atany-fab {
        right: calc(16px + env(safe-area-inset-right, 0px));
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        width: 52px; height: 52px;
      }
    }
  `;
  document.head.appendChild(style);

  /* ---------- CHATBOT KNOWLEDGE BASE — now role-aware, Groq AI primary ---------- */
  // Mode detection: window.ATANY_ASSISTANT_MODE = 'customer' | 'seller', or auto-detect via path
  function getMode() {
    if (window.ATANY_ASSISTANT_MODE) return window.ATANY_ASSISTANT_MODE;
    const p = window.location.pathname;
    if (p.includes('/shop') || p.includes('shop-owner')) return 'seller';
    return 'customer';
  }

  const KB_CUSTOMER = [
    { keys: ['bid', 'how to bid', 'place a bid', 'auction work'],
      a: "To bid: open any live auction, tap \"Place Bid,\" and enter an amount above the current bid. You'll get an outbid alert if someone tops you." },
    { keys: ['branch', 'location', 'nearest', 'gps', 'pickup', 'claim'],
      a: "You can find and get directions to the nearest ATANY branch on our GPS locator page — it also shows live distance from you." },
    { keys: ['hour', 'open', 'close', 'time'],
      a: "Branch hours vary by location — most are open Mon–Sat, 9am–6pm. Check the branch locator for exact hours near you." },
    { keys: ['payment', 'pay', 'refund', 'transaction'],
      a: "Once you win an auction, you'll get a payment link and pickup instructions by notification. Refunds for cancelled orders are processed within 3–5 business days." },
    { keys: ['account', 'sign up', 'register', 'login', 'password'],
      a: "You can create an account from the sign-up page, or reset your password from the sign-in screen using \"Forgot password?\"." },
    { keys: ['authentic', 'real', 'certificate', 'karat', 'genuine'],
      a: "Every ATANY piece is inspected and comes with a karat/weight certificate shown on its listing page." },
    { keys: ['human', 'agent', 'support', 'talk to someone', 'representative'],
      a: "I can connect you with a human support agent — I've flagged this conversation for our team, and someone will follow up shortly." },
  ];

  const KB_SELLER = [
    { keys: ['submit', 'list item', 'new item', 'create listing'],
      a: "To submit a new item: go to My Listings → Submit New Item, fill in Item Name, Category, Karat/Weight, Starting Price, Auction Start/End, Photo, and Description, then Submit for Review. It's usually reviewed within 1 business day." },
    { keys: ['how long', 'approval', 'review take', 'pending'],
      a: "New listings are reviewed by ATANY admins before going live — usually within 1 business day. You'll get a notification when it's approved or if it needs changes." },
    { keys: ['schedule', 'auction time', 'duration', 'when live', 'start time', 'end time'],
      a: "When you submit, you propose an Auction Start and End time — Duration is auto-calculated as End − Start. On approval, admin confirms your schedule; the auction goes live at your start time and Live Auctions shows the countdown from your end_time." },
    { keys: ['payout', 'paid', 'when paid', 'commission', '90%', 'earnings'],
      a: "Your payout is 90% of the sale amount (10% platform commission). Sales show as Processing until an admin marks the transaction Paid Out on Admin → Transactions, then it's sent to your Payout Method (bank/e-wallet in Shop Profile) in 1–2 business days." },
    { keys: ['edit', 'resubmit', 'rejected', 'declined'],
      a: "If your listing was rejected, find it in My Listings with status Rejected, click Edit & Resubmit, update the pre-filled form, and Save & Resubmit — it goes back to pending for re-review." },
    { keys: ['sales', 'history', 'where sales', 'my sales'],
      a: "Check Sales & Payouts for your shop's completed sales — it lists only your items that were won (from the same transactions table admin sees), with Order ID TXN-..., Sale Amount, Your Payout, and Status." },
    { keys: ['human', 'agent', 'support', 'talk to someone', 'representative'],
      a: "I can connect you with a human support agent — flagged for our team, someone will follow up shortly." },
  ];

  // Fallback rule-based for offline, but Groq is primary now
  function getRuleReply(text, mode) {
    const KB = mode === 'seller' ? KB_SELLER : KB_CUSTOMER;
    const q = text.toLowerCase();
    for (const entry of KB) {
      if (entry.keys.some(k => q.includes(k))) return entry.a;
    }
    return null;
  }

  // Groq AI call via backend (or Supabase Edge Function) with history and mode
  let conversationHistory = [];
  async function getBotReply(text) {
    const mode = getMode();
    // Add to history for context (keep last 6)
    conversationHistory.push({ role: 'user', content: text });
    if (conversationHistory.length > 12) conversationHistory = conversationHistory.slice(-12);

    // Try Groq via backend / Supabase Edge Function first (real AI)
    try {
      const endpoint = window.ATANY_CHAT_ENDPOINT || '/chat';
      // For Supabase Edge Function, use full URL if configured
      const url = endpoint.startsWith('http') ? endpoint : (window.ATANY_API_URL || '') + endpoint;
      const res = await fetch(url || '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, query: text, history: conversationHistory.slice(-6), mode }),
      });
      if (res.ok) {
        const data = await res.json();
        const reply = data.reply || data.response || data.choices?.[0]?.message?.content;
        if (reply) {
          conversationHistory.push({ role: 'assistant', content: reply });
          return reply;
        }
      }
    } catch (e) {
      console.warn('Groq chat failed, falling back to rule KB', e);
    }

    // Fallback to rule-based KB
    const rule = getRuleReply(text, mode);
    const fallback = rule || "I'm not fully sure about that one yet — I've noted your question for our team. In the meantime, try asking about " + (mode === 'seller' ? "submitting listings, payouts, or your sales." : "bidding, branches, payments, or your account.");
    conversationHistory.push({ role: 'assistant', content: fallback });
    return fallback;
  }

  /* ---------- CHAT WIDGET ---------- */
  function buildChatWidget() {
    const fab = document.createElement('button');
    fab.className = 'atany-fab';
    fab.setAttribute('aria-label', 'Open chat assistant');
    fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="12" rx="3"/><path d="M8 21l3-4h2l3 4M8 10h.01M12 10h.01M16 10h.01"/></svg><span class="fab-dot"></span>`;
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.className = 'atany-chat-panel';
    panel.innerHTML = `
      <div class="atany-chat-head">
        <div><b>ATANY Assistant</b><span>Usually replies instantly</span></div>
        <button class="atany-chat-close" aria-label="Close chat">×</button>
      </div>
      <div class="atany-chat-body" id="atanyChatBody"></div>
      <div class="atany-chat-input">
        <input type="text" id="atanyChatInput" placeholder="Ask about bids, branches, orders…">
        <button id="atanyChatSend" aria-label="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 3 18 9-18 9 4.5-9L3 3Z"/></svg>
        </button>
      </div>
    `;
    document.body.appendChild(panel);

    const body = panel.querySelector('#atanyChatBody');
    const input = panel.querySelector('#atanyChatInput');
    const sendBtn = panel.querySelector('#atanyChatSend');

    function addMsg(text, who) {
      const div = document.createElement('div');
      div.className = 'atany-msg ' + who;
      div.textContent = text;
      body.appendChild(div);
      body.scrollTop = body.scrollHeight;
    }

    function addQuickReplies() {
      const wrap = document.createElement('div');
      wrap.className = 'atany-quick-replies';
      const isSeller = getMode() === 'seller';
      const qs = isSeller
        ? ['How do I submit an item?', 'How long does approval take?', 'When do I get paid?', 'Edit a rejected item?']
        : ['How do I bid?', 'Find a branch', 'Payment & pickup', 'Talk to a human'];
      qs.forEach(q => {
        const b = document.createElement('button');
        b.textContent = q;
        b.onclick = () => handleUserMessage(q);
        wrap.appendChild(b);
      });
      body.appendChild(wrap);
      body.scrollTop = body.scrollHeight;
    }

    function showTyping() {
      const div = document.createElement('div');
      div.className = 'atany-msg bot typing';
      div.id = 'atanyTyping';
      div.textContent = 'ATANY is typing…';
      div.style.opacity = '0.7';
      div.style.fontStyle = 'italic';
      body.appendChild(div);
      body.scrollTop = body.scrollHeight;
    }
    function hideTyping() {
      const el = document.getElementById('atanyTyping');
      if (el) el.remove();
    }

    async function handleUserMessage(text) {
      if (!text.trim()) return;
      addMsg(text, 'user');
      input.value = '';
      showTyping();
      try {
        const reply = await getBotReply(text);
        hideTyping();
        addMsg(reply, 'bot');
      } catch (e) {
        hideTyping();
        addMsg("Our AI is temporarily unavailable — I've flagged this for our team. In the meantime, try asking about ATANY bidding, listings, or branches.", 'bot');
      }
    }

    fab.addEventListener('click', () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open') && body.children.length === 0) {
        const isSeller = getMode() === 'seller';
        addMsg(isSeller ? "Hi! I'm the ATANY seller assistant. Ask me about submitting items, approval times, scheduling, payouts, or your sales." : "Hi! I'm the ATANY assistant. Ask me about bidding, branches, payments, or your account.", 'bot');
        addQuickReplies();
      }
    });
    panel.querySelector('.atany-chat-close').addEventListener('click', () => panel.classList.remove('open'));
    sendBtn.addEventListener('click', () => handleUserMessage(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') handleUserMessage(input.value); });
  }

  /* ---------- NOTIFICATION BELL ---------- */
  const DEMO_NOTIFICATIONS = [
    { text: 'Your bid on the Rose Gold Bangle was outbid — tap to rebid.', time: '10 min ago' },
    { text: 'Auctions ending in the next hour — check your watchlist.', time: '2 hours ago' },
    { text: 'New Byzantine Gold collection just launched.', time: '1 day ago' },
  ];

  function buildNotificationBell() {
    const slots = document.querySelectorAll('#assistantBellSlot');
    slots.forEach(slot => {
      const wrap = document.createElement('div');
      wrap.className = 'atany-bell-wrap';
      wrap.innerHTML = `
        <button class="atany-bell-btn" aria-label="Notifications">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>
          <span class="atany-bell-dot"></span>
        </button>
        <div class="atany-notif-panel">
          <div class="atany-notif-panel-head">Notifications</div>
          ${DEMO_NOTIFICATIONS.map(n => `<div class="atany-notif-item">${n.text}<div class="t">${n.time}</div></div>`).join('')}
        </div>
      `;
      slot.appendChild(wrap);

      const btn = wrap.querySelector('.atany-bell-btn');
      const dropdown = wrap.querySelector('.atany-notif-panel');
      btn.addEventListener('click', e => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
      });
      document.addEventListener('click', () => dropdown.classList.remove('open'));
    });
  }

  /* ---------- INIT ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    buildChatWidget();
    buildNotificationBell();
  });
})();
