// backend/src/db/pool.js
// Transparent wrapper: tries direct pg first, falls back to Supabase REST when IPv6 DNS is unreachable.
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { describeConnectionString, isTransactionPooler, isConnFailure, isQueryError } from './connectionInfo.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Pool sizing is explicit (pg default max is 10 — 4 concurrent per-minute cron jobs
// plus API traffic can burst; exhaustion surfaces as "timeout exceeded").
// connectionTimeout 10s: Supabase direct over IPv6 from local dev routinely exceeds 5s
// on cold start/DNS; 5s turned single blips into 60s of REST fallback (pause 503s).
const directPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // PG_SSL_DISABLED=true only for local non-SSL dev databases (e.g. Homebrew
  // Postgres without certs). Supabase always requires SSL — default stays on.
  ssl: process.env.PG_SSL_DISABLED === 'true' ? false : { rejectUnauthorized: false },
  max: 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  // Bound every query: a response that never arrives (stalled TCP, firewall,
  // VPN-mangled loopback) must error instead of parking a pool client forever.
  // 15s is generous — legitimate queries here run in ms (measured: role check
  // ~1ms, mutations commit in ~30ms end-to-end). A wedged query surfaces at
  // 15s instead of 30s, halving worst-case mutation latency. Expiry surfaces
  // as 'Query read timeout', which isConnFailure() treats as a query error
  // (never flips the pool unhealthy).
  query_timeout: 15000,
  keepAlive: true,
  application_name: 'atany-backend',
});

let directOk = true;

// Sanitized diagnostics — pool counters + connection mode only.
// Never logs DATABASE_URL, credentials, or full connection string.
export function logPoolStatus(reason = '') {
  try {
    const info = describeConnectionString(process.env.DATABASE_URL);
    console.log(
      `[pool] status${reason ? ` (${reason})` : ''}: total=${directPool.totalCount} idle=${directPool.idleCount} waiting=${directPool.waitingCount} directOk=${directOk} mode=${info.mode} port=${info.port ?? '?'} ssl=true`
    );
  } catch {}
}

// Health timestamps (ISO strings, no sensitive data). Updated on every direct
// success and every flip to fallback — powers GET /api/health/database.
let lastSuccessAt = null;
let lastFailureAt = null;
let lastFailureCode = null;

function noteDirectSuccess() {
  lastSuccessAt = new Date().toISOString();
}

function noteDirectFailure(e) {
  lastFailureAt = new Date().toISOString();
  lastFailureCode = (e && typeof e.code === 'string' ? e.code : 'UNKNOWN').slice(0, 24);
}

export function getPoolHealth() {
  const info = describeConnectionString(process.env.DATABASE_URL);
  const out = {
    direct_pg: directOk,
    mode: info.mode === 'supabase-direct' ? 'direct' : info.mode,
    pool: { total: directPool.totalCount, idle: directPool.idleCount, waiting: directPool.waitingCount },
    last_success: lastSuccessAt,
    last_failure: lastFailureAt,
    last_failure_code: lastFailureCode,
  };
  return out;
}

// On-demand health verification for transaction-sensitive mutations.
// requireDirectPg() trusts the cached directOk flag, which can go stale: a
// transient failure flips it false, and subsequent mutations are rejected
// without ever trying the database again until the background reprobe fires.
// This probes direct pg immediately when the flag is false — if the DB has
// recovered, the mutation proceeds; if not, it still fails closed (never REST).
//
// The probe uses a DEDICATED pg.Client — never directPool — so a saturated
// main pool (all clients checked out, waiters queued) cannot block the health
// signal itself. A saturated pool previously made every probe time out behind
// waiters, pinning directOk=false permanently (resume/end 503s forever).
// Direct pg only: no REST fallback involved in this path.
export async function ensureDirectPg(timeoutMs = 5000) {
  if (directOk) return true;
  let client = null;
  try {
    client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PG_SSL_DISABLED === 'true' ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: Math.min(timeoutMs, 5000),
      query_timeout: timeoutMs,
      application_name: 'atany-backend-probe',
    });
    await Promise.race([
      (async () => {
        await client.connect();
        await client.query('SELECT 1');
      })(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('health probe timeout')), timeoutMs))
    ]);
    directOk = true;
    noteDirectSuccess();
    console.log('[pool] direct pg recovered on demand, resuming direct queries');
    logPoolStatus('recovered-on-demand');
    return true;
  } catch (e) {
    noteDirectFailure(e);
    return false;
  } finally {
    // Always release the probe connection — a leaked probe per mutation would
    // exhaust the database exactly when it is recovering.
    if (client) {
      try { await client.end(); } catch {}
    }
  }
}

