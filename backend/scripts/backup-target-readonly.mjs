// Read-only source backup; restore destination is hard-coded to a fresh private
// LOCAL cluster. Never imports the app, invokes migrations, or contacts PayMongo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
import { parse } from 'pg-connection-string';
import dotenv from 'dotenv';

process.umask(0o077);
const backend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=process.argv[2];
if(!/^\/private\/tmp\/atany-target-audit-[A-Za-z0-9]+$/.test(root||''))throw new Error('An existing protected audit directory is required.');
const audit=JSON.parse(fs.readFileSync(path.join(root,'audit.json'),'utf8'));
assert.equal(audit.audit.status,'complete');
if(fs.existsSync(path.join(root,'backup-result.json')))throw new Error('Refusing to overwrite an earlier backup attempt.');
const env=dotenv.parse(fs.readFileSync(path.join(backend,'.env')));
const source=parse(env.DATABASE_URL);
const ref=new URL(env.SUPABASE_URL).hostname.split('.')[0];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(hash(ref),audit.identity.project_reference_sha256);
assert.ok(source.user.endsWith('.'+ref)||source.host===`db.${ref}.supabase.co`);
const caPath=path.join(root,'supabase-ca.crt');
const config={host:source.host,port:Number(source.port||5432),user:source.user,password:source.password,database:source.database,
  ssl:{rejectUnauthorized:true,ca:fs.readFileSync(caPath,'utf8')},connectionTimeoutMillis:10000,query_timeout:30000,
  options:'-c default_transaction_read_only=on',application_name:'atany-readonly-backup'};
const childEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(PG|DATABASE|SUPABASE|PAYMONGO)/.test(k)));
const dumpEnv={...childEnv,PGHOST:source.host,PGPORT:String(source.port||5432),PGUSER:source.user,PGPASSWORD:source.password,
  PGDATABASE:source.database,PGSSLMODE:'verify-full',PGSSLROOTCERT:caPath,PGCONNECT_TIMEOUT:'10',
  PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000',PGAPPNAME:'atany-readonly-backup'};
const result={started_at:new Date().toISOString(),source_read_only:true,backup:{status:'not_started'},restore:{status:'not_started'},
  provider_requests_made:false,source_migrations_executed:false};
const bin='/opt/homebrew/bin';
const save=()=>fs.writeFileSync(path.join(root,'backup-result.json'),JSON.stringify(result,null,2),{mode:0o600});
function run(program,args,{input,remote=false,label='command'}={}){
  const r=spawnSync(program,args,{env:remote?dumpEnv:childEnv,input,encoding:input?undefined:'utf8',timeout:120000,maxBuffer:16*1024*1024});
  if(r.status!==0){fs.writeFileSync(path.join(root,`${label}-error.log`),r.stderr||Buffer.from(String(r.error?.code||'FAILED')),{mode:0o600});
    throw Object.assign(new Error(`${label} failed; details protected`),{code:`${label.toUpperCase().replaceAll('-','_')}_FAILED`});}
  if(r.stderr?.length)fs.writeFileSync(path.join(root,`${label}-warnings.log`),r.stderr,{mode:0o600});
  return r.stdout;
}
const quote=x=>'"'+x.replaceAll('"','""')+'"';
async function fingerprints(c,tables){
  const data={};
  for(const t of tables){const rows=(await c.query(`SELECT to_jsonb(t)::text AS row FROM ${quote(t.nspname)}.${quote(t.relname)} t ORDER BY to_jsonb(t)::text`)).rows;
    data[`${t.nspname}.${t.relname}`]={rows:rows.length,sha256:hash(JSON.stringify(rows))};}
  return data;
}
async function sequences(c,names){const values={};for(const t of names)values[`${t.schemaname}.${t.sequencename}`]=(await c.query(`SELECT last_value::text,is_called FROM ${quote(t.schemaname)}.${quote(t.sequencename)}`)).rows[0];return values;}
const sourceClient=new pg.Client(config);
let localStarted=false,phase='source_preflight';
const localDir=path.join(root,'local-restore'),socket=path.join(root,'restore-socket'),port=55442;
try{
  await sourceClient.connect();
  await sourceClient.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await sourceClient.query("SET LOCAL search_path=pg_catalog,public; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s'; SET LOCAL row_security=off; SET LOCAL timezone='UTC'");
  result.source_transaction_read_only=(await sourceClient.query('SHOW transaction_read_only')).rows[0].transaction_read_only==='on';
  assert.equal(result.source_transaction_read_only,true);
  result.tls={client_encrypted:sourceClient.connection.stream.encrypted===true,client_certificate_authorized:sourceClient.connection.stream.authorized===true,
    server_reported_ssl:(await sourceClient.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0]?.ssl};
  assert.ok(result.tls.client_encrypted&&result.tls.client_certificate_authorized);
  result.supplemental={};
  result.supplemental.triggers=(await sourceClient.query(`SELECT c.relname,t.tgname,t.tgenabled,p.proname,n.nspname,pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace ORDER BY c.relname,t.tgname`)).rows;
  result.supplemental.functions=(await sourceClient.query(`SELECT p.proname,p.prosecdef,p.proconfig,p.proacl,md5(pg_get_functiondef(p.oid)) AS definition_md5
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' ORDER BY p.proname`)).rows;
  result.supplemental.legacy_flags=(await sourceClient.query(`SELECT
    (SELECT count(*)::int FROM payments WHERE provider='paymongo' AND checkout_session_id IS NULL AND COALESCE((metadata->>'checkout_creation_rejected')::text,'false')<>'true') AS unknown_gateway_attempts,
    (SELECT count(*)::int FROM orders WHERE status='pending' AND payment_deadline IS NULL) AS pending_missing_deadline,
    (SELECT count(*)::int FROM (SELECT checkout_session_id FROM payments WHERE checkout_session_id IS NOT NULL GROUP BY 1 HAVING count(*)>1) x) AS duplicate_checkout_groups,
    (SELECT count(*)::int FROM (SELECT order_id FROM payments WHERE status='paid' GROUP BY 1 HAVING count(*)>1) x) AS duplicate_paid_groups`)).rows[0];
  phase='backup';result.backup.status='running';save();
  const snapshot=(await sourceClient.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
  const tables=(await sourceClient.query(`SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY n.nspname,c.relname`)).rows;
  const sequenceNames=(await sourceClient.query("SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname NOT LIKE 'pg_%' ORDER BY schemaname,sequencename")).rows;
  const beforeSequences=await sequences(sourceClient,sequenceNames);
  result.backup.source_tables=await fingerprints(sourceClient,tables);
  const raw=path.join(root,'database.private.dump');
  console.log('Exporting complete database in a read-only snapshot; no schemas or tables excluded.');
  run(`${bin}/pg_dump`,['--format=custom','--no-password',`--snapshot=${snapshot}`,'--lock-wait-timeout=5000','--quote-all-identifiers','--file',raw],{remote:true,label:'pg-dump'});
  fs.chmodSync(raw,0o600);
  assert.deepEqual(await sequences(sourceClient,sequenceNames),beforeSequences,'Source sequences advanced during backup; exact verification requires a quiet interval.');
  result.backup.source_sequences=beforeSequences;
  await sourceClient.query('ROLLBACK');await sourceClient.end();
  const plain=fs.readFileSync(raw);
  result.backup.plain_sha256=hash(plain);result.backup.archive_bytes=plain.length;
  run(`${bin}/pg_restore`,['--exit-on-error','--no-owner','--no-acl','--file','/dev/null',raw],{label:'archive-integrity'});
  const keyDir=fs.mkdtempSync('/private/tmp/atany-target-backup-keys-');fs.chmodSync(keyDir,0o700);
  const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),magic=Buffer.from('ATANYPG1');
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(magic);
  const encrypted=Buffer.concat([magic,iv,cipher.update(plain),cipher.final(),cipher.getAuthTag()]);
  const encryptedPath=path.join(root,'database.dump.aesgcm');const keyPath=path.join(keyDir,'database.key');
  fs.writeFileSync(keyPath,key,{mode:0o600});fs.writeFileSync(encryptedPath,encrypted,{mode:0o600});
  const saved=fs.readFileSync(encryptedPath),decipher=crypto.createDecipheriv('aes-256-gcm',fs.readFileSync(keyPath),saved.subarray(8,20));
  decipher.setAAD(saved.subarray(0,8));decipher.setAuthTag(saved.subarray(-16));
  const restoredArchive=Buffer.concat([decipher.update(saved.subarray(20,-16)),decipher.final()]);
  assert.equal(hash(restoredArchive),result.backup.plain_sha256);
  result.backup.encrypted_file=encryptedPath;result.backup.key_file=keyPath;result.backup.encrypted_sha256=hash(encrypted);
  result.backup.integrity='all archive blocks decoded; authenticated encrypted copy round-tripped and hash matched';
  fs.unlinkSync(raw);result.backup.status='verified';save();
  console.log('Complete archive verified and encrypted; plaintext intermediate removed. Restoring locally only.');
  phase='restore';result.restore.status='running';save();
  fs.mkdirSync(localDir,{mode:0o700});fs.mkdirSync(socket,{mode:0o700});
  run(`${bin}/initdb`,['-D',path.join(localDir,'pgdata'),'-U','atany_restore_admin','-A','trust','--no-locale','-E','UTF8'],{label:'local-initdb'});
  run(`${bin}/pg_ctl`,['-D',path.join(localDir,'pgdata'),'-l',path.join(localDir,'server.log'),'-o',`-k ${socket} -p ${port} -h "" -c unix_socket_permissions=0700`,'-w','start'],{label:'local-start'});
  localStarted=true;
  const local={host:socket,port,user:'atany_restore_admin',database:'postgres'};
  const c=new pg.Client(local);await c.connect();
  try{
    assert.equal((await c.query("SHOW listen_addresses")).rows[0].listen_addresses,'');
    const existing=new Set((await c.query('SELECT rolname FROM pg_roles')).rows.map(r=>r.rolname));
    for(const role of audit.audit.roles){if(!existing.has(role.rolname))await c.query(`CREATE ROLE ${quote(role.rolname)} NOLOGIN NOSUPERUSER NOBYPASSRLS`);}
    await c.query('CREATE DATABASE atany_target_restore');
  }finally{await c.end();}
  // No application/worker is started. No live URL or provider key is passed to restore.
  run(`${bin}/pg_restore`,['--exit-on-error','--single-transaction','-h',socket,'-p',String(port),'-U','atany_restore_admin','-d','atany_target_restore'],{input:restoredArchive,label:'local-restore'});
  const verify=new pg.Client({...local,database:'atany_target_restore'});await verify.connect();
  try{await verify.query("BEGIN READ ONLY; SET LOCAL timezone='UTC'; SET LOCAL search_path=pg_catalog,public");
    assert.deepEqual(await fingerprints(verify,tables),result.backup.source_tables);
    assert.deepEqual(await sequences(verify,sequenceNames),beforeSequences);
    result.restore.data_and_sequences_match=true;
  }finally{await verify.query('ROLLBACK').catch(()=>{});await verify.end();}
  result.restore.status='verified';result.finished_at=new Date().toISOString();
}catch(error){
  result.blocker={phase,code:error.code||'VERIFICATION_FAILED'};
  if(phase==='backup')result.backup.status='failed';if(phase==='restore')result.restore.status='failed';
  process.exitCode=1;console.error(JSON.stringify({stopped:true,...result.blocker}));
}finally{
  await sourceClient.query('ROLLBACK').catch(()=>{});await sourceClient.end().catch(()=>{});
  if(localStarted){run(`${bin}/pg_ctl`,['-D',path.join(localDir,'pgdata'),'-m','fast','-w','stop'],{label:'local-stop'});result.restore.local_server_stopped=true;}
  result.finished_at=new Date().toISOString();save();console.log(`Protected backup/restore result: ${root}/backup-result.json`);
}
