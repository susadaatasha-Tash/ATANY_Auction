# PAYMONGO HOSTED SUBSCRIPTION PAYMENT FLOW — COMPLETE

## A. Architecture

```
Seller → Subscription → Next Payment → Update payment method
        → modal selects the PREFERENCE (card | gcash | maya | qrph)
        → Confirm saves billing_records.payment_method_type
        → (NO provider call, NO payment, NO paid state)

When the invoice is due → "Pay now"
        → POST /billing/:id/checkout
        → createBillingCheckoutSession() reads billing.payment_method_type
        → toPayMongoMethodType() → provider method
        → PayMongo Hosted Checkout Session, payment_method_types = [providerMethod]
        → seller redirected to PayMongo (secure card / QR / e-wallet UI)
        → PayMongo webhook → markBillingPaid()  (authoritative)
        → polling fallback syncBillingWithPayMongo()
        → subscription/billing UI refreshes
```

ATANY builds **no** custom card vault, **no** custom QR generator, **no** second payment system. The modal only selects; PayMongo collects.

## B. Supported Methods
| UI label | Preference value (stored) | PayMongo method sent |
|---|---|---|
| Card | `card` | `card` |
| GCash | `gcash` | `gcash` |
| Maya | `maya` | `paymaya` |
| QR Ph | `qrph` | `qrph` |

The provider identifier `paymaya` never appears in customer-facing copy.

## C. Removed Methods
GrabPay, ShopeePay, UnionBank, BillEase, Buy Now Pay Later / BNPL are gone from the subscription flow: frontend option arrays, backend allowlist, PayMongo payloads, constants, tests, fixtures and mocks. Verified: no occurrence remains in the flow's code (only explanatory comments). Historical payment records are untouched.

## D. Payment Preference
- **Route**: `POST /billing/subscription/payment-method` (reuses the existing billing router — no duplicate endpoint). `GET /billing/subscription/payment-methods` returns the catalog + the saved preference.
- **Storage field**: `billing_records.payment_method_type` — the column already existed in the deployed DB but was in no migration and unused by any code. Migration `034_subscription_payment_method.sql` makes it reproducible (`ADD COLUMN IF NOT EXISTS` + a CHECK constraint allowing only `card|gcash|maya|qrph` + an index). **No new table was created.**
- **Validation**: `assertSupportedSubscriptionMethod()` → 400 `UNSUPPORTED_PAYMENT_METHOD` for anything else; `assertNoSensitiveCardFields()` → 400 `SENSITIVE_CARD_DATA_REJECTED` for card credentials.
- **Ownership**: the seller always comes from `req.user.id`; a `seller_id` in the body is ignored (tested). The target billing record is resolved server-side (the open invoice first, else the active cycle).

## E. Card
- **Preference**: `card` — selectable with no provider call, no saved-card vault, no card form.
- **Hosted checkout**: at Pay Now the session is created with `payment_method_types: ['card']`; the seller enters card details on PayMongo's page.
- **Security**: ATANY never receives a card number, CVC or CVV; nothing sensitive is stored in Postgres, Supabase, localStorage, logs or audit_logs. The modal renders **no** card inputs and no "saved cards" list.

## F. GCash
- **Preference**: `gcash`. At Pay Now → `payment_method_types: ['gcash']` → PayMongo's GCash authorization page → webhook confirms.

## G. Maya
- **Preference**: `maya` (customer-facing label "Maya").
- **Provider identifier**: `paymaya` — the value the current PayMongo Checkout API expects, resolved through `PAYMONGO_METHOD_MAP`.
- At Pay Now → `payment_method_types: ['paymaya']`.

## H. QR Ph
- **Preference**: `qrph`. ATANY generates **no** QR and creates **no** QR resource: at Pay Now the session is created with `payment_method_types: ['qrph']` and PayMongo renders/displays the QR during the secure checkout. The modal screen simply explains this.

## I. Checkout Session
- **Service**: `createBillingCheckoutSession()` in `backend/src/services/subscriptionService.js` (the existing real PayMongo call — `POST https://api.paymongo.com/v1/checkout_sessions`, `PAYMONGO_SECRET_KEY` server-side only).
- **Selected method behaviour**: `payment_method_types` is exactly `[providerMethod]` — one element, the seller's selection.
- **Amount**: always the server-side billing record / plan catalog (never a client amount).
- **URLs**: `success_url` / `cancel_url` from `FRONTEND_URL` — no hardcoded production localhost.
- **No preference**: a normal "Pay now" returns **409 `PAYMENT_METHOD_REQUIRED`** so the seller is asked to choose first; a fresh plan checkout (new subscription / plan change / admin retry) may still offer the supported set via `allowUnselected`, so "Change plan" keeps working.

