# ATANY Staging Migration Rehearsal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for any later, explicitly approved execution. This document does not authorize execution, delegation, database access or migration.

**Goal:** Rehearse migrations 037/038, restore/recovery and the 16 opt-in tests on
identified, non-production targets without losing evidence or changing policies.

**Architecture:** Use a verified staging baseline, a separate restore-verification
target, and separate disposable full-schema and minimal payment-test databases.
Use direct PostgreSQL/psql with explicit identities, bounded locks, staged commits
and reviewed ACLs; keep all application/provider writers stopped until checks pass.

**Tech Stack:** PostgreSQL matching the staging server major; Supabase-compatible
Auth/roles/platform where applicable; psql/pg_dump/pg_restore; existing Vitest suites.

**Spec:** [Staging readiness report](../../staging-database-readiness.md) and the
user's “ATANY — STAGING DATABASE READINESS” request.

## Global constraints

- Do not access or modify production data.
- Do not apply migrations to production.
- Do not apply migrations to staging without explicit approval.
- Do not make real PayMongo transactions.
- Do not change working payment or UI logic.
- Do not commit, push, or deploy.
- Current execution stops at report preparation. Every command below is a future
  procedure, not a command run during this review. Existing test/implementation
  results are historical evidence, not proof of staging readiness.

## Review focus

1. Fresh enum versus already committed enum: 037 must work in both cases without
   a multi-statement implicit-transaction error. Check after each boundary.
2. Existing names with wrong types/checks/ACLs: compare definitions before writes;
   IF NOT EXISTS and migration-history rows cannot hide drift.
3. Unknown/old provider identities: retain evidence and fail closed; prevent workers
   from contacting any production/live checkout during the rehearsal.
4. Filtered or incomplete backups: restore into another target and verify data,
   sequences, role behavior and managed-platform dependencies, not just archive TOC.
5. Destructive tests aimed at the wrong database: validate the parsed Unix-socket
   connection, isolated dataset and egress controls before opting in.

## Task 1 — identity, scope and read-only baseline gate

**Files:** Read `docs/staging/{catalog-readonly,legacy-payments-readonly}.sql`,
`docs/staging/local-source-manifest.json`, migrations 037/038 and the readiness report.
Create only private rehearsal evidence outside Git when execution is approved.

- [ ] Obtain explicit approval naming the staging project ref/host, database and
  migration role; restore-verification target; disposable test targets; 037/038;
  ACL/history steps; synthetic fixture writes; backup/restore scope and quiet window.
  Do not infer identity from a service label or the database name `postgres`.
- [ ] Record host, port, project ref, database, role, PostgreSQL/platform versions,
  certificates, approved code/migration checksums, operator and recovery owner.
  Use a separate protected libpq service/password file, not backend/.env, a default
  Supabase link, shell history credentials or a production backup. Pin clients to
  the server major. Do not upgrade tools during the rehearsal.
- [ ] Provision service labels `atany_staging_auditor`, `atany_staging_backup`,
  `atany_staging_migrator`, `atany_staging_backend` and
  `atany_staging_restore_verifier` only after verifying their distinct targets.
  Use certificate-verified TLS for remote connections. Direct connections are
  preferred; a dedicated session-mode connection must retain session state.
  Do not use the application's REST fallback or a transaction pooler for migration.
- [ ] With the approved staging identity, run the read-only catalog first, then
  the aggregate audit only if baseline columns/types/permissions are correct:

```sh
# Future commands, from the repository root. Replace only approved placeholders.
umask 077
export ATANY_STAGING_ARTIFACT_DIR='/private/tmp/atany-staging-approved-rehearsal'
mkdir -p "$ATANY_STAGING_ARTIFACT_DIR"
PGOPTIONS='-c default_transaction_read_only=on' psql -X --no-password \
  --dbname='service=atany_staging_auditor' -v ON_ERROR_STOP=1 \
  -v backend_role='ACTUAL_APPROVED_BACKEND_ROLE' \
  -f docs/staging/catalog-readonly.sql \
  > "$ATANY_STAGING_ARTIFACT_DIR/catalog-before.txt"
PGOPTIONS='-c default_transaction_read_only=on' psql -X --no-password \
  --dbname='service=atany_staging_auditor' -v ON_ERROR_STOP=1 \
  -f docs/staging/legacy-payments-readonly.sql \
  > "$ATANY_STAGING_ARTIFACT_DIR/legacy-before.txt"
```

