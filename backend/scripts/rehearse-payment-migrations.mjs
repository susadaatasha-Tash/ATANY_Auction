// LOCAL ONLY. Fixed Unix socket, fresh private cluster, no application .env.
// Never accepts DATABASE_URL, project identifiers, credentials or remote hosts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = '/private/tmp/atany-migration-rehearsal';
const port = 55440;
const user = 'atany_migrator';
const database = 'atany_migration_test';
const bin = '/opt/homebrew/bin';
const evidence = { scope: 'disposable-local-only', started_at: new Date().toISOString(), checks: {} };
const hash = value => createHash('sha256').update(value).digest('hex');
const sqlFile = name => path.join(backend, 'src/db/migrations', name);
const migrationFiles = ['037_order_cancellation_enum.sql','038_order_cancellation.sql','039_payment_safety.sql'];
const sources = Object.fromEntries(migrationFiles.map(file=>[file,fs.readFileSync(sqlFile(file),'utf8')]));
const combinedCancellation = sources[migrationFiles[0]]+'\n'+sources[migrationFiles[1]];
const paymentSafety = sources[migrationFiles[2]];
evidence.migrations = Object.fromEntries(migrationFiles.map(file=>[file,hash(sources[file])]));
// Clear inherited DB/provider variables; every child gets synthetic values only.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !/^(PG|DATABASE|SUPABASE|PAYMONGO|ATANY_)/.test(k)));
Object.assign(env, { NODE_ENV: 'test', PGOPTIONS: '-c search_path=public -c lock_timeout=5s -c statement_timeout=120s',
  PG_SSL_DISABLED: 'true', DATABASE_URL: 'postgresql://unused@127.0.0.1:1/never_connect',
  SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_SERVICE_ROLE_KEY: 'fixture',
  PAYMONGO_SECRET_KEY: 'sk_test_fixture', PAYMONGO_WEBHOOK_SECRET: 'fixture' });
