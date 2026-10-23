import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })), on: () => {} },
}));

import { pool } from '../db/pool.js';
import { chatbotReply } from '../services/chatbotService.js';

// Same rows the Branch Locator reads from the live branches table.
const DB_BRANCHES = [
  { name: 'Gmall Branch', address: 'Gmall Davao, J.P. Laurel Ave, Davao City', hours: 'Mon–Sat · 9AM–6PM', phone: '(082) 224-6500' },
  { name: 'Abreeza Branch', address: 'Abreeza Mall, J.P. Laurel Ave, Davao City', hours: 'Mon–Sun · 10AM–9PM', phone: '(082) 221-5200' },
  { name: 'SM Lanang Branch', address: 'SM City Lanang, JP Laurel Ave, Davao City', hours: 'Mon–Sun · 10AM–9PM', phone: '(082) 285-1100' },
];
const STALE_BRANCH_TERMS = [
  'Victoria Plaza', 'Manila Branch', 'Cebu Branch', 'Iloilo Branch', 'Baguio Branch',
  'Greenbelt', 'Ayala Center Cebu', 'Festive Walk', 'Session Road',
];

let savedKey;
let savedFetch;
beforeEach(() => {
  savedKey = process.env.GROQ_API_KEY;
  savedFetch = globalThis.fetch;
  // Route mocked queries by SQL: role lookup empty, branches table returns DB rows.
  pool.query.mockImplementation(async (sql) => {
    if (/FROM branches/i.test(sql)) return { rows: DB_BRANCHES };
    return { rows: [] };
  });
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = savedKey;
  globalThis.fetch = savedFetch;
  vi.restoreAllMocks();
});

function mockGroq(captured) {
  globalThis.fetch = vi.fn(async (_url, opts) => {
    captured.body = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Mocked reply. ---SUGGESTIONS--- ["Thanks"]' } }] }),
    };
  });
}

function systemPromptOf(captured) {
  return captured.body.messages.find((m) => m.role === 'system').content;
}

describe('chatbot branch context comes from the database', () => {
  test('A. "What branches does ATANY have?" rule KB directs to Branch Locator', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    const captured = {};
    mockGroq(captured);
    const res = await chatbotReply('What branches does ATANY have?', { mode: 'customer', history: [] });
    expect(res.source).toBe('rule');
    expect(res.reply).toContain('Branch Locator');
    expect(res.reply).toContain('directions');
    // Groq should NOT have been called since rule KB matched
    expect(captured.body).toBeUndefined();
  });

  test('B. Manila question uses rule KB directing to Branch Locator', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    const captured = {};
    mockGroq(captured);
    const res = await chatbotReply('Do you have a branch in Manila?', { mode: 'customer', history: [] });
    expect(res.source).toBe('rule');
    expect(res.reply).toContain('Branch Locator');
    expect(res.reply).toContain('directions');
    expect(captured.body).toBeUndefined();
  });

  test('C. Davao availability question uses Groq with DB branch context', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    const captured = {};
    mockGroq(captured);
    await chatbotReply('Is ATANY available in Davao City?', { mode: 'customer', history: [] });
    const system = systemPromptOf(captured);
    expect(system).toContain('ATANY operates in Davao City, Philippines');
    expect(system).toContain('SM Lanang Branch');
  });

  test('D. nearest-branch question uses rule KB directing to Branch Locator', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    const captured = {};
    mockGroq(captured);
    const res = await chatbotReply('Where is the nearest branch?', { mode: 'customer', history: [] });
    expect(res.source).toBe('rule');
    expect(res.reply).toContain('Branch Locator');
    expect(res.reply).toContain('directions');
    expect(captured.body).toBeUndefined();
  });

  test('E. branch query failure yields graceful fallback, never fabricated branches', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    const captured = {};
    mockGroq(captured);
    pool.query.mockImplementation(async (sql) => {
      if (/FROM branches/i.test(sql)) throw new Error('db down');
      return { rows: [] };
    });
    const res = await chatbotReply('What branches does ATANY have?', { mode: 'customer', history: [] });
    expect(res.source).toBe('rule');
    expect(res.reply).toContain('Branch Locator');
    expect(res.reply).toContain('directions');
    expect(captured.body).toBeUndefined();
  });

  test('F. normal auction question still works via rule KB', async () => {
    delete process.env.GROQ_API_KEY;
    const res = await chatbotReply('How do I place a bid?', { mode: 'customer', history: [] });
    expect(res.source).toBe('rule');
    expect(res.reply).toMatch(/place bid/i);
    expect(res.conversation_state).toBe('ongoing');
    expect(res.suggestions.length).toBeGreaterThan(0);
  });

  test('seller prompt also receives DB branch context via Groq', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    const captured = {};
    mockGroq(captured);
    await chatbotReply('Where is the Gmall branch?', { mode: 'seller', history: [] });
    const system = systemPromptOf(captured);
    expect(system).toContain('Gmall Davao, J.P. Laurel Ave, Davao City');
    for (const stale of STALE_BRANCH_TERMS) expect(system).not.toContain(stale);
  });
});
