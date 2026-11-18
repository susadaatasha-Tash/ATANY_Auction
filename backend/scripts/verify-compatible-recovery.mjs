// Offline full-archive restore. Fixed private socket; no source URL, .env,
// migration runner, application service or provider credentials are loaded.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import pg from 'pg';

process.umask(0o077);
const durable='/Users/honeycar/ATANY_Backups/2026-11-19/target-audit-d3Aw9E';
const build='/private/tmp/atany-vault-build-031/vault-0.3.1';
const retention=JSON.parse(fs.readFileSync(path.join(durable,'retention.json'),'utf8'));
const original=JSON.parse(fs.readFileSync(path.join(durable,'backup-result.json'),'utf8'));
const audit=JSON.parse(fs.readFileSync(path.join(durable,'audit.json'),'utf8')).audit;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const bytes=fs.readFileSync(retention.archive),key=fs.readFileSync(retention.key_file);
assert.equal(sha(bytes),retention.encrypted_sha256);
const d=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(8,20));d.setAAD(bytes.subarray(0,8));d.setAuthTag(bytes.subarray(-16));
const archive=Buffer.concat([d.update(bytes.subarray(20,-16)),d.final()]);assert.equal(sha(archive),retention.plaintext_sha256);key.fill(0);
const root=fs.mkdtempSync('/private/tmp/atany-compatible-recovery-');fs.chmodSync(root,0o700);
const runtime=path.join(root,'runtime'),share=path.join(runtime,'share'),lib=path.join(runtime,'lib'),socket=path.join(root,'socket');
for(const p of [runtime,share,path.join(share,'extension'),lib,socket])fs.mkdirSync(p,{mode:0o700});
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(PG|DATABASE|SUPABASE|PAYMONGO|RESEND|SMTP|AWS)/.test(k)));
const bin='/opt/homebrew/bin',port=55446,user='atany_recovery_admin';
const result={started_at:new Date().toISOString(),scope:'offline complete logical database recovery',directory:root,
  source_archive_sha256:retention.encrypted_sha256,source_postgres:'17.6',local_postgres:'18.6',
  migrations_037_038_039_executed:false,source_connections:0,provider_requests:0,
  object_exclusions:[],verification:{}};
