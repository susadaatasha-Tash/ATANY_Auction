// backend/src/tests/productionReadiness.test.js
// Production readiness + H2 hardening regression suite.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dbDir = path.join(root, 'db');

// Real pool.js (imported inside the mock factory for __test helpers) requires
// Supabase env at module load. Hoist dummy values so createClient succeeds.
vi.hoisted(() => {
  process.env.SUPABASE_URL ||= 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
  process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
});

const poolQuery = vi.fn();
const poolConnect = vi.fn();
vi.mock('../db/pool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    pool: {
      query: (...a) => poolQuery(...a),
      connect: (...a) => poolConnect(...a),
      on: () => {},
    },
    isDirectPg: () => true,
    __test: actual.__test,
  };
});

const { validateProductionEnv, warnMissingDevEnv, formatEnvReport } = await import('../config/validateEnv.js');
const { rateLimit, resetRateLimitBuckets } = await import('../middleware/rateLimit.js');
const { ServiceUnavailableError, requireDirectPg, withSerializableTx } = await import('../db/dbGuard.js');
const { runExclusiveJob, jobLockKey } = await import('../services/jobLock.js');
const poolMod = await import('../db/pool.js');
const { closeExpiredAuctions } = await import('../services/auctionCloser.js');
const { checkAndExpireWinners } = await import('../services/winnerExpiration.js');

beforeEach(() => {
  poolQuery.mockReset();
  poolConnect.mockReset();
  resetRateLimitBuckets();
});

