# ATANY OFFICIAL SUPPORT EMAIL — COMPLETE

ATANY Jewelry Auction Platform — the single official support destination

## A. Official Email

```
goldjewelryauction@gmail.com
```

Every ATANY support flow now resolves its recipient through one centralized
backend configuration and delivers to this inbox.

## B. Central Configuration

| | |
|---|---|
| **Backend module** | `backend/src/config/support.js` *(new)* — the ONE declaration of the address in the backend |
| **Env variable** | `ATANY_SUPPORT_EMAIL` — the deployment source of truth |
| **Legacy alias** | `SUPPORT_EMAIL` still honoured; `ATANY_SUPPORT_EMAIL` always wins |
| **Fallback** | `goldjewelryauction@gmail.com` (documented in `backend/.env.example`) |
| **Invalid config** | An invalid configured address falls back to the official inbox (never a broken recipient) |
| **Frontend display constant** | `frontend/src/shared/config/support.js` *(new)* — `SUPPORT_EMAIL`, `SUPPORT_CATEGORIES`, `supportMailto()` (URL-encoded) |
| **Enforcement** | Automated tests assert the literal appears in **exactly one** backend module and **exactly one** frontend module |

Nothing is hardcoded per-component: 8 support surfaces now read the shared
constant. `backend/.env.example` documents both `ATANY_SUPPORT_EMAIL` and the
now-required `RESEND_FROM_EMAIL`.

## C. Shared Support Service

`backend/src/services/supportService.js` — rewritten as the **single** backend
implementation (`sendSupportNotification`), used by every flow:

```js
sendSupportNotification({
  source, requesterName, requesterEmail, requesterRole, requesterUserId,
  subject, category, message, attachment, metadata
})
```

1. **Validates** the request (backend validation is authoritative).
2. **Persists** the `support_requests` row **first** — it is the authoritative
   record of the inquiry.
3. **Notifies** the official inbox (best-effort, never blocks storage).
4. **Sets Reply-To** to the validated requester address.
5. **Returns a stable reference** (`SUP-XXXXXX`) derived from the stored row id.
6. **Handles provider failure safely** — the row stays and the API reports
   `email_notification.sent: false` with a reason.

There is **no second email implementation**: the old inline copy inside
`backend/src/index.js` was deleted and now delegates to this service. The
frontend has one shared form component
(`frontend/src/shared/components/SupportRequestForm.jsx`) used by every surface.

## D. Public Contact

- **Route:** `POST /api/public/contact` — **kept** (no duplicate route created).
- **Rate limit:** 5 requests / 10 min / IP (existing limiter, unchanged).
- **Validation:** name required (≤150), email format, category from the
  whitelist, message required & trimmed (≤5000), attachment type/size.
- **Delivery:** `To: goldjewelryauction@gmail.com`, `Reply-To:` the visitor's
  email, `From:` the authorized ATANY sender.
- **Response:** `{ success, request: { id, reference, status }, email_notification: { sent } }`.
- The landing page now labels the select **Category** and lists the shared
  whitelist.

## E. Customer Support

- **Route:** `POST /customer/support` — **reused** (mounted behind
  `requireAuth` + `requireRole('customer')`; there is **no** active-account
  guard there, so a suspended customer can already reach it).
- **Authentication:** the requester's `id`, `name`, `email` and `role` are read
  from the **database row of the session** — a client-supplied `user_id`,
  `email` or `name` is ignored (verified live: a spoof attempt was stored
  under the authenticated identity).
- **UI:** Customer Profile → Help & Support now shows the official address,
  offers a **Category** select + **Subject** input, and reports the reference
  (`SUP-XXXXXX`) plus an honest "email notification delayed" note.

## F. Shop Owner Support

- **Route:** `POST /support/account` — **new**, narrowly scoped, mounted at the
  app level with `requireAuth` + `requireRole(['customer','shop_owner'])` and
  **no** active-account guard, so it is reachable by a suspended seller.
- **UI:** Shop Profile → **Contact ATANY Support** panel + modal (the shared
  form, `POST /support/account`).
