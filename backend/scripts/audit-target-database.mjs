// Read-only target audit. Does not import application startup/pool/migration code.
// Credentials remain in memory. Private detailed results stay outside Git.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import pg from 'pg';
import { parse as parsePgConnection } from 'pg-connection-string';
import dotenv from 'dotenv';

process.umask(0o077);
const backend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const env=dotenv.parse(fs.readFileSync(path.join(backend,'.env')));
const source=new URL(env.DATABASE_URL);
const parsed=parsePgConnection(env.DATABASE_URL);
const ref=new URL(env.SUPABASE_URL).hostname.split('.')[0];
const linked=fs.readFileSync(path.resolve(backend,'../supabase/.temp/project-ref'),'utf8').trim();
if(ref!==linked || !(decodeURIComponent(source.username).endsWith('.'+ref) || source.hostname===`db.${ref}.supabase.co`))
  throw new Error('Target identity mismatch; no connection attempted.');
const root=fs.mkdtempSync('/private/tmp/atany-target-audit-');
fs.chmodSync(root,0o700);
const result={started_at:new Date().toISOString(),scope:'existing-project-read-only',
  identity:{local_link_api_database_match:true,project_reference_sha256:crypto.createHash('sha256').update(ref).digest('hex')},
  connection:{kind:source.hostname.includes('pooler.supabase')?(source.port==='6543'?'transaction_pooler':'session_pooler'):'direct',probes:[]},
  payment_configuration:{secret_present:!!env.PAYMONGO_SECRET_KEY,mode:env.PAYMONGO_SECRET_KEY?.startsWith('sk_test_')?'test':env.PAYMONGO_SECRET_KEY?.startsWith('sk_live_')?'live':'unknown',
    test_key_shape:/^sk_test_[A-Za-z0-9]{16,}$/.test(env.PAYMONGO_SECRET_KEY||''),webhook_secret_present:!!env.PAYMONGO_WEBHOOK_SECRET,
    frontend_loopback:/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(env.FRONTEND_URL||''),provider_requests_made:false},
  audit:{},backup:{status:'not_started'},restore:{status:'not_started'}};
const config={host:source.hostname,port:Number(source.port||5432),database:decodeURIComponent(source.pathname.slice(1)),
  user:parsed.user,password:parsed.password,ssl:{rejectUnauthorized:true},
  connectionTimeoutMillis:8000,query_timeout:15000,application_name:'atany-readonly-audit'};