- [ ] Compare 001–036 history/effects and 037/038 hashes to the local manifest.
  Missing history is a separate reconciliation gate: do not use `--baseline=36`
  without proving every effect. If schema_migrations is absent, obtain approval
  for its exact reviewed creation/history reconciliation before proceeding.
- [ ] Stop for incompatible existing objects, invalid indexes, wrong schemas,
  unexpected owner/client grants, unreviewed policies, legacy/live identifiers or
  real personal data. The audit is a list of flags, not an automatic repair script.
  Any approved data repair must preserve original identifiers/evidence separately.

**Pass:** identity and baseline signed off; no unknown conflicts; exact backend/RLS
access design approved. **Otherwise stop before writes.**

## Task 2 — freeze writers and prove backup/restore

- [ ] Stop the named staging backend/cron processes, external webhook delivery,
  synthetic traffic, email/notification workers, database-scheduled jobs and any
  integrations that can write. Do not invent a disabled-cron environment flag:
  index.js schedules jobs when it starts. Record the actual runtime control used.
  Verify the target has no active application writer transactions or migration
  operator besides the approved session. Prevent provider/production egress.
- [ ] Capture a supported **staging-only platform snapshot/backup**, including a
  documented restore-to-new-target procedure. Capture managed Auth/configuration,
  custom roles/ACLs, extensions, custom triggers/policies/publications, sequences,
  and separately required Storage objects/secrets. Do not recreate locked managed
  schemas or reserved roles with unreviewed SQL.
- [ ] Take a complementary application archive with the approved backup role:

```sh
pg_dump --dbname='service=atany_staging_backup' --format=custom --schema=public \
  --file="$ATANY_STAGING_ARTIFACT_DIR/public-before.dump"
pg_restore --list "$ATANY_STAGING_ARTIFACT_DIR/public-before.dump" \
  > "$ATANY_STAGING_ARTIFACT_DIR/public-before.list"
shasum -a 256 "$ATANY_STAGING_ARTIFACT_DIR/public-before.dump" \
  > "$ATANY_STAGING_ARTIFACT_DIR/public-before.sha256"
```

The public archive is **not** a full Supabase platform backup. Catalog inventory
does not restore passwords; provision new staging-only secrets securely. A backup
role that cannot see all rows must fail; do not add `--enable-row-security` to hide
incomplete visibility. Use restricted encrypted storage with retention/expiry.
If using Supabase CLI exports, first review the installed `db dump --help` and its
dry-run output against the approved **staging** connection; use explicit `--db-url`,
never implicit `--linked`. CLI 2.117.0 locally advertises `--db-url`, `--role-only`,
`--data-only` and `--use-copy`. Exact filters depend on the target platform version.

- [ ] Restore the platform backup to a separately provisioned empty verification
  target, with no workers/provider egress. For a compatible application-archive
  restore, pre-provision required roles/auth helpers/extensions, review the archive
  TOC, and use this command only when its ownership/schema entries fit the target:

```sh
pg_restore --dbname='service=atany_staging_restore_verifier' \
  --exit-on-error --single-transaction \
  "$ATANY_STAGING_ARTIFACT_DIR/public-before.dump"
```

Do not use `--clean`, ignore errors, disable constraints, or drop existing schemas
to force this through. Managed Supabase targets may need the vendor-supported
restore flow instead. Any excluded TOC entries or owner mappings must be reviewed
before restore, and grants/RLS reverified afterward. Do not silently use `--no-acl`
or `--no-owner` and then claim privilege parity.

- [ ] On the restored target, rerun both read-only inspections using a separately
  verified restore-auditor service. Compare exact orders/payments fingerprints,
  counts/totals, all existing evidence tables, schema definitions, valid FKs/indexes,
  defaults, sequences and next generated code behavior, grants and role-denial tests.
  Managed Auth IDs/config and synthetic login must work where in scope.
- [ ] Record backup/restore exit codes, duration, artifacts, versions and integrity
  results. Owner must approve RPO/RTO targets before the rehearsal; measure achieved
  recovery time. For the frozen staging snapshot, expect no lost writes (RPO zero).

