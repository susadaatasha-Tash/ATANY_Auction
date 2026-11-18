// Authorized read-only account/security audit. No application imports or mutations.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';import pg from 'pg';import {parse} from 'pg-connection-string';import dotenv from 'dotenv';
process.umask(0o077);
const backend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const env=dotenv.parse(fs.readFileSync(path.join(backend,'.env'))),config=parse(env.DATABASE_URL);
const ref=new URL(env.SUPABASE_URL).hostname.split('.')[0];
if(fs.readFileSync(path.resolve(backend,'../supabase/.temp/project-ref'),'utf8').trim()!==ref||!(config.user.endsWith('.'+ref)||config.host===`db.${ref}.supabase.co`))throw new Error('Target identity mismatch');
const root=fs.mkdtempSync('/private/tmp/atany-account-security-audit-');fs.chmodSync(root,0o700);
const result={started_at:new Date().toISOString(),mode:'read-only',project_reference_sha256:crypto.createHash('sha256').update(ref).digest('hex')};
let c;
try{
  const response=await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt',{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('CA_DOWNLOAD_FAILED');const ca=await response.text();
  c=new pg.Client({host:config.host,port:Number(config.port||5432),database:config.database,user:config.user,password:config.password,
    ssl:{rejectUnauthorized:true,ca},options:'-c default_transaction_read_only=on',connectionTimeoutMillis:10000,query_timeout:15000,application_name:'atany-account-security-readonly'});
  await c.connect();await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await c.query("SET LOCAL search_path=pg_catalog,public; SET LOCAL statement_timeout='12s'; SET LOCAL row_security=off; SET LOCAL timezone='UTC'");
  const q=async(name,sql)=>{result[name]=(await c.query(sql)).rows;};
  await q('connection',"SELECT current_user,current_setting('transaction_read_only') AS read_only,current_setting('server_version') AS server_version");
  await q('admin_roster',`SELECT u.id,u.name,u.email,u.status,u.created_at,a.created_at AS auth_created_at,a.last_sign_in_at,
    (a.id IS NOT NULL) AS auth_identity_present,
    CASE WHEN a.raw_user_meta_data->>'role' IN ('customer','shop_owner','admin') THEN a.raw_user_meta_data->>'role' ELSE 'other_or_missing' END AS untrusted_metadata_role
    FROM public.users u LEFT JOIN auth.users a ON a.id=u.id WHERE u.role='admin' ORDER BY u.created_at,u.id`);
  await q('role_counts',"SELECT role,status,count(*)::int AS accounts FROM public.users GROUP BY role,status ORDER BY role,status");
  await q('user_policies',"SELECT policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='users' ORDER BY policyname");
  await q('user_triggers',"SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='public.users'::regclass AND NOT tgisinternal");
  await q('column_grants',`SELECT r.rolname,a.attname,has_column_privilege(r.oid,'public.users'::regclass,a.attnum,'UPDATE') AS can_update,
    has_column_privilege(r.oid,'public.users'::regclass,a.attnum,'SELECT') AS can_select
    FROM pg_roles r CROSS JOIN pg_attribute a WHERE r.rolname IN ('anon','authenticated','service_role','postgres')
    AND a.attrelid='public.users'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY r.rolname,a.attnum`);
  await q('authorization_events',`SELECT id,user_id,action,entity_type,entity_id,created_at,
    jsonb_strip_nulls(jsonb_build_object('role',details->'role','old_role',details->'old_role','new_role',details->'new_role',
      'status',details->'status','old_status',details->'old_status','new_status',details->'new_status')) AS authorization_details
    FROM public.audit_logs WHERE entity_type='user' OR action~* '(role|admin|account|seller_application_approved)' ORDER BY created_at DESC LIMIT 1000`);
  await q('audit_coverage',"SELECT count(*)::int AS total,min(created_at) AS first_event,max(created_at) AS last_event FROM public.audit_logs");
  await q('auth_audit_coverage',"SELECT count(*)::int AS total,min(created_at) AS first_event,max(created_at) AS last_event FROM auth.audit_log_entries");
  await q('auth_actions',"SELECT payload->>'action' AS action,count(*)::int AS events FROM auth.audit_log_entries GROUP BY payload->>'action' ORDER BY action");
  await q('rest_schema_settings',`SELECT s FROM pg_db_role_setting r CROSS JOIN LATERAL unnest(r.setconfig) AS s WHERE s LIKE 'pgrst.db_schemas=%'`);
  await q('related_policies',"SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('shops','products','seller_applications','audit_logs','schema_migrations') ORDER BY tablename,policyname");
  result.read_only_verified=result.connection[0].read_only==='on';await c.query('ROLLBACK');
  const actorRoles=new Map(result.admin_roster.map(x=>[x.id,'admin']));
  result.summary={admin_count:result.admin_roster.length,active_admins:result.admin_roster.filter(x=>x.status==='active').length,
    admins_without_auth:result.admin_roster.filter(x=>!x.auth_identity_present).length,
    authorization_events:result.authorization_events.length,auth_audit_events:result.auth_audit_coverage[0].total,
    user_guard_present:result.user_triggers.length>0,
    authenticated_role_update_grant:result.column_grants.some(x=>x.rolname==='authenticated'&&x.attname==='role'&&x.can_update),
    explicit_role_events:result.authorization_events.filter(x=>x.authorization_details.role||x.authorization_details.old_role||x.authorization_details.new_role).length,
    event_actors_not_in_current_admin_roster:result.authorization_events.filter(x=>x.user_id&&!actorRoles.has(x.user_id)).length,
    attribution_limit:'No historical role provenance can be inferred solely from current actor roles or absent audit events.'};
  console.log(JSON.stringify({read_only_verified:result.read_only_verified,summary:result.summary}));
}catch(error){result.error={code:error.code||'READONLY_AUDIT_FAILED'};process.exitCode=1;console.error(JSON.stringify(result.error));}
finally{if(c){await c.query('ROLLBACK').catch(()=>{});await c.end().catch(()=>{});}result.finished_at=new Date().toISOString();
  fs.writeFileSync(path.join(root,'audit.private.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(`Private account audit: ${root}/audit.private.json`);}
