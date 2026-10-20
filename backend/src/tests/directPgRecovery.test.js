// Focused tests for direct PostgreSQL auto-recovery in pool.js.
// ensureDirectPg probes on a dedicated pg.Client (live DATABASE_URL), never the
// shared pool, releases the client in finally, and recovers directOk when the
// database becomes reachable again without a backend restart.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({})),
}));

const pgClient = {
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
};
const pgPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  on: vi.fn(),
  end: vi.fn(),
};
vi.mock('pg', () => ({
  default: { Pool: vi.fn(() => pgPool), Client: vi.fn(() => pgClient) },
  Pool: vi.fn(() => pgPool),
  Client: vi.fn(() => pgClient),
}));

const OLD_DB_URL = process.env.DATABASE_URL;
const OLD_SUPABASE_URL = process.env.SUPABASE_URL;
const OLD_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.DATABASE_URL = 'postgresql://postgres:pw@db.ref.supabase.co:5432/postgres';
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

let poolModule;
beforeEach(async () => {
  vi.resetModules();
  // Startup probe (directPool.query('SELECT 1')) fails -> directOk=false,
  // so ensureDirectPg always takes the probe path (never early-returns).
  pgPool.query.mockRejectedValue(new Error('connect ECONNREFUSED'));
  pgClient.connect.mockReset();
  pgClient.query.mockReset();
  pgClient.end.mockReset();
  poolModule = await import('../db/pool.js');
});

afterEach(() => {
  process.env.DATABASE_URL = OLD_DB_URL;
  process.env.SUPABASE_URL = OLD_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_SUPABASE_SERVICE_ROLE_KEY;
  vi.restoreAllMocks();
});

describe('ensureDirectPg — dedicated client probe (live env)', () => {
  it('A. healthy DB: SELECT 1 succeeds, returns true, sets directOk=true, releases client', async () => {
    pgClient.connect.mockResolvedValue(undefined);
    pgClient.query.mockResolvedValue({ rows: [{ ok: 1 }] });
    // Clear the startup-probe call so we can assert the probe itself used pg.Client, not the pool.
    pgPool.query.mockClear();
    const { ensureDirectPg, isDirectPg } = poolModule;
    const result = await ensureDirectPg();
    expect(result).toBe(true);
    expect(pgClient.connect).toHaveBeenCalledTimes(1);
    expect(pgClient.query).toHaveBeenCalledWith('SELECT 1');
    expect(pgClient.end).toHaveBeenCalledTimes(1); // released in finally
    expect(isDirectPg()).toBe(true);
    // Probe used a dedicated pg.Client, not the shared pool
    expect(pgPool.query).not.toHaveBeenCalled();
  });

  it('B. down DB: connection fails, returns false, releases client, directOk stays false', async () => {
    const e = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    e.code = 'ECONNREFUSED';
    pgClient.connect.mockRejectedValue(e);
    const { ensureDirectPg, isDirectPg } = poolModule;
    const result = await ensureDirectPg();
    expect(result).toBe(false);
    expect(pgClient.end).toHaveBeenCalledTimes(1); // released even on failure
    expect(isDirectPg()).toBe(false);
  });

  it('C. recovery: first probe fails, second succeeds, directOk returns to true', async () => {
    const fail = new Error('connect ECONNREFUSED');
    fail.code = 'ECONNREFUSED';
    pgClient.connect.mockRejectedValueOnce(fail).mockResolvedValueOnce(undefined);
    pgClient.query.mockResolvedValue({ rows: [{ ok: 1 }] });
    const { ensureDirectPg, isDirectPg } = poolModule;
    expect(await ensureDirectPg()).toBe(false);
    expect(await ensureDirectPg()).toBe(true);
    expect(isDirectPg()).toBe(true);
  });

  it('D. probe timeout (~5s) fails fast, does not hang 30-40s', async () => {
    // connect never resolves -> probe is bounded by timeoutMs (5000 default)
    pgClient.connect.mockReturnValue(new Promise(() => {}));
    const { ensureDirectPg } = poolModule;
    const start = Date.now();
    const result = await ensureDirectPg(1000);
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(2000); // bounded, not 30-40s
    expect(pgClient.end).toHaveBeenCalledTimes(1); // released even on timeout
  });
});