const save=()=>fs.writeFileSync(path.join(root,'audit.json'),JSON.stringify(result,null,2),{mode:0o600});
async function readTransaction(work){
  const c=new pg.Client(config);try{await c.connect();await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='3s'; SET LOCAL search_path=pg_catalog,public; SET LOCAL row_security=off");
    return await work(c);
  }finally{await c.query('ROLLBACK').catch(()=>{});await c.end().catch(()=>{});}
}
try{
  const caSource='https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt';
  const certificateResponse=await fetch(caSource,{signal:AbortSignal.timeout(10000)});
  if(!certificateResponse.ok)throw Object.assign(new Error('Official CA download failed'),{code:'CA_DOWNLOAD_FAILED'});
  const certificate=await certificateResponse.text();
  const ca=new crypto.X509Certificate(certificate);
  if(!ca.ca)throw Object.assign(new Error('Official certificate is not a CA'),{code:'INVALID_CA'});
  config.ssl.ca=certificate;
  fs.writeFileSync(path.join(root,'supabase-ca.crt'),certificate,{mode:0o600});
  result.connection.tls={verify_certificate:true,verify_hostname:true,ca_source:caSource,ca_sha256:ca.fingerprint256};
  for(let i=0;i<3;i++){
    const start=performance.now();const probe={};
    try{const addresses=await dns.lookup(config.host,{all:true});probe.dns={ok:true,ipv4:addresses.some(a=>a.family===4),ipv6:addresses.some(a=>a.family===6)};}
    catch(error){probe.dns={ok:false,code:error.code};}
    try{probe.database=await readTransaction(async c=>(await c.query(`SELECT current_database() AS database,current_user,
      current_setting('server_version') AS server_version,current_setting('transaction_read_only') AS transaction_read_only,
      (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl`)).rows[0]);probe.ok=true;}
    catch(error){probe.ok=false;probe.code=error.code||'CONNECTION_TIMEOUT';}
    probe.elapsed_ms=Math.round(performance.now()-start);result.connection.probes.push(probe);save();
    console.log(JSON.stringify({phase:'read-only connection probe',sample:i+1,ok:probe.ok,dns:probe.dns,code:probe.code,elapsed_ms:probe.elapsed_ms}));
    if(!probe.ok)throw Object.assign(new Error('Read-only database connection failed'),{code:probe.code});
  }
  result.connection.stable_sample=true;
  await readTransaction(async c=>{
    const queries={
      schemas:"SELECT nspname,pg_get_userbyid(nspowner) AS owner,nspacl FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' ORDER BY nspname",
      extensions:'SELECT extname,extversion,extnamespace::regnamespace::text AS schema FROM pg_extension ORDER BY extname',
      tables:"SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl,c.reltuples AS estimated_rows FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','supabase_migrations') AND c.relkind IN ('r','p','v','m') ORDER BY n.nspname,c.relname",
      columns:"SELECT table_schema,table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema IN ('public','supabase_migrations') ORDER BY table_schema,table_name,ordinal_position",
      enums:"SELECT n.nspname,t.typname,e.enumlabel,e.enumsortorder FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder",
      constraints:"SELECT conrelid::regclass::text AS relation,conname,contype,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY relation,conname",
      indexes:"SELECT t.relname AS relation,i.relname AS name,x.indisunique,x.indisvalid,x.indisready,pg_get_indexdef(i.oid) AS definition FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid WHERE t.relnamespace='public'::regnamespace ORDER BY t.relname,i.relname",
      roles:'SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls FROM pg_roles ORDER BY rolname',
      memberships:'SELECT pg_get_userbyid(roleid) AS parent,pg_get_userbyid(member) AS member,admin_option FROM pg_auth_members ORDER BY parent,member',
      policies:"SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname",
      defaults:'SELECT pg_get_userbyid(defaclrole) AS role,defaclnamespace::regnamespace::text AS schema,defaclobjtype,defaclacl FROM pg_default_acl ORDER BY role,schema,defaclobjtype',
      privileges:"SELECT r.rolname,c.relname,has_table_privilege(r.oid,c.oid,'SELECT') AS sel,has_table_privilege(r.oid,c.oid,'INSERT') AS ins,has_table_privilege(r.oid,c.oid,'UPDATE') AS upd,has_table_privilege(r.oid,c.oid,'DELETE') AS del,has_table_privilege(r.oid,c.oid,'TRUNCATE') AS trunc FROM pg_roles r CROSS JOIN pg_class c WHERE r.rolname IN (current_user,'anon','authenticated','service_role') AND c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') ORDER BY r.rolname,c.relname",
      publications:'SELECT pubname,puballtables FROM pg_publication ORDER BY pubname',
      publication_tables:"SELECT pubname,schemaname,tablename FROM pg_publication_tables WHERE schemaname='public' ORDER BY pubname,tablename",
      history_locations:"SELECT to_regclass('public.schema_migrations')::text AS application,to_regclass('supabase_migrations.schema_migrations')::text AS supabase",
      size:'SELECT pg_database_size(current_database())::text AS bytes',
    };
    for(const [name,sql] of Object.entries(queries))result.audit[name]=(await c.query(sql)).rows;
    const locations=result.audit.history_locations[0];
    if(locations.application)result.audit.application_history=(await c.query('SELECT filename,checksum,applied_at FROM public.schema_migrations ORDER BY filename')).rows;
    // Avoid dumping migration SQL bodies, which may embed secrets.
    if(locations.supabase)result.audit.supabase_history=(await c.query('SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version')).rows;
    result.audit.read_only_verified=(await c.query("SHOW transaction_read_only")).rows[0].transaction_read_only==='on';
  });
  result.audit.status='complete';
  console.log('Read-only catalog audit complete. Detailed results protected outside Git.');
}catch(error){result.blocker={phase:result.connection.stable_sample?'catalog':'connection',code:error.code||'AUDIT_FAILED'};process.exitCode=1;
  console.error(JSON.stringify({stopped:true,...result.blocker}));
}finally{result.finished_at=new Date().toISOString();save();console.log(`Protected audit evidence: ${root}/audit.json`);}
