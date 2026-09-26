import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn(), on: () => {} },
}));

import { pool } from '../db/pool.js';
import { logChatTurn } from '../services/chatbotLogService.js';

const UID = '11111111-1111-1111-1111-111111111111';

function sessionRow(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 'sess-1', user_id: UID, mode: 'customer', topic: 'How do I bid?',
    resolved: true, message_count: 2, created_at: now, last_active: now,
    ...overrides,
  };
}

beforeEach(() => {
  pool.query.mockReset();
  // Default: user exists; no prior session; insert session; message inserts; touch update
  pool.query.mockImplementation(async (sql) => {
    if (/FROM users/i.test(sql)) return { rows: [{ id: UID }] };
    if (/FROM chatbot_sessions/i.test(sql)) return { rows: [] };
    if (/INSERT INTO chatbot_sessions/i.test(sql)) {
      return { rows: [sessionRow({ id: 'new-sess', message_count: 0 })] };
    }
    return { rows: [] };
  });
});

describe('chatbotLogService.logChatTurn', () => {
  test('authenticated first message creates a session with 2 rows (user + assistant)', async () => {
    const id = await logChatTurn({ userId: UID, mode: 'customer', query: 'How do I bid?', reply: 'Open any live auction…' });
    expect(id).toBe('new-sess');
    const sessionInserts = pool.query.mock.calls.filter(([sql]) => /INSERT INTO chatbot_sessions/i.test(sql));
    const msgInserts = pool.query.mock.calls.filter(([sql]) => /INSERT INTO chatbot_messages/i.test(sql));
    expect(sessionInserts.length).toBe(1);
    expect(msgInserts.length).toBe(2);
    expect(msgInserts[0][1][1]).toBe('user');
    expect(msgInserts[1][1][1]).toBe('assistant');
  });

  test('second message within 30 minutes reuses the session and bumps count', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/FROM users/i.test(sql)) return { rows: [{ id: UID }] };
      if (/FROM chatbot_sessions/i.test(sql)) return { rows: [sessionRow()] };
      return { rows: [] };
    });
    const id = await logChatTurn({ userId: UID, mode: 'customer', query: 'And payment?', reply: 'Via notification…' });
    expect(id).toBe('sess-1');
    const sessionInserts = pool.query.mock.calls.filter(([sql]) => /INSERT INTO chatbot_sessions/i.test(sql));
    expect(sessionInserts.length).toBe(0);
    const touch = pool.query.mock.calls.find(([sql]) => /UPDATE chatbot_sessions SET last_active/i.test(sql));
    expect(touch).toBeTruthy();
    expect(touch[1][1]).toBe(4); // message_count 2 + 2
  });

  test('new session starts after a 30-minute gap', async () => {
    const old = sessionRow({ last_active: new Date(Date.now() - 31 * 60 * 1000).toISOString() });
    pool.query.mockImplementation(async (sql) => {
      if (/FROM users/i.test(sql)) return { rows: [{ id: UID }] };
      if (/FROM chatbot_sessions/i.test(sql)) return { rows: [old] };
      if (/INSERT INTO chatbot_sessions/i.test(sql)) return { rows: [sessionRow({ id: 'new-sess-2', message_count: 0 })] };
      return { rows: [] };
    });
    const id = await logChatTurn({ userId: UID, mode: 'customer', query: 'Hello again', reply: 'Hi!' });
    expect(id).toBe('new-sess-2');
  });

  test('guest session stores NULL user_id (no fake accounts)', async () => {
    const id = await logChatTurn({ userId: null, mode: 'customer', query: 'Hi guest', reply: 'Hello!' });
    expect(id).toBe('new-sess');
    const sessionInserts = pool.query.mock.calls.filter(([sql]) => /INSERT INTO chatbot_sessions/i.test(sql));
    expect(sessionInserts[0][1][0]).toBeNull();
  });

  test('customer and seller modes do not merge', async () => {
    pool.query.mockImplementation(async (sql, params) => {
      if (/FROM users/i.test(sql)) return { rows: [{ id: UID }] };
      if (/FROM chatbot_sessions/i.test(sql)) {
        // only a seller session exists; customer turn must create a new one
        return { rows: [] };
      }
      if (/INSERT INTO chatbot_sessions/i.test(sql)) {
        expect(params[1]).toBe('customer');
        return { rows: [sessionRow({ id: 'cust-sess', message_count: 0 })] };
      }
      return { rows: [] };
    });
    const id = await logChatTurn({ userId: UID, mode: 'customer', query: 'How do I bid?', reply: 'Open…' });
    expect(id).toBe('cust-sess');
  });

  test('escalation turn marks session unresolved', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/FROM users/i.test(sql)) return { rows: [{ id: UID }] };
      if (/FROM chatbot_sessions/i.test(sql)) return { rows: [sessionRow({ resolved: true })] };
      return { rows: [] };
    });
    await logChatTurn({ userId: UID, mode: 'customer', query: 'Talk to a human please', reply: 'Flagged…', escalated: true });
    const touch = pool.query.mock.calls.find(([sql]) => /UPDATE chatbot_sessions SET last_active/i.test(sql));
    expect(touch[1][2]).toBe(false);
  });

  test('database failure never throws and returns null', async () => {
    pool.query.mockRejectedValue(new Error('db down'));
    await expect(logChatTurn({ userId: UID, mode: 'customer', query: 'Hi', reply: 'Hello' })).resolves.toBeNull();
  });

  test('empty query or reply is skipped without writes', async () => {
    pool.query.mockClear();
    await expect(logChatTurn({ userId: UID, mode: 'customer', query: '   ', reply: 'Hello' })).resolves.toBeNull();
    await expect(logChatTurn({ userId: UID, mode: 'customer', query: 'Hi', reply: '' })).resolves.toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
