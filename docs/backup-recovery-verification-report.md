# ATANY backup recovery verification — 19 November 2026

**Application database recovery verified; overall NO-GO remains.** The complete
unchanged logical archive now restores successfully, with all 71 captured table
counts/content fingerprints and four sequences matching. The encrypted backup is
in durable private storage outside the repository, with its key separate.
Permissions remain a blocker: self-promotion from customer to admin was reproduced
using a synthetic identity in a local clone. Full Supabase project recovery has
not been verified.

This phase made **zero source database connections or changes**, applied no
migrations 037/038/039 and made no payment requests. It used the captured target
catalog and backup. No application/worker, Auth, Storage or provider service was
started. No commits, pushes or deployments occurred. All disposable database
servers were stopped after verification.

## 1. Exact restore failure and dependency ownership

The original error was:

```text
ERROR: extension "supabase_vault" is not available
HINT: The extension must first be installed on the system where PostgreSQL is running.
Command was: CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";
```

The generic Homebrew PostgreSQL installation lacked the required extension
library/control files. The error did not demonstrate damaged ATANY data.

Offline inspection of the archive TOC and schema found these Vault-related
objects/dependencies:

- `vault` schema, owned in the source by `supabase_admin`.
- `supabase_vault` extension and its comment.
- `vault.secrets`, its archived table data and ACL.
- `vault.decrypted_secrets` view ACL.
- Function ACLs for `vault._crypto_aead_det_decrypt`, `vault.create_secret` and
  `vault.update_secret`.
- The extension creates its own crypto functions, secret table/indexes and
  decrypted view; extension members are recreated by the real extension scripts.

The restored catalog's reverse dependency closure contained **28 tracked
objects**, with **zero public-schema dependents**. Archive public-object definitions
contained no Vault reference. These results identify a Supabase-managed
infrastructure dependency, not an ATANY business-table dependency. No Vault
object was excluded, replaced with a stub or edited out of the archive.

