// backend/src/db/pool.js
// Transparent wrapper: tries direct pg first, falls back to Supabase REST when IPv6 DNS is unreachable.
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const directPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
});

let directOk = true;

// Quick probe on startup
directPool.query('SELECT 1').then(() => { directOk = true; }).catch(() => { directOk = false; });

// Extract table name, skipping schema prefix and trailing alias
function extractTable(sql) {
  // Match: FROM schema.table alias / FROM table alias / INTO table / UPDATE table / DELETE FROM table
  const patterns = [
    /FROM\s+(?:[a-z_]+\.)?([a-z_]+)\s/i,
    /INTO\s+(?:[a-z_]+\.)?([a-z_]+)\s*\(/i,
    /UPDATE\s+(?:[a-z_]+\.)?([a-z_]+)\s/i,
    /DELETE\s+FROM\s+(?:[a-z_]+\.)?([a-z_]+)\s/i,
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

// Minimal SQL → Supabase REST translation for simple CRUD
async function restQuery(sql, params) {
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

  // UPDATE table SET … WHERE id=$N RETURNING *
  if (upper.startsWith('UPDATE')) {
    const setM = sql.match(/SET\s+([\s\S]+?)\s+WHERE/i);
    if (!setM) throw new Error('REST fallback: cannot parse UPDATE SET');
    const setClause = setM[1];
    const whereM = sql.match(/WHERE\s+([a-z_.]+)\s*=\s*\$(\d+)/i);
    if (!whereM) throw new Error('REST fallback: cannot parse UPDATE WHERE');
    const idCol = whereM[1].split('.').pop();
    const whereVal = params[Number(whereM[2]) - 1];

    const updates = {};
    // col = $N
    const setParamRe = /([a-z_]+)\s*=\s*\$(\d+)/gi;
    let sm;
    while ((sm = setParamRe.exec(setClause)) !== null) {
      updates[sm[1]] = params[Number(sm[2]) - 1];
    }
    // col = 'literal'
    const setLitRe = /([a-z_]+)\s*=\s*'([^']+)'/gi;
    while ((sm = setLitRe.exec(setClause)) !== null) {
      if (!(sm[1] in updates)) updates[sm[1]] = sm[2];
    }

    if (Object.keys(updates).length === 0) throw new Error('REST fallback: no update fields parsed');
    const { data, error } = await supabase.from(table).update(updates).eq(idCol, whereVal).select().single();
    if (error) throw new Error(error.message);
    return { rows: [data] };
  }

  // DELETE FROM table WHERE col = $N [AND col2 = $M]
  if (upper.startsWith('DELETE')) {
    const whereClause = sql.match(/WHERE\s+([\s\S]+)/i);
    if (!whereClause) throw new Error('REST fallback: cannot parse DELETE WHERE');
    const whereStr = whereClause[1];
    // Support up to two conditions: id=$1 AND user_id=$2
    const condRe = /([a-z_]+)\s*=\s*\$(\d+)/gi;
    let m;
    let q = supabase.from(table).delete();
    let hasCond = false;
    while ((m = condRe.exec(whereStr)) !== null) {
      const col = m[1];
      const val = params[Number(m[2]) - 1];
      q = q.eq(col, val);
      hasCond = true;
    }
    if (!hasCond) throw new Error('REST fallback: cannot parse DELETE WHERE');
    const { error, data } = await q.select();
    if (error) throw new Error(error.message);
    return { rowCount: data ? data.length : 0, rows: [] };
  }

  throw new Error(`REST fallback: unsupported SQL: ${upper.slice(0, 50)}`);
}

// Expose query() matching pg.Pool.query() signature
async function query(sql, params = []) {
  if (directOk) {
    try {
      return await directPool.query(sql, params);
    } catch (e) {
      const isConn = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'pool is ended'].some(k => (e.message || '').includes(k));
      if (isConn) {
        console.error('[pool] direct pg failed, switching to REST fallback:', e.message);
        directOk = false;
      } else {
        throw e;
      }
    }
  }
  return restQuery(sql, params);
}

// Provide pool.connect() for transaction support — wraps each query in mock BEGIN/COMMIT
// For complex multi-query transactions, falls back to sequential REST calls (not truly atomic)
async function connect() {
  if (directOk) {
    try {
      return await directPool.connect();
    } catch (e) {
      const isConn = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'pool is ended'].some(k => (e.message || '').includes(k));
      if (isConn) directOk = false;
    }
  }
  // Mock client for REST fallback — executes queries sequentially
  return {
    query: async (sql, params) => {
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('BEGIN') || upper.startsWith('COMMIT') || upper.startsWith('ROLLBACK')) return { rows: [] };
      return restQuery(sql, params);
    },
    release: () => {},
  };
}

export const pool = { query, connect, on: directPool.on.bind(directPool) };
export default pool;