## J. Method Change
- Changing the preference clears `paymongo_checkout_session_id` **only on an unpaid record** (the `CASE WHEN $2 THEN NULL ELSE … END` in the UPDATE), so an old GCash session can never be reused for Card.
- Already-paid invoices keep their session (history) and their payment facts (`status`, `paid_at`, `amount`, `payment_reference`) — only the preference column changes.
- The next generated period inherits the preference (`getInheritedPaymentMethod()`), so a seller who switches to Card keeps Card next cycle.

## K. PayMongo Webhook
- **Unchanged**: `POST /webhooks/paymongo` — signature verification, billing lookup, `markBillingPaid()` / `markBillingFailed()`, idempotency. No second webhook was created. Repeated provider events still cannot duplicate a payment, a subscription extension, revenue or a notification.

## L. Polling Fallback
- **Unchanged**: `syncBillingWithPayMongo()` — used after the seller returns from PayMongo. The webhook remains authoritative; polling is the fallback.

## M. Security
- **Card data**: never received, never stored, never logged. The only card-related input the API accepts is a preference string.
- **Secrets**: `PAYMONGO_SECRET_KEY` is server-side only; the capability payload was asserted to contain no `sk_test`/`sk_live`/secret text.
- **Authorization**: `requireAuth` + `requireRole('shop_owner')` + `requireActiveAccount()` → unauthenticated 401, customer/admin 403, suspended seller 403 `ACCOUNT_SUSPENDED`.
- **Ownership**: `req.user.id` only; Seller A cannot change Seller B's preference.

## N. Database
- **Fields reused**: `billing_records.payment_method_type` (new migration `034`, idempotent), `billing_records.paymongo_checkout_session_id`, `status`, `amount`.
- **Migration**: `backend/src/db/migrations/034_subscription_payment_method.sql` — `ADD COLUMN IF NOT EXISTS`, a CHECK constraint (`card|gcash|maya|qrph`), and an index. **No new table, no sensitive columns.**
- `backend/src/db/pool.js` was **not** modified.

## O. Frontend Files Changed
- `src/roles/shop-owner/subscription/PaymentMethodModal.jsx` — rewritten: preference-only flow, no card vault / no QR session / no provider call, Card + QR Ph info screens, functional Retry, error classification
- `src/roles/shop-owner/subscription/subscriptionPaymentMethods.js` — canonical preference values (`maya` not `paymaya`)
- `src/roles/shop-owner/subscription/PaymentMethodMarks.jsx` — removed the now-unused saved-card/add-card marks
- `src/roles/shop-owner/subscription/NextPaymentCard.jsx` — shows the preference, "Select payment method" when none is chosen, "Pay now" only with a method
- `src/roles/shop-owner/subscription/sellerSubscriptionSelectors.js` — exposes `payment_method_type`
- `src/roles/shop-owner/pages/Billing.jsx` — reads the preference from the billing record
- `src/roles/shop-owner/subscription/payment-method-modal.css` — layout/overflow fixes retained
- `src/roles/shop-owner/subscription/__tests__/PaymentMethodModal.test.jsx` (rewritten), `__tests__/PaymentMethodProviderFlow.test.jsx` (rewritten), `__tests__/PaymentMethodModalLayout.test.jsx`, `__tests__/SellerBilling.test.jsx`

## P. Backend Files Changed
- `src/services/subscriptionPaymentMethods.js` — **new**: the canonical contract (preference values, `PAYMONGO_METHOD_MAP`, `toPayMongoMethodType()`, `assertSupportedSubscriptionMethod()`) in its own module to avoid a circular import
- `src/services/paymentMethodService.js` — preference now stored on `billing_records`; re-exports the canonical contract; safe-card metadata helpers retained
- `src/services/subscriptionService.js` — checkout restricted to the selected method; preference inheritance for new periods; `payment_method_type` in the summary
- `src/services/paymongoService.js` — `isPayMongoConfigured()`
- `src/controllers/billing.controller.js` — capability + preference endpoints; the provider-session endpoint was **removed** (the checkout only happens on Pay Now)
- `src/routes/billing.routes.js` — the session route removed; existing routes reused
- `src/db/migrations/034_subscription_payment_method.sql` — **new**
- `src/tests/subscriptionPaymentMethods.test.js` (rewritten), `src/tests/subscriptionPaymentMethodRoutes.test.js` (rewritten), `src/tests/subscriptionCheckoutMethod.test.js` (new), `src/tests/billingSubscription.test.js` (fixture updated)