const save=()=>fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(result,null,2),{mode:0o600});
function run(program,args,{input,label='command'}={}){
  const r=spawnSync(program,args,{env,input,encoding:input?undefined:'utf8',timeout:120000,maxBuffer:32*1024*1024});
  if(r.stderr?.length)fs.writeFileSync(path.join(root,`${label}.private.log`),r.stderr,{mode:0o600});
  if(r.status!==0)throw Object.assign(new Error(`${label} failed; protected log retained`),{code:label.toUpperCase()});
  return r.stdout;
}
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const connect=db=>new pg.Client({host:socket,port,user,database:db});
async function inDb(db,work){const c=connect(db);await c.connect();try{return await work(c);}finally{await c.end();}}
async function fingerprint(c,name){const [schema,table]=name.split('.');const rows=(await c.query(`SELECT to_jsonb(t)::text AS row FROM ${quote(schema)}.${quote(table)} t ORDER BY to_jsonb(t)::text`)).rows;return {rows:rows.length,sha256:sha(JSON.stringify(rows))};}
let started=false;
try{
  assert.equal(sha(fs.readFileSync('/private/tmp/atany-vault-0.3.1.tar.gz')),'344edb590e574cc94937d5665f696b4b04c3af5ae9431cc9050da657ab563b11');
  fs.copyFileSync(path.join(build,'supabase_vault.dylib'),path.join(lib,'supabase_vault.dylib'));
  const controls={};
  for(const extension of audit.extensions){
    const name=extension.extname;
    if(name==='supabase_vault'){
      // Relocate only module loading metadata. Vendor C and SQL stay unchanged.
      const control=fs.readFileSync(path.join(build,'supabase_vault.control'),'utf8').replace("'$libdir/supabase_vault'","'supabase_vault'");
      fs.writeFileSync(path.join(share,'extension',`${name}.control`),control);
      for(const f of fs.readdirSync(path.join(build,'sql')))fs.copyFileSync(path.join(build,'sql',f),path.join(share,'extension',f));
      fs.copyFileSync(path.join(build,'supabase_vault--0.2.8.control'),path.join(share,'extension','supabase_vault--0.2.8.control'));
    }else{
      for(const f of fs.readdirSync('/opt/homebrew/share/postgresql@18/extension').filter(f=>f===`${name}.control`||f.startsWith(`${name}--`)))
        fs.copyFileSync(path.join('/opt/homebrew/share/postgresql@18/extension',f),path.join(share,'extension',f));
      const p=path.join(share,'extension',`${name}.control`);
      fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/default_version\s*=\s*'[^']*'/,`default_version = '${extension.extversion}'`));
    }
    controls[name]={version:extension.extversion,control_sha256:sha(fs.readFileSync(path.join(share,'extension',`${name}.control`)))};
  }
  result.extension_runtime={controls,source_archive_sha256:'344edb590e574cc94937d5665f696b4b04c3af5ae9431cc9050da657ab563b11',
    vault_binary_sha256:sha(fs.readFileSync(path.join(lib,'supabase_vault.dylib'))),global_install:false,
    source_key_used:false,synthetic_vault_root_key:true};
  // New local key is solely for testing the empty Vault and synthetic roundtrip.
  const localKey=path.join(root,'synthetic-vault.key'),getKey=path.join(root,'get-synthetic-vault-key.sh');
  fs.writeFileSync(localKey,crypto.randomBytes(32).toString('hex')+'\n',{mode:0o600});
  fs.writeFileSync(getKey,`#!/bin/sh\nexec /bin/cat '${localKey}'\n`,{mode:0o700});
  run(`${bin}/initdb`,['-D',path.join(root,'pgdata'),'-U',user,'-A','trust','--no-locale','-E','UTF8'],{label:'initdb'});
  fs.appendFileSync(path.join(root,'pgdata','postgresql.conf'),`\nlisten_addresses = ''\nunix_socket_directories = '${socket}'\nport = ${port}\nunix_socket_permissions = 0700\nextension_control_path = '${share}:$system'\ndynamic_library_path = '${lib}:$libdir'\nshared_preload_libraries = 'supabase_vault'\nvault.getkey_script = '${getKey}'\nlog_statement = 'none'\nlog_min_error_statement = 'panic'\ntimezone = 'UTC'\n`);
  run(`${bin}/pg_ctl`,['-D',path.join(root,'pgdata'),'-l',path.join(root,'server.private.log'),'-w','start'],{label:'start'});started=true;
  await inDb('postgres',async c=>{
    assert.equal((await c.query('SHOW listen_addresses')).rows[0].listen_addresses,'');
    result.local_postgres=(await c.query('SHOW server_version')).rows[0].server_version;
    const available=(await c.query('SELECT name,version FROM pg_available_extension_versions')).rows;
    for(const e of audit.extensions)assert.ok(available.some(x=>x.name===e.extname&&x.version===e.extversion),`Unavailable required version ${e.extname} ${e.extversion}`);
    const existing=new Set((await c.query('SELECT rolname FROM pg_roles')).rows.map(r=>r.rolname));
    for(const r of audit.roles)if(!existing.has(r.rolname))await c.query(`CREATE ROLE ${quote(r.rolname)} NOLOGIN ${r.rolsuper?'SUPERUSER':'NOSUPERUSER'} ${r.rolbypassrls?'BYPASSRLS':'NOBYPASSRLS'} ${r.rolinherit?'INHERIT':'NOINHERIT'} ${r.rolcreatedb?'CREATEDB':'NOCREATEDB'} ${r.rolcreaterole?'CREATEROLE':'NOCREATEROLE'}`);
    for(const r of audit.memberships)await c.query(`GRANT ${quote(r.parent)} TO ${quote(r.member)}${r.admin_option?' WITH ADMIN OPTION':''}`);
    await c.query('CREATE DATABASE atany_recovered');await c.query('CREATE DATABASE atany_vault_synthetic');
  });
  console.log('Restoring the complete unchanged archive, including Vault, Auth and Storage database objects, to the private local cluster.');
  run(`${bin}/pg_restore`,['--single-transaction','--exit-on-error','-h',socket,'-p',String(port),'-U',user,'-d','atany_recovered'],{input:archive,label:'restore'});
  result.archive_restore='passed';save();
  await inDb('atany_recovered',async c=>{
    await c.query("BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,public; SET LOCAL timezone='UTC'");
    const expected=original.backup.source_tables,actual={};
    for(const name of Object.keys(expected))actual[name]=await fingerprint(c,name);
    result.verification.table_results=Object.fromEntries(Object.keys(expected).map(name=>[name,{rows:actual[name].rows,count_matches:actual[name].rows===expected[name].rows,hash_matches:actual[name].sha256===expected[name].sha256}]));
    assert.deepEqual(actual,expected,'Snapshot row fingerprints differ');
    result.verification.tables_matched=Object.keys(expected).length;
    const sequences={};for(const name of Object.keys(original.backup.source_sequences)){const [s,t]=name.split('.');sequences[name]=(await c.query(`SELECT last_value::text,is_called FROM ${quote(s)}.${quote(t)}`)).rows[0];}
    assert.deepEqual(sequences,original.backup.source_sequences);result.verification.sequences_matched=Object.keys(sequences).length;
    // PG18 adds catalog rows for NOT NULL; PG17 encoded these on columns only.
    // Compare every source constraint plus the complete column nullability contract.
    const constraints=(await c.query("SELECT conrelid::regclass::text AS relation,conname,contype,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype<>'n' ORDER BY relation,conname")).rows;
    assert.deepEqual(constraints,audit.constraints);result.verification.public_constraints_matched=constraints.length;
    const columnFields=['table_schema','table_name','column_name','data_type','udt_name','is_nullable','column_default'];
    const normalizeColumns=rows=>rows.map(row=>Object.fromEntries(columnFields.map(k=>[k,row[k]])));
    const columns=(await c.query("SELECT table_schema,table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_schema,table_name,ordinal_position")).rows;
    assert.deepEqual(normalizeColumns(columns),normalizeColumns(audit.columns.filter(x=>x.table_schema==='public')));
    result.verification.public_column_contracts_matched=columns.length;
    result.verification.pg18_not_null_catalog_entries=(await c.query("SELECT count(*)::int AS n FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='n'")).rows[0].n;
    const indexes=(await c.query("SELECT t.relname AS relation,i.relname AS name,x.indisunique,x.indisvalid,x.indisready,pg_get_indexdef(i.oid) AS definition FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid WHERE t.relnamespace='public'::regnamespace ORDER BY t.relname,i.relname")).rows;
    assert.deepEqual(indexes,audit.indexes);result.verification.public_indexes_matched=indexes.length;
    const enums=(await c.query("SELECT n.nspname,t.typname,e.enumlabel,e.enumsortorder FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder")).rows;
    assert.deepEqual(enums,audit.enums);result.verification.public_enum_labels_matched=enums.length;
    const policies=(await c.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows;
    assert.deepEqual(policies,audit.policies);result.verification.public_policies_matched=policies.length;
    const functions=(await c.query("SELECT p.proname,p.prosecdef,p.proconfig,p.proacl,md5(pg_get_functiondef(p.oid)) AS definition_md5 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' ORDER BY p.proname")).rows;
    assert.deepEqual(functions,original.supplemental.functions);result.verification.public_functions_matched=functions.length;
    const triggers=(await c.query("SELECT c.relname,t.tgname,t.tgenabled,p.proname,n.nspname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace ORDER BY c.relname,t.tgname")).rows;
    assert.deepEqual(triggers,original.supplemental.triggers);result.verification.public_triggers_matched=triggers.length;
    const privileges=(await c.query("SELECT r.rolname,c.relname,has_table_privilege(r.oid,c.oid,'SELECT') AS sel,has_table_privilege(r.oid,c.oid,'INSERT') AS ins,has_table_privilege(r.oid,c.oid,'UPDATE') AS upd,has_table_privilege(r.oid,c.oid,'DELETE') AS del,has_table_privilege(r.oid,c.oid,'TRUNCATE') AS trunc FROM pg_roles r CROSS JOIN pg_class c WHERE r.rolname IN ('postgres','anon','authenticated','service_role') AND c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') ORDER BY r.rolname,c.relname")).rows;
    assert.deepEqual(privileges,audit.privileges);result.verification.public_role_privileges_matched=privileges.length;
    result.verification.migration_history=(await c.query('SELECT filename,checksum FROM public.schema_migrations ORDER BY filename')).rows;
    assert.ok(!result.verification.migration_history.some(r=>/^0(37|38|39)_/.test(r.filename)));
    result.verification.extension_versions=(await c.query('SELECT extname,extversion,extnamespace::regnamespace::text AS schema FROM pg_extension ORDER BY extname')).rows;
    assert.deepEqual(result.verification.extension_versions,audit.extensions);
    result.verification.vault_secret_rows=(await c.query('SELECT count(*)::int AS n FROM vault.secrets')).rows[0].n;
    await c.query('ROLLBACK');
  });
  // Validate the native extension only with an unrelated synthetic secret/database.
  await inDb('atany_vault_synthetic',async c=>{
    await c.query("CREATE EXTENSION supabase_vault VERSION '0.3.1'; BEGIN");
    await c.query("SELECT vault.create_secret('synthetic recovery canary','atany_recovery_canary')");
    assert.equal((await c.query("SELECT decrypted_secret='synthetic recovery canary' AS ok FROM vault.decrypted_secrets WHERE name='atany_recovery_canary'")).rows[0].ok,true);
    await c.query('ROLLBACK');result.verification.synthetic_vault_crypto_roundtrip=true;
  });
  result.application_database_recovery='verified';result.full_supabase_project_recovery='not_verified';
}catch(error){result.blocker={code:error.code||'VERIFICATION_FAILED',message:String(error.message).split('\n')[0]};
  // Detailed comparison errors may contain database data. Never print or persist them.
  process.exitCode=1;console.error(JSON.stringify({stopped:true,code:result.blocker.code}));
}finally{
  if(started){run(`${bin}/pg_ctl`,['-D',path.join(root,'pgdata'),'-m','fast','-w','stop'],{label:'stop'});result.local_server_stopped=true;}
  result.finished_at=new Date().toISOString();save();archive.fill(0);console.log(`Protected recovery verification: ${root}/verification.json`);
}
