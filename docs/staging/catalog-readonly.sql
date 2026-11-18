-- PREPARED ONLY; NOT EXECUTED. Use only an explicitly approved staging service.
-- psql -X -v ON_ERROR_STOP=1 -v backend_role=ACTUAL_ROLE -f this-file.sql
-- No credentials, row payloads, migration DDL or mutation statements are emitted.
\set ON_ERROR_STOP on
\if :{?backend_role}
\else
  \set backend_role ''
\endif

BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog, public;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TimeZone = 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';
SET LOCAL row_security = off;

SELECT current_database() AS database_name, session_user, current_user,
       inet_server_addr() AS server_address, inet_server_port() AS server_port,
       current_setting('server_version') AS server_version,
       current_setting('search_path') AS audit_search_path,
       current_setting('transaction_read_only') AS transaction_read_only;
-- Database name alone (often "postgres") cannot identify a Supabase project.
SELECT extname, extversion FROM pg_extension ORDER BY extname;
SELECT n.nspname, pg_get_userbyid(n.nspowner) AS owner, n.nspacl
FROM pg_namespace n WHERE n.nspname IN ('public','auth');

-- Include duplicate object names outside public: migrations use unqualified names.
SELECT n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.reltuples AS estimated_rows,
       pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relname IN ('users','shops','branches','products','auctions','orders','payments',
 'notifications','audit_logs','billing_records','subscription_changes','schema_migrations',
 'payment_operations','payment_webhook_events','provider_collections','payment_reconciliations')
 AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname,n.nspname;

SELECT c.relname, a.attname, format_type(a.atttypid,a.atttypmod) AS column_type,
       a.attnotnull, pg_get_expr(d.adbin,d.adrelid) AS column_default
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
WHERE n.nspname='public' AND c.relname IN
 ('users','shops','products','auctions','orders','payments','notifications','audit_logs',
 'billing_records','schema_migrations','payment_operations','payment_webhook_events',
 'provider_collections','payment_reconciliations') ORDER BY c.relname,a.attnum;

SELECT n.nspname, t.typname, e.enumlabel, e.enumsortorder
FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
JOIN pg_enum e ON e.enumtypid=t.oid
WHERE t.typname IN ('order_status','payment_status','user_role','auction_status')
ORDER BY t.typname,n.nspname,e.enumsortorder;

SELECT con.conrelid::regclass AS table_name, con.conname, con.contype,
       con.convalidated, con.condeferrable, con.condeferred,
       pg_get_constraintdef(con.oid,true) AS definition
FROM pg_constraint con
WHERE con.conrelid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('users','orders','payments','payment_operations',
 'payment_webhook_events','provider_collections','payment_reconciliations'))
 OR con.confrelid IN (to_regclass('public.users'),to_regclass('public.orders'),to_regclass('public.payments'))
ORDER BY con.conrelid::regclass::text,con.conname;

SELECT t.relname AS table_name, i.relname AS index_name, x.indisunique,
       x.indisvalid, x.indisready, pg_get_indexdef(i.oid) AS definition,
       pg_get_expr(x.indpred,x.indrelid) AS predicate
FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid
JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class i ON i.oid=x.indexrelid
WHERE n.nspname='public' AND t.relname IN ('orders','payments','payment_operations',
 'payment_webhook_events','provider_collections','payment_reconciliations')
ORDER BY t.relname,i.relname;

SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
FROM pg_policies WHERE schemaname='public' AND tablename IN
 ('users','orders','payments','audit_logs','payment_operations','payment_webhook_events',
 'provider_collections','payment_reconciliations') ORDER BY tablename,policyname;

SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls
FROM pg_roles WHERE rolname IN (session_user,current_user,:'backend_role',
 'anon','authenticated','service_role','postgres','supabase_admin') ORDER BY rolname;
SELECT pg_get_userbyid(m.roleid) AS parent_role, pg_get_userbyid(m.member) AS member_role,
       m.admin_option FROM pg_auth_members m ORDER BY parent_role,member_role;

-- Grants are separate from RLS. TRUNCATE and REFERENCES are not restricted by RLS.
SELECT r.rolname, c.relname,
       has_schema_privilege(r.oid,n.oid,'USAGE') AS schema_usage,
       has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,
       has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
       has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,
       has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete,
       has_table_privilege(r.oid,c.oid,'TRUNCATE') AS can_truncate,
       has_table_privilege(r.oid,c.oid,'REFERENCES') AS can_reference,
       has_table_privilege(r.oid,c.oid,'TRIGGER') AS can_create_trigger
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE r.rolname IN (current_user,:'backend_role','anon','authenticated','service_role')
 AND n.nspname='public' AND c.relkind IN ('r','p') AND c.relname IN
 ('orders','payments','audit_logs','payment_operations','payment_webhook_events',
 'provider_collections','payment_reconciliations') ORDER BY r.rolname,c.relname;
SELECT pg_get_userbyid(defaclrole) AS object_creator,
       CASE WHEN defaclnamespace=0 THEN '(all schemas)' ELSE defaclnamespace::regnamespace::text END AS namespace,
       defaclobjtype,defaclacl FROM pg_default_acl
WHERE defaclnamespace=0 OR defaclnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public');

SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname IN
 ('users','orders','payments','audit_logs','payment_operations','payment_webhook_events',
 'provider_collections','payment_reconciliations') ORDER BY c.relname,t.tgname;
SELECT n.nspname,p.proname,pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef,p.proconfig,p.proacl FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='public' AND p.proname IN ('is_admin','users_guard_privileged_columns',
 'set_transaction_code','set_auction_code')) OR (n.nspname='auth' AND p.proname IN ('uid','role'));
SELECT schemaname,sequencename,sequenceowner,data_type,start_value,increment_by,last_value
FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename;

SELECT pubname,puballtables FROM pg_publication ORDER BY pubname;
SELECT pubname,schemaname,tablename FROM pg_publication_tables
WHERE schemaname='public' AND tablename IN ('orders','payments','payment_operations',
 'payment_webhook_events','provider_collections','payment_reconciliations') ORDER BY pubname,tablename;
SELECT pid,usename,application_name,state,wait_event_type,wait_event,
       now()-xact_start AS transaction_age,pg_blocking_pids(pid) AS blocking_pids
FROM pg_stat_activity WHERE datname=current_database() ORDER BY xact_start NULLS LAST;

SELECT to_regclass('public.schema_migrations') IS NOT NULL AS history_exists \gset
\if :history_exists
SELECT filename,checksum,applied_at FROM public.schema_migrations ORDER BY filename;
\endif
ROLLBACK;
