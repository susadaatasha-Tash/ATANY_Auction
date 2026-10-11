// backend/src/tests/directTxClient.test.js
// Regression for the resume-503 incident: when the shared pool is saturated,
// transaction-sensitive mutations must still reach direct pg via a dedicated
// fresh client (real transaction, never REST), and 503s must use the stable
// structured body. Only true connection failures map to 503.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mockConnect = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: (...a) => mockConnect(...a), on: vi.fn() },
  isDirectPg: () => true,
  ensureDirectPg: async () => true,
  getPoolHealth: () => ({ direct_pg: true, pool: { total: 0, idle: 0, waiting: 0 } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));

const OLD_DB_URL = process.env.DATABASE_URL;
// Refused instantly (discard port) — dedicated-client path fails fast, no hang.
const DEAD_DB_URL = 'postgresql://u:p@127.0.0.1:9/db_does_not_matter';
beforeEach(() => {
  mockConnect.mockReset();
  process.env.DATABASE_URL = DEAD_DB_URL;
});
afterEach(() => {
  process.env.DATABASE_URL = OLD_DB_URL;
});

describe('acquireTxClient', () => {
  it('healthy pool → returns pooled client, release() releases it', async () => {
    const pooled = { query: vi.fn(), release: vi.fn(), __restFallback: false };
    mockConnect.mockResolvedValue(pooled);
    const { acquireTxClient } = await import('../db/dbGuard.js');
    const tx = await acquireTxClient('resumeAuction');
    expect(tx.client).toBe(pooled);
    tx.release();
    expect(pooled.release).toHaveBeenCalledTimes(1);
  });

  it('pool connect throws connection failure + pg down → 503, never REST', async () => {
    const e = new Error('timeout exceeded when trying to connect');
    mockConnect.mockRejectedValue(e);
    const { acquireTxClient, ServiceUnavailableError } = await import('../db/dbGuard.js');
    await expect(acquireTxClient('resumeAuction')).rejects.toMatchObject({
      statusCode: 503,
      code: 'DB_UNAVAILABLE',
    });
    await expect(acquireTxClient('resumeAuction')).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('REST-fallback mock + pg down → 503 (does not run on mock)', async () => {
    mockConnect.mockResolvedValue({ query: vi.fn(), release: vi.fn(), __restFallback: true });
    const { acquireTxClient } = await import('../db/dbGuard.js');
    await expect(acquireTxClient('endAuction')).rejects.toMatchObject({ statusCode: 503 });
  });

  it('pool connect throws non-connection error → rethrows (not swallowed)', async () => {
    mockConnect.mockRejectedValue(new TypeError('not a function'));
    const { acquireTxClient } = await import('../db/dbGuard.js');
    await expect(acquireTxClient('resumeAuction')).rejects.toBeInstanceOf(TypeError);
  });
});

describe('saturated-pool fast path (skip 20s of doomed acquires)', () => {
  it('uses dedicated client immediately when pool is saturated', async () => {
    const guardSrc = fs.readFileSync(path.join(__dirname, '../db/dbGuard.js'), 'utf8');
    expect(guardSrc).toContain('pool saturated, using dedicated tx client');
    expect(guardSrc).toContain('openDedicatedTxClient');
  });

  it('probe fails fast (5s default, not 30s)', () => {
    const poolSrc = fs.readFileSync(path.join(__dirname, '../db/pool.js'), 'utf8');
    expect(poolSrc).toMatch(/ensureDirectPg\(timeoutMs = 5000\)/);
  });
});

describe('starter never holds a transaction open for email', () => {
  it('queues emails in-tx, sends after COMMIT+release', () => {
    const starterSrc = fs.readFileSync(path.join(__dirname, '../services/auctionStarter.js'), 'utf8');
    expect(starterSrc).toContain('pendingEmails');
    expect(starterSrc).toContain('Outside the transaction');
  });
});

describe('structured 503 contract (AUCTION_OPERATION_UNAVAILABLE)', () => {
  const manageSrc = fs.readFileSync(
    path.join(__dirname, '../controllers/shop-owner/auctionManage.controller.js'), 'utf8'
  );

  it('all five mutations use the structured unavailable body', () => {
    expect(manageSrc).toContain("code: 'AUCTION_OPERATION_UNAVAILABLE'");
    expect(manageSrc).toContain('Auction action temporarily unavailable.');
  });

  it('resume guard failure no longer echoes internal error text', () => {
    expect(manageSrc).not.toContain('res.status(err.statusCode');
  });

  it('resume maps only true connection failures to 503 (SQL errors stay 500)', () => {
    expect(manageSrc).toMatch(/ServiceUnavailableError \|\| isConnFailure\(e\)/);
    expect(manageSrc).toContain("message: 'Failed to resume auction'");
  });
});