- **Billing:** Shop Owner Subscription → a failed load shows a **Contact ATANY
  Support** action that opens the shared form with
  Category `Billing / Subscription`, Subject `Subscription Billing Support` and
  safe context (plan name, ATANY billing reference, payment status, provider
  `PayMongo`).

## G. Suspended Accounts

- **Customer and Shop Owner** both land on the same `AccountSuspended` page.
- **Contact ATANY Support** is now a **real persisted request**, not a
  mailto-only dead end: it opens the shared form posting to `/support/account`.
- **Prefill (safe only):**
  - Category: `Account Issue`
  - Subject: `Suspended Account Inquiry`
  - Message: *"Hello ATANY Support, I would like assistance regarding my
    suspended account. Role: Customer / Shop Owner. Suspension reason: …"*
- **Privacy:** only the suspension reason the owner can already see is
  included. No admin notes, no audit history, no admin identity — enforced by
  a test.
- **Route access (verified live):** with the seller suspended,
  `GET /shop-owner/sales/summary` → `403 ACCOUNT_SUSPENDED`, while
  `POST /support/account` → `201` with a reference. The account was restored
  afterwards.
- **No reactivation:** contacting support is informational; the account is not
  reactivated.

## H. Auction Winner Support

- The expired-winner "Contact ATANY Support" action previously linked to the
  buyer↔seller **message thread** (`/customer/messages`) — which is not a
  support channel. It now opens the **real support pipeline** at
  `/customer/account?support=expired-payment&…`.
- **Prefill:** Category `Auction / Payment Support`, Subject
  `Expired Auction Payment Inquiry`, plus the safe context: item name,
  transaction code, expired payment deadline and **the customer's own** former
  winning amount.
- **Privacy:** the next bidder's identity is **never** included (asserted by a
  test on the link and on the submitted metadata).

## I. Billing / Payment Support

- Safe context only: `plan_name`, `billing_reference`, `payment_status`,
  `provider` (`PayMongo`), `reference_id`.
- **Never included:** PayMongo secret keys, raw payment payloads, webhook
  signatures, card PAN/CVC.
- The metadata is passed through a **whitelist + credential-pattern filter**
  (`sanitizeMetadata`) on the server — unknown keys and anything matching
  `secret|api_key|password|cvc|cvv|pan|card_number|signature|authorization|bearer|token`
  are dropped.

## J. Attachments

| | |
|---|---|
| Types | `.jpg` `.jpeg` `.png` `.webp` (images only) |
| Size | 5 MB maximum (same rule ATANY already applies to listing photos) |
| Storage | The **private** Supabase bucket `atany-support` (already existed; verified `public: false`) |
| Stored value | The storage **path** — never a permanent public URL |
| Delivery | A **short-lived signed URL** is generated only when the notification needs to link the file (1 h) |
| Upload | `POST /support/attachment-url` returns a signed upload URL; the browser PUTs straight to Supabase so the service-role key never leaves the backend |
| Verified live | Upload → `200`; signed download URL carries a token and is **not** a public object URL; path traversal (`../../etc/passwd`) is rejected |

## K. Email Provider

- **Provider:** Resend (the provider already configured — no second mail system
  was introduced).
- **To:** `goldjewelryauction@gmail.com` (resolved from `ATANY_SUPPORT_EMAIL`).
- **From:** the provider-authorized ATANY sender (`RESEND_FROM_EMAIL`). The
  support inbox is **never** used as a From address — Resend would reject an
  unverified From domain.
- **Reply-To:** the validated requester's email, so staff can press Reply and
  answer the person directly. The requester is never spoofed as the From.
- `sendNotificationEmail()` now returns `{ sent, reason? }` so a caller can
  report honestly; `reply_to` is passed to the provider.
- Production env validation now **requires** `RESEND_API_KEY` and
  `RESEND_FROM_EMAIL` (a deployment without them cannot notify the inbox).

## L. Database

- **Reused** the existing `support_requests` table — **no second support
  table** was created.
- **Migration** `backend/src/db/migrations/035_support_requests_official.sql`
  adds only the genuinely missing columns (all `IF NOT EXISTS`, idempotent):
  `user_id`, `requester_role`, `category`, `source`, `attachment_path`
  (+ 2 indexes). `setup_complete.sql` was updated to match a fresh install.