// Transaction-pooler (:6543) does NOT support advisory locks / multi-statement
// transactions this backend relies on (jobLock, SERIALIZABLE bids, auction close).
// Warn once at startup; behavior is unchanged (fail closed, never downgrade).
if (isTransactionPooler(process.env.DATABASE_URL)) {
  console.warn('[pool] WARNING: DATABASE_URL uses transaction pooler (:6543) — advisory locks and multi-statement transactions are unsupported there. Use direct (db.*.supabase.co:5432) or session pooler (:5432).');
}

// Quick probe on startup
directPool.query('SELECT 1').then(() => { directOk = true; noteDirectSuccess(); }).catch((e) => { directOk = false; noteDirectFailure(e); });

// Failure classification lives in connectionInfo.js (pure, unit-tested):
// only true network/system failures flip the pool unhealthy — SQLSTATE query
// errors (unique violations, enum errors, syntax) never poison directOk.

// Retry once on direct before flipping to REST fallback: a single transient blip
// (cold connect, IPv6, DNS, brief pool exhaustion) must not pin the process to
// non-atomic fallback for a full minute (pause/resume/extend/end 503s).
async function directQueryWithRetry(sql, params) {
  try {
    const r = await directPool.query(sql, params);
    noteDirectSuccess();
    return r;
  } catch (e) {
    if (!isConnFailure(e)) throw e;
    // One immediate retry — absorbs single transient failures.
    try {
      const r = await directPool.query(sql, params);
      noteDirectSuccess();
      return r;
    } catch (e2) {
      if (isConnFailure(e2)) {
        console.error('[pool] direct pg failed (after retry), switching to REST fallback:', e2.message);
        directOk = false;
        noteDirectFailure(e2);
        logPoolStatus('fallback');
      }
      throw e2;
    }
  }
}

// While on REST fallback, periodically re-probe direct pg so a transient
// network blip doesn't pin the process to non-atomic mock transactions forever.
// 15s (was 60s): fail-closed mutations (pause/resume/extend/end) recover faster.
const reprobeTimer = setInterval(() => {
  if (!directOk) {
    directPool.query('SELECT 1').then(() => {
      directOk = true;
      console.log('[pool] direct pg recovered, resuming direct queries');
      logPoolStatus('recovered');
    }).catch(() => {});
  }
}, 15000);
if (reprobeTimer.unref) reprobeTimer.unref();

