// backend/src/services/chatbotLogService.js
// Chatbot conversation persistence (Admin Chatbot Logs page). Persistence ONLY —
// no AI logic, no prompts, no response shaping. Every function is failure-safe:
// logging must NEVER break the customer chatbot, so callers wrap in try/catch and
// all internal failures are logged with console.warn and swallowed.
import { pool } from '../db/pool.js';

// A session is reused while its last activity is within this window; otherwise a
// new session starts. Keeps queries REST-fallback-safe (equality + ORDER BY + LIMIT;
// the gap comparison happens in JS, never in SQL).
const SESSION_GAP_MS = 30 * 60 * 1000;

// Same escalation keywords the chatbot service already uses to flag human follow-up.
// Kept in sync with chatbotService.js (human/agent/support) — no AI classification.
const ESCALATION_RE = /human|agent|support/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function topicFor(firstUserMessage) {
  const t = String(firstUserMessage || '').trim().replace(/\s+/g, ' ');
  if (!t) return 'General question';
  return t.length > 60 ? t.slice(0, 60).trimEnd() + '…' : t;
}

// Resolve a caller-supplied user id to a real users row, else NULL (guests and
// spoofed ids never create fake accounts and never violate the FK).
async function resolveUserId(userId) {
  if (!userId || !UUID_RE.test(String(userId))) return null;
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE id=$1', [userId]);
    return rows.length ? rows[0].id : null;
  } catch {
    return null;
  }
}

async function findActiveSession(userId, mode) {
  // Authenticated: latest session for this user+mode. Guest (NULL): latest anonymous
  // session for this mode. Gap check happens in JS below (REST-fallback-safe).
  let rows = [];
  if (userId) {
    ({ rows } = await pool.query(
      'SELECT * FROM chatbot_sessions WHERE user_id=$1 AND mode=$2 ORDER BY last_active DESC LIMIT 1',
      [userId, mode]
    ));
  } else {
    ({ rows } = await pool.query(
      'SELECT * FROM chatbot_sessions WHERE mode=$1 ORDER BY last_active DESC LIMIT 10',
      [mode]
    ));
    rows = rows.filter((r) => !r.user_id);
  }
  const latest = rows[0] || null;
  if (!latest) return null;
  if (Date.now() - new Date(latest.last_active).getTime() > SESSION_GAP_MS) return null;
  return latest;
}

/**
 * Persist one chatbot turn (user message + assistant reply) and return the
 * session id, or null when logging was skipped/failed. Never throws.
 */
export async function logChatTurn({ userId, mode = 'customer', query, reply, escalated = false }) {
  try {
    const userText = String(query || '').trim();
    const botText = String(reply || '').trim();
    if (!userText || !botText) return null;
    const safeMode = mode === 'seller' ? 'seller' : 'customer';
    const resolvedUserId = await resolveUserId(userId);

    let session = await findActiveSession(resolvedUserId, safeMode);
    if (!session) {
      const { rows } = await pool.query(
        'INSERT INTO chatbot_sessions (user_id, mode, topic, resolved) VALUES ($1,$2,$3,$4) RETURNING *',
        [resolvedUserId, safeMode, topicFor(userText), !escalated]
      );
      session = rows[0];
      if (!session) return null;
    }

    await pool.query(
      'INSERT INTO chatbot_messages (session_id, role, message) VALUES ($1,$2,$3)',
      [session.id, 'user', userText]
    );
    await pool.query(
      'INSERT INTO chatbot_messages (session_id, role, message) VALUES ($1,$2,$3)',
      [session.id, 'assistant', botText]
    );
    // Single param-only UPDATE (pool REST fallback supports col=$N but not NOW()/exprs).
    // An escalation inside an existing session marks it unresolved (follow-up needed).
    try {
      await pool.query(
        'UPDATE chatbot_sessions SET last_active=$1, message_count=$2, resolved=$3 WHERE id=$4',
        [
          new Date().toISOString(),
          Number(session.message_count || 0) + 2,
          escalated ? false : session.resolved !== false,
          session.id,
        ]
      );
    } catch (e) {
      console.warn('[chatbotLog] failed to touch session:', e.message);
    }
    return session.id;
  } catch (e) {
    console.warn('[chatbotLog] failed to persist turn:', e.message);
    return null;
  }
}