- **Legacy data preserved:** historically `subject` stored the *category*; the
  migration backfills `category = subject` so nothing is lost, and `subject`
  keeps its value as the human-readable subject.
- **Status:** the existing convention is unchanged — `'new'` (default),
  `'in_progress'`, `'resolved'`.
- **Persistence behaviour:** the row is written **before** the notification
  attempt. A provider failure (missing key, rejected message, unreachable
  provider, thrown error) leaves the request **stored** and the API reports
  `email_notification.sent: false` with a reason. Verified by 2 tests and by
  the live QA below.

## M. Security

- **Identity:** always resolved from the authenticated session's database row.
  A client-supplied `user_id` / `email` / `name` / `requester_role` is ignored.
- **Route guards:** `/support` = `requireAuth` + `requireRole(['customer',
  'shop_owner'])` + rate limit; **no** other protected functionality is
  reachable from it. `/customer/support` keeps its existing customer guard.
- **Rate limiting:** public contact 5 / 10 min; authenticated support 10 /
  10 min; per-IP, one noisy IP cannot block another.
- **Secrets:** the address is public; `RESEND_API_KEY`, the service-role key
  and every other credential stay in `process.env` on the server. No API
  response contains a credential (asserted by a test that scans the serialized
  response).
- **Input:** name ≤150, email format, subject ≤200, message ≤5000, category
  whitelisted, attachment extension + size enforced server-side.
- **No account-existence leak:** the Login page's new support link opens the
  **public** contact form; auth errors are unchanged.
- **Log hygiene:** only ids and provider reasons are logged — never an
  attachment body, a password or a token.

## N. Files Changed

**Backend — new**
- `backend/src/config/support.js` — centralized support configuration
- `backend/src/controllers/support.controller.js` — `/support/account`,
  attachment upload URL, contact info, metadata sanitizer
- `backend/src/routes/support.routes.js` — the narrowly scoped support router
- `backend/src/db/migrations/035_support_requests_official.sql` — the missing
  `support_requests` columns (idempotent)
- `backend/src/tests/supportOfficial.test.js` *(new, 27 tests)*
- `backend/src/tests/supportRateLimit.test.js` *(new, 5 tests)*

**Backend — modified**
- `backend/src/services/supportService.js` — the shared implementation
- `backend/src/services/emailService.js` — `reply_to` + honest `{ sent }`
- `backend/src/services/storageService.js` — private support attachments
- `backend/src/controllers/customer/support.controller.js` — shared service +
  metadata + reference
- `backend/src/index.js` — public contact delegates to the shared service;
  `/support` mounted before the shop-owner guard
- `backend/src/config/validateEnv.js` — `RESEND_*` required in production
- `backend/.env.example`, `backend/src/db/setup_complete.sql`
- `backend/src/tests/{customerProfile,emailService,publicLanding,productionReadiness}.test.js`

**Frontend — new**
- `frontend/src/shared/config/support.js` — display constant + `supportMailto()`
- `frontend/src/shared/config/__tests__/supportAddress.test.js` *(6 tests)*
- `frontend/src/shared/components/SupportRequestForm.jsx` — the ONE support form
- `frontend/src/shared/components/__tests__/SupportRequestForm.test.jsx` *(8 tests)*
- `frontend/src/roles/shop-owner/pages/__tests__/ShopProfileSupport.test.jsx` *(3 tests)*

**Frontend — modified**
- `frontend/src/pages/AccountSuspended.jsx` — real support form + safe prefill
- `frontend/src/pages/LandingPage.jsx` — official address, reference, delay notice
- `frontend/src/pages/Login.jsx` — locked-out support link (public form)
- `frontend/src/roles/customer/pages/Profile.jsx` — Category + Subject, official
  address, reference, expired-winner prefill
- `frontend/src/roles/customer/pages/OrderDetails.jsx` — expired-winner action
  now opens the support pipeline
- `frontend/src/roles/shop-owner/pages/ShopProfile.jsx` — seller support panel
- `frontend/src/roles/shop-owner/pages/Billing.jsx` — subscription billing support
- `frontend/src/index.css` — `.profile-support__last` confirmation block
- `frontend/src/pages/__tests__/{AccountSuspended,LandingPage,LandingPageCtaFooter}.test.jsx`,
  `frontend/src/roles/customer/pages/__tests__/Profile.test.jsx`

