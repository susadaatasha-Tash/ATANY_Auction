// backend/src/tests/poolStability.test.js
// Regression: direct-PG stability for transactional auction ops (pause/resume/extend/end/close).
// - Pool must be sized/timed for Supabase direct over IPv6 (no 5s flapping).
// - Single transient blips must retry before flipping to REST fallback.
// - Diagnostics must never leak credentials.
// - Sensitive actions must still require direct PG (fail closed, never downgraded).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describeConnectionString, isTransactionPooler } from '../db/connectionInfo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const poolSrc = fs.readFileSync(path.join(__dirname, '../db/pool.js'), 'utf8');
const manageSrc = fs.readFileSync(path.join(__dirname, '../controllers/shop-owner/auctionManage.controller.js'), 'utf8');
const closerSrc = fs.readFileSync(path.join(__dirname, '../services/auctionClosingService.js'), 'utf8');

describe('pg Pool hardening (no 5s flapping)', () => {
  it('pool has explicit max and keepalive', () => {
    expect(poolSrc).toMatch(/max:\s*10/);
    expect(poolSrc).toMatch(/keepAlive:\s*true/);
    expect(poolSrc).toMatch(/application_name:\s*'atany-backend'/);
  });

  it('connection timeout is 10s (not 5s) for Supabase direct cold start', () => {
    expect(poolSrc).toMatch(/connectionTimeoutMillis:\s*10000/);
    expect(poolSrc).not.toMatch(/connectionTimeoutMillis:\s*5000/);
  });

  it('every query is bounded (no infinite park on lost responses)', () => {
    expect(poolSrc).toMatch(/query_timeout:\s*15000/);
  });

  it('retries once before flipping to REST fallback', () => {
    expect(poolSrc).toMatch(/directQueryWithRetry|retry/i);
    // Query path must not flip on first failure without retry
    expect(poolSrc).toMatch(/after retry/);
  });

  it('reprobes faster than 60s so fail-closed mutations recover', () => {
    expect(poolSrc).toMatch(/15000/);
    expect(poolSrc).not.toMatch(/}, 60000\)/);
  });

  it('diagnostics log pool counters + mode, never credentials', () => {
    expect(poolSrc).toMatch(/logPoolStatus/);
    expect(poolSrc).toMatch(/totalCount/);
    expect(poolSrc).toMatch(/idleCount/);
    expect(poolSrc).toMatch(/waitingCount/);
    // logPoolStatus body must not interpolate the raw URL or password
    // (bounded to the function body — later code legitimately references
    // process.env.DATABASE_URL to open connections, never to log it)
    const fnBody = poolSrc.slice(
      poolSrc.indexOf('export function logPoolStatus'),
      poolSrc.indexOf('// Health timestamps')
    );
    expect(fnBody).not.toMatch(/DATABASE_URL[^)]*}/);
    expect(fnBody.toLowerCase()).not.toContain('password');
  });

  it('warns on transaction pooler (:6543) without changing behavior', () => {
    expect(poolSrc).toMatch(/isTransactionPooler/);
    expect(poolSrc).toMatch(/advisory locks/);
  });
});

describe('connectionInfo classification (sanitized)', () => {
  it('classifies Supabase direct', () => {
    const r = describeConnectionString('postgresql://postgres:secret@db.abcdef.supabase.co:5432/postgres');
    expect(r.mode).toBe('supabase-direct');
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  it('classifies session pooler (:5432)', () => {
    const r = describeConnectionString('postgresql://postgres.abcdef:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres');
    expect(r.mode).toBe('supabase-pooler-session');
    expect(JSON.stringify(r)).not.toContain('pw');
  });

  it('classifies transaction pooler (:6543)', () => {
    const r = describeConnectionString('postgresql://postgres.abcdef:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres');
    expect(r.mode).toBe('supabase-pooler-transaction');
    expect(isTransactionPooler('postgresql://u:p@aws-0-x.pooler.supabase.com:6543/postgres')).toBe(true);
  });

  it('never echoes credentials', () => {
    const r = describeConnectionString('postgresql://postgres:myS3cretPw@db.ref.supabase.co:5432/postgres');
    expect(JSON.stringify(r)).not.toContain('myS3cretPw');
  });
});

describe('transactional guards intact (fail closed)', () => {
  it.each(['startAuction', 'extendAuction', 'pauseAuction', 'resumeAuction', 'endAuction'])(
    '%s verifies direct PG on demand (never stale boolean, never REST)',
    (op) => {
      expect(manageSrc).toMatch(new RegExp(`ensureDirectPgAvailable\\('${op}'\\)`));
    }
  );

  it('closeSingleAuction verifies on demand and rejects REST fallback', () => {
    expect(closerSrc).toMatch(/ensureDirectPgAvailable/);
    expect(closerSrc).toMatch(/__restFallback/);
    expect(closerSrc).toMatch(/AUCTION_OPERATION_UNAVAILABLE/);
  });
});

describe('end response + socket contract (no stale live after End)', () => {
  it('end payload forces status ended with winner/order summary', () => {
    expect(manageSrc).toContain("status: 'ended'");
    expect(manageSrc).toContain('winner_id');
    expect(manageSrc).toContain('order_id');
  });

  it('end socket event carries authoritative ended fields incl paused_at null', () => {
    expect(manageSrc).toMatch(/paused_at: null/);
    expect(manageSrc).toMatch(/status: 'ended', current_bid/);
  });

  it('enrichAuctions exposes computed status as status (ended survives)', () => {
    expect(manageSrc).toMatch(/status: computed/);
    expect(manageSrc).toContain('stored_status');
  });
});