**Pass:** an actual restore succeeds and matches the approved baseline within the
approved recovery objective. A dump or TOC alone is not sufficient.

## Task 3 — rehearse 037, then 038 with explicit boundaries

**Prerequisites:** Tasks 1–2 passed; exclusive quiet window; schema_migrations
verified; 037/038 history entries absent, or an explicitly reviewed partial-state
recovery path selected. Compare exact file hashes again. These examples assume
the clean pre-037 path; never rerun them blindly on a partially applied target.

- [ ] Rehearse on a resettable staging-schema copy first, containing a genuine
  enum without cancelled. Keep the already-committed-enum case for a second reset
  copy. Do not force enum values by recreating types or editing pg_enum.
- [ ] Run 037 with psql **file mode, autocommit on, no outer transaction**:

```sh
PGOPTIONS='-c search_path=public -c lock_timeout=5s -c statement_timeout=120s -c application_name=atany_staging_rehearsal' \
psql -X --no-password --dbname='service=atany_staging_migrator' \
  -v ON_ERROR_STOP=1 -v AUTOCOMMIT=on \
  -f backend/src/db/migrations/037_order_cancellation.sql \
  > "$ATANY_STAGING_ARTIFACT_DIR/037.txt" 2>&1
```

Do not use Node migrate.js, `psql -c` with the whole file, `-1`, a wrapping BEGIN,
or the SQL editor's unknown transaction mode. The enum DO statement must commit
before the partial index consumes cancelled. On error, stop; inspect the committed
subset. Never interpret a nonzero exit as proof that nothing changed.

- [ ] Rerun catalog/audit after 037. Confirm enum, nullable types, FK action,
  partial-index validity/predicate; all pre-existing orders/payments fingerprints,
  amounts, assignments, created_at and deadlines unchanged. Record 037 only after
  those checks, using the verified history table and checksum:

```sql
-- Future staging-only history write, after the above verification.
INSERT INTO public.schema_migrations(filename,checksum)
VALUES ('037_order_cancellation.sql','b2c5502221bd4153');
```

A duplicate history entry or different checksum is a stop condition. No ON CONFLICT
DO NOTHING shortcut. These literal hashes must still match the approved manifest.

- [ ] Apply 038 with approved ACLs and its history entry in one transaction.
  The following ACL path is valid **only if** the approved backend role already
  has owner/BYPASSRLS semantics for the new tables and the default-ACL review found
  no other unexpected grantees. Otherwise stop for a separate narrowly scoped
  policy/grant design; do not grant global BYPASSRLS or client access to proceed.

```sh
# Future command; run from repository root, only after named-role approval.
PGOPTIONS='-c search_path=public -c lock_timeout=5s -c statement_timeout=120s -c application_name=atany_staging_rehearsal' \
psql -X --no-password --dbname='service=atany_staging_migrator' \
  -v ON_ERROR_STOP=1 -v backend_role='ACTUAL_APPROVED_BACKEND_ROLE' <<'SQL'
BEGIN;
\i backend/src/db/migrations/038_payment_safety.sql
REVOKE ALL ON TABLE public.payment_operations, public.payment_webhook_events,
 public.provider_collections, public.payment_reconciliations
 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_operations,
 public.payment_webhook_events, public.provider_collections,
 public.payment_reconciliations TO :"backend_role";
INSERT INTO public.schema_migrations(filename,checksum)
VALUES ('038_payment_safety.sql','a6d0c9bd721b64bb');
COMMIT;
SQL
```

This intentionally adds explicit staging ACL steps to the bare 038 file; approval
must cover them. They do not alter the source migration. Prerequisites include the
Supabase client roles existing, no unexpected grants through memberships/PUBLIC,
and an approved role design. If ON_ERROR_STOP exits mid-transaction, closing the
connection rolls it back. Confirm the result by catalog inspection; if a connection
is lost around COMMIT, inspect history and definitions before retrying.

- [ ] Compare all types, required columns/defaults, UUID keys, checked states,
  validated FKs, unique keys/partial predicates, RLS/ACLs and history. New evidence
  tables should be empty on the clean path. Old fingerprints/deadlines must match.
  Test backend SELECT/INSERT/UPDATE on synthetic linked rows inside a rolled-back
  transaction; test anon/authenticated/PUBLIC-derived denial, including destructive
  privileges. Never execute a TRUNCATE probe to prove that permission is absent.