// Extract table name, skipping schema prefix and trailing alias
function extractTable(sql) {
  // Match: FROM schema.table alias / FROM table alias / INTO table / UPDATE table / DELETE FROM table
  // The table name may be the LAST token in the statement, so the terminator
  // must accept end-of-string as well as whitespace. Previously every pattern
  // required a trailing `\s`, which silently broke simple queries such as
  // `SELECT id, home_branch_id FROM shops` and `SELECT shop_id FROM products`
  // — they threw "cannot parse table from query" and surfaced as a 503 whenever
  // direct Postgres was unreachable.
  const patterns = [
    /FROM\s+(?:[a-z_]+\.)?([a-z_]+)(?=\s|$)/i,
    /INTO\s+(?:[a-z_]+\.)?([a-z_]+)\s*\(/i,
    /UPDATE\s+(?:[a-z_]+\.)?([a-z_]+)(?=\s|$)/i,
    /DELETE\s+FROM\s+(?:[a-z_]+\.)?([a-z_]+)(?=\s|$)/i,
  ];
  for (const re of patterns) {
    const m = sql.match(re);
    if (m) return m[1];
  }
  return null;
}

// Detect queries too complex for REST (JOINs, GROUP BY, subqueries, aggregates)
function isComplexQuery(sql) {
  const upper = sql.toUpperCase();
  return /\bJOIN\b/.test(upper) || /\bGROUP\s+BY\b/.test(upper) || /\bHAVING\b/.test(upper) || /\bUNION\b/.test(upper) || /\(\s*SELECT\b/.test(upper) || /\bCOUNT\s*\(/.test(upper) || /\bSUM\s*\(/.test(upper) || /\bSUBSTRING\b/.test(upper) || /\bARRAY\b/.test(upper) || /\bJSONB\b/.test(upper) || /\bCOALESCE\b/.test(upper);
}

// Parse ALL simple WHERE equality/IN/IS NULL predicates.
// H2 ownership safety: UPDATE ... WHERE id=$1 AND user_id=$2 must keep BOTH
// predicates on REST fallback. Complex WHERE (OR, parentheses, expressions)
// cannot be proven safe → fail closed rather than drop ownership conditions.
function parseSimpleWhere(whereStr, params) {
  const conds = [];
  // Split on AND at top level (no nested parens expected in our write paths)
  const parts = whereStr.split(/\bAND\b/i).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    let m;
    // Simple IN lists first: col IN ('a','b') / col IN ($1,$2) — outer parens
    // are IN syntax, not complex expressions. Values must be literals or params.
    if ((m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s*IN\s*\(([^)]+)\)$/i))) {
      const col = m[1].split('.').pop();
      const vals = m[2].split(',').map((s) => {
        const pm = s.trim().match(/\$(\d+)/);
        return pm ? params[Number(pm[1]) - 1] : s.trim().replace(/^'|'$/g, '');
      });
      conds.push({ type: 'in', col, val: vals });
      continue;
    }
    // Reject OR / parentheses / function calls we cannot faithfully translate
    if (/\bOR\b/i.test(part) || /[()]/.test(part) || /\bCASE\b/i.test(part)) {
      throw new Error(`REST fallback: unsupported WHERE predicate (requires direct Postgres): ${part.slice(0, 80)}`);
    }
    if ((m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s*=\s*\$(\d+)$/i))) {
      const col = m[1].split('.').pop();
      conds.push({ type: 'eq', col, val: params[Number(m[2]) - 1] });
    } else if ((m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s*=\s*'([^']*)'$/i))) {
      const col = m[1].split('.').pop();
      conds.push({ type: 'eq', col, val: m[2] });
    } else if ((m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s*!=\s*\$(\d+)$/i))
      || (m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s*<>\s*\$(\d+)$/i))) {
      conds.push({ type: 'neq', col: m[1].split('.').pop(), val: params[Number(m[2]) - 1] });
    } else if ((m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s*(?:!=|<>)\s*'([^']*)'$/i))) {
      conds.push({ type: 'neq', col: m[1].split('.').pop(), val: m[2] });
    } else if ((m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s+IS\s+NULL$/i))) {
      conds.push({ type: 'isNull', col: m[1].split('.').pop() });
    } else if ((m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s+IS\s+NOT\s+NULL$/i))) {
      conds.push({ type: 'isNotNull', col: m[1].split('.').pop() });
    } else if ((m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s*=\s*NOW\(\)$/i))) {
      conds.push({ type: 'eq', col: m[1].split('.').pop(), val: new Date().toISOString() });
    } else if ((m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s*<=\s*NOW\(\)$/i))) {
      conds.push({ type: 'lte', col: m[1].split('.').pop(), val: new Date().toISOString() });
    } else if ((m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s*>=\s*NOW\(\)$/i))) {
      conds.push({ type: 'gte', col: m[1].split('.').pop(), val: new Date().toISOString() });
    } else if ((m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s*<=\s*\$(\d+)$/i))) {
      conds.push({ type: 'lte', col: m[1].split('.').pop(), val: params[Number(m[2]) - 1] });
    } else if ((m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s*>=\s*\$(\d+)$/i))) {
      conds.push({ type: 'gte', col: m[1].split('.').pop(), val: params[Number(m[2]) - 1] });
    } else if ((m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s+IS\s+DISTINCT\s+FROM\s*'([^']*)'$/i))) {
      // IS DISTINCT FROM 'literal' ≡ neq for non-null enum/text (enum values are never null here)
      conds.push({ type: 'neq', col: m[1].split('.').pop(), val: m[2] });
    } else if ((m = part.match(/^([a-z_]+(?:\.[a-z_]+)?)\s+IS\s+DISTINCT\s+FROM\s*\$(\d+)$/i))) {
      conds.push({ type: 'neq', col: m[1].split('.').pop(), val: params[Number(m[2]) - 1] });
    } else {
      throw new Error(`REST fallback: unsupported WHERE predicate (requires direct Postgres): ${part.slice(0, 80)}`);
    }
  }
  if (!conds.length) throw new Error('REST fallback: write requires WHERE conditions');
  return conds;
}

