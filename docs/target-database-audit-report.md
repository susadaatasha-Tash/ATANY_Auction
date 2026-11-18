# ATANY target database audit — 19 November 2026

**Historical result:** the [recovery follow-up](backup-recovery-verification-report.md)
subsequently verified the complete logical archive restore and durable retention.
The permissions blockers remain; full Supabase project recovery is unverified.

**NO-GO for schema changes or payment activation.** The authorized read-only
target audit completed, and a complete logical database archive passed integrity
checks. Restoring it to disposable local PostgreSQL failed because
`supabase_vault` is unavailable. All database/provider work stopped at that failure,
as requested. The local server was shut down. No migrations were applied, no
existing records were changed, and no payments/refunds, deployment, commit or push
occurred.

## 1. Supabase connection status

The configured backend database, Supabase API URL and local project link agree on
the target. Neither connected Supabase account listed that project, so the audit
used its existing backend PostgreSQL credentials. No unrelated project's database
was queried. Supabase skill/documentation guidance was consulted; the connector's
project listing could not supply the target's backup/plan information.

The configured **session pooler resolves over IPv4** outside the filesystem/network
sandbox. Three fresh authenticated, repeatable-read/read-only connections succeeded
in **1420, 1430 and 1453 ms**. Catalog queries and the later backup session also
succeeded. The server reports **PostgreSQL 17.6**. No timeout or DNS error occurred
on those successful samples; this is a bounded observation, not a long-duration
stability guarantee or proof that the direct IPv6 endpoint works.

Inside the sandbox, DNS initially returned `ENOTFOUND`. Outside it, default Node
trust returned `SELF_SIGNED_CERT_IN_CHAIN`. Loading the Supabase CA from its HTTPS
distribution solved client trust without disabling verification. The audit/backup
explicitly verified the certificate and hostname; the backup's client socket was
encrypted and authorized. Application TLS configuration was not changed.

**Transport follow-up:** PostgreSQL's `pg_stat_ssl` reported `false` for the
server-side session, while the Node client-to-pooler socket verified TLS. These
measurements describe different connection boundaries. End-to-end/pooler-upstream
encryption is not established and needs provider/configuration review. No SSL
setting was changed; those settings can restart the database.
[Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement).

## 2. Existing schema compatibility

The target has the prerequisite UUID primary/FKs and expected orders/payments
structures, including canonical winner rank, winner confirmation and payment
deadline columns. Audit logs, shops/products/auctions, notifications and billing
checkout references are present. Orders and payments are owned by `postgres`.
All inspected public indexes are valid/ready and constraints validated. The
one-order-per-auction, unique checkout/provider reference and one-paid-allocation
per-order indexes have the expected definitions/predicates.

Current `order_status` values are:

`pending`, `ready_pickup`, `completed`, `preparing`, `expired`.

The following are absent, consistent with 037–039 not having run:

- `order_status.cancelled`.
- `orders.cancelled_by`, `orders.cancelled_at`, `orders.cancellation_reason`.
- `payments.provider_checked_at`.
- `payment_operations`, `payment_webhook_events`, `provider_collections`,
  `payment_reconciliations`.

No existing new-table/index name collision was identified. The base schema is
structurally compatible with the three additive migrations, subject to permission
and recovery blockers below. The payment safety schema is currently incomplete;
backend checks must continue to fail closed. Actual application mutation tests
were not run against this database.

## 3. Migration history compatibility

`public.schema_migrations` exists; no
`supabase_migrations.schema_migrations` table was found.

- **001–032:** 32 entries contain `baseline`, not source checksums. Their historical
  SQL cannot be verified from these records. Catalog effects must be evaluated.
- **033–036:** all four recorded 16-character SHA-256 prefixes match current local
  files: `ff70240b71689384`, `d117cca2283e0a30`, `adf2b3ffa0a5180c`,
  `6998c7abe0d7ea74`, respectively.
- No recorded original `037_order_cancellation.sql`,
  `037a_order_cancellation_enum.sql` or `038_payment_safety.sql` conflict was found.
- Current `037_order_cancellation_enum.sql`, `038_order_cancellation.sql` and
  `039_payment_safety.sql` are all unrecorded. Their current hashes are preserved
  in the redacted evidence. No history rows were inserted or changed.

