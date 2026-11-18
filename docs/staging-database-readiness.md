# ATANY staging database readiness — migrations 037 and 038

**Decision: prepared for review; not cleared to migrate.** This is a local source
review and an execution plan. No database connection, query, backup, restore,
migration, test database creation or database-writing test was performed in this
phase. Neither migration was changed. Staging identity, actual catalog, roles and
legacy records remain **unverified** because no target database was inspected.

The [staging rehearsal plan](superpowers/plans/2026-11-18-staging-migration-rehearsal.md)
contains the future procedure and approval gates. Stop before its execution until
explicit approval names the non-production targets and approved write scope.

## Findings that affect the execution path

| Finding | Local evidence | Required disposition before staging writes |
| --- | --- | --- |
| **037 can fail through the current Node runner on a fresh enum.** | `migrate.js` sends an entire file through `pool.query(sql)`. 037 adds `order_status.cancelled` and then uses it in a partial index in that same request. Installed pg uses the simple-query protocol for this call. | Use the reviewed statement-by-statement psql procedure, committing the enum addition before index creation. Do not use the current runner for this rehearsal. This is source/documentation analysis, not an executed database reproduction. |
| **038 does not establish backend permissions.** | Four tables have RLS enabled, no policies or explicit grants; no FORCE RLS. | Identify the actual PostgreSQL backend role and migration owner. Confirm existing owner/BYPASSRLS access plus grants, or obtain approval for a narrowly scoped policy design. Do not grant global BYPASSRLS to fix a permission error. |
| **Idempotent names do not verify shape.** | `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` skip existing names. | Compare column types/defaults, validated constraints, indexes/predicates, owners, grants and policies, not just names. Partial older 038 tables can be incompatible. |
| **Migration history is not a reliable verifier by itself.** | Runner records a 16-character SHA-256 prefix but does not compare existing checksums. `--status` calls `ensureTable()` and may write. `--file` does not enforce prerequisites. | Inspect history using read-only SQL; compare checksums and actual schema. Do not run `migrate:status`, blanket `migrate:sql`, `--baseline`, or `npm run migrate` during this review. |
| **Bootstrap files differ materially.** | `schema.sql` defines shops before referenced branches, uses `public.is_admin()` without defining it, omits audit_logs and the preparing enum extension, and supplies only part of payment indexes/RLS parity. `setup_complete.sql` contains seeds but does not create payments. | Rehearse against a verified staging schema at the approved pre-037 baseline. Neither bootstrap file alone proves parity; do not replay all 001–036 or seeds blindly. |
| **Legacy payment interpretation is a launch prerequisite.** | Safety code fails closed on unresolved gateway creation; correlation reads checkout_session_id/reference, amount, mode and assignment metadata. 038 performs no data backfill. | Audit synthetic staging records, retain identifiers/evidence, and triage anomalies. No bulk relabeling, deleting duplicate money, reconstructing provider truth or resetting deadlines. |
| **Both database suites mutate data.** | The 16-test suite selects existing users and changes deadlines/payment rows. The 34-test suite creates/alters fixture tables and truncates with CASCADE. | Run each in its own disposable database. Neither suite belongs on a shared staging dataset. |