function applySimpleWhere(q, conds) {
  for (const c of conds) {
    if (c.type === 'eq') q = q.eq(c.col, c.val);
    else if (c.type === 'neq') q = q.neq(c.col, c.val);
    else if (c.type === 'in') q = q.in(c.col, c.val);
    else if (c.type === 'isNull') q = q.is(c.col, null);
    else if (c.type === 'isNotNull') q = q.not(c.col, null);
    else if (c.type === 'lte') q = q.lte(c.col, c.val);
    else if (c.type === 'gte') q = q.gte(c.col, c.val);
  }
  return q;
}

// Parse SET assignments for simple col=$N / col='literal' / col=NOW()
function parseSimpleSet(setClause, params) {
  // Reject complex expressions that REST cannot honor (money paths must use direct pg)
  if (/\bCOALESCE\s*\(/i.test(setClause) || /\bCASE\b/i.test(setClause) || /::/.test(setClause)) {
    throw new Error('REST fallback: complex SET expressions require direct Postgres');
  }
  const updates = {};
  const setParamRe = /([a-z_]+)\s*=\s*\$(\d+)/gi;
  let sm;
  while ((sm = setParamRe.exec(setClause)) !== null) {
    updates[sm[1]] = params[Number(sm[2]) - 1];
  }
  const setLitRe = /([a-z_]+)\s*=\s*'([^']+)'/gi;
  while ((sm = setLitRe.exec(setClause)) !== null) {
    if (!(sm[1] in updates)) updates[sm[1]] = sm[2];
  }
  const setNowRe = /([a-z_]+)\s*=\s*NOW\(\)/gi;
  while ((sm = setNowRe.exec(setClause)) !== null) {
    if (!(sm[1] in updates)) updates[sm[1]] = new Date().toISOString();
  }
  if (Object.keys(updates).length === 0) throw new Error('REST fallback: no update fields parsed');
  return updates;
}