The captured `vault.secrets` table contained **zero rows**. There were no original
Vault secret values to decrypt in this snapshot. Supabase Vault normally relies
on a separately managed server key; a logical database archive does not establish
recovery of that key.
[Vault source and key handling](https://github.com/supabase/vault/tree/v0.3.1).

## 2. Restore approach

The source is PostgreSQL **17.6**. A compatible **logical database** test ran on
local PostgreSQL **18.6**, with all source extension versions pinned:

| Extension | Verified version |
| --- | --- |
| `supabase_vault` | 0.3.1 |
| `pgcrypto` | 1.3 |
| `pg_stat_statements` | 1.11 |
| `uuid-ossp` | 1.1 |
| `plpgsql` | 1.0 |

Vault 0.3.1 was downloaded from the official Supabase repository and inspected
before building. The build used the existing PostgreSQL development tools and
libsodium. Vendor C and SQL were unchanged. The downloaded release archive SHA-256
was `344edb590e574cc94937d5665f696b4b04c3af5ae9431cc9050da657ab563b11`.

Native build setup needed the existing gettext include path and PostgreSQL's
Darwin bundle-loader flags. The compiler's unsupported header-format attribute
warnings were kept as warnings; extension code was not patched. An earlier
link attempt had overridden the package's native linker flags; preserving those
flags resolved it. No package manager or global extension installation was used.

Extension libraries, control files and SQL were staged under the disposable
cluster's private paths. Only control-file loading locations/version defaults
were adjusted; PostgreSQL's global files and the backup were unchanged. The
private controls pinned source versions because PostgreSQL 18 defaults to newer
`pgcrypto`/`pg_stat_statements` versions. PostgreSQL 18 supports per-cluster
extension search paths.
[PostgreSQL extension paths](https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-EXTENSION-CONTROL-PATH).

A new **synthetic local Vault root key** was used solely in this isolated cluster.
It is not the archive encryption key or the original project's managed Vault key.
An independent synthetic database verified a Vault encryption/decryption roundtrip
and rolled its canary transaction back.

The complete archive was decrypted in memory and restored with
`pg_restore --single-transaction --exit-on-error`, with **no object exclusions**
and no owner/ACL stripping. Source role names/attributes and memberships were
recreated for ownership and policy checks, but logins were disabled and no source
role passwords installed. The server used a mode-0700 private Unix socket and no
TCP listener. It had no application/provider configuration or connection to the
existing project.

This environment was sufficient to prove application database recovery. A full
Supabase service environment is still required to verify Auth, Storage APIs,
Realtime, configuration and managed-key recovery. Docker/Supabase services were
not installed or started to claim that broader result.

## 3. Restore and data-integrity results

Every captured table's sorted `to_jsonb` row fingerprint matched the fingerprint
recorded inside the original read-only export snapshot. **71/71 counts and
content hashes matched**, including all captured Auth, public, Realtime, Storage
and Vault tables. All four sequence values and `is_called` flags matched.

Selected recovered counts:

| Object | Rows | Count and full-row fingerprint |
| --- | ---: | --- |
| `public.users` | 12 | Match |
| `auth.users` | 15 | Match |
| `public.orders` | 15 | Match |
| `public.auctions` | 28 | Match |
| `public.bids` | 31 | Match |
| `public.payments` | 24 | Match |
| `public.billing_records` | 14 | Match |
| `public.subscription_changes` | 9 | Match |
| `public.audit_logs` | 241 | Match |
| `public.schema_migrations` | 36 | Match |
| `storage.buckets` | 2 | Match |
| `storage.objects` | 58 | Match |
| `vault.secrets` | 0 | Match |

Other verified contracts:

- **68** original public constraints, including **33 foreign keys**, matched by
  name, definition, type and validation state. Restored FK validation checks the
  captured relationships, including users, orders, products, auctions and bids.
- **198** public column contracts matched by name/type/default/nullability.
- **67** public indexes matched by definition, uniqueness, validity and readiness.
- **51** public enum labels, **33** public RLS policies, **3** public function
  definitions/security/ACLs and **2** triggers matched.
- **92** role/table privilege combinations matched across `postgres`, `anon`,
  `authenticated` and `service_role`.
- All source extension versions matched. Application history retained its 36 rows
  and exact recorded values; 037/038/039 remained absent.

The first metadata comparison detected **115 additional NOT NULL catalog rows**
introduced by PostgreSQL 18. PostgreSQL 17 represented these in column flags. The
verification was corrected to compare all original constraints and separately
compare every public column's nullability/type/default. The new representation
was accounted for rather than treated as missing data or silently ignored.
[PostgreSQL 18 constraint catalog](https://www.postgresql.org/docs/18/catalog-pg-constraint.html).

Existing payment identifiers, metadata and audit/billing records matched their
snapshot fingerprints. This proves recovery of stored financial evidence, not
provider settlement or checkout closure. The new webhook/operation/collection/
reconciliation tables were absent in the source because 039 had not run; this
phase did not invent or backfill that missing historical evidence.

## 4. Backup retention verification

Verified durable encrypted archive, outside the repository:

`/Users/honeycar/ATANY_Backups/2026-11-19/target-audit-d3Aw9E/database.dump.aesgcm`

Its SHA-256 still matches the original:

`3b05aef9947984aaf8f1ca2241569dcb2d63b5c2bb62a313d493d4b89a7ac634`

- Archive: **700,571 encrypted bytes**, AES-256-GCM; **700,535 decrypted bytes**.
- Original-to-copy checksum match and authenticated decryption were verified again
  after copying; decrypted bytes matched the recorded original plaintext hash.
- Backup directories are **0700**, files **0600**, owned by the user. The archive
  encryption key was copied into a **separate private directory outside the
  repository**, also 0700/0600. Its value was never displayed or committed.
- Archive, key, metadata and retention manifest were flushed to disk. No plaintext
  archive was written during this recovery phase.
- Original temporary archive and key were retained. Neither was deleted.
- Private recovery/permissions evidence was copied into the durable archive's
  `verification` directory. `retention.json` records the authoritative durable
  paths; the older copied `backup-result.json` is historical provenance and
  contains the old temporary-path references.

This verifies durable **local** retention, not off-machine redundancy. The key and
archive are in separate directories on the same computer; independent key escrow,
an off-machine encrypted archive copy, retention policy and media-loss recovery
remain operational prerequisites. The temporary local restored data directories
contain sensitive copies, are mode 0700 and have no running server.

## 5. Exact permissions findings

Findings describe the captured target catalog and were reproduced offline. No
fresh target connection, production policy change or live exploit was performed.

### Confirmed self-promotion path in the captured policies

Affected table: **`public.users`**. Role: **`authenticated`**.

The policy named **`users: self can update own name`** is an UPDATE policy with
`USING (auth.uid() = id)`. Its name does not impose column restrictions. The role
has table-wide UPDATE grants, including `role`, and there is no non-internal
guard trigger on `public.users`. The expected user privilege-guard function was
also absent from the captured functions. Migration 028's history entry is only a
baseline marker, not proof that the guard exists.

Metadata confirms UPDATE privilege on these columns:

`id`, `name`, `email`, `password_hash`, `role`, `status`, `created_at`,
`totp_secret`, `totp_enabled`, `preferred_branch_id`, `phone`, `suspension_reason`.

In a **separate local clone**, the test inserted a new synthetic customer, assumed
the ordinary `authenticated` PostgreSQL role and that synthetic identity's claims,
and tested changing **only that new row**:

| Check | Observed result |
| --- | --- |
| `is_admin()` before role update | false |
| Own-row `role='admin'` update | 1 row accepted |
| `is_admin()` afterward | true |
| Rollback and canary lookup | Transaction rolled back; canary absent |

The captured `is_admin()` helper reads the users table and identity, so this is
an authorization failure in the database contract. A live HTTP/Data API exploit
was not attempted; exposure of a particular endpoint remains a separate check.
It is a critical blocker until protected-column updates are denied and the
approved self-service profile fields are narrowly defined. Merely renaming the
policy or adding an ownership-only WITH CHECK would not restrict the `role`
column. No corrective SQL was applied or migration created in this phase.

### Broad client grants and future-table defaults

Default creators: **`postgres` and `supabase_admin`**, schema **`public`**.
Recipients include **`anon`, `authenticated`, `service_role`, `postgres`**.
The client grants include SELECT, INSERT, UPDATE, DELETE and **TRUNCATE** (plus
other broad table privileges). RLS is enabled, but does not filter TRUNCATE.
This is an excessive SQL-role privilege; it does not mean PostgREST exposes a
TRUNCATE endpoint.

Both client roles have broad privileges on these **23** current public tables:

`auction_reminders`, `auction_viewers`, `auctions`, `audit_logs`, `bids`,
`billing_records`, `branches`, `chatbot_messages`, `chatbot_sessions`, `favorites`,
`notifications`, `orders`, `payments`, `product_reviews`, `products`,
`schema_migrations`, `security_alerts`, `seller_payment_methods`, `shops`,
`subscription_changes`, `support_requests`, `users`, `watchlists`.

The same creator defaults would affect new public payment-evidence tables unless
explicitly addressed in reviewed permission SQL. Migration 039's RLS statements
alone do not revoke those grants. Existing row policies still determine ordinary
row visibility and modifications; table grants alone do not imply every operation
is allowed on every row.
[PostgreSQL RLS and privileged operations](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

### Trusted backend permissions

The captured backend role is **`postgres`**, non-superuser with **BYPASSRLS**,
**CREATEROLE** and **CREATEDB**. It owns the public application tables. The cloned
role could read orders/payments, and the 92 captured role/table privilege results
matched. RLS therefore does not constrain normal trusted-backend access; backend
ownership/payment checks remain necessary. A narrower runtime role is a separate
permission-design change requiring review and authorization.

## 6. Application-data versus full-project recovery

| Component | Verified scope / limitation |
| --- | --- |
| ATANY application database | Stored rows, relationships and listed schema contracts verified against the backup snapshot. |
| Auth database | All captured rows/fingerprints recovered, including users. Login, token verification, MFA behavior, OAuth, redirects, SMTP and Auth service configuration were not tested. |
| Storage | 58 object metadata rows and 2 bucket rows matched. The underlying file bytes were not in this database archive or restored. |
| Vault | Extension/schema and empty secret table restored. Synthetic local encryption works. No original managed root key was recovered, and recovery of non-empty managed secrets is not proven. |
| Realtime | Captured database tables matched. Live subscriptions/WebSocket services were not tested. |
| Roles | Names, relevant attributes/memberships and verified table privileges were recreated; source passwords were not restored and local logins were disabled. This is not a live operational identity restoration. |
| Project configuration | JWT/signing keys, API secrets, provider credentials, Edge Functions, DNS, Auth/Storage settings and managed infrastructure are not recovered by this test. |
| PayMongo | No provider request, payment, checkout expiry or refund. Database recovery does not reverse provider actions or establish current payment state. |

Full Supabase project recovery needs a compatible service environment and supported
configuration/key/file restoration, plus actual service end-to-end checks. No full
project recovery claim is made.
[Supabase restore scope](https://supabase.com/docs/guides/self-hosting/restore-from-platform).

## 7. Remaining blockers and recommendation

**GO:** recovery of this captured application database snapshot using the tested
isolated native environment and unchanged archive is verified.

**Overall NO-GO:** do not apply 037–039, activate payments or declare full-project
disaster-recovery readiness until the following are addressed:

1. Reviewed/authorized protected-column and client-grant corrections, followed by
   positive/negative authorization regression tests. The user-role canary is a
   confirmed local reproduction of the captured source vulnerability.
2. Auth/service/signing configuration and Storage file backup/restore verification;
   original Vault key recovery if future/non-empty secret data requires it.
3. Independent protected backup/key retention and an agreed recovery owner,
   retention policy, RTO/RPO and end-to-end recovery exercise. Current local timings
   and one successful logical restore do not establish those objectives.
4. Prior unresolved legacy payment classification, transport verification and
   isolated provider test-mode/end-to-end gates. Nothing in this phase contacted
   PayMongo or cleared existing safety blocks.
5. Explicit user approval before any existing-project schema or permission change.

## 8. Files and reproducibility

Added local-only helpers:

- `backend/scripts/retain-target-backup.mjs` — guarded copy, separate key retention,
  checksums, authenticated decryption, fsync and protected evidence copy.
- `backend/scripts/inspect-recovery-archive.mjs` — offline TOC/schema dependency
  inspection without printing data or writing a plaintext data archive.
- `backend/scripts/verify-compatible-recovery.mjs` — full unchanged archive restore,
  pinned private extension runtime and source-snapshot contract checks.
- `backend/scripts/verify-recovered-permissions.mjs` — dependency/permission audit
  and rolled-back synthetic user canary in a separate local clone.

This report and the [redacted verification summary](staging/backup-recovery-verification-summary.json)
contain results and aggregate metadata only. Private detailed evidence is retained
with the durable encrypted backup. Application logic, dependency manifests and
migration files were not changed. The prior target-audit report remains a
historical record of the initial failed restore and now links to this follow-up.

Reproduction requires the inspected Vault 0.3.1 source build/private dependencies,
the durable encrypted archive and separate key. The helpers do not accept a remote
restore URL or load application `.env`. Their only database destinations are
private local Unix sockets; operating-system approval was required for processes
and durable writes outside the workspace. Do not run application services or
provider tests against the restored real-record snapshot.

Verification is complete and work stops here.