- [ ] Re-run each approved file on a separate resettable copy already containing
  the correct objects (excluding duplicate history inserts), then compare definitions.
  Use a deliberately drifted synthetic copy to confirm preflight rejects wrong
  columns/indexes/checks. Do not turn IF NOT EXISTS into a repair strategy.

**Pass:** fresh and already-applied cases behave as expected; no data/deadline
change; actual backend role works; browser roles cannot access evidence; history
matches. Missing prerequisites block enabling the staging application.

## Task 4 — safely run all 16 opt-in winner tests

**Target:** dedicated disposable `atany_winner_rehearsal` database, private Unix
socket `/private/tmp/atany-winner-staging`, port 55439. This must be a separate
cluster/database built from the verified **staging schema**, never a production
copy or shared staging dataset. Provision a faithful compatible Auth/helper/role
baseline; do not replace RLS/functions with permissive stubs.

- [ ] Explicitly approve creating/restoring/migrating this disposable fixture too.
  Populate only three synthetic active customer users and one synthetic Shop Owner.
  Where actual Auth FKs/triggers exist, provision those fixture identities through
  the isolated Auth instance first. Confirm there are exactly three candidate
  customers: the test selects the first three by UUID, not a supplied fixture list.
- [ ] Apply the already approved 037/038 sequence to this full-schema copy; verify
  prior 004/005/012/015/020/021/028/034 effects, auth helpers, notifications, audit
  logs and payment safety permissions. No services/cron run beside the test process.
  The fixture login needs the tested SELECT/INSERT/UPDATE/DELETE and sequence
  privileges on its disposable objects, with RLS retained. Approve any fixture
  owner mapping explicitly; this does not replace testing the actual staging
  backend role in Task 3. Do not disable RLS to make the fixture pass.
- [ ] Use the example URL below; installed pg-connection-string has parsed it
  offline to the intended socket/database/port. A substring match alone is unsafe.
  Before execution, verify the socket is owned by the disposable cluster and use
  psql through it to confirm current database, role and server identity.

```sh
# Future commands from backend/. No real credentials or .env loading.
export ATANY_WINNER_REHEARSAL_URL='postgresql://atany_winner_test@localhost/atany_winner_rehearsal?host=/private/tmp/atany-winner-staging&port=55439'
env -i PATH="$PATH" ATANY_WINNER_TEST_DATABASE_URL="$ATANY_WINNER_REHEARSAL_URL" \
node --input-type=module <<'JS'
import { parse } from 'pg-connection-string';
const c=parse(process.env.ATANY_WINNER_TEST_DATABASE_URL);
if(c.host!=='/private/tmp/atany-winner-staging' || c.port!=='55439' ||
 c.database!=='atany_winner_rehearsal' || c.user!=='atany_winner_test')
 throw new Error('Unexpected disposable database identity');
console.log('Offline URL check passed; server identity must still be checked.');
JS

# Run this only after the preceding check and server identity verification pass.
env -i PATH="$PATH" NODE_ENV=test TZ=Asia/Manila PG_SSL_DISABLED=true \
  DATABASE_URL="$ATANY_WINNER_REHEARSAL_URL" \
  ATANY_WINNER_TEST_DATABASE_URL="$ATANY_WINNER_REHEARSAL_URL" \
  ATANY_ALLOW_WINNER_DB_TESTS=1 \
  SUPABASE_URL=http://127.0.0.1:1 SUPABASE_SERVICE_ROLE_KEY=fixture \
  PAYMONGO_SECRET_KEY=sk_test_fixture PAYMONGO_WEBHOOK_SECRET=fixture \
  ./node_modules/.bin/vitest run src/tests/winnerExpirationDb.test.js \
  --pool=forks --maxWorkers=1 --minWorkers=1
```

`PG_SSL_DISABLED=true` is permitted here only for this private local socket. Block
outbound provider/SMTP/production traffic at the fixture runtime boundary. Do not
pass a remote staging URL containing `/private/tmp/atany-` as a token to defeat the
existing guard. Do not filter, shuffle, parallelize, skip, weaken or reorder tests:
A–P share a seeded scenario. Expected result: **16 executed tests**, zero skips.