## O. Tests

- **Backend: 49 files / 780 tests — ALL PASS** ✅
  (was 47 files / 744 tests; +2 files, +36 tests)
- **Frontend: 742 passed / 747** — the only 5 failures are **pre-existing and
  unrelated** (admin `subscriptionSelectors` ×2, admin `Billing`,
  `SellerBilling` selectors + page). Verified against the stashed tree: the
  same 5 fail without this task's changes.
- New coverage: 27 support-service/config/identity tests, 5 rate-limit tests,
  3 email-provider tests, 6 address-centralisation tests, 8 shared-form tests,
  3 seller-support tests, plus updated Landing/Profile/AccountSuspended/
  OrderDetails suites.

## P. Build

- `npx vite build` → **✓ built in ~4s**, 2554 modules, no errors ✅
- `node --check` passes on every changed backend file.

## Q. Real Email QA

**Attempted and honestly reported — the provider is not configured in this
development environment.**

- `backend/.env` has `RESEND_API_KEY=` **empty** and no `RESEND_FROM_EMAIL`.
- One labelled test was attempted:
  `[ATANY QA] Support Email Integration Test` → `goldjewelryauction@gmail.com`.
  Result: `{"sent":false,"reason":"provider_not_configured"}` — **no fake
  success was reported**.
- The server now logs the gap at startup:
  `RESEND_API_KEY not set (support requests are stored but the notification is
  not delivered)`.
- **Nothing was actually delivered** — inbox delivery could not be verified.
  To enable it, set `RESEND_API_KEY` (real key) and `RESEND_FROM_EMAIL` (a
  Resend-verified ATANY sender, e.g. `ATANY <support@your-domain>`). The
  inbox address itself must **not** be used as the From address.
- The QA record was deleted afterwards; the 5 pre-existing support rows were
  left untouched.

**Everything else was verified live** against a running server with real
sessions (seller + customer) and the real database:

| Flow | Result |
|---|---|
| A — public contact | `201`, reference `SUP-FA6042`, row stored |
| B — customer | `201`, reference `SUP-1081E3`, identity from the session |
| C — shop owner | `201`, reference `SUP-944F4E`, `source = Shop Owner Portal` |
| D — suspended seller | protected route → `403 ACCOUNT_SUSPENDED`; support route → `201` |
| E — expired winner | frontend link opens `/customer/account?support=expired-payment` with safe context |
| Spoof attempt | client-supplied `user_id`/`email`/`name` **ignored**; stored under the session identity |
| Attachment | signed upload `200`; signed download URL is tokenised, not public; traversal rejected |

## R. Remaining Limitations

1. **No email is actually delivered in this environment** — `RESEND_API_KEY`
   is empty. Support requests are stored and the API reports the delay
   honestly. Real delivery requires a Resend key plus a verified sender.
2. **`goldjewelryauction@gmail.com` is the recipient only.** Resend cannot
   send *from* an unverified Gmail address; the From must be a verified ATANY
   sender. The official inbox still receives the mail and staff can reply
   directly thanks to `Reply-To`.
3. **No admin support desk was built** (per instruction). The existing
   `support_requests` RLS read policy for admins is preserved, so admins can
   still read the table through the existing Supabase path — but there is no
   admin UI for it.
4. **Attachments are not attached to the email** — the message links a
   short-lived signed URL instead; the database row remains authoritative.
5. **The `support_requests` insert policy still allows anonymous inserts**
   (pre-existing RLS from migration 010). Abuse is blunted by the rate limit,
   but the row can be written without an account — the same as before this task.
6. **`RESEND_API_KEY` / `RESEND_FROM_EMAIL` are now production-required** — a
   deployment that omits them will fail fast at startup instead of silently
   not delivering support notifications.
7. **The frontend display constant is a static copy** of the official address
   (by design, per the brief). If a deployment overrides `ATANY_SUPPORT_EMAIL`,
   the UI would still show the official address — change the frontend constant
   at the same time.
8. **No SLA is promised** anywhere in the UI (the existing "Response Time"
   copy was left as-is).
