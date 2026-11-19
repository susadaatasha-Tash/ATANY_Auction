// backend/src/services/jobLock.js
// Multi-instance cron safety: PostgreSQL advisory locks so overlapping backend
// processes cannot run the same scheduled job concurrently.
// Process-local onceAtATime guards remain as a cheap first line; this lock is
// the cross-instance source of truth.
import { pool, isDirectPg } from '../db/pool.js';
import { ServiceUnavailableError } from '../db/dbGuard.js';

/** Stable 32-bit keyspace for named jobs (advisory lock bigint). */
const LOCK_KEYS = {
  auction_close: 910001,
  auction_start: 910002,
  winner_expire: 910003,
  payment_reminder: 910004,
  billing_jobs: 910005,
  subscription_scheduled: 910006,
  payment_evidence: 910007,
};

export function jobLockKey(name) {
  return LOCK_KEYS[name] ?? null;
}

/**
 * Run fn while holding a Postgres advisory lock.
 * - Direct pg required (advisory locks are not available on REST fallback).
 * - If another instance holds the lock, returns { skipped: true } without running fn.
 * - Always releases the lock in finally when we acquired it.
 */
export async function runExclusiveJob(name, fn, { lockKey } = {}) {
  const key = lockKey ?? jobLockKey(name);

  // Prevent jobs from using missing or invalid lock keys
  if (!Number.isSafeInteger(key)) {
    throw new Error(`[jobLock] Unknown lock key for job: ${name}`);
  }

  let direct = true;
  try {
    direct = typeof isDirectPg === 'function' ? !!isDirectPg() : true;
  } catch {
    direct = false;
  }
  if (!direct) {
    console.warn(`[jobLock] ${name} skipped — direct Postgres unavailable (fail closed)`);
    return { skipped: true, reason: 'DB_UNAVAILABLE' };
  }
  // Unit-test mocks may omit connect — claim UPDATE remains the per-row safety net.
  if (typeof pool.connect !== 'function') {
    return { skipped: false, result: await fn(), lockless: true };
  }

  const client = await pool.connect();
  let acquired = false;
  try {
    if (client?.__restFallback || !direct) {
      console.warn(`[jobLock] ${name} skipped — REST fallback cannot hold advisory locks`);
      return { skipped: true, reason: 'DB_UNAVAILABLE' };
    }
    const session = await client.query(`
  SELECT pg_backend_pid() AS pid,
         current_setting('application_name') AS app
`);

console.log(
  `[jobLock] ${name} attempting lock`,
  { pid: session.rows[0]?.pid, app: session.rows[0]?.app, key }
);
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [key]);

    acquired = !!rows[0]?.locked;
    if (!acquired) {
      console.warn(`[jobLock] ${name} skipped — lock held by another instance`);
      return { skipped: true, reason: 'LOCKED' };
    }
    const result = await fn(client);
    return { skipped: false, result };
    } finally {
    if (acquired) {
      try {
        const unlock = await client.query(`
          SELECT
            pg_backend_pid() AS pid,
            pg_advisory_unlock($1) AS unlocked
        `, [key]);

        console.log(`[jobLock] ${name} unlock result:`, {
          pid: unlock.rows[0]?.pid,
          unlocked: unlock.rows[0]?.unlocked
        });
      } catch (e) {
        console.error(`[jobLock] ${name} unlock failed:`, e.message);
      }
    }
    client.release();
  }
}

export { LOCK_KEYS };