- [ ] Preserve the full output and database state on failure. The suite creates
  branch/shop/product/auction/bids/orders and notifications; backdates deadlines;
  reassigns winners; records a local counter payment; then changes that payment to
  cancelled to test resumed rotation. It performs no gateway payment/refund.
  Cleanup suppresses some errors and can leave records. Inspect survivors rather
  than assuming afterAll succeeded; discard the dedicated fixture only under its
  approved cleanup scope. Never run cleanup against shared staging.

## Task 5 — payment, application, recovery and sign-off checks

- [ ] Run the 34-test payment fixture **in its separate existing isolated database**
  via `bash scripts/test-payment-safety.sh`, after approving its fixture DDL/truncation.
  Its hard-coded socket is `/private/tmp/atany-safety-audit`, database
  `atany_safety_test`, port 55438. It uses minimal TEXT status tables and applies
  038/fixture repairs; it is not evidence that 037/full-schema/RLS passed. Never
  point that fixture at the database holding shared staging data or the 16-test copy.
- [ ] Run full backend/frontend and the dedicated 265-test payment / 72-test modal
  regression gates, frontend build and syntax checks in controlled environments.
  Record actual executed/skipped counts; do not reuse the earlier green counts as
  proof of this rehearsal. Keep all non-test credentials out of test processes.
- [ ] With only synthetic staging data and named staging identities, verify
  Customer/Seller pending-order cancellation, ownership/paid/processing rejection,
  atomic metadata/audit writes, Admin read-only reconciliation and negative access,
  details/invoice/direct-link refresh, print/download and realtime configuration.
  For first staging UI verification use orders without external checkout IDs;
  avoid checkout/payment buttons. Test all-session expiry, webhook HMAC/duplicates,
  late evidence and race/rollback behavior through controlled mocks. Provider
  test-mode integration, if desired, needs its own explicit approved scope.
- [ ] Before starting any staging worker, prove no live/missing-mode historical
  attempts can trigger a provider call. Check RLS, client table denial, publication
  configuration and runtime role. Use only staging keys/URLs and denied provider
  egress for mock-only verification. Restart only the approved staging processes;
  confirm durable received-event recovery after a controlled restart and backlog
  monitoring. Do not enable real provider delivery to make a mock test pass.
- [ ] Rehearse failure recovery on resettable copies: 037 enum committed/column
  failure; 038 forced error before COMMIT; lost-ack/unknown COMMIT outcome; missing
  history after a completed DDL step; backend denied by RLS; restart with received
  webhook evidence. Never kill a database or inject failures in shared staging.
- [ ] Sign off only with catalog/history/ACL evidence, stable old fingerprints,
  verified backup restore and achieved RTO/RPO, 16 real-schema tests, isolated safety
  tests, cross-role staging results and an assigned reconciliation/recovery owner.

## Recovery decision table

| State | Approved recovery approach |
| --- | --- |
| Before writes | Abort; keep existing staging schema/runtime. |
| 037 partly committed | Freeze writers; inspect exact enum/columns/indexes. Leave additive objects in place; complete only verified missing steps under the approved recovery path. Do not write a success history row for an incomplete file. |
| 038 fails before COMMIT | Verify transaction rolled back and 037 remains. Fix the exact prerequisite on a resettable copy before another approved attempt. |
| Lost response around COMMIT | Check history, definitions and counts first; do not assume failure or issue blind duplicate writes. |
| Drift/permissions discovered | Keep writers stopped. Prepare a reviewed forward repair or narrowly scoped permission amendment. Do not edit an already recorded migration or grant global bypass/client access. |
| Synthetic activity after snapshot | Preserve new events/collections/operations/reconciliation and their IDs first. Restore to another target only under the recovery plan; verify evidence reconciliation before switching the staging connection. |
| Restore required | Use the verified pre-migration backup on a separately identified recovery target; compare schema/data/roles/sequences/config, then approve a staging-only connection switch. No production cutover is included. |

No automatic down migration is supplied: dropping the new tables/columns or
rebuilding the enum can destroy audit/financial evidence. A database restore does
not reverse an external checkout or charge. No refunds are part of recovery.

**Current status: all execution checkboxes remain unchecked. Report preparation
is finished; no migration, restore or database test in this plan has run.**
