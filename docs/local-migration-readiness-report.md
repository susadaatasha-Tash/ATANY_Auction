# ATANY local migration readiness — 19 November 2026

**Local rehearsal passed. Existing Supabase deployment is not approved or verified.**
No Supabase project was connected, queried or changed; no production records,
credentials, real payments or refunds were used. No commit, push or deployment.
Payment and UI application logic was not changed during this phase.

## Migration numbering changed during this work

The requested files initially existed as `037_order_cancellation.sql` and
`038_payment_safety.sql`. Both were tested before the shared workspace reorganized
them. The final workspace now contains this sequence:

1. `037_order_cancellation_enum.sql` — enum extension, committed separately.
2. `038_order_cancellation.sql` — cancellation columns, FK and partial index.
3. `039_payment_safety.sql` — the original 038 payment-safety DDL, byte-identical.

Do **not** enable payment actions after applying only the current 037 and 038.
The current 039 is also required. The new enum/cancellation split was already
present when this phase detected the workspace change; this phase verified it
and adjusted the rehearsal and legacy test's migration reference. It did not
rewrite or renumber those migration files.

| Tested source | Result |
| --- | --- |
| Original 037 cancellation | Failed with `55P04` when sent as one `pg.query(sql)` request; PostgreSQL rolled back both enum and columns. Passed with `psql -f` statement autocommit. |
| Original 038 payment safety | Passed atomically; injected division-by-zero failure rolled back the entire DDL. Rerun preserved schema. |
| Current 037 enum | Passed through the actual `src/db/migrate.js --file=...` runner. |
| Current 038 cancellation | Passed through the actual runner after 037 committed. |
| Current 039 payment safety | Passed through the actual runner; injected transaction failure rolled back all new tables and `payments.provider_checked_at`. |
| Current complete sequence | Exact history filenames/checksums verified; runner reruns skipped recorded files; direct SQL reruns preserved schema. |

