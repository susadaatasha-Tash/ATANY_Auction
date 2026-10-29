// Verifies that a PostgreSQL connection string can serve the write paths that
// placeBid() requires: SERIALIZABLE transactions + SELECT ... FOR UPDATE row
// locking. Reads work fine over the Supabase REST fallback, so a green REST
// response does NOT prove bidding works — only this check does.
//
// Usage:
//   node --env-file=.env scripts/check-direct-db.mjs
//   DATABASE_URL='postgresql://...' node scripts/check-direct-db.mjs
//
// Read-only: it opens a transaction, takes a row lock, and ROLLBACKs.
// It never writes.

import fs from 'node:fs';
import pg from 'pg';

const url =
  process.env.DATABASE_URL ||
  (() => {
    try {
      const env = Object.fromEntries(
        fs
          .readFileSync(new URL('../.env', import.meta.url), 'utf8')
          .split('\n')
          .filter((l) => l.includes('='))
          .map((l) => [
            l.slice(0, l.indexOf('=')).trim(),
            l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, ''),
          ])
      );
      return env.DATABASE_URL;
    } catch {
      return null;
    }
  })();

if (!url) {
  console.error('No DATABASE_URL found (checked env and backend/.env).');
  process.exit(1);
}

// Report the host without leaking credentials.
const host = (() => {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}`;
  } catch {
    return '(unparseable)';
  }
})();

const checks = [
  { name: 'TCP connect + auth', run: async (c) => c.query('SELECT 1') },
  {
    name: 'SERIALIZABLE transaction',
    run: async (c) => c.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE'),
  },
  {
    name: 'SELECT ... FOR UPDATE (row lock)',
    run: async (c) => c.query('SELECT id FROM bids LIMIT 1 FOR UPDATE'),
  },
  {
    name: 'read a table',
    run: async (c) => c.query('SELECT COUNT(*)::int AS n FROM auctions'),
  },
];

const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 10_000,
  ssl: { rejectUnauthorized: false },
});

console.log(`\n  Target: ${host}\n`);
let failed = false;

try {
  await client.connect();
  for (const check of checks) {
    try {
      const r = await check.run(client);
      const extra = r?.rows?.[0]?.n != null ? ` (${r.rows[0].n} auctions)` : '';
      console.log(`  PASS  ${check.name}${extra}`);
    } catch (e) {
      failed = true;
      console.log(`  FAIL  ${check.name} -> ${e.message}`);
      break;
    }
  }
  try {
    await client.query('ROLLBACK');
  } catch {
    /* connection may already be gone */
  }
} catch (e) {
  failed = true;
  console.log(`  FAIL  TCP connect + auth -> ${e.message}\n`);

  // The two failure modes seen in practice, with the matching remedy.
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
    console.log(
      '        -> Host does not resolve on IPv4. Supabase publishes direct\n' +
        '           hosts (db.<ref>.supabase.co) as IPv6-only; if this host has\n' +
        '           no A record you need the connection pooler instead: project\n' +
        '           dashboard -> Connect -> Connection Pooler (session mode, 5432).'
    );
  } else if (e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT') {
    console.log(
      '        -> Host resolves but is unroutable. A AAAA-only Supabase direct\n' +
        '           host needs working IPv6 on this network.'
    );
  } else if (/tenant|not found/i.test(e.message)) {
    console.log(
      '        -> Pooler reachable but does not know this project. Use the\n' +
        '           exact host/region shown in the dashboard Connect panel, and\n' +
        '           the username "postgres.<project-ref>".'
    );
  }
} finally {
  try {
    await client.end();
  } catch {
    /* ignore */
  }
}

console.log(
  failed
    ? '\n  RESULT: direct Postgres NOT usable — write paths (placeBid, auction\n' +
        '  start/close, winner expiry, job locks) will fail closed with 503.\n'
    : '\n  RESULT: direct Postgres usable — write paths can run.\n'
);
process.exit(failed ? 1 : 0);