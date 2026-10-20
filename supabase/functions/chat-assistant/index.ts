// Supabase Edge Function: chat-assistant
// Receives { message, history, mode } and calls Groq API with role-aware system prompt
// Deploy with: supabase functions deploy chat-assistant --no-verify-jwt
// Set secret: supabase secrets set GROQ_API_KEY=your_key GROQ_MODEL=llama-3.1-8b-instant

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.1-8b-instant";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");

const SYSTEM_PROMPT_CUSTOMER = `You are ATANY's helpful support assistant — warm, natural, conversational. Use contractions, friendly phrasing, not stiff corporate.
Scope strictly to ATANY's gold jewelry auction platform: bidding, listings/auctions, payments & pickup, branches, account. If asked outside scope, politely decline and redirect to ATANY topics.
Key facts:
- Branches: Victoria Plaza Branch (Victoria Plaza Area, Davao City, Mon–Sat 9AM–6PM, (082) 123-4567) + 4 other Davao branches; also Cebu, Manila, Iloilo, Baguio in legacy.
- Review: usually within 1 business day.
- Payout/refund: payout 90% (10% commission), Processing → Paid Out via admin Mark Paid, sent in 1–2 business days; refunds 3–5 business days.
- Pickup-only, no delivery; bring valid government-issued ID.
- Karat/weight certificate on each listing.`;

const SYSTEM_PROMPT_SELLER = `You are ATANY's helpful support assistant for sellers — warm, natural, conversational.
Scope strictly to ATANY seller flows: submitting listings, admin review, auction scheduling, payouts, editing rejected items, sales history, branches, account/shop.
Key facts:
- Submit: My Listings → Submit New Item (Item Name, Category, Karat/Weight, Starting Price, Auction Start/End, Photo, Description) → pending.
- Review: usually within 1 business day.
- Scheduling: seller proposes Start/End, Duration auto-calculated as End − Start; admin confirms on approval.
- Payout: 90% of sale (10% commission), Processing until admin Mark Paid, then Paid Out in 1–2 business days to Shop Profile payout method.
- Edit rejected: My Listings → Edit & Resubmit pre-filled form → Save & Resubmit → pending.
- Sales: Sales & Payouts shows only your shop's won items (TXN-... traceable to A-...).
Be concise, warm, use contractions.`;

serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { message, query, history = [], mode = "customer" } = await req.json();
    const text = message || query;
    if (!text) return new Response(JSON.stringify({ error: "Missing message" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

    if (!GROQ_API_KEY) {
      return new Response(JSON.stringify({ reply: "I'm not fully sure about that one yet — I've noted your question for our team. In the meantime, try asking about ATANY bidding, branches, payments, or your account.", source: "fallback" }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const systemPrompt = mode === "seller" ? SYSTEM_PROMPT_SELLER : SYSTEM_PROMPT_CUSTOMER;
    const historyMessages = (Array.isArray(history) ? history.slice(-6) : []).map((m: any) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content || m.text || "",
    })).filter((m: any) => m.content);

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          ...historyMessages,
          { role: "user", content: text },
        ],
        temperature: 0.7,
        max_tokens: 400,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Groq ${res.status}`);
    const reply = data.choices?.[0]?.message?.content || "I'm not sure — try asking about ATANY bidding or your account.";

    return new Response(JSON.stringify({ reply, source: "groq", mode }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ reply: "Our AI is temporarily unavailable — I've flagged this for our team. In the meantime, try asking about ATANY bidding, listings, or branches.", source: "error" }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