The required correction is a transaction boundary between enum addition and use.
The current three-file sequence provides it. Never wrap all three files in a
single transaction. PostgreSQL documents this restriction for new enum values.
[ALTER TYPE](https://www.postgresql.org/docs/current/sql-altertype.html).

Some migration comments and earlier reports still name `037a` or the original
037/038 pair. The actual filenames above and the current checksum artifact are
the execution contract. Reconcile historical migration filenames/checksums before
any staging application; do not use a blanket baseline to hide differences.

## Scope and schema dependencies

Fresh PostgreSQL **18.6 (Homebrew)** cluster, port 55440, private Unix socket
`/private/tmp/atany-migration-rehearsal`, with TCP disabled and directory/socket
permissions 0700. The script refuses an existing directory and never takes a
remote URL. All records use synthetic fixture identities. Both local servers
started during this work were stopped afterward.

The integration baseline uses the checked-in `setup_complete.sql` DDL, excluding
both original seed blocks, plus migrations **015, 016, 020, 021, 022 and 034**.
It includes real UUID FKs, enums, triggers, sequences, RLS, payment uniqueness and
winner/deadline columns. Local `auth.uid()`/`auth.role()` functions emulate claim
settings for parsing the existing policies. This is **not** a full Supabase Auth
environment, a replay of every 001–036 migration, or proof of live schema parity.

Verified dependencies include `public.users/orders/payments` UUID keys,
`orders.status` using `public.order_status`, payment status enum, transaction and
auction code triggers, audit logs, notifications and billing checkout references.
The existing `schema.sql` is not a sufficient standalone bootstrap: dependency
ordering/helper definitions/payment parity differ. Do not replay seeds or all
historical migrations against an existing project.

## Constraints, indexes, RLS and permissions

The current [catalog evidence](staging/local-migration-rehearsal-results.json)
records enum labels, every relevant constraint definition and validation flag,
index definition/readiness/validity, role properties and client privilege checks.
All inspected constraints were validated and indexes valid/ready, including:

- Cancellation actor FK with `ON DELETE SET NULL`, and cancelled-order partial index.
- One paid allocation per order; unique non-null checkout and provider references.
- One running/unknown operation per order; a competing insert raised `23505`.
- Event/provider/mode uniqueness, collection/provider/mode uniqueness, and the
  reconciliation collection/event-reason uniqueness rules and state checks.
- Evidence FKs retain financial dependencies rather than cascading away collections.

All four new tables had RLS enabled, no FORCE RLS, no initial policies and no
client grants in this clean cluster. `anon`, `authenticated` and an ordinary
backend role were denied SELECT by ACLs on all four tables (`42501`). Temporarily
granting operation-table SELECT/INSERT still hid an existing row and rejected
INSERT under default-deny RLS; those temporary grants were rolled back.

For application integration, the harness then installed **local fixture grants
and policies only**, scoped to `atany_runtime`, a non-owner role with neither
superuser nor BYPASSRLS. All 15 new integration tests ran through that role. Its
fixture permissions exclude migration history and do not grant DELETE/TRUNCATE.
The fixture policies are not migration changes or a production permission design.
They demonstrate that an explicitly authorized backend can operate under RLS.
Grants and RLS are separate requirements.
[PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

The actual Supabase backend login, object owners, inherited/default grants,
publication exposure and policies remain **uninspected**. Migration 039 itself
does not establish backend access. Approve narrow role-specific permissions after
that audit; do not solve this by granting clients evidence-table access or adding
global BYPASSRLS. Admin reconciliation was exercised through its existing read-only
response handler; real authenticated Supabase/browser end-to-end access is pending.

## Backend and test results

`cancellationSnapshot()` executed its actual readiness SQL and observed
**`safety_schema_ready = true`**. The public function returns capabilities, not
a field of that name: the eligible fixture returned `can_request_payment=true`,
`can_request_cancellation=true`, and no block code. No API contract was invented.

| Run | Result |
| --- | --- |
| Current migration rehearsal, payment/controller regression subset | **102 passed**, including **15** new enum/FK/RLS database tests. |
| Full backend regression | **858 passed, 31 opt-in tests skipped**, 46 passing files. Those skipped tests are the 15 new tests and 16 winner tests, both run separately in the rehearsal. The 36 existing payment DB tests ran in this full suite. |
| Winner/deadline opt-in suite | **16 passed**, serially on a separate restored, migrated synthetic database. |
| Existing payment DB suite after correcting its renamed migration reference | **36 passed**, including its bootstrap path, on its separate minimal fixture database. |
| Customer modal/purchases/status frontend regression | **68 passed**, 3 files. |

These runs overlap; do not add their counts as distinct tests. New real-PostgreSQL
coverage includes eligible unpaid checkout, paid/processing rejection, every active
and older checkout closing before Customer/Shop Owner cancellation, duplicate
payment requests, both checkout/cancellation race directions, safe unpaid
cancellation, unauthorized customer, audit-failure rollback/retry, database-level
reservation uniqueness, and late-payment evidence with Admin projection.
Existing safety tests additionally exercise webhook signatures, durable receipts,
provider uncertainty, replay/idempotency, recovery and settlement races.

Provider calls were mocked. The missing-configuration test used the actual
checkout helper with no secret: **fetch was never called**, the order remained
pending, and a durable unknown-operation/reconciliation record blocked retries.
This is conservative current behavior, not a configured payment system. No usable
PayMongo credentials were inspected or tested. Configuration must be validated
before traffic; supplying a key later does not automatically resolve that fence.
Do not delete evidence or bypass backend checks to clear it.

The first new fixture run had a UUID parameter-casting error, and another called
the Admin handler without its response argument. Both test-fixture mistakes were
corrected. An initial winner run targeted the pre-migration restore; switching
to the migrated restore resolved its two failures. Final runs above have no test
failures. Repository-wide `git diff --check` still reports a pre-existing trailing
space at `frontend/src/roles/shop-owner/pages/MyAuctions.jsx:645`; it was not changed.

## Backup and recovery verification

Both **pre-migration and post-migration** custom-format `pg_dump` archives were
actually restored with `pg_restore --exit-on-error` into different local databases.
Sorted row fingerprints for every public table, sequence values/is_called, and
normalized schema dumps matched. The schema comparison covers enum definitions,
constraints, indexes, triggers, functions, RLS, policies and ACLs. The final backup
contained non-empty financial evidence: **one webhook event, one external collection
and one reconciliation**, including their raw fixture evidence. The winner suite
then successfully exercised the migrated restore.

Measured local backup/restore/fingerprint checks took **515 ms before** and
**525 ms after** migrations. These tiny-fixture timings are not production RTO/RPO
estimates. Archives and detailed logs remain outside Git under the private socket
directory. Restore used existing local roles in the same cluster; cluster-wide
role recreation, encryption/escrow and managed Supabase recovery are not proven.

Before any existing-project schema change, a named operator must:

1. Obtain approval naming the staging project, backend role, maintenance scope and
   separate restore target. Confirm it contains no production data or live keys.
2. Run the prepared catalog and aggregate legacy-payment audits in read-only mode
   on that approved target. Compare history and the current manifest by filename
   and checksum, including effects through 036; inspect partial/older 038/039 tables.
3. Freeze staging checkout/cancellation/manual-payment/fulfilment writers and
   winner/recovery workers. Keep external provider traffic mocked. For any future
   production window, separately approve durable webhook ingress/replay handling;
   a database restore does not undo provider actions or recover lost webhooks.
4. Verify a supported project snapshot/backup, then capture application schema and
   data with complete RLS visibility; inventory roles/memberships/grants, extensions,
   sequences, policies, functions, triggers and project configuration. Encrypt and
   escrow backups outside Git, with retention, restore owner and explicit RTO/RPO.
5. Restore into the approved separate target and compare schema/data/evidence,
   identifiers, sequence state and actual-role transactions/negative client access.
   Account separately for Auth, Storage objects, secrets, Edge Functions and managed
   schemas; a public-table archive is not a whole-project recovery mechanism.
   Use Supabase's supported restore procedure rather than replaying managed-role
   or realtime-schema DDL blindly.
   [Supabase backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
6. Only after those checks and explicit approval, apply the **current 037, 038,
   then 039 in separate file requests** with controlled `search_path=public`, bounded
   lock/statement timeouts and the authorized migrator. The local rehearsal used
   the actual Node runner with explicit `--file` arguments, never blanket migration
   or baseline commands. Verify catalogs/history after each file; add only the
   separately approved backend access design.
7. Run synthetic cross-role API/browser tests, both cancellation roles, duplicate
   requests and payment races on the approved isolated copy; verify Admin read-only
   reconciliation. Test PayMongo's real test-mode sandbox only under a separate
   approved configuration. Inspect legacy sessions before enabling recovery workers.
8. Recheck capability responses and payment configuration, then resume writers in
   a controlled window with reconciliation ownership and a stop/recovery threshold.

Recovery preference is **retain additive schema and repair forward**. If 037
succeeds and a later file fails, leave the unused enum, stop writers and repair
the failed step. If payment-safety DDL aborts, rollback was verified locally.
DDL commit and history insertion are separate runner operations: a crash can leave
objects without a history row; reconcile catalog/checksum before retrying.
Do not drop evidence tables, erase operations, remove enum values or restore over
new financial evidence as an automatic rollback. Restore to a separate target,
retain post-snapshot receipts/provider identifiers, and reconcile before any switch.

## Remaining conflicts and deployment blockers

- No approved existing-project inspection was performed; actual schema/history,
  PostgreSQL major, owners, policies, grants, default ACLs and legacy payments are
  unverified. Earlier restrictions on production access remain in force.
- `IF NOT EXISTS` does not converge an older table/index of the same name. Missing
  `next_attempt_at`, old state checks, wrong uniqueness/type/FK/index definitions or
  unexpected policies must be detected and repaired by separately reviewed SQL.
- The renumbered chain must be reconciled with existing migration history and old
  docs/manifests; applying current 037/038 alone leaves payment safety unavailable.
- Actual-project backup completeness, restore exercise, recovery objectives,
  role recreation and recovery ownership are not verified by this local rehearsal.
- Valid provider test-mode configuration, real test-mode API behavior and complete
  authenticated staging/browser end-to-end testing remain outstanding.
- Legacy null/ambiguous gateway identifiers, live-mode evidence, cross-order reuse,
  duplicate money or assignment mismatches need triage. SQL schema readiness does
  not prove provider checkout closure. Ordinary indexes take locks; fixture timings
  do not establish a production lock budget or performance result.

**Recommendation:** approve a separately scoped staging read-only audit and
backup/restore rehearsal next. Keep existing Supabase schema changes blocked until
its prerequisites and explicit migration approval are satisfied. No claim of
production readiness is made.

## Files and reproduction

Added in this phase:

- `backend/scripts/rehearse-payment-migrations.mjs` — local-only guarded rehearsal,
  actual runner, catalog/permission checks, rollback, backups/restores and tests.
- `backend/src/tests/migrationReadinessDb.test.js` — 15 opt-in integration tests.
- This report and `docs/staging/local-migration-rehearsal-results.json` — current
  schema/index/constraint/role/checksum evidence.
- `docs/staging/original-037-038-local-rehearsal.json` — preserved original-pair proof.

Updated `backend/src/tests/paymentSafetyDb.test.js` to reference renamed
`039_payment_safety.sql`. Existing payment/UI work and unrelated dirty files were
preserved. Current migration source hashes are in the current evidence artifact;
the original artifact is explicitly historical.

From the repository root, on this machine with installed PostgreSQL binaries:

```sh
node backend/scripts/rehearse-payment-migrations.mjs
```

The script uses `/opt/homebrew/bin`, fixed private socket/port/database names and
synthetic environment values. It requires local PostgreSQL process/socket rights;
the filesystem sandbox's shared-memory restriction required approved execution
outside that sandbox here. It refuses to reuse the evidence directory. Before a
repeat, verify the owned server is stopped and archive that directory by renaming
it; do not delete it or point the harness at an existing project. It stops its
owned server in `finally`, writes `result.json`, and fails on SQL/test/source drift.
Logs: `integration-tests.log`, `winner-tests.log`, `catalog-readonly.log`,
`legacy-audit-readonly.log`, plus separate backend/frontend regression logs.
Never run the truncating database suites against shared staging or live Supabase.
