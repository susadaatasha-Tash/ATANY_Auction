// backend/src/db/migrate.js
//
// Forward-migration runner.
//
// WHY THIS EXISTS
// ---------------
// `npm run migrate` only ran `psql -f src/db/schema.sql`. Nothing ever applied
// `src/db/migrations/*.sql`, so a migration written for a deployed environment
// could sit on disk unapplied while the application code that depends on it
// shipped. That is exactly how the winner-fallback schema drifted: migration 021
// added orders.payment_deadline / winner_confirmed_at / winner_rank and the
// order_status.'expired' value, none of which existed in the running database.
//
// USAGE
// -----
//   node src/db/migrate.js                    # apply every pending migration
//   node src/db/migrate.js --baseline=32      # mark 001..032 applied, then apply the rest
//   node src/db/migrate.js --status           # report only
//   node src/db/migrate.js --file=033_x.sql   # apply exactly one file
//
// `--baseline=N` is for databases that were bootstrapped from schema.sql before
// this runner existed: those environments already contain the effects of 001..N,
// so re-executing files that are not idempotent (bare CREATE TYPE) would be
// unsafe. Marking them recorded is the honest representation of reality.
//
// Safety: every migration is expected to be idempotent. The runner records the
// file name + checksum and never re-runs a recorded migration.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pool, isDirectPg } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const argv = process.argv.slice(2);
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return null;
  const [k, v] = hit.split('=');
  return v === undefined ? true : v;
};

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => {
      const na = Number(a.split('_')[0]);
      const nb = Number(b.split('_')[0]);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.localeCompare(b);
    });
}

const checksum = (sql) => crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function appliedSet() {
  const { rows } = await pool.query('SELECT filename, checksum FROM public.schema_migrations');
  return new Map(rows.map((r) => [r.filename, r.checksum]));
}

/**
 * Migrations must never run inside a transaction: `ALTER TYPE ... ADD VALUE`
 * is illegal in a transaction block on older PostgreSQL, and several existing
 * migrations rely on that.
 */
async function applyFile(file) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  await pool.query(sql);
  await pool.query(
    'INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1,$2) ON CONFLICT (filename) DO NOTHING',
    [file, checksum(sql)]
  );
  console.log(`  applied  ${file}`);
}

async function main() {
  if (!isDirectPg()) {
    console.error('[migrate] direct Postgres unavailable — migrations need a real pg connection.');
    process.exitCode = 1;
    return;
  }
  await ensureTable();
  const applied = await appliedSet();
  const all = listMigrations();

  const baseline = flag('baseline');
  if (baseline && baseline !== true) {
    const upTo = Number(baseline);
    for (const f of all) {
      if (Number(f.split('_')[0]) > upTo) break;
      if (applied.has(f)) continue;
      await pool.query(
        'INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1,$2) ON CONFLICT (filename) DO NOTHING',
        [f, 'baseline']
      );
      applied.set(f, 'baseline');
      console.log(`  baseline ${f}`);
    }
  }

  const only = flag('file');
  if (only && only !== true) {
    if (!all.includes(only)) {
      console.error(`[migrate] unknown migration file: ${only}`);
      process.exitCode = 1;
      return;
    }
    if (applied.has(only)) console.log(`  skipped  ${only} (already applied)`);
    else await applyFile(only);
    return;
  }

  if (flag('status')) {
    console.log('applied:');
    for (const f of all) console.log(`  ${applied.has(f) ? 'x' : ' '} ${f}`);
    const pending = all.filter((f) => !applied.has(f));
    console.log(pending.length ? `PENDING: ${pending.join(', ')}` : 'PENDING: none');
    return;
  }

  const pending = all.filter((f) => !applied.has(f));
  if (!pending.length) {
    console.log('[migrate] nothing pending — schema is up to date.');
    return;
  }
  console.log(`[migrate] applying ${pending.length} migration(s)…`);
  for (const f of pending) {
    try {
      await applyFile(f);
    } catch (e) {
      console.error(`[migrate] FAILED on ${f}: ${e.message}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log('[migrate] done.');
}

main()
  .catch((e) => { console.error('[migrate] fatal:', e.message); process.exitCode = 1; })
  .finally(() => process.exit(process.exitCode || 0));