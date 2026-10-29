// backend/src/tests/poolCallbackPassthrough.test.js
// Regression for the pool-poisoning hang: connect() patched client.query with
// a 2-arg async wrapper that dropped pg-pool's internal callback. Recycled
// idle clients then made pool.query() never settle and never release — every
// reuse leaked a client until the pool exhausted and every query hung (webhook
// 90s hangs, direct_pg:false via connect timeouts). The wrapper must forward
// callback-style calls untouched.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const poolSrc = fs.readFileSync(path.join(__dirname, '../db/pool.js'), 'utf8');

describe('pool.connect() notification-gate wrapper', () => {
  it('forwards callback-style client.query calls (pg-pool internal reuse)', () => {
    const gateIdx = poolSrc.indexOf('function wrapNotificationGate');
    expect(gateIdx).toBeGreaterThan(-1);
    const gateBody = poolSrc.slice(gateIdx, poolSrc.indexOf('\n}', gateIdx));
    // The exact regression: a wrapper with only (sql, params) that never
    // inspects a callback argument poisons recycled pool clients.
    expect(gateBody).toMatch(/typeof params === 'function' \|\| typeof cb === 'function'/);
    expect(gateBody).toMatch(/return origQuery\(sql, params, cb\)/);
  });

  it('is idempotent — recycled clients are not re-wrapped', () => {
    const gateIdx = poolSrc.indexOf('function wrapNotificationGate');
    const gateBody = poolSrc.slice(gateIdx, poolSrc.indexOf('\n}', gateIdx));
    expect(gateBody).toMatch(/if \(client\.__notifGate\) return client;/);
  });

  it('connect() uses the shared wrapper on both the primary and retry paths', () => {
    const connectIdx = poolSrc.indexOf('async function connect()');
    expect(connectIdx).toBeGreaterThan(-1);
    const connectBody = poolSrc.slice(connectIdx, poolSrc.indexOf('\n}', connectIdx));
    const wraps = connectBody.match(/wrapNotificationGate\(await directPool\.connect\(\)\)/g);
    expect(wraps).toHaveLength(2);
    // The old poisoned pattern must not exist anywhere in the file.
    expect(poolSrc).not.toMatch(/client\.query = async \(sql, params = \[\]\)/);
  });
});
