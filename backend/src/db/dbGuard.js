// backend/src/db/dbGuard.js
// Production readiness / H2: fail closed when transactional guarantees require direct Postgres.
import pg from 'pg';
import { pool, isDirectPg, ensureDirectPg, getPoolHealth } from './pool.js';
import { isConnFailure } from './connectionInfo.js';

// Sanitized dev diagnostics for direct-only mutations. Pool counters + mode
// only — never DATABASE_URL, passwords, tokens, or keys (getPoolHealth is
// sanitized by construction).
function logDirectGuard(action, before, probed, after) {
  try {
    const h = typeof getPoolHealth === 'function' ? getPoolHealth() : null;
    const pc = h?.pool;
    console.log(
      `[dbGuard] action=${action} directOk before=${before} probe=${probed ? 'attempted' : 'skipped'} ` +
      `result=${after ? 'success' : 'unavailable'} directOk after=${after}` +
      (pc ? ` pool total=${pc.total} idle=${pc.idle} waiting=${pc.waiting}` : '')
    );
  } catch {}
}

export class ServiceUnavailableError extends Error {
  constructor(message, code = 'SERVICE_UNAVAILABLE') {
    super(message);
    this.name = 'ServiceUnavailableError';
    this.code = code;
    this.statusCode = 503;
  }
}

/**
 * Throw when the process is on Supabase REST fallback and the operation
 * requires SERIALIZABLE / FOR UPDATE / multi-statement atomic semantics.
 * Never silently downgrade transactional guarantees.
 * Test mocks that omit isDirectPg are treated as direct (unit-test convenience).
 */
export function requireDirectPg(operation = 'operation') {
  let ok = true;
  try {
    ok = typeof isDirectPg === 'function' ? !!isDirectPg() : true;
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new ServiceUnavailableError(
      `${operation} requires a direct database connection and is temporarily unavailable`,
      'DB_UNAVAILABLE'
    );
  }
}

/**
 * On-demand variant of requireDirectPg for transaction-sensitive mutations.
 * requireDirectPg trusts the cached directOk flag, which can go stale after a
 * transient failure. When the flag is false, this probes direct pg immediately:
 * recovered DB → mutation proceeds; still down → still fails closed (never REST).
 */
export async function ensureDirectPgAvailable(operation = 'operation') {
  let before = true;
  try {
    before = typeof isDirectPg === 'function' ? !!isDirectPg() : true;
  } catch {
    before = false;
  }
  let ok = before;
  let probed = false;
  if (!ok) {
    probed = true;
    try {
      ok = await ensureDirectPg();
    } catch {
      ok = false;
    }
  }
  logDirectGuard(operation, before, probed, ok);
  if (!ok) {
    throw new ServiceUnavailableError(
      `${operation} requires a direct database connection and is temporarily unavailable`,
      'DB_UNAVAILABLE'
    );
  }
}

export function assertDirectPgClient(client, operation = 'operation') {
  if (client?.__restFallback) {
    throw new ServiceUnavailableError(
      `${operation} requires a direct database connection and is temporarily unavailable`,
      'DB_UNAVAILABLE'
    );
  }
}

function directTxConfig() {
  return {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PG_SSL_DISABLED === 'true' ? false : { rejectUnauthorized: false },
    // Fail fast when pg is truly down (probe already gates; this is backstop).
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
    application_name: 'atany-backend-tx',
  };
}

/**
 * Acquire a transaction-capable DIRECT pg client for a critical mutation.
 * Fast path: shared pool (preserves pooling when healthy). If pool acquisition
 * fails with a true connection failure (saturated pool, wedged sockets) or
 * yields a REST-fallback mock, open ONE dedicated fresh pg.Client and use it
 * for the transaction instead. Real direct pg with real BEGIN/COMMIT —
 * never REST fallback. The dedicated client is always closed in release().
 * Throws ServiceUnavailableError (503) only when pg is genuinely unreachable.
 *
 * Returns { client, release }. Callers use client.query + client.__restFallback
 * exactly as before, but must call release() (not client.release()) in finally.
 */
export async function acquireTxClient(operation = 'operation') {
  // Saturated-pool fast path: if every client is checked out and waiters are
  // already queued, a pooled acquire would burn connectionTimeout (10s) + a
  // full retry (≈20s) before failing. Skip straight to the dedicated client —
  // same direct pg, same transaction, ~5s worst case instead of ~25s.
  try {
    const h = typeof getPoolHealth === 'function' ? getPoolHealth() : null;
    if (h && h.pool && h.pool.idle === 0 && h.pool.total > 0 && h.pool.waiting > 0) {
      try { console.log(`[dbGuard] ${operation} pool saturated, using dedicated tx client`); } catch {}
      return await openDedicatedTxClient(operation);
    }
  } catch {}
  try {
    const pooled = await pool.connect();
    if (pooled && !pooled.__restFallback) {
      return {
        client: pooled,
        release: () => { try { pooled.release(); } catch {} },
      };
    }
    try { pooled?.release?.(); } catch {}
  } catch (e) {
    // Only connection failures fall through to the dedicated client.
    // Anything else (programming error) must surface, not silently retry.
    if (!isConnFailure(e)) throw e;
  }
  // Pool unusable right now — dedicated fresh direct client for this op only.
  return await openDedicatedTxClient(operation);
}

async function openDedicatedTxClient(operation) {
  const raw = new pg.Client(directTxConfig());
  try {
    await raw.connect();
  } catch (e2) {
    try { await raw.end(); } catch {}
    throw new ServiceUnavailableError(
      `${operation} requires a direct database connection and is temporarily unavailable`,
      'DB_UNAVAILABLE'
    );
  }
  return {
    client: raw,
    release: () => { raw.end().catch(() => {}); },
  };
}

/**
 * Run fn inside a real SERIALIZABLE transaction on direct pg.
 * Fails closed (503) when REST fallback would only no-op BEGIN/COMMIT.
 */
export async function withSerializableTx(operation, fn) {
  // On-demand probe (not the stale cached flag): a recovered DB must not
  // keep failing closed here while the five auction mutations proceed.
  await ensureDirectPgAvailable(operation);
  const client = await pool.connect();
  try {
    assertDirectPgClient(client, operation);
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    }
  } finally {
    client.release();
  }
}

export default { ServiceUnavailableError, requireDirectPg, ensureDirectPgAvailable, assertDirectPgClient, acquireTxClient, withSerializableTx };
