// Offline permission/dependency verification. The only row mutation is a new
// synthetic canary, rolled back in a separate local clone. No live connection.
import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';import pg from 'pg';
process.umask(0o077);
const root=process.argv[2];
assert.ok(/^\/private\/tmp\/atany-compatible-recovery-[A-Za-z0-9]+$/.test(root||''));
const evidence=JSON.parse(fs.readFileSync(path.join(root,'verification.json'),'utf8'));
assert.equal(evidence.application_database_recovery,'verified');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(PG|DATABASE|SUPABASE|PAYMONGO|SMTP|RESEND|AWS)/.test(k)));
const result={scope:'captured target snapshot and local clone only',source_connections:0,source_changes:0,provider_requests:0};
let started=false;
const client=db=>new pg.Client({host:path.join(root,'socket'),port:55446,user:'atany_recovery_admin',database:db});
function control(action){const r=spawnSync('/opt/homebrew/bin/pg_ctl',['-D',path.join(root,'pgdata'),...(action==='start'?['-l',path.join(root,'server.private.log')]:['-m','fast']),'-w',action],{env,encoding:'utf8'});assert.equal(r.status,0);}
try{
  control('start');started=true;
  const c=client('atany_recovered');await c.connect();
  try{
    await c.query("BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,public");
    const dependencies=(await c.query(`WITH RECURSIVE closure(classid,objid,objsubid) AS (
      SELECT 'pg_extension'::regclass,oid,0 FROM pg_extension WHERE extname='supabase_vault'
      UNION SELECT d.classid,d.objid,d.objsubid FROM pg_depend d JOIN closure x
      ON d.refclassid=x.classid AND d.refobjid=x.objid AND (x.objsubid=0 OR d.refobjsubid=x.objsubid))
      SELECT pg_describe_object(x.classid,x.objid,x.objsubid) AS object,
      CASE WHEN x.classid='pg_class'::regclass THEN (SELECT relnamespace::regnamespace::text FROM pg_class WHERE oid=x.objid)
        WHEN x.classid='pg_proc'::regclass THEN (SELECT pronamespace::regnamespace::text FROM pg_proc WHERE oid=x.objid)
        WHEN x.classid='pg_type'::regclass THEN (SELECT typnamespace::regnamespace::text FROM pg_type WHERE oid=x.objid)
        WHEN x.classid='pg_constraint'::regclass THEN (SELECT connamespace::regnamespace::text FROM pg_constraint WHERE oid=x.objid)
        WHEN x.classid='pg_rewrite'::regclass THEN (SELECT c.relnamespace::regnamespace::text FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class WHERE r.oid=x.objid)
      END AS namespace FROM closure x ORDER BY object`)).rows;
    result.vault_dependency_closure=dependencies;result.public_dependents=dependencies.filter(d=>d.namespace==='public');
    assert.equal(result.public_dependents.length,0);
    result.default_table_grants=(await c.query("SELECT pg_get_userbyid(defaclrole) AS creator,defaclnamespace::regnamespace::text AS schema,defaclacl FROM pg_default_acl WHERE defaclobjtype='r' AND defaclnamespace='public'::regnamespace ORDER BY creator")).rows;
    result.affected_client_objects=(await c.query(`SELECT r.rolname,c.relname,c.relrowsecurity,
      has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
      has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete,
      has_table_privilege(r.oid,c.oid,'TRUNCATE') AS can_truncate
      FROM pg_roles r CROSS JOIN pg_class c WHERE r.rolname IN ('anon','authenticated') AND c.relkind IN ('r','p')
      AND c.relnamespace='public'::regnamespace ORDER BY r.rolname,c.relname`)).rows;
    result.user_column_update=(await c.query(`SELECT r.rolname,a.attname,
      has_column_privilege(r.oid,'public.users'::regclass,a.attnum,'UPDATE') AS can_update
      FROM pg_roles r CROSS JOIN pg_attribute a WHERE r.rolname IN ('anon','authenticated')
      AND a.attrelid='public.users'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY r.rolname,a.attnum`)).rows;
    result.user_policies=(await c.query("SELECT policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='users' ORDER BY policyname")).rows;
    result.user_guard_triggers=(await c.query("SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='public.users'::regclass AND NOT tgisinternal")).rows;
    const helper=(await c.query("SELECT pg_get_functiondef('public.is_admin()'::regprocedure) AS body")).rows[0].body;
    result.admin_helper={reads_users_table:/\busers\b/i.test(helper),uses_auth_uid:/auth\.uid/i.test(helper),trusts_admin_role:/role[\s\S]*admin/i.test(helper)};
    result.backend_role=(await c.query("SELECT rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname='postgres'")).rows[0];
    result.backend_table_owners=(await c.query("SELECT relname,pg_get_userbyid(relowner) AS owner,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') ORDER BY relname")).rows;
    await c.query('SET LOCAL ROLE postgres');
    result.backend_readable=(await c.query('SELECT (SELECT count(*) FROM orders)>=0 AND (SELECT count(*) FROM payments)>=0 AS ok')).rows[0].ok;
    await c.query('ROLLBACK');
    await c.query('CREATE DATABASE atany_permissions_canary TEMPLATE atany_recovered');
  }finally{await c.end();}
  const canary=client('atany_permissions_canary');await canary.connect();
  try{
    const id=randomUUID();await canary.query('BEGIN');
    await canary.query("INSERT INTO public.users(id,name,email,password_hash,role) VALUES($1,'Local permission canary',$2,'not-a-credential','customer')",[id,id+'@fixture.invalid']);
    await canary.query('SET LOCAL ROLE authenticated');
    await canary.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',$2,true)",[id,JSON.stringify({sub:id,role:'authenticated'})]);
    result.synthetic_privilege_canary={admin_before:(await canary.query('SELECT public.is_admin() AS yes')).rows[0].yes};
    const change=await canary.query("UPDATE public.users SET role='admin' WHERE id=$1",[id]);
    result.synthetic_privilege_canary.updated_rows=change.rowCount;
    result.synthetic_privilege_canary.admin_after=(await canary.query('SELECT public.is_admin() AS yes')).rows[0].yes;
    await canary.query('ROLLBACK');
    result.synthetic_privilege_canary.fixture_removed=(await canary.query('SELECT count(*)::int AS n FROM public.users WHERE id=$1',[id])).rows[0].n===0;
    result.synthetic_privilege_canary.transaction_rolled_back=true;
    assert.equal(result.synthetic_privilege_canary.admin_before,false);
    assert.equal(result.synthetic_privilege_canary.updated_rows,1);
    assert.equal(result.synthetic_privilege_canary.admin_after,true);
    assert.equal(result.synthetic_privilege_canary.fixture_removed,true);
  }finally{await canary.end();}
  result.findings_confirmed=true;
}catch(error){result.blocker={code:error.code||'PERMISSION_VERIFICATION_FAILED'};process.exitCode=1;}
finally{if(started){control('stop');result.local_server_stopped=true;}result.finished_at=new Date().toISOString();
  fs.writeFileSync(path.join(root,'permissions-verification.json'),JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify({evidence:path.join(root,'permissions-verification.json'),public_vault_dependents:result.public_dependents?.length,
    synthetic_canary:result.synthetic_privilege_canary,local_server_stopped:result.local_server_stopped,blocker:result.blocker}));}