PostgreSQL documents that a new enum value cannot be used until its transaction
commits, and multiple statements in one simple-query message share an implicit
transaction. That explains the 037 runner risk even without an explicit BEGIN in
the application. Normal psql `-f` autocommit separates these statements; wrapping
037 with `-1`, sending the whole file with `-c`, or pasting it into an editor that
wraps execution would reintroduce the risk.
[ALTER TYPE](https://www.postgresql.org/docs/current/sql-altertype.html),
[simple-query transactions](https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-SIMPLE-QUERY),
[psql execution](https://www.postgresql.org/docs/current/app-psql.html).

## Dependency and ordering map

1. Verify the actual application baseline through 036 by effect and history; not
   simply the presence of a maximum migration number. There are 38 numbered local
   files. Some older files seed data or change permissions, so replaying the entire
   directory is not the rehearsal procedure.
2. Baseline requirements for 037: `public.order_status` is the enum used by
   `public.orders.status`; public users/orders have UUID primary keys. Inspect
   existing cancellation columns/FKs if any. Set a controlled `search_path=public`
   for migration execution because these files contain unqualified names.
3. Baseline requirements for 038 SQL: public users/orders/payments with compatible
   UUID keys and an alterable payments table. Although 038's DDL does not reference
   cancellation fields, the **application requires 037 before 038-enabled use**.
4. Application dependencies: 004 transaction codes; 005 auction codes; 012 audit
   logs/billing; 015 payment table/enums/indexes/RLS and preparing status; 016 billing
   checkout reference; 020 unique order per auction; 021/034 canonical winner
   tracking/deadline and expired status; existing subscription 017/025–027 contract
   for subscription webhook handling; notifications including any 022 dependencies.
   Check the complete baseline, not only these examples.
5. Apply 037 statement-by-statement and verify it. Only then apply 038 atomically
   with the approved ACL/history steps. Verify both before starting staging writers.

037 adds three nullable columns: reason TEXT, cancelled_at TIMESTAMPTZ and
cancelled_by UUID with FK to public.users ON DELETE SET NULL; plus a non-unique
index on cancelled_by WHERE status='cancelled'. It does not backfill cancellations,
expire orders, move winners or reset deadlines.

038 adds four tables and `payments.provider_checked_at TIMESTAMPTZ`. UUID IDs on
new tables have no database-generated default; the application supplies them. No
existing payment identifiers are replaced, and no historical collections/events
are reconstructed by this migration.

## Constraints, indexes and schema conflicts to inspect

| Object | Expected contract |
| --- | --- |
| orders/payments baseline | Valid UUID FKs; correct enums; one order per non-null auction; unique non-null provider_reference_id and checkout_session_id; one paid allocation per order. |
| payment_operations | UUID PK; non-null order/actor FKs; checkout/cancel kinds; running/unknown/completed/failed states; unique order_id WHERE state IN ('running','unknown'). |
| payment_webhook_events | UUID PK; required provider/event ID/livemode/type/payload/raw_body; unique (provider,livemode,provider_event_id); received/processed/review state; next_attempt_at default now(); pending receipt index. |
| provider_collections | UUID PK; unique (provider,livemode,provider_payment_id); BIGINT centavos, currency, evidence; optional order/payment links; no cascade deletion of financial evidence. |
| payment_reconciliations | UUID PK; event/collection/order FKs; unique non-null collection_id; open/reviewed/resolved state; event+reason uniqueness only for collection_id IS NULL; open-case index. |
| Cancellation | Correct FK delete action, partial-index predicate and column types even if names already exist. |

`CREATE INDEX IF NOT EXISTS` does not guarantee the existing index has the requested
definition. Check `indisvalid`, `indisready`, uniqueness, columns and partial
predicates. Both migrations use ordinary index creation: schedule a quiet staging
window, bounded lock/statement timeouts, and measure locks/elapsed time. Do not
silently substitute CONCURRENTLY inside a transaction.
[PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html).

Additional risks:

- Existing 038 tables may lack next_attempt_at, have an older reconciliation state
  check, wrong unique keys, invalid indexes or unexpected policies. The minimal
  safety test fixture explicitly repairs some fixture drift; migration 038 does
  not. A green fixture run cannot prove convergence of those existing tables.
- The new FKs use NO ACTION rather than CASCADE. Actor/order/payment deletion can
  now fail, including cascades from existing payments/users relationships. Preserve
  evidence and review deletion/account-retention workflows; do not drop constraints
  to make cleanup succeed. The older cancelled_by SET NULL action alone can lose
  legacy actor identity when a user is deleted.
- Amount positivity, JSON object shape and evidence immutability are not enforced
  by dedicated new CHECK constraints/triggers. Application validation and privileged
  access matter. No constraint changes are proposed as part of this report.
- Extra FK lookup indexes are not automatically created. Recovery orders by
  next_attempt_at/provider_checked_at; current indexes may need scale review. Use
  EXPLAIN on representative synthetic volumes and measure recovery throughput;
  an empty-table plan is not a performance result. No new index is applied here.

## RLS, roles and access verification

`users.role='admin'` is an application role, not necessarily a PostgreSQL login.
The Admin API uses the backend connection and must remain read-only for
reconciliation. Do not give authenticated browsers direct access to the four
evidence/operation tables.

RLS without policies denies ordinary access, while owners normally bypass RLS and
superusers/BYPASSRLS roles bypass it. A GRANT alone does not override RLS; BYPASSRLS
alone does not grant table access. Inspect ownership, inheritance/membership,
FORCE RLS, default ACLs, schema USAGE, relation grants and existing policies.
TRUNCATE/REFERENCES are not row-filtered by RLS. Default privileges may have granted
client roles privileges even though 038 contains no GRANT.
[PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html),
[default privileges](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html).

Acceptance matrix for the four new tables:

- Trusted backend: required SELECT/INSERT/UPDATE through real transactions; no
  normal application need for TRUNCATE or destructive evidence cleanup.
- anon/authenticated/PUBLIC: no direct table privileges; no inherited access or
  permissive policies. Verify denial using those real roles and client API attempts.
- Admin application: GET reconciliation works through backend role protection;
  Customer/Seller cannot use that endpoint; no refund/write reconciliation action.
- Separate migrator: appropriate object ownership/schema CREATE/type ALTER rights,
  ability to create references, enforce RLS and record migration history.
- Backup operator: complete snapshot visibility; an RLS-filtered backup is not
  acceptable. Test runtime transactions as the **actual** backend role, not only a
  superuser fixture. pg_triggers/defaults and auth helper privileges are part of this.

Current Supabase documentation distinguishes Data API grants from RLS; its
October 2026 rollout changes exposure defaults for newly created tables. Do not
assume inherited defaults match another project. Inspect publication membership
and keep raw evidence tables out of client realtime feeds. The managed realtime
schema must not be recreated by an unfiltered restore.
[Data API change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically),
[Realtime schema restrictions](https://supabase.com/changelog/realtime-schema-locked-down-against-modification),
[Supabase roles](https://supabase.com/docs/guides/database/postgres/roles).

## Legacy-record triage — prepared, not run

The [catalog inspection](staging/catalog-readonly.sql) and
[aggregate legacy audit](staging/legacy-payments-readonly.sql) contain read-only
queries for an approved staging target. They have been source-reviewed, not parsed
or executed by PostgreSQL. The second file requires a verified pre-037 baseline;
missing columns/permissions must stop the run, not be hidden with catch-and-continue.

Audit duplicate session/reference IDs, multiple paid rows, cross-order/billing
session reuse, unresolved null gateway IDs, manual payments mislabeled as gateway,
metadata shape/mode, old assignment/amount/currency mismatches, missing deadlines,
orphan references and incomplete cancellation metadata. These are review flags:
multiple historical sessions and assignment changes can be legitimate history.

**Do not copy production records or credentials.** Use only synthetic staging
data. Stop if staging contains live-mode records or unexpectedly real identities.
No SQL audit can prove an external checkout is closed; unknown provider state must
remain blocked. Migration 038 does not make old metadata trustworthy or recover
missing identifiers. Any remediation needs a separate reviewed plan and approval.

Before enabling workers, check the old sessions carefully: recovery polls every
non-paid row with a checkout ID, not just a new test fixture. Prevent staging from
contacting a live provider or using production keys. Keep all provider behavior
mocked for the first rehearsal; test-mode integration is a separate gate.

## Backup, restore, recovery and test gates

The rehearsal plan specifies a staging-only snapshot, public application archive,
role/ACL/extension/config inventory, separate restore target, consistency
fingerprints, sequence checks and role/negative-access tests. A file that merely
exists or passes `pg_restore --list` is not a verified restore. Capture elapsed
recovery time and have the owner set acceptable RTO/RPO before approval.

Supabase Auth/configuration, Storage objects, secrets, functions and managed-schema
customizations need explicit scope beyond a public-table dump. Use a supported
managed-project restore for platform recovery; do not replay reserved-role or
managed-schema DDL blindly. Keep encrypted staging backups and raw webhook evidence
outside Git. Logical dump completeness requires sufficient RLS access.
[Supabase backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html),
[pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html).

037 is not an all-or-nothing file in the recommended execution path; a failure may
leave the enum or nullable columns committed. 038 can be atomic. Prefer retaining
additive schema and a reviewed forward repair; never drop evidence or rebuild the
order enum as an automatic rollback. Restore into another isolated target only
after freezing writers and retaining any post-snapshot evidence. Rewinding a
database does not undo provider actions.

The **16 legacy tests remain unexecuted**. Their isolated socket substring guard
is not a production/staging identity verifier. The plan uses a dedicated
staging-schema copy with only synthetic accounts, validates the parsed pg host,
disables external services and runs all 16 serially. Never add a guard substring
to a remote connection string to make it pass. The **34 safety tests use another
database** and cannot serve as the full-schema migration rehearsal.

## Verification performed and remaining prerequisites

Performed: local inspection of both migrations, bootstrap variants, migration
runner/installed pg query path, payment services and both database test suites;
documentation verification; offline parsing of the example Unix-socket URL;
local source checksums and plan/artifact checks. Installed tools: PostgreSQL client
18.6 and Supabase CLI 2.117.0. CLI version/help only was read; no project was linked
or queried. Pin client tooling to the actual staging server major before a dump
or restore. No dependency upgrade was performed.

Still required: named staging/restore/test targets; explicit approval; actual
schema/history/role/legacy audit; permission design; matching platform versions;
quiet window and timeout budget; verified backup/restore and recovery objectives;
synthetic fixture provisioning; all 16 full-schema tests; authenticated cross-role
staging verification and provider mocks; documented recovery/reconciliation owner.

Files created in this phase: this report; the rehearsal plan; two read-only SQL
inspection files; and [local-source-manifest.json](staging/local-source-manifest.json).
Application code, migrations, production data and UI remain unchanged. No commit,
push, deployment, real payment or refund occurred. **Execution stops here.**