function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: backend, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (path.basename(executable)==='vitest' && result.status!==0)
    fs.writeFileSync(`${root}/failed-tests.log`, `${result.stdout}\n${result.stderr}`);
  if (result.status !== 0) throw new Error(`${path.basename(executable)} failed: ${result.stderr || result.stdout || result.error}`);
  return result.stdout;
}
const psql = (db, args, options) => run(`${bin}/psql`, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', root, '-p', String(port), '-U', user, '-d', db, ...args], options);
const connect = db => new pg.Client({ host: root, port, user, database: db });
async function withDb(db, work) { const c = connect(db); await c.connect(); try { return await work(c); } finally { await c.end(); } }
const query = (db, sql, params) => withDb(db, c => c.query(sql, params));
const createDb = db => run(`${bin}/createdb`, ['-h', root, '-p', String(port), '-U', user, db]);
const applyWithRunner = file => run(process.execPath, ['src/db/migrate.js',`--file=${file}`], {
  env:{...env,DATABASE_URL:`postgresql://${user}@localhost/${database}?host=${root}&port=${port}`}
});
async function fingerprint(db) {
  return withDb(db, async c => {
    const tables = (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    const data = {};
    for (const { tablename } of tables) data[tablename] = (await c.query(`SELECT to_jsonb(t)::text AS row FROM public."${tablename}" t ORDER BY to_jsonb(t)::text`)).rows;
    const sequences = {};
    for (const { sequencename } of (await c.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows)
      sequences[sequencename] = (await c.query(`SELECT last_value::text,is_called FROM public."${sequencename}"`)).rows;
    const schema = schemaHash(db);
    return { data: hash(JSON.stringify(data)), sequences: hash(JSON.stringify(sequences)), schema };
  });
}
function schemaHash(db) {
  // pg_dump randomizes \restrict tokens. Exclude those tokens and header timestamps.
  return hash(run(`${bin}/pg_dump`, ['-h', root, '-p', String(port), '-U', user, '-d', db, '--schema-only'])
    .split('\n').filter(line => !line.startsWith('\\restrict ') && !line.startsWith('\\unrestrict ') && !line.startsWith('--')).join('\n'));
}
async function verifyBackup(db, name) {
  const started = performance.now();
  const archive = path.join(root, `${name}.dump`);
  run(`${bin}/pg_dump`, ['-h', root, '-p', String(port), '-U', user, '-d', db, '-Fc', '-f', archive]);
  createDb(name);
  run(`${bin}/pg_restore`, ['-h', root, '-p', String(port), '-U', user, '-d', name, '--exit-on-error', archive]);
  const before = await fingerprint(db), after = await fingerprint(name);
  assert.deepEqual(after, before);
  return { restored: true, matching: before, archive_sha256: hash(fs.readFileSync(archive)), elapsed_ms: Math.round(performance.now() - started) };
}

if (fs.existsSync(root)) throw new Error(`Refusing to reuse ${root}; preserve evidence and choose a separately reviewed fresh directory before rerunning.`);
fs.mkdirSync(root, { mode: 0o700 });
let started = false;
try {
  run(`${bin}/initdb`, ['-D', `${root}/pgdata`, '-U', user, '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  run(`${bin}/pg_ctl`, ['-D', `${root}/pgdata`, '-l', `${root}/server.log`, '-o', `-k ${root} -p ${port} -h "" -c unix_socket_permissions=0700`, '-w', 'start']);
  started = true;
  evidence.checks.socket_only = (await query('postgres', "SELECT current_setting('listen_addresses')='' AS local_only")).rows[0].local_only;
  assert.equal(evidence.checks.socket_only, true);
  evidence.postgresql = (await query('postgres', 'SHOW server_version')).rows[0].server_version;
  await query('postgres', 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE atany_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS');
  createDb(database);
  psql(database, ['-c', `CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;`]);
  // Use checked-in setup DDL; omit ALL original seed blocks. This is a source-derived
  // integration baseline, not a dump or claim of complete pre-036 Supabase parity.
  const setup = fs.readFileSync(path.join(backend, 'src/db/setup_complete.sql'), 'utf8');
  assert.ok(setup.includes('-- 4. SEED BRANCHES') && setup.includes('-- 10. SEED DEMO USERS'));
  const baseline = setup.slice(0, setup.indexOf('-- 4. SEED BRANCHES'))
    + setup.slice(setup.indexOf('-- 5. FUNCTIONS'), setup.indexOf('-- 10. SEED DEMO USERS'));
  fs.writeFileSync(`${root}/baseline.sql`, baseline);
  psql(database, ['-f', `${root}/baseline.sql`]);
  const dependencies = ['015_order_payment_flow.sql','016_billing_paymongo_checkout.sql','020_orders_unique_auction.sql',
    '021_auction_winner_payment_deadline.sql','022_notifications_auction_id.sql','034_winner_fallback_hardening.sql'];
  for (const file of dependencies) psql(database, ['-f', sqlFile(file)]);
  evidence.baseline = { setup_ddl_sha256: hash(baseline), dependencies };
  await query(database, `INSERT INTO users(name,email,password_hash,role) VALUES
    ('Local customer 1','customer1@fixture.invalid','not-a-password','customer'),
    ('Local customer 2','customer2@fixture.invalid','not-a-password','customer'),
    ('Local customer 3','customer3@fixture.invalid','not-a-password','customer'),
    ('Local seller','seller@fixture.invalid','not-a-password','shop_owner'),
    ('Local admin','admin@fixture.invalid','not-a-password','admin');`);
  evidence.checks.before_backup = await verifyBackup(database, 'atany_before_restore');
  // Reproduce the original combined-enum migration failure and its rollback.
  await withDb(database, async c => {
    await assert.rejects(c.query(combinedCancellation), error => { evidence.checks.combined_enum_error = error.code; return error.code === '55P04'; });
    const { rows } = await c.query("SELECT EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='order_status'::regtype AND enumlabel='cancelled') AS enum_present, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='cancelled_by') AS column_present");
    assert.deepEqual(rows[0], { enum_present: false, column_present: false });
    evidence.checks.combined_enum_rolled_back = true;
  });
  applyWithRunner(migrationFiles[0]);
  evidence.checks.migration_037 = 'passed: actual Node runner, enum committed in its own file';
  applyWithRunner(migrationFiles[1]);
  evidence.checks.migration_038 = 'passed: actual Node runner, cancellation columns and partial index';
  // Inject an error after payment-safety DDL in a real transaction.
  await withDb(database, async c => {
    await c.query('BEGIN');
    await c.query(paymentSafety);
    await assert.rejects(c.query('SELECT 1/0'), e => e.code === '22012');
    await c.query('ROLLBACK');
    assert.equal((await c.query("SELECT to_regclass('public.payment_operations') IS NULL AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='provider_checked_at') AS clean")).rows[0].clean, true);
    evidence.checks.migration_039_rollback = true;
  });
  applyWithRunner(migrationFiles[2]);
  evidence.checks.migration_039 = 'passed: actual Node runner, payment-safety DDL';
  evidence.checks.history = (await query(database,'SELECT filename,checksum FROM schema_migrations ORDER BY filename')).rows;
  assert.deepEqual(evidence.checks.history,migrationFiles.map(filename=>({filename,checksum:evidence.migrations[filename].slice(0,16)})));
  const shape = schemaHash(database);
  for (const file of migrationFiles) {
    assert.ok(applyWithRunner(file).includes('skipped'));
    psql(database,['-1','-f',sqlFile(file)]);
  }
  assert.equal(schemaHash(database), shape);
  evidence.checks.rerun_same_schema = true;
  evidence.checks.enums = (await query(database, `SELECT t.typname,e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
    WHERE t.typname IN ('order_status','payment_status') ORDER BY t.typname,e.enumsortorder`)).rows;
  evidence.checks.constraints = (await query(database, `SELECT conrelid::regclass::text AS relation,conname,contype,convalidated,
    pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN
    ('orders'::regclass,'payments'::regclass,'payment_operations'::regclass,'payment_webhook_events'::regclass,
    'provider_collections'::regclass,'payment_reconciliations'::regclass) ORDER BY relation,conname`)).rows;
  assert.ok(evidence.checks.constraints.every(c=>c.convalidated));
  evidence.checks.indexes = (await query(database, `SELECT t.relname AS relation,i.relname AS name,x.indisunique,x.indisvalid,x.indisready,
    pg_get_indexdef(i.oid) AS definition FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
    WHERE t.relname IN ('orders','payments','payment_operations','payment_webhook_events','provider_collections','payment_reconciliations') ORDER BY t.relname,i.relname`)).rows;
  assert.ok(evidence.checks.indexes.every(i=>i.indisvalid && i.indisready));
  const protectedTables = ['payment_operations','payment_webhook_events','provider_collections','payment_reconciliations'];
  evidence.checks.rls = (await query(database, `SELECT relname, relrowsecurity, relforcerowsecurity,
    has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS anon_access,
    has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS client_access
    FROM pg_class WHERE relname=ANY($1) ORDER BY relname`, [protectedTables])).rows;
  for (const table of evidence.checks.rls) { assert.equal(table.relrowsecurity,true); assert.equal(table.anon_access,false); assert.equal(table.client_access,false); }
  assert.equal((await query(database, 'SELECT count(*)::int AS n FROM pg_policies WHERE tablename=ANY($1)', [protectedTables])).rows[0].n, 0);
  // Prove grants do not bypass default-deny RLS. All grants/policies below are
  // LOCAL role fixtures, deliberately outside migration files and live scope.
  for (const role of ['anon','authenticated','atany_runtime']) {
    await withDb(database, async c => {
      // ACL denial is checked before temporary grants, for every evidence table.
      for (const table of protectedTables) {
        await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${role}`);
        await assert.rejects(c.query(`SELECT * FROM ${table}`), e=>e.code==='42501');
        await c.query('ROLLBACK');
      }
      await c.query('BEGIN');
      await c.query(`INSERT INTO orders(buyer_id,amount) SELECT id,1101 FROM users LIMIT 1`);
      await c.query(`INSERT INTO payment_operations(id,order_id,actor_id,kind,state) SELECT gen_random_uuid(),o.id,o.buyer_id,'cancel','running' FROM orders o LIMIT 1`);
      assert.equal((await c.query('SELECT * FROM payment_operations')).rows.length,1);
      await c.query(`GRANT SELECT,INSERT ON payment_operations TO ${role}`);
      await c.query(`SET LOCAL ROLE ${role}`);
      assert.equal((await c.query('SELECT * FROM payment_operations')).rows.length, 0);
      await assert.rejects(c.query("INSERT INTO payment_operations(id,order_id,actor_id,kind,state) VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'cancel','running')"), e => e.code === '42501');
      await c.query('ROLLBACK');
    });
  }
  evidence.checks.default_deny_with_grants = true;
  await query(database, 'GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO atany_runtime');
  const publicTables = (await query(database, "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations'")).rows;
  for (const { tablename } of publicTables) {
    await query(database,`GRANT SELECT,INSERT,UPDATE ON "${tablename}" TO atany_runtime`);
    await query(database, `CREATE POLICY local_runtime_fixture ON "${tablename}" TO atany_runtime USING(true) WITH CHECK(true)`);
  }
  evidence.checks.runtime_role = (await query(database, "SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='atany_runtime'")).rows[0];
  console.log('Local migrations, idempotency, transaction rollback and RLS denial checks passed. Running mocked-provider integration tests.');
  const tests = run(path.join(backend, 'node_modules/.bin/vitest'), ['run','src/tests/migrationReadinessDb.test.js',
    'src/tests/orderActionSnapshot.test.js','src/tests/paymongoSafety.test.js','src/tests/customer/order.controller.test.js',
    'src/tests/sellerOrders.test.js','src/tests/manualPayment.test.js','src/tests/paymentNotifications.test.js',
    '--pool=forks','--maxWorkers=1','--minWorkers=1'], { env: { ...env, ATANY_MIGRATION_REHEARSAL: '1' } });
  fs.writeFileSync(`${root}/integration-tests.log`, tests); console.log(tests);
  evidence.checks.integration_tests = 'passed; see integration-tests.log';
  evidence.checks.backup_evidence_rows = (await query(database, `SELECT
    (SELECT count(*)::int FROM payment_webhook_events) AS events,
    (SELECT count(*)::int FROM provider_collections) AS collections,
    (SELECT count(*)::int FROM payment_reconciliations) AS reconciliations`)).rows[0];
  assert.ok(Object.values(evidence.checks.backup_evidence_rows).every(n=>n>0));
  fs.writeFileSync(`${root}/catalog-readonly.log`, psql(database, ['-v','backend_role=atany_runtime','-f',path.resolve(backend,'../docs/staging/catalog-readonly.sql')]));
  fs.writeFileSync(`${root}/legacy-audit-readonly.log`, psql(database, ['-f',path.resolve(backend,'../docs/staging/legacy-payments-readonly.sql')]));
  evidence.checks.readonly_local_audits = 'passed; synthetic catalog and aggregate payment audit only';
  evidence.checks.after_backup = await verifyBackup(database, 'atany_after_restore');
  // Legacy winner suite gets its own restored synthetic DB; never shared staging.
  const winnerUrl = `postgresql://${user}@localhost/atany_after_restore?host=${root}&port=${port}`;
  assert.equal(new URL(winnerUrl).searchParams.get('host'), root);
  const winners = run(path.join(backend,'node_modules/.bin/vitest'), ['run','src/tests/winnerExpirationDb.test.js','--pool=forks','--maxWorkers=1','--minWorkers=1'],
    { env: { ...env, ATANY_ALLOW_WINNER_DB_TESTS: '1', ATANY_WINNER_TEST_DATABASE_URL: winnerUrl } });
  fs.writeFileSync(`${root}/winner-tests.log`, winners); console.log(winners);
  evidence.checks.winner_tests = 'passed on separate migrated restored synthetic database';
  for (const file of migrationFiles) assert.equal(hash(fs.readFileSync(sqlFile(file),'utf8')),evidence.migrations[file],`Source changed during rehearsal: ${file}`);
  evidence.completed_at = new Date().toISOString();
} catch (error) {
  evidence.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  if (started) { run(`${bin}/pg_ctl`, ['-D', `${root}/pgdata`, '-m','fast','-w','stop']); evidence.cluster_stopped = true; }
  fs.writeFileSync(`${root}/result.json`, JSON.stringify(evidence,null,2));
  console.log(`Local evidence: ${root}/result.json`);
}
