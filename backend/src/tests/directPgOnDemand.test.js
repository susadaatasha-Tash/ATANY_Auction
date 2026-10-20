// backend/src/tests/directPgOnDemand.test.js
// Regression: stale directOk must not permanently block transactional mutations.
// ensureDirectPgAvailable probes on demand when the cached flag is false:
// recovered DB → proceed; still down → fail closed (never REST).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mockIsDirectPg = true;
let mockEnsureDirectPg = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn(), on: vi.fn() },
  isDirectPg: () => mockIsDirectPg,
  ensureDirectPg: (...args) => mockEnsureDirectPg(...args),
}));

import { isConnFailure, isQueryError } from '../db/connectionInfo.js';

let ensureDirectPgAvailable;
let ServiceUnavailableError;
beforeEach(async () => {
  vi.resetModules();
  const guard = await import('../db/dbGuard.js');
  ensureDirectPgAvailable = guard.ensureDirectPgAvailable;
  ServiceUnavailableError = guard.ServiceUnavailableError;
});

describe('isConnFailure classification (query errors never poison the pool)', () => {
  it.each(['23505', '23503', '22P02', '42601', '42703', '40001'])(
    'SQLSTATE %s is a query error, not a connection failure',
    (code) => {
      expect(isQueryError({ code, message: 'something failed' })).toBe(true);
      expect(isConnFailure({ code, message: 'something failed' })).toBe(false);
    }
  );

  it('paused-enum error does not flip pool unhealthy', () => {
    const e = { code: '22P08', message: 'invalid input value for enum auction_status: "paused"' };
    expect(isConnFailure(e)).toBe(false);
  });

  it('unique violation does not flip pool unhealthy', () => {
    expect(isConnFailure({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(false);
  });

  it.each(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENETUNREACH'])(
    'network error %s still flips to fallback',
    (code) => {
        const e = new Error('connect failed');
      e.code = code;
      expect(isConnFailure(e)).toBe(true);
    }
  );

  it('timeout exceeded still flips (pool exhaustion signal)', () => {
    expect(isConnFailure(new Error('timeout exceeded when trying to connect'))).toBe(true);
  });

  it('57014 query_canceled never flips (slow query, not dead DB)', () => {
    expect(isQueryError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(true);
    expect(isConnFailure({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false);
  });

  it('query read timeout never flips (single slow query, not dead DB)', () => {
    expect(isConnFailure(new Error('Query read timeout'))).toBe(false);
  });

  it('socket closed / terminated unexpectedly still flips', () => {
    expect(isConnFailure(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isConnFailure(new Error('socket closed'))).toBe(true);
  });
});

describe('ensureDirectPg probe bypasses saturated pool (dedicated client)', () => {
  const poolSrc = fs.readFileSync(path.join(__dirname, '../db/pool.js'), 'utf8');
  // Bounded to the probe body only — later code (REST translation) legitimately
  // mentions supabase/restQuery without the probe touching it.
  const probeFn = poolSrc.slice(
    poolSrc.indexOf('export async function ensureDirectPg'),
    poolSrc.indexOf('// Transaction-pooler (:6543)')
  );

  it('probe uses a dedicated pg.Client, not the shared pool', () => {
    expect(probeFn).toContain('new pg.Client');
  });

  it('probe releases its client in finally (no leak on recovery path)', () => {
    expect(probeFn).toMatch(/finally[\s\S]*\.end\(\)/);
  });

  it('probe never touches REST fallback', () => {
    expect(probeFn).not.toContain('restQuery');
    expect(probeFn).not.toContain('supabase');
  });

  it('withSerializableTx probes on demand (never stale boolean)', () => {
    const guardSrc = fs.readFileSync(path.join(__dirname, '../db/dbGuard.js'), 'utf8');
    expect(guardSrc).toContain('await ensureDirectPgAvailable(operation)');
  });

  it('guard diagnostics log no secrets', () => {
    const guardSrc = fs.readFileSync(path.join(__dirname, '../db/dbGuard.js'), 'utf8');
    // Bounded to the diagnostics helper — file prose comments may use ordinary
    // words; what matters is no secret VALUES or env lookups in the log path.
    const helper = guardSrc.slice(
      guardSrc.indexOf('function logDirectGuard'),
      guardSrc.indexOf('export class ServiceUnavailableError')
    );
    expect(helper).not.toContain('process.env.DATABASE_URL');
    expect(helper).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(helper).not.toContain('Authorization');
    expect(helper.toLowerCase()).not.toContain('password');
    expect(helper).toContain('pool total=');
  });
});

describe('ensureDirectPgAvailable (on-demand recovery)', () => {
  beforeEach(() => {
    mockIsDirectPg = true;
    mockEnsureDirectPg.mockReset();
    mockEnsureDirectPg.mockResolvedValue(true);
  });

  it('healthy flag proceeds without probing', async () => {
    await expect(ensureDirectPgAvailable('pauseAuction')).resolves.toBeUndefined();
    expect(mockEnsureDirectPg).not.toHaveBeenCalled();
  });

  it('stale false flag + recovered DB → probes once and proceeds', async () => {
    mockIsDirectPg = false;
    mockEnsureDirectPg.mockResolvedValue(true);
    await expect(ensureDirectPgAvailable('pauseAuction')).resolves.toBeUndefined();
    expect(mockEnsureDirectPg).toHaveBeenCalledTimes(1);
  });

  it('stale false flag + DB still down → fails closed 503, never REST', async () => {
    mockIsDirectPg = false;
    mockEnsureDirectPg.mockResolvedValue(false);
    await expect(ensureDirectPgAvailable('endAuction')).rejects.toMatchObject({
      name: 'ServiceUnavailableError',
      statusCode: 503,
      code: 'DB_UNAVAILABLE',
    });
  });

  it('probe throwing also fails closed', async () => {
    mockIsDirectPg = false;
    mockEnsureDirectPg.mockRejectedValue(new Error('boom'));
    await expect(ensureDirectPgAvailable('extendAuction')).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});

describe('seller mutations use on-demand verification (not stale boolean)', () => {
  const manageSrc = fs.readFileSync(path.join(__dirname, '../controllers/shop-owner/auctionManage.controller.js'), 'utf8');

  it.each(['startAuction', 'extendAuction', 'pauseAuction', 'resumeAuction', 'endAuction'])(
    '%s awaits ensureDirectPgAvailable',
    (op) => {
      expect(manageSrc).toContain(`await ensureDirectPgAvailable('${op}')`);
    }
  );

  it('shared closer verifies on demand too', () => {
    const closerSrc = fs.readFileSync(path.join(__dirname, '../services/auctionClosingService.js'), 'utf8');
    expect(closerSrc).toContain('ensureDirectPgAvailable');
  });
});

describe('GET /api/health/database (sanitized diagnostics)', () => {
  const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

  it('route is registered', () => {
    expect(indexSrc).toContain('/api/health/database');
    expect(indexSrc).toContain('getPoolHealth');
  });

  it('admin-protected in production, open in development', () => {
    expect(indexSrc).toMatch(/NODE_ENV.*production[\s\S]*\/api\/health\/database/);
    expect(indexSrc).toMatch(/requireRole\(\['admin'\]\)[^\n]*\n?.*health\/database|health\/database.*requireRole/s);
  });

  it('returns only sanitized fields (no credentials/host/DATABASE_URL)', () => {
    const poolSrc = fs.readFileSync(path.join(__dirname, '../db/pool.js'), 'utf8');
    const healthFn = poolSrc.slice(
      poolSrc.indexOf('export function getPoolHealth'),
      poolSrc.indexOf('// On-demand health verification')
    );
    expect(healthFn).toContain('direct_pg');
    expect(healthFn).toContain('last_success');
    expect(healthFn).toContain('last_failure');
    expect(healthFn.toLowerCase()).not.toContain('password');
    expect(healthFn).not.toContain('connectionString');
    expect(healthFn).not.toContain('DATABASE_URL=');
  });
});