// Minimal SQL → Supabase REST translation for simple CRUD
async function restQuery(sql, params) {
  if (await shouldBlockNotification(sql, params)) {
    return { rows: [], rowCount: 0 };
  }
  const upper = sql.trim().toUpperCase();
  const table = extractTable(sql);
  if (!table) throw new Error('REST fallback: cannot parse table from query');

  // Complex queries (JOINs, GROUP BY, aggregates) can't be translated to REST
  if (isComplexQuery(sql)) {
    console.warn('[pool] REST fallback: complex query returning empty:', sql.trim().slice(0, 80));
    return { rows: [] };
  }

  // SELECT … FROM table [WHERE …] [ORDER BY …] [LIMIT …]
  if (upper.startsWith('SELECT')) {
    // Parse explicit column list or fall back to *
    const selM = sql.match(/SELECT\s+(.+?)\s+FROM/i);
    let cols = '*';
    if (selM) {
      const raw = selM[1].trim();
      if (raw !== '*') {
        // Extract individual column names (skip aliases like "a.id", "b.name as branch")
        cols = raw.split(',').map(c => {
          c = c.trim();
          // "table.col AS alias" → just table.col
          const asM = c.match(/^(?:[a-z_]+\.)?([a-z_]+(?:\.[a-z_]+)?)\s+(?:AS\s+)?[a-z_]+$/i);
          if (asM) return asM[1].replace(/\./, ':');
          // "COUNT(*)::int as cnt" → skip complex aggregates (can't do in REST)
          if (/COUNT|SUM|AVG|MIN|MAX|::/i.test(c)) return null;
          // plain "col" or "table.col"
          const plainM = c.match(/^(?:[a-z_]+\.)?([a-z_]+)$/i);
          if (plainM) return plainM[1];
          return null;
        }).filter(Boolean);
        if (cols.length === 0 || cols.some(c => c === null)) cols = '*';
        else cols = cols.join(',');
      }
    }
    let q = supabase.from(table).select(cols);

    // WHERE — extract conditions and apply via Supabase filters
    const whereSection = sql.match(/WHERE\s+([\s\S]+?)(?:ORDER|LIMIT|GROUP|HAVING|$)/i);
    if (whereSection) {
      const ws = whereSection[1];
      // col != 'literal' (must come before = check)
      const neqRe = /([a-z_]+)\s*!=\s*'([^']+)'/gi;
      let wm;
      while ((wm = neqRe.exec(ws)) !== null) {
        const col = wm[1]; const val = wm[2];
        q = q.neq(col, val);
      }
      // col != $N
      const neqParamRe = /([a-z_]+)\s*!=\s*\$(\d+)/gi;
      while ((wm = neqParamRe.exec(ws)) !== null) {
        const col = wm[1]; const idx = Number(wm[2]) - 1;
        if (params[idx] != null) q = q.neq(col, params[idx]);
      }
      // col <= NOW() — Supabase .lte with iso timestamp
      const lteNowRe = /([a-z_]+)\s*<=\s*NOW\(\)/gi;
      while ((wm = lteNowRe.exec(ws)) !== null) {
        q = q.lte(wm[1], new Date().toISOString());
      }
      // col >= NOW()
      const gteNowRe = /([a-z_]+)\s*>=\s*NOW\(\)/gi;
      while ((wm = gteNowRe.exec(ws)) !== null) {
        q = q.gte(wm[1], new Date().toISOString());
      }
      // col < NOW()
      const ltNowRe = /([a-z_]+)\s*<\s*NOW\(\)/gi;
      while ((wm = ltNowRe.exec(ws)) !== null) {
        q = q.lt(wm[1], new Date().toISOString());
      }
      // col > NOW()
      const gtNowRe = /([a-z_]+)\s*>\s*NOW\(\)/gi;
      while ((wm = gtNowRe.exec(ws)) !== null) {
        q = q.gt(wm[1], new Date().toISOString());
      }
      // col <= $N
      const lteParamRe = /([a-z_]+)\s*<=\s*\$(\d+)/gi;
      while ((wm = lteParamRe.exec(ws)) !== null) {
        const col = wm[1]; const idx = Number(wm[2]) - 1;
        if (params[idx] != null) q = q.lte(col, params[idx]);
      }
      // col >= $N
      const gteParamRe = /([a-z_]+)\s*>=\s*\$(\d+)/gi;
      while ((wm = gteParamRe.exec(ws)) !== null) {
        const col = wm[1]; const idx = Number(wm[2]) - 1;
        if (params[idx] != null) q = q.gte(col, params[idx]);
      }
      // col < $N
      const ltParamRe = /([a-z_]+)\s*<\s*\$(\d+)/gi;
      while ((wm = ltParamRe.exec(ws)) !== null) {
        const col = wm[1]; const idx = Number(wm[2]) - 1;
        if (params[idx] != null) q = q.lt(col, params[idx]);
      }
      // col > $N
      const gtParamRe = /([a-z_]+)\s*>\s*\$(\d+)/gi;
      while ((wm = gtParamRe.exec(ws)) !== null) {
        const col = wm[1]; const idx = Number(wm[2]) - 1;
        if (params[idx] != null) q = q.gt(col, params[idx]);
      }
      // col = $N (exact match — must come after !=)
      const paramRe = /([a-z_]+(?:\.[a-z_]+)?)\s*=\s*\$(\d+)/gi;
      while ((wm = paramRe.exec(ws)) !== null) {
        const col = wm[1].split('.').pop(); const idx = Number(wm[2]) - 1;
        const val = params[idx];
        if (val !== null && val !== undefined) q = q.eq(col, val);
      }
      // col = 'literal' (AND separated)
      const litRe = /(?:AND|OR)?\s*([a-z_]+)\s*=\s*'([^']+)'/gi;
      while ((wm = litRe.exec(ws)) !== null) {
        const col = wm[1]; const val = wm[2];
        q = q.eq(col, val);
      }
      // col IN (…) with params
      const inRe = /([a-z_]+)\s+IN\s*\(([^)]+)\)/gi;
      while ((wm = inRe.exec(ws)) !== null) {
        const col = wm[1];
        const inParams = wm[2].split(',').map(s => {
          const pm = s.trim().match(/\$(\d+)/);
          return pm ? params[Number(pm[1]) - 1] : s.trim().replace(/'/g, '');
        });
        q = q.in(col, inParams);
      }
    }

    // ORDER BY
    const orderM = sql.match(/ORDER\s+BY\s+([a-z_.]+)\s*(DESC|ASC)?/i);
    if (orderM) {
      const col = orderM[1].split('.').pop();
      q = q.order(col, { ascending: (orderM[2] || 'ASC').toUpperCase() === 'ASC' });
    }
    // LIMIT
    const limM = sql.match(/LIMIT\s+(\d+)/i);
    if (limM) q = q.limit(Number(limM[1]));

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: data || [] };
  }

  // INSERT INTO table (cols) VALUES (…) RETURNING *
  if (upper.startsWith('INSERT')) {
    const colsM = sql.match(/INSERT\s+INTO\s+(?:[a-z_]+\.)?[a-z_]+\s*\(([^)]+)\)/i);
    const valsM = sql.match(/VALUES\s*\(([^)]+)\)/i);
    if (!colsM || !valsM) throw new Error('REST fallback: cannot parse INSERT');
    const cols = colsM[1].split(',').map(c => c.trim());
    const valTokens = valsM[1].split(',');
    const obj = {};
    cols.forEach((c, i) => {
      const vt = valTokens[i]?.trim();
      if (!vt) return;
      const pm = vt.match(/\$(\d+)/);
      if (pm) {
        let val = params[Number(pm[1]) - 1];
        // Convert Date objects to ISO strings for Supabase REST compatibility
        if (val instanceof Date) val = val.toISOString();
        obj[c] = val;
      } else {
        // Inline literal: 'pending', NOW(), etc.
        const litM = vt.match(/^'([^']*)'$/);
        if (litM) obj[c] = litM[1];
        else if (vt.toUpperCase() === 'NOW()') obj[c] = new Date().toISOString();
      }
    });
    const { data, error } = await supabase.from(table).insert(obj).select().single();
    if (error) throw new Error(error.message);
    return { rows: [data] };
  }

  // UPDATE table SET … WHERE id=$N [AND owner_col=$M] [AND status='x'] RETURNING *
  // H2 ownership safety: ALL simple WHERE predicates must be applied — never drop owner conditions.
  if (upper.startsWith('UPDATE')) {
    const setM = sql.match(/SET\s+([\s\S]+?)\s+WHERE/i);
    if (!setM) throw new Error('REST fallback: cannot parse UPDATE SET');
    const setClause = setM[1];
    const whereM = sql.match(/WHERE\s+([\s\S]+?)(?:\s+RETURNING\b|$)/i);
    if (!whereM) throw new Error('REST fallback: cannot parse UPDATE WHERE');
    const updates = parseSimpleSet(setClause, params);
    const conds = parseSimpleWhere(whereM[1], params);
    // Require at least one predicate on a primary key-like column when present
    const hasIdLike = conds.some((c) => /(^|_)(id|uuid)$/.test(c.col) || c.col === 'id');
    if (!hasIdLike) {
      // e.g. UPDATE seller_payment_methods SET is_default=false WHERE seller_id=$1 — seller_id is ownership
      const hasOwnership = conds.some((c) => /user_id|buyer_id|seller_id|owner_id|shop_id|customer_id/.test(c.col));
      if (!hasOwnership) {
        throw new Error('REST fallback: UPDATE without id or ownership predicate requires direct Postgres');
      }
    }
    let q = supabase.from(table).update(updates);
    q = applySimpleWhere(q, conds);
    const { data, error } = await q.select();
    if (error) throw new Error(error.message);
    return { rows: data || [], rowCount: data ? data.length : 0 };
  }

  // DELETE FROM table WHERE col = $N [AND col2 = $M] — apply ALL predicates
  if (upper.startsWith('DELETE')) {
    const whereClause = sql.match(/WHERE\s+([\s\S]+?)(?:\s+RETURNING\b|$)/i);
    if (!whereClause) throw new Error('REST fallback: cannot parse DELETE WHERE');
    const conds = parseSimpleWhere(whereClause[1], params);
    let q = supabase.from(table).delete();
    q = applySimpleWhere(q, conds);
    const { error, data } = await q.select();
    if (error) throw new Error(error.message);
    return { rowCount: data ? data.length : 0, rows: [] };
  }

  throw new Error(`REST fallback: unsupported SQL: ${upper.slice(0, 50)}`);
}

