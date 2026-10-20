// backend/src/db/connectionInfo.js
// Sanitized connection-string classification — never extracts or logs credentials.
// Used for pool diagnostics only (no behavior change).
export function describeConnectionString(cs = '') {
  try {
    const s = String(cs || '');
    if (!s) return { mode: 'unknown', port: null, ssl: false };
    const u = new URL(s);
    const port = u.port ? Number(u.port) : (u.protocol === 'postgresql:' || u.protocol === 'postgres:' ? 5432 : null);
    const host = (u.hostname || '').toLowerCase();
    const isPoolerHost = host.includes('pooler.supabase.com') || host.includes('pooler.supabase.co');
    const isDirectHost = /^db\.[a-z0-9-]+\.supabase\.co$/.test(host);
    let mode = 'unknown';
    if (port === 6543) mode = 'supabase-pooler-transaction';
    else if (isPoolerHost && port === 5432) mode = 'supabase-pooler-session';
    else if (isDirectHost && port === 5432) mode = 'supabase-direct';
    else if (isDirectHost && !port) mode = 'supabase-direct';
    const params = u.search || '';
    const sslmode = /sslmode=([^&]*)/i.exec(params)?.[1] || null;
    return { mode, port, sslmode };
  } catch {
    return { mode: 'unknown', port: null, ssl: false };
  }
}

export function isTransactionPooler(cs = '') {
  return describeConnectionString(cs).mode === 'supabase-pooler-transaction';
}

// Connection-failure classification (pure — safe to unit test without a pool).
// Only true network/system failures flip the pool unhealthy. SQLSTATE classes
// below are ALWAYS query/business errors, never connectivity:
//   23 integrity (23505 unique, 23503 FK), 22 data (22P02 invalid syntax),
//   42 syntax/access, 40 transaction rollback.
// E.g. a paused-enum error on a DB missing migration 030 is a schema problem,
// not a network problem — it must not poison directOk.
const CONN_FAILURE_HINTS = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'pool is ended', 'timeout exceeded', 'connection terminated', 'Connection terminated unexpectedly', 'socket closed', 'socket hang up'];
const QUERY_ERROR_CODE_RE = /^(23|22|42|40)/;
// 57014 query_canceled (statement/query timeout killed a SLOW query) is a
// query error, never a dead connection — it must not poison directOk.
const QUERY_ERROR_CODES_EXACT = ['57014'];
const QUERY_ERROR_HINTS = ['invalid input value for enum', 'syntax error', 'violates ', 'constraint ', 'invalid input syntax', 'canceling statement'];

export function isQueryError(e) {
  if (e && typeof e.code === 'string') {
    if (QUERY_ERROR_CODES_EXACT.includes(e.code)) return true;
    if (QUERY_ERROR_CODE_RE.test(e.code)) return true;
  }
  const msg = String(e?.message || '').toLowerCase();
  return QUERY_ERROR_HINTS.some(k => msg.includes(k));
}

const CONN_FAILURE_CODES = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ECONNABORTED'];
export function isConnFailure(e) {
  if (isQueryError(e)) return false;
  if (e && typeof e.code === 'string' && CONN_FAILURE_CODES.includes(e.code)) return true;
  return CONN_FAILURE_HINTS.some(k => (String(e?.message || '')).includes(k));
}
