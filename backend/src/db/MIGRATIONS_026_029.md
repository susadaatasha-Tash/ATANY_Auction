# Production migration apply order
# Apply to live DATABASE_URL via psql or Supabase SQL Editor.
# Do NOT assume the live DB is already updated — verify then apply.

## Order (strict)

1. Baseline schema (if environment is fresh / incomplete):
   ```
   psql "$DATABASE_URL" -f backend/src/db/schema.sql
   ```
   Or use `backend/src/db/setup_complete.sql` for a full demo-capable install.

2. Historical migrations that may still be unapplied on long-lived DBs:
   ```
   # Only apply migrations that are missing. Check pg_tables / columns first.
   psql "$DATABASE_URL" -f backend/src/db/migrations/015_order_payment_flow.sql
   psql "$DATABASE_URL" -f backend/src/db/migrations/016_billing_paymongo_checkout.sql
   psql "$DATABASE_URL" -f backend/src/db/migrations/017_billing_subscription_periods.sql
   psql "$DATABASE_URL" -f backend/src/db/migrations/021_auction_winner_payment_deadline.sql
   psql "$DATABASE_URL" -f backend/src/db/migrations/025_billing_plan_code.sql
   ```

3. Priority sequence (required for subscription + security + C5 + auction pause):
    ```
    psql "$DATABASE_URL" -f backend/src/db/migrations/026_subscription_plan_change.sql
    psql "$DATABASE_URL" -f backend/src/db/migrations/027_subscription_hardening.sql
    psql "$DATABASE_URL" -f backend/src/db/migrations/028_users_privilege_guard.sql
    psql "$DATABASE_URL" -f backend/src/db/migrations/029_products_proposed_schedule.sql
    psql "$DATABASE_URL" -f backend/src/db/migrations/030_auction_pause_support.sql
    ```

## Dependency notes

| Migration | Depends on | Idempotent? | Notes |
|-----------|------------|-------------|-------|
| 026 | billing_records (012/016/017/025) | Yes | IF NOT EXISTS columns/tables; enums via DO exception |
| 027 | 025 + 026 | Yes (after this pass) | CHECK/FK skipped when present |
| 028 | public.users + is_admin() | Yes | DROP+CREATE policy; CREATE OR REPLACE trigger fn |
| 029 | public.products | Yes | ADD COLUMN IF NOT EXISTS |

## Fresh-install parity

- `schema.sql` and `setup_complete.sql` now include:
  - users privilege trigger (028)
  - products.proposed_* (029)
  - payments table (015)
  - billing_records plan/interval columns (025/026)
  - subscription_changes + seller_payment_methods (026) + hardening (027)

## Post-apply verification (read-only)

```sql
-- C5 columns exist
SELECT column_name FROM information_schema.columns
WHERE table_name='products' AND column_name LIKE 'proposed_%';

-- C1 trigger installed
SELECT tgname FROM pg_trigger WHERE tgname='trg_users_guard_privileged';

-- 026 tables exist
SELECT to_regclass('public.subscription_changes'), to_regclass('public.seller_payment_methods');

-- 027 unique guards
SELECT indexname FROM pg_indexes
WHERE indexname IN ('idx_subscription_changes_one_pending','idx_subscription_changes_one_scheduled');

-- payments unique paid guard
SELECT indexname FROM pg_indexes WHERE indexname='idx_payments_one_paid_per_order';
```

## Production env (set before deploy)

| Key | Required | Notes |
|-----|----------|-------|
| NODE_ENV | yes | `production` |
| DATABASE_URL | yes | direct Postgres (required for money paths) |
| SUPABASE_URL | yes | https project URL |
| SUPABASE_ANON_KEY | yes | auth-required config |
| SUPABASE_SERVICE_ROLE_KEY | yes | backend-only |
| PAYMONGO_SECRET_KEY | yes | server-side |
| PAYMONGO_WEBHOOK_SECRET | yes | fail-closed webhooks |
| FRONTEND_URL | yes | CORS allowlist |
| ALLOW_INSECURE_PAYMONGO_WEBHOOKS | must NOT be true | production forbids |
| GROQ_API_KEY / RESEND_API_KEY | recommended | chatbot / email |