// Helper to check notification preferences before inserting (customer-only)
async function shouldBlockNotification(sql, params) {
  const upper = sql.trim().toUpperCase();
  if (!upper.startsWith('INSERT') || !upper.includes('NOTIFICATIONS')) return false;
  try {
    // Extract user_id, type, message from params (assumes order: user_id, type, message)
    const colsM = sql.match(/INSERT\s+INTO\s+(?:[a-z_]+\.)?[a-z_]+\s*\(([^)]+)\)/i);
    if (!colsM) return false;
    const cols = colsM[1].split(',').map(c => c.trim().toLowerCase());
    const userIdIdx = cols.indexOf('user_id');
    const typeIdx = cols.indexOf('type');
    const msgIdx = cols.indexOf('message');
    if (userIdIdx === -1 || typeIdx === -1 || msgIdx === -1) return false;
    // Find param indices from VALUES (...$1, $2, $3...)
    const valsM = sql.match(/VALUES\s*\(([^)]+)\)/i);
    if (!valsM) return false;
    const valTokens = valsM[1].split(',').map(s => s.trim());
    const getParam = (colIdx) => {
      const tok = valTokens[colIdx];
      const m = tok && tok.match(/\$(\d+)/);
      return m ? params[Number(m[1]) - 1] : null;
    };
    const userId = getParam(userIdIdx);
    const type = getParam(typeIdx);
    const message = getParam(msgIdx);
    if (!userId || !type) return false;
    // Use Supabase Admin API to fetch user settings (service role).
    // Bounded: a stalled settings lookup must not wedge pool.query callers
    // (bid/outbid paths). On timeout, deliver the notification (fail-open,
    // same as the catch-all below).
    const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    let data = null;
    let error = null;
    try {
      const res = await Promise.race([
        supa.auth.admin.getUserById(userId),
        new Promise((_, rej) => setTimeout(() => rej(new Error('settings lookup timeout')), 5000)),
      ]);
      data = res?.data ?? null;
      error = res?.error ?? null;
    } catch {
      return false;
    }
    if (error || !data?.user) return false;
    const settings = data.user.user_metadata?.settings;
    if (!settings) return false;
    const msgLower = String(message || '').toLowerCase();
    let category = null;
    if (type === 'payout' || msgLower.includes('order') || msgLower.includes('purchase') || msgLower.includes('shipping') || msgLower.includes('payment')) {
      category = 'order_updates';
    } else if (msgLower.includes('outbid') || msgLower.includes('win') || (msgLower.includes('bid') && !msgLower.includes('live auction') && !msgLower.includes('new auction'))) {
      if (msgLower.includes('live auction') || msgLower.includes('ending soon') || msgLower.includes('new auction')) category = 'auction_updates';
      else category = 'bid_activity';
    } else if (type === 'auction' && (msgLower.includes('live') || msgLower.includes('ending soon') || msgLower.includes('new auction'))) {
      category = 'auction_updates';
    } else if (type === 'promotion' || msgLower.includes('promotion') || msgLower.includes('deal') || msgLower.includes('special')) {
      category = 'promotions_offers';
    } else if (type === 'auction') {
      category = 'auction_updates';
    }
    if (!category) return false;
    if (settings[category] === false) {
      console.log(`[notifications] Skipped ${type} for ${userId} due to ${category}=OFF`);
      return true; // block
    }
    return false;
  } catch {
    return false;
  }
}