The corrected sequence still requires **037 commit → 038 → 039**. Do not wrap the
enum addition and its first use in one transaction, run a blanket migration, or
re-baseline this project to conceal differences.

## 4. Permissions and RLS

The backend connects as `postgres`: non-superuser, with BYPASSRLS, CREATE ROLE and
CREATE DATABASE privileges. It owns orders/payments and would normally access its
own new tables. Public application tables have RLS enabled and no FORCE RLS.
Actual migration-role authority to alter the enum/create in the schema should be
explicitly confirmed before any approved DDL; that complete privilege check was
not reached before the stop gate.

**Migration-blocking default privileges:** public-table defaults for both
`postgres` and `supabase_admin` grant `anon` and `authenticated`
`arwdDxtm` privileges, including **TRUNCATE**. Migration 039 enables RLS but does
not revoke these inherited grants. Ordinary SELECT/INSERT/UPDATE/DELETE are subject
to policies, while TRUNCATE is not. The clean local rehearsal's no-client-grant
assumption does not hold on this project. A reviewed explicit privilege correction
is needed for new evidence/operation tables. Do not grant browser clients access
to those tables or assume RLS alone handles the defaults. This is a catalog
finding; no client write or TRUNCATE was attempted, and a browser exploit through
the Data API was not demonstrated.
[PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

**Existing baseline security discrepancy:** `users` still has its older own-row
UPDATE policy, authenticated table-wide UPDATE privileges, and no user privilege
guard trigger/function was found. The only non-internal public triggers found
were auction/transaction code generators. This indicates a potential path for a
client to alter protected user columns, including role/status, despite migration
028 being marked as baseline. It needs a dedicated security review/correction;
no exploit or write was attempted. Do not treat a baseline label as proof that
the current guard exists.

Orders have buyer/admin SELECT policy; payments have own/admin SELECT and admin
ALL policy. Existing Admin/RLS helper functions and policy metadata were inspected,
but no authenticated browser end-to-end permission test was performed. Public
migration history also has RLS enabled; its broad grants still deserve review
because RLS does not govern every privileged operation.

Aggregate legacy checks found **18 PayMongo-labeled rows without checkout IDs**
and without a definitive creation-rejection marker. These require classification;
some may be historical manual records. This count does not prove that 18 active
provider checkouts exist. No duplicate checkout-ID groups, duplicate paid-allocation
groups or pending orders missing deadlines were found. Provider state was not
queried and no identifiers/evidence were rewritten.

## 5. Backup verification result

**Complete logical archive created and integrity-verified.** Native `pg_dump` 18.6
exported the PostgreSQL 17.6 database without explicit schema/table exclusions.
It used an exported repeatable-read/read-only snapshot and connection-level
`default_transaction_read_only=on`, with verified TLS. Source fingerprints were
captured for **71 ordinary/partitioned non-system tables**, and sequence values
did not advance across the dump interval. No source row locks, DDL, DML or
application service/worker execution was used.

Verification performed:

1. `pg_dump` exited successfully; custom-format archive size **700,535 bytes**.
2. `pg_restore --exit-on-error --file=/dev/null` decoded the complete archive,
   including compressed data, without executing its SQL.
3. The archive was encrypted with **AES-256-GCM**, then read back, authenticated,
   decrypted in memory and compared to the original SHA-256.
4. The plaintext intermediate was removed. Encrypted archive and private evidence
   have mode **0600**, inside a **0700** directory. The random key has mode 0600 in
   a separate 0700 directory. Credentials never appeared in command arguments,
   logs or repository files.

Protected archive:
`/private/tmp/atany-target-audit-d3Aw9E/database.dump.aesgcm`

Encrypted archive SHA-256:
`3b05aef9947984aaf8f1ca2241569dcb2d63b5c2bb62a313d493d4b89a7ac634`

The protected `backup-result.json` in that directory records the separate key-file
location and source fingerprints. The key itself and database contents were not
copied into the repository. **Temporary storage is not durable backup escrow.**
The archive and its separately protected key need approved permanent retention
before this can support an operational recovery plan. Do not lose the key or
store it with a shared archive.

This is a logical database backup using standard extension-dump semantics, not a
physical cluster/platform backup. Global role passwords, server encryption keys,
Storage file bytes, Edge Function deployments and project/Auth configuration are
outside its scope. Role/membership/default-grant inventory was retained privately;
it is not a password-bearing cluster-role dump.
[pg_dump scope](https://www.postgresql.org/docs/current/app-pgdump.html).

Available methods and limits:

| Method | Verified availability here |
| --- | --- |
| Native logical database archive | Successfully created and integrity-verified as above. |
| Supabase CLI schema/data/role exports | CLI 2.117.0/help available; not used for this backup. Its managed-schema filtering requires careful scope review; Docker was not found. |
| Supabase managed daily backups/PITR | Documented options, but this project's plan, enabled features, recovery points and retention could not be inspected through the connected accounts. Not verified available for this target. |
| Storage file backup | Separate from database metadata; not performed in this database-only phase. |

[Supabase backups](https://supabase.com/docs/guides/platform/backups),
[supported backup/restore procedures](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## 6. Restore verification result

**FAILED — stop gate reached.** The verified encrypted archive was decrypted only
in memory and supplied to `pg_restore` targeting a newly created disposable LOCAL
PostgreSQL **18.6** cluster. It listened only on a private Unix socket. Source
roles were represented by inert NOLOGIN roles for local object ownership; no
source login passwords or live application configuration were installed.

Restore ran with `--single-transaction --exit-on-error` and failed with:

```text
ERROR: extension "supabase_vault" is not available
```

The local installation lacks that Supabase extension. The transaction did not
complete, the server was shut down, and post-restore data/sequence/schema/permission
comparisons were **not reached**. Archive integrity is verified; recoverability
is **not** verified. No extension, table or failed statement was excluded to force
a green result, and no second restore was attempted after this failure.

The next recovery prerequisite is a compatible isolated local Supabase/PostgreSQL
environment with the required extensions and managed-schema support, preferably
matching source major 17. Restore the same archive there, then verify all source
table fingerprints, financial identifiers/evidence, sequences, constraints,
indexes, functions/triggers, policies/grants and required role behavior. Keep the
restored copy offline from applications, providers, email and scheduled jobs.
Do not restore to or alter the existing Supabase project.

## 7. PayMongo test configuration and isolation requirements

Local configuration contains a `sk_test_`-shaped secret and a webhook signing
secret. The configured frontend is loopback. No values were exposed and **no
PayMongo API call or checkout/payment was initiated**. Key shape/presence does
not prove provider authorization, matching webhook registration or delivery.

Safe real test-mode verification remains conditional on:

- A separate backend/configuration using a **clean synthetic database**, not the
  existing project or a restored copy of real customer/order records.
- Isolated Auth/service configuration and disabled live fallback URLs, mail,
  fulfilment and background jobs. Starting the app with its current `.env` would
  point at the existing project and is not an isolated test.
- Provider-confirmed test credentials and test-only webhook signing configuration,
  with a public HTTPS delivery endpoint routed solely to that synthetic backend.
- Raw-body signature/mode verification, durable event receipts, test fixture order
  references, duplicate-event/processing/late-payment/cancellation tests and Admin
  read-only reconciliation. No automatic refunds or safety-check bypasses.

Provider key authorization, actual webhook registration/reachability, delivery and
test checkout were not verified. They remain pending because the restore failure
triggered the requested stop.

## 8. Final recommendation and artifacts

**NO-GO.** Keep existing schema changes and payment activation blocked until:

1. Full recovery succeeds in a compatible local environment and the backup/key
   have durable protected retention with a recovery owner and agreed RTO/RPO.
2. New-table default grants are hardened in reviewed SQL, and the missing user
   privilege guard/baseline discrepancy is resolved under separate authorization.
3. Legacy ambiguous payment records and pooler-upstream TLS are reviewed, and
   remaining migration-role authority is verified.
4. Isolated provider test-mode/webhook and authenticated end-to-end checks pass.
5. The user explicitly approves any existing-project migration or permission change.

No additional source/database/provider work proceeded after restore failure.
This phase added only the two guarded audit/backup scripts, this report and a
[redacted summary](staging/target-database-audit-summary.json). Existing application
logic and migration files were unchanged. Reports contain schema metadata and
aggregate findings only; private database contents, raw logs and keys remain
outside Git. Prior local migration rehearsal results remain a separate record.

The backup script takes a protected completed-audit directory, refuses to overwrite
an existing attempt and has no remote restore destination option. Any future
retry is a new explicitly scoped task after the restore blocker is addressed.