## Q. Tests
- **Backend: 717 passed / 717 (45 files)** — all green. New/updated coverage: the allowlist (4 values, 10 rejected variants), the PayMongo map (maya→paymaya), raw-card rejection, preference storage on the billing record, body-supplied `seller_id` ignored, stale-session clearing only for unpaid records, paid invoices' payment facts untouched, the removed session endpoint is gone (404), and the **outgoing PayMongo payload per method** (`['card']`, `['gcash']`, `['paymaya']`, `['qrph']` — one element each, never `grab_pay`/`billease`), server-side amount, preserved success/cancel/reference URLs, 409 `PAYMENT_METHOD_REQUIRED` without a preference, and the plan-checkout fallback.
- **Frontend: 693 passed / 698 (49 files)** — 5 pre-existing failures (admin `subscriptionSelectors`, admin `Billing`, `SellerBilling` selectors + page) that fail identically on the unmodified baseline. New coverage: only QR Ph/Card/E-Wallet, only GCash/Maya, no removed providers, no card inputs, no saved cards, no QR generated, **no provider call on open/select/review/confirm**, the preference always selectable even when the provider is down, Review contents, Edit, Confirm saving the canonical value (`card`/`gcash`/`maya`/`qrph`) with no checkout and no paid state, capability failure + working Retry, and the 7 error-classification cases.

## R. Build
`npx vite build` ✓ passed (3.25s) — no broken imports, no missing icons, no React errors.

## S. PayMongo Test-Mode E2E
A probe issued **real** HTTPS requests to `api.paymongo.com/v1/checkout_sessions` for all four methods, capturing the outgoing body and the genuine provider response:

| Method | Outgoing `payment_method_types` | Amount | Provider response |
|---|---|---|---|
| Card | `["card"]` | 1200000 (₱12,000) | **HTTP 404** — invalid key |
| GCash | `["gcash"]` | 1200000 | **HTTP 404** — invalid key |
| Maya | `["paymaya"]` | 1200000 | **HTTP 404** — invalid key |
| QR Ph | `["qrph"]` | 1200000 | **HTTP 404** — invalid key |

Each request **reached PayMongo** and the payload contained **exactly** the selected method. The provider's real 404 is the response for the placeholder key (`PAYMONGO_SECRET_KEY` is absent from `backend/.env`; only `PAYMONGO_WEBHOOK_SECRET` is set). The error is surfaced as **502 `PROVIDER_UNAVAILABLE`** — never as a fake success.

Also verified live against the running server (real seller JWT): the capability endpoint returns exactly `['qrph','card','gcash','maya']`; saving `maya` succeeds and is read back; `grabpay` → **400 `UNSUPPORTED_PAYMENT_METHOD`**; "Pay now" on a paid cycle → **409 "Billing already paid"**.

## T. Provider Limitations
- **No valid PayMongo sandbox key is present locally.** `backend/.env` has `PAYMONGO_WEBHOOK_SECRET` but not `PAYMONGO_SECRET_KEY` (documented as `sk_test_<...>` in `.env.example`; supplied by `render.yaml` in deployment). Consequently the hosted-checkout **page could not be opened** and the payment could not be completed here — the provider's own response for the placeholder key is a 404. This is a **credential gap, not an implementation gap**: the request construction, the method restriction, the redirect contract and the error mapping are all implemented and verified.
- A method may still be refused by a specific PayMongo merchant account (e.g. an account without QR Ph or Maya enabled). That is a provider-side configuration; the API surfaces it as `PAYMENT_METHOD_UNAVAILABLE` / `PROVIDER_UNAVAILABLE` with a safe message and never marks a payment paid.
- The QR image is rendered by PayMongo during checkout — the ATANY API used here does not return a raw QR payload, so ATANY does not embed one.
- **Browser-level QA could not be run**: no Playwright/Puppeteer/Chromium in this sandbox. Verification was done with real HTTP calls against the running server (real seller JWT) and a real-network probe of PayMongo.