directPool.on('error', (e) => { try { console.log('[pool] idle client error:', e && e.message); } catch {} });
// Expose query() matching pg.Pool.query() signature
async function query(sql, params = []) {
  if (await shouldBlockNotification(sql, params)) {
    return { rows: [], rowCount: 0 };
  }
  if (directOk) {
    try {
      return await directQueryWithRetry(sql, params);
    } catch (e) {
      if (isConnFailure(e)) {
        // directOk already flipped inside directQueryWithRetry; fall through to REST.
      } else {
        throw e;
      }
    }
  }
  return restQuery(sql, params);
}

// Patch client.query with the notification-preferences gate for promise-style
// calls. CRITICAL: must pass callback-style calls through untouched — pg-pool's
// internal query() re-dispatches pool.query() on recycled idle clients as
// client.query(text, values, cb). Dropping that callback (as the previous
// 2-arg wrapper did) makes pg-pool never release the client and never settle
// the caller's promise: the query completes on the wire but the pool leaks one
// client per reuse, eventually exhausting all 10 and hanging every query.
function wrapNotificationGate(client) {
  if (client.__notifGate) return client;
  client.__notifGate = true;
  const origQuery = client.query.bind(client);
  client.query = (sql, params, cb) => {
    if (typeof params === 'function' || typeof cb === 'function') {
      return origQuery(sql, params, cb);
    }
    return (async () => {
      if (await shouldBlockNotification(sql, params || [])) {
        return { rows: [], rowCount: 0 };
      }
      return origQuery(sql, params);
    })();
  };
  return client;
}