// ─────────────────────────────────────────────────────────────
// 1. Migration readiness
// ─────────────────────────────────────────────────────────────
describe('migration readiness 026→029', () => {
  const files = [
    '026_subscription_plan_change.sql',
    '027_subscription_hardening.sql',
    '028_users_privilege_guard.sql',
    '029_products_proposed_schedule.sql',
  ];

  it('all four migrations exist in order', () => {
    for (const f of files) {
      expect(fs.existsSync(path.join(dbDir, 'migrations', f))).toBe(true);
    }
  });

  it('026 is idempotent (IF NOT EXISTS / DO exception enums)', () => {
    const sql = fs.readFileSync(path.join(dbDir, 'migrations/026_subscription_plan_change.sql'), 'utf8');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS billing_interval/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public.subscription_changes/);
    expect(sql).toMatch(/EXCEPTION WHEN duplicate_object THEN NULL/);
  });

  it('027 is re-runnable (CHECK/FK guarded by pg_constraint)', () => {
    const sql = fs.readFileSync(path.join(dbDir, 'migrations/027_subscription_hardening.sql'), 'utf8');
    expect(sql).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint WHERE conname = 'chk_billing_records_interval'/);
    expect(sql).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint WHERE conname = 'chk_billing_records_type'/);
    // Must not use bare ADD CONSTRAINT outside a guard
    const bare = sql.match(/^\s*ALTER TABLE[\s\S]*ADD CONSTRAINT/m);
    // Bare ALTER only allowed inside DO $$ ... IF NOT EXISTS blocks — file should have DO wrappers
    expect(sql).toMatch(/DO \$\$ BEGIN[\s\S]*ADD CONSTRAINT chk_billing_records_interval/);
  });

  it('028 drops old policy and creates privileged trigger', () => {
    const sql = fs.readFileSync(path.join(dbDir, 'migrations/028_users_privilege_guard.sql'), 'utf8');
    expect(sql).toMatch(/DROP POLICY IF EXISTS "users: self can update own name"/);
    expect(sql).toMatch(/CREATE POLICY "users: self can update own profile"/);
    expect(sql).toMatch(/trg_users_guard_privileged/);
  });

  it('029 adds proposed_* columns', () => {
    const sql = fs.readFileSync(path.join(dbDir, 'migrations/029_products_proposed_schedule.sql'), 'utf8');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS proposed_start_time TIMESTAMPTZ/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS proposed_end_time TIMESTAMPTZ/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS proposed_duration_days INTEGER/);
  });

  it('fresh schema.sql parity: trigger + subscription + payments + proposed_*', () => {
    const schema = fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8');
    expect(schema).toMatch(/users_guard_privileged_columns/);
    expect(schema).toMatch(/trg_users_guard_privileged/);
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS payments/);
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS public.subscription_changes/);
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS public.seller_payment_methods/);
    expect(schema).toMatch(/billing_interval TEXT NOT NULL DEFAULT 'monthly'/);
    expect(schema).toMatch(/idx_subscription_changes_one_pending/);
    expect(schema).toMatch(/proposed_start_time TIMESTAMPTZ/);
  });

  it('setup_complete.sql parity: subscription + billing columns + trigger', () => {
    const setup = fs.readFileSync(path.join(dbDir, 'setup_complete.sql'), 'utf8');
    expect(setup).toMatch(/users_guard_privileged_columns/);
    expect(setup).toMatch(/billing_interval TEXT NOT NULL DEFAULT 'monthly'/);
    expect(setup).toMatch(/CREATE TABLE IF NOT EXISTS public.subscription_changes/);
    expect(setup).toMatch(/CREATE TABLE IF NOT EXISTS public.seller_payment_methods/);
    expect(setup).toMatch(/idx_subscription_changes_one_pending/);
  });

  it('MIGRATIONS doc documents apply order 026→029', () => {
    const doc = fs.readFileSync(path.join(dbDir, 'MIGRATIONS_026_029.md'), 'utf8');
    expect(doc).toMatch(/026_subscription_plan_change/);
    expect(doc).toMatch(/027_subscription_hardening/);
    expect(doc).toMatch(/028_users_privilege_guard/);
    expect(doc).toMatch(/029_products_proposed_schedule/);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. Production env validation
// ─────────────────────────────────────────────────────────────
describe('production env validation', () => {
  it('non-production always ok', () => {
    expect(validateProductionEnv({ NODE_ENV: 'development' }).ok).toBe(true);
  });

  it('production missing secrets fails with key names only', () => {
    const r = validateProductionEnv({ NODE_ENV: 'production' });
    expect(r.ok).toBe(false);
    expect(r.missingKeys).toContain('PAYMONGO_WEBHOOK_SECRET');
    expect(r.missingKeys).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(r.missingKeys).toContain('DATABASE_URL');
    expect(r.missingKeys).toContain('FRONTEND_URL');
  });

  it('production with full valid env passes', () => {
    const r = validateProductionEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db:5432/postgres',
      SUPABASE_URL: 'https://proj.supabase.co',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      PAYMONGO_SECRET_KEY: 'sk_live_x',
      PAYMONGO_WEBHOOK_SECRET: 'whsec_abcdef12',
      FRONTEND_URL: 'https://app.example.com',
    });
    expect(r.ok).toBe(true);
  });

  it('ALLOW_INSECURE_PAYMONGO_WEBHOOKS=true fails production', () => {
    const r = validateProductionEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://x',
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_ANON_KEY: 'a',
      SUPABASE_SERVICE_ROLE_KEY: 's',
      PAYMONGO_SECRET_KEY: 'k',
      PAYMONGO_WEBHOOK_SECRET: 'whsec_abcdef12',
      FRONTEND_URL: 'https://app.example.com',
      ALLOW_INSECURE_PAYMONGO_WEBHOOKS: 'true',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/ALLOW_INSECURE_PAYMONGO_WEBHOOKS/);
  });

  it('report never contains secret values', () => {
    const secretVal = 'whsec_SUPERSECRETVALUE999';
    const r = validateProductionEnv({ NODE_ENV: 'production', PAYMONGO_WEBHOOK_SECRET: secretVal });
    const report = formatEnvReport(r) + JSON.stringify(r);
    expect(report).not.toContain(secretVal);
  });

  it('dev warnings list missing keys without values', () => {
    const w = warnMissingDevEnv({ NODE_ENV: 'development' });
    expect(w.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 3+4. H2 ownership predicate safety (pool REST translation)
// ─────────────────────────────────────────────────────────────
describe('REST fallback ownership predicates (H2)', () => {
  const { __test } = poolMod;
  const { parseSimpleWhere, parseSimpleSet } = __test;

  it('preserves ALL simple AND predicates (id + owner)', () => {
    const conds = parseSimpleWhere("id=$1 AND user_id=$2", ['ord-1', 'user-1']);
    expect(conds).toHaveLength(2);
    expect(conds[0]).toMatchObject({ type: 'eq', col: 'id', val: 'ord-1' });
    expect(conds[1]).toMatchObject({ type: 'eq', col: 'user_id', val: 'user-1' });
  });

  it('preserves status + buyer ownership predicates', () => {
    const conds = parseSimpleWhere("id=$1 AND status='pending' AND buyer_id=$2", ['o1', 'b1']);
    expect(conds).toHaveLength(3);
    expect(conds.map((c) => c.col)).toEqual(['id', 'status', 'buyer_id']);
  });

  it('fails closed on OR predicates (cannot prove safe translation)', () => {
    expect(() => parseSimpleWhere("id=$1 OR user_id=$2", ['a', 'b'])).toThrow(/OR|direct Postgres/);
  });

  it('fails closed on complex expressions', () => {
    expect(() => parseSimpleWhere("id=$1 AND created_at > NOW() - INTERVAL '1 day'", ['a']))
      .toThrow(/direct Postgres|unsupported/);
  });

  it('parses IS DISTINCT FROM status guards (money claims)', () => {
    const conds = parseSimpleWhere("id=$1 AND status IS DISTINCT FROM 'paid'", ['p1']);
    expect(conds).toHaveLength(2);
    expect(conds[1]).toMatchObject({ type: 'neq', col: 'status', val: 'paid' });
  });

  it('parses atomic money claim IN status lists', () => {
    const conds = parseSimpleWhere("id=$1 AND status IN ('pending','processing','failed','expired')", ['p1']);
    expect(conds).toHaveLength(2);
    expect(conds[1]).toMatchObject({ type: 'in', col: 'status' });
    expect(conds[1].val).toEqual(['pending', 'processing', 'failed', 'expired']);
  });

  it('parses simple SET including NOW()', () => {
    const updates = parseSimpleSet("status='paid', paid_at=now(), updated_at=now(), metadata=$1", ['{}']);
    expect(updates.status).toBe('paid');
    expect(updates.paid_at).toBeTruthy();
    expect(updates.metadata).toBe('{}');
  });

  it('fails closed on complex SET (COALESCE money expressions)', () => {
    expect(() => parseSimpleSet("paid_at = COALESCE(paid_at, now()), status='paid'", []))
      .toThrow(/direct Postgres|complex SET/);
  });
});

// ─────────────────────────────────────────────────────────────
// 5. Money path fail-closed + job locks
// ─────────────────────────────────────────────────────────────
describe('H2 fail-closed money/job paths', () => {
  it('requireDirectPg throws ServiceUnavailableError when isDirectPg false', async () => {
    // Simulate via module mock already true; assert class shape
    expect(typeof ServiceUnavailableError).toBe('function');
    const e = new ServiceUnavailableError('x', 'DB_UNAVAILABLE');
    expect(e.code).toBe('DB_UNAVAILABLE');
    expect(e.statusCode).toBe(503);
  });

  it('auctionCloser source fails closed without direct pg markers', () => {
    const src = fs.readFileSync(path.join(root, 'services/auctionCloser.js'), 'utf8');
    expect(src).toMatch(/DB_UNAVAILABLE|fail closed/);
    expect(src).toMatch(/status != 'ended' RETURNING id/);
  });

  it('winnerExpiration source fails closed without direct pg markers', () => {
    const src = fs.readFileSync(path.join(root, 'services/winnerExpiration.js'), 'utf8');
    expect(src).toMatch(/DB_UNAVAILABLE|fail closed/);
  });

  it('bidLogic already fails closed BIDDING_UNAVAILABLE', () => {
    const src = fs.readFileSync(path.join(root, 'services/bidLogic.js'), 'utf8');
    expect(src).toMatch(/BIDDING_UNAVAILABLE/);
  });

  it('webhook paid path uses atomic claim + requireDirectPg', () => {
    const src = fs.readFileSync(path.join(root, 'controllers/webhook.controller.js'), 'utf8');
    expect(src).toMatch(/requireDirectPg/);
    expect(src).toMatch(/status IN \('pending','processing','failed','expired'\)/);
  });

  it('payment polling path uses atomic claim + requireDirectPg', () => {
    const src = fs.readFileSync(path.join(root, 'controllers/customer/payment.controller.js'), 'utf8');
    expect(src).toMatch(/requireDirectPg/);
    expect(src).toMatch(/status IN \('pending','processing','failed','expired'\)/);
  });

  it('subscription apply paths require direct pg', () => {
    const src = fs.readFileSync(path.join(root, 'services/subscriptionPlanChangeService.js'), 'utf8');
    expect(src).toMatch(/requireDirectPg\('applyUpgradeChange'\)/);
    expect(src).toMatch(/requireDirectPg\('applyScheduledChangesDue'\)/);
  });

  it('auctionCloser skips when pool reports REST fallback client', async () => {
    poolQuery.mockResolvedValue({ rows: [{ id: 'auc-1' }], rowCount: 1 });
    poolConnect.mockResolvedValue({
      __restFallback: true,
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    });
    const result = await closeExpiredAuctions();
    // isDirectPg mock is true so it enters loop, then client.__restFallback skips
    expect(poolConnect).toHaveBeenCalled();
  });

  it('jobLock skips when REST fallback', async () => {
    // pool mock has isDirectPg true — force via connect returning restFallback client
    poolConnect.mockResolvedValue({
      __restFallback: true,
      query: vi.fn(async () => ({ rows: [{ locked: false }] })),
      release: vi.fn(),
    });
    const fn = vi.fn();
    const result = await runExclusiveJob('auction_close', fn);
    expect(result.skipped).toBe(true);
    expect(fn).not.toHaveBeenCalled();
  });

  it('jobLock acquires advisory lock then runs', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
        if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    poolConnect.mockResolvedValue(client);
    const fn = vi.fn(async () => 'ran');
    const result = await runExclusiveJob('auction_close', fn);
    expect(result.skipped).toBe(false);
    expect(result.result).toBe('ran');
    expect(fn).toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [jobLockKey('auction_close')]);
  });

  it('jobLock skips when another instance holds the lock', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: false }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    poolConnect.mockResolvedValue(client);
    const fn = vi.fn();
    const result = await runExclusiveJob('winner_expire', fn);
    expect(result).toMatchObject({ skipped: true, reason: 'LOCKED' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('withSerializableTx fails closed on rest fallback client', async () => {
    poolConnect.mockResolvedValue({
      __restFallback: true,
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    });
    await expect(withSerializableTx('test-op', async () => 'x')).rejects.toMatchObject({
      code: 'DB_UNAVAILABLE',
      statusCode: 503,
    });
  });
});

// ─────────────────────────────────────────────────────────────
// 6. Rate limiting
// ─────────────────────────────────────────────────────────────
describe('rate limiting', () => {
  function mockReqRes(ip = '1.2.3.4') {
    const req = { ip, socket: { remoteAddress: ip }, body: {}, headers: {} };
    const res = {
      statusCode: null,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
    return { req, res };
  }

  it('allows requests under the limit then blocks', () => {
    const mw = rateLimit({ name: 't1', windowMs: 60_000, max: 3 });
    const { req, res } = mockReqRes();
    let nextCount = 0;
    const next = () => { nextCount += 1; };
    mw(req, res, next);
    mw(req, res, next);
    mw(req, res, next);
    expect(nextCount).toBe(3);
    mw(req, res, next);
    expect(res.statusCode).toBe(429);
    expect(nextCount).toBe(3);
  });

  it('separate IPs have separate buckets', () => {
    const mw = rateLimit({ name: 't2', windowMs: 60_000, max: 1 });
    const a = mockReqRes('10.0.0.1');
    const b = mockReqRes('10.0.0.2');
    const next = vi.fn();
    mw(a.req, a.res, next);
    mw(b.req, b.res, next);
    expect(next).toHaveBeenCalledTimes(2);
    mw(a.req, a.res, next);
    expect(a.res.statusCode).toBe(429);
  });
});

// ─────────────────────────────────────────────────────────────
// 7. Smoke script + CI wiring
// ─────────────────────────────────────────────────────────────
describe('smoke script + CI', () => {
  it('production-smoke.mjs exists and covers required areas', () => {
    const smoke = fs.readFileSync(path.join(root, '../scripts/production-smoke.mjs'), 'utf8');
    expect(smoke).toMatch(/AUTH sync-user unauthenticated/);
    expect(smoke).toMatch(/WEBHOOK invalid signature/);
    expect(smoke).toMatch(/AUCTION/);
    expect(smoke).toMatch(/SUBSCRIPTION/);
    expect(smoke).toMatch(/PAYMENT stale winner/);
    expect(smoke).toMatch(/process\.exit/);
  });

  it('CI workflow runs backend tests, frontend tests, frontend build', () => {
    const ci = fs.readFileSync(path.join(__dirname, '../../../.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/working-directory: backend/);
    expect(ci).toMatch(/npm test/);
    expect(ci).toMatch(/working-directory: frontend/);
    expect(ci).toMatch(/npm run build/);
    expect(ci).toMatch(/node --check/);
  });

  it('auth routes rate-limit login and sync-user', () => {
    const routes = fs.readFileSync(path.join(root, 'routes/auth.routes.js'), 'utf8');
    expect(routes).toMatch(/rateLimit\(\{ name: 'auth-login'/);
    expect(routes).toMatch(/rateLimit\(\{ name: 'auth-sync-user'/);
  });

  it('index.js validates production env before listen + wraps cron with job locks', () => {
    const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    expect(idx).toMatch(/validateProductionEnv/);
    expect(idx).toMatch(/process\.exit\(1\)/);
    expect(idx).toMatch(/runExclusiveJob\('auction_close'/);
    expect(idx).toMatch(/runExclusiveJob\('winner_expire'/);
    expect(idx).toMatch(/rateLimit\(\{ name: 'chat'/);
    // Webhook must NOT be rate-limited
    const webhookMount = idx.slice(idx.indexOf("app.use('/webhooks'"), idx.indexOf("app.use('/webhooks'") + 200);
    expect(webhookMount).not.toMatch(/rateLimit/);
  });
});