// Provide pool.connect() for transaction support — wraps each query in mock BEGIN/COMMIT
// For complex multi-query transactions, falls back to sequential REST calls (not truly atomic)
async function connect() {
  if (directOk) {
    try {
      return wrapNotificationGate(await directPool.connect());
    } catch (e) {
      if (!isConnFailure(e)) throw e;
      // One retry before flipping — same transient-blip rationale as query().
      try {
        return wrapNotificationGate(await directPool.connect());
      } catch (e2) {
        if (isConnFailure(e2)) {
          console.error('[pool] direct pg connect failed (after retry), switching to REST fallback:', e2.message);
          directOk = false;
          noteDirectFailure(e2);
          logPoolStatus('fallback-connect');
        } else throw e2;
      }
    }
  }
  // Mock client for REST fallback — executes queries sequentially
  // __restFallback marks non-atomic path so critical writes (bids) can fail closed.
  return {
    __restFallback: true,
    query: async (sql, params) => {
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('BEGIN') || upper.startsWith('COMMIT') || upper.startsWith('ROLLBACK')) return { rows: [] };
      return restQuery(sql, params);
    },
    release: () => {},
  };
}

export const pool = { query, connect, on: directPool.on.bind(directPool) };
export function isDirectPg() { return directOk; }
// Exported for ownership-predicate regression tests (H2) + failure-classification tests
export const __test = { parseSimpleWhere, parseSimpleSet, applySimpleWhere, isComplexQuery, extractTable, isConnFailure, isQueryError };
export default pool;
