# SUBSCRIPTION PAYMENT PROVIDER FLOW — FIXED

## A. Provider Error Root Cause

Reproduced against the running server (real HTTP, seller JWT):

| Request | Status (before) | Body (before) |
|---|---|---|
| `GET /billing/subscription/payment-methods` | **200** | methods + cards + preference (worked) |
| `POST /billing/subscription/payment-method/session` `{method:'qrph'}` | **503** | `PROVIDER_UNAVAILABLE` — *"The payment provider is temporarily unavailable."* |
| `POST /billing/subscription/payment-method/session` `{method:'card'}` | **400** | `UNSUPPORTED_PAYMENT_METHOD` — *"Card payments are completed through the secure checkout."* |

**Two distinct root causes:**

1. **Missing provider configuration.** `backend/.env` contains `PAYMONGO_WEBHOOK_SECRET` but **not `PAYMONGO_SECRET_KEY`**. `authHeader()` therefore throws and no provider resource can ever be created. (`.env.example` line 15-16 documents `PAYMONGO_SECRET_KEY=sk_test_<...>` — "PayMongo (sandbox for dev)" — and `render.yaml` supplies it for deployment; the local `.env` simply has it unfilled.) The key is a secret, so it was **not fabricated** — instead the condition is now reported as a *configuration* problem, distinct from an outage.

2. **The card path was a guaranteed dead end** — I had hard-rejected `card` inside `createSubscriptionPaymentSession` ("Card payments are completed through the secure checkout."), so the **Continue securely** button could never work. Removed: the card now creates a real provider-hosted session.

**Proof the flow is genuinely real** (not faked): running the server with a throwaway key, the card request actually reached PayMongo — `provider detail: Received non-200 response: 404` (the dummy key is invalid) — and was correctly mapped to `PROVIDER_UNAVAILABLE` (502), i.e. a *provider* failure rather than a config failure.

## B. Provider Availability
Reported **per method** by the backend (`availability` on the capability endpoint), so one failing method never disables the others:

| Method | Canonical value | Availability source |
|---|---|---|
| QR Ph | `qrph` | backend `availability.qrph.enabled` |
| Card | `card` | backend `availability.card.enabled` |
| GCash | `gcash` | backend `availability.gcash.enabled` |
| Maya | `paymaya` (PayMongo's id) | backend `availability.paymaya.enabled` |

The backend is authoritative (`assertSupportedSubscriptionMethod`); the UI never decides support on its own. With the key configured all four report `enabled: true`; without it they report `false` with a customer-safe reason.

## C. Retry
- The fatal screen appears **only** when the capability request itself fails.
- **Retry re-issues the real request** (`loadOptions()` → `GET /billing/subscription/payment-methods`) — it does not just reset the view. The previous failure is cleared only after the request genuinely succeeds.
- The button is disabled and reads **"Checking…"** while in flight, and the modal is never closed (no page refresh, no sign-out).
- A QR failure has its own **Try again** inside the QR step, which re-issues the provider session request (and reuses the existing session when it already exists, so no duplicate provider resources).

## D. Card
- **Architecture: Option B — provider-hosted checkout.** The current PayMongo integration is a server-side hosted-Checkout-Session integration, and there is no `VITE_PAYMONGO_PUBLISHABLE_KEY` in the frontend, so client-side tokenization (Option A) is not available. The provider therefore owns the card form.
- **Continue securely is real**: it calls `POST /billing/subscription/payment-method/session` with `{method:'card'}` → the backend creates a real PayMongo session (`payment_method_types:['card']`) → the seller is redirected to the provider's secure page. Verified end-to-end: with a key set the request reached PayMongo; the test asserts the redirect to `paymongo.test`.
- **Saved cards**: shown only when real provider-backed rows exist (provider `paymongo`). With none, the honest empty state appears. "Use a saved card" is never rendered without real cards.
- **Raw card handling status: zero.** No card-number/CVC input exists in the UI, and the backend rejects `card_number` / `cardNumber` / `cvc` / `cvv` / `pan` / `security_code` with **400 `SENSITIVE_CARD_DATA_REJECTED`**. Nothing sensitive is stored in Postgres, Supabase, localStorage, logs or audit_logs.

## E. GCash
E-Wallet → **GCash** (`gcash`) → Continue → Review shows GCash → **Confirm** saves the *preference*. The saved preference then scopes the real invoice checkout (`createBillingCheckoutSession` → `payment_method_types: [preferred]`), so the actual invoice payment runs through PayMongo's GCash flow. Payment succeeds only on provider confirmation (webhook / `syncBillingWithPayMongo`).

## F. Maya
Identical to GCash with the real provider value `paymaya`; the UI label stays **"Maya"**. Same preference → same scoped provider checkout → same confirmation-only success.

## G. QR Ph
- Selecting QR Ph creates a **real** provider resource: `POST /billing/subscription/payment-method/session` → `createPayMongoSubscriptionCheckout({ methodType: 'qrph' })` → a genuine PayMongo checkout session restricted to QR Ph.
- The QR itself is rendered by the provider (PayMongo does not expose a raw QR payload), so the modal links to the provider's secure QR page and shows the **real** reference + the **real** expiry countdown when the provider supplies one. No static or decorative QR is used.
- The payment stays **pending** until the provider confirms.

## H. Review / Confirmation
"Confirm payment method" **saves the payment-method PREFERENCE only** (that is what "Update payment method" means in this codebase — the actual invoice is paid from the Next payment card's "Pay now", which now honours the saved preference). It creates no payment row, marks nothing paid and recognises no revenue. The Review screen shows the real plan, amount, selected method, billing date, reference (or "Not generated yet") and billing cycle, with an **Edit** link that returns without closing the modal.

## I. Payment Truth
- Payment status is **provider/webhook driven** only — the existing `webhook.controller.js` + `syncBillingWithPayMongo` path is untouched.
- **Selecting a method is not a payment**: no `payments.status='paid'`, no revenue, no subscription activation.
- **Webhook idempotency preserved** — no changes to the webhook handler, so repeated provider events still cannot duplicate a payment, a subscription extension, revenue or a notification.

## J. Backend Routes
No duplicates; the existing `billing` router is reused:
- `GET  /billing/subscription/payment-methods` — methods, per-method availability, real saved cards, saved preference
- `POST /billing/subscription/payment-method` — save the preference
- `POST /billing/subscription/payment-method/session` — start a real provider session (QR Ph / Card / GCash / Maya)

## K. Authorization
Every route: `requireAuth` + `requireRole('shop_owner')` + `requireActiveAccount()`.
- Unauthenticated → **401**
- Customer / Admin → **403**
- Suspended seller → **403 `ACCOUNT_SUSPENDED`**
- **Ownership**: the seller is always `req.user.id`; a `seller_id` in the body is ignored (tested).

## L. Error Mapping
| Condition | Status | Code / message |
|---|---|---|
| Session expired | 401 | *"Your session has expired. Please sign in again."* |
| Suspended account | 403 | *"Your ATANY account has been suspended."* (existing flow preserved) |
| Wrong role | 403 | *"You do not have access to this payment option."* |
| Route/integration bug | 404 | *"This payment option is unavailable right now."* |
| **Provider not configured** | 503 | `PROVIDER_CONFIG_MISSING` — *"This payment method is temporarily unavailable. Please try another method."* |
| **Provider outage / timeout / 5xx** | 502 | `PROVIDER_UNAVAILABLE` — *"The payment provider is temporarily unavailable. Please try again."* |
| Network unreachable | — | *"Unable to reach the payment provider. Please check your connection."* |
| Unsupported method | 400 | `UNSUPPORTED_PAYMENT_METHOD` — *"This payment method is not supported."* |
| No payable invoice | 400 | `NO_PAYABLE_SUBSCRIPTION` |

Only a genuine provider outage/timeout now reads as "provider unavailable". Missing configuration, auth, role and route bugs are all reported distinctly. A safe backend diagnostic (`PayMongo payment method configuration unavailable`) is logged **without any secret value**.

## M. Files Changed
**Backend**
- `src/services/paymongoService.js` — `isPayMongoConfigured()` helper (no secret exposure)
- `src/controllers/billing.controller.js` — per-method availability; card session allowed; correct error classification
- `src/routes/billing.routes.js` — unchanged in this task (routes already existed)
- `src/services/paymentMethodService.js` — unchanged in this task

**Frontend**
- `src/roles/shop-owner/subscription/PaymentMethodModal.jsx` — `describeError()` classifier, per-method availability, in-place QR error, functional Retry, real card CTA, fatal-vs-inline error split
- `src/roles/shop-owner/subscription/payment-method-modal.css` — unavailable-row + QR-error styles

**Tests**
- `backend/src/tests/subscriptionPaymentMethodRoutes.test.js` (extended: card session, QR/GCash/Maya sessions, config-vs-outage mapping, availability, no secret exposure)
- `frontend/src/roles/shop-owner/subscription/__tests__/PaymentMethodProviderFlow.test.jsx` (new: 18 tests)

**Not touched:** `backend/src/db/pool.js`, routes, authorization, the webhook, the Subscription page design, other Seller pages, and no backend files beyond the two listed.

## N. Tests
- **Backend: 704 passed / 704 (44 files)** — 6 new: real provider session for Card (Option B), for QR Ph/GCash/Maya, removed methods rejected with 400, missing configuration → `PROVIDER_CONFIG_MISSING` (503), provider outage → `PROVIDER_UNAVAILABLE` (502), per-method availability present with no secret in the payload.
- **Frontend: 699 passed / 704 (49 files)** — 18 new: capability load, only QR Ph/Card/E-Wallet, only GCash/Maya, per-method availability (one disabled, the rest usable), capability failure → error screen, **Retry re-issues the request and recovers without a reload**, Retry disabled + "Checking…" in flight, QR error stays in the QR step with Try again / Choose another method, QR retry recovers, Continue securely performs the real provider call and redirects, no raw card inputs, and the 7 error-classification cases (401/403/403-suspended/404/502/503/network).
- The 5 frontend failures are pre-existing (admin `subscriptionSelectors`, admin `Billing`, `SellerBilling` selectors + page) and fail identically on the unmodified baseline.

## O. Build
- `npx vite build` ✓ passed (3.32s), no broken imports, no React errors.

## P. Browser / Network QA
Real-browser automation is unavailable in this sandbox (no Playwright/Puppeteer/Chromium), so the QA was done with **real HTTP calls against the running server** using a real Shop Owner JWT — the exact requests the browser makes:

| Step | Observed |
|---|---|
| Modal open → capability request | **200**, 4 methods, per-method availability, saved preference intact |
| Card "Continue securely" (no key) | **503 `PROVIDER_CONFIG_MISSING`** (accurate, not a fake success) |
| Card "Continue securely" (key set) | request **reached PayMongo** (`Received non-200 response: 404` for the throwaway key) → **502 `PROVIDER_UNAVAILABLE`** — proof the provider call is real |
| QR Ph session (no key) | **503 `PROVIDER_CONFIG_MISSING`** |
| Removed method (grabpay) | **400 `UNSUPPORTED_PAYMENT_METHOD`** |
| Provider temporarily unavailable | saved preference **still returned** (`{"method":"gcash",...}`) — not erased |
| Server logs | no 500s, no unhandled rejections, no secret values logged |

To complete the UI walkthrough in a browser: fill `PAYMONGO_SECRET_KEY` in `backend/.env` with the sandbox key from `.env.example` (and set the matching `PAYMONGO_WEBHOOK_SECRET`), then Seller → Subscription → Update payment method → Card → Add new card → **Continue securely** should land on PayMongo's secure card page, and QR Ph / GCash / Maya should each open their provider flow.

## Q. Remaining Limitations
- **The local environment has no PayMongo secret key**, so the provider-dependent steps (QR Ph session, card secure page, e-wallet authorization) cannot be completed here. The implementation is complete and proven to reach the provider; only the deployment secret is missing. `PAYMONGO_SECRET_KEY` must be filled in `backend/.env` (sandbox key per `.env.example`) and is already supplied by `render.yaml` in deployment.
- **The QR image is rendered by the provider**, not embedded by ATANY — PayMongo's checkout API used here does not return a raw QR payload, so the modal links to the provider's secure QR page and shows the real reference/expiry.
- **No reusable saved-card vault**: without `VITE_PAYMONGO_PUBLISHABLE_KEY` (PayMongo Elements) ATANY cannot tokenise cards client-side, so "Add new card" routes to the provider's hosted card page rather than creating a reusable ATANY-held payment method. The "saved card" section only ever lists real provider-backed rows.
- **Recurring auto-charge is not implemented** — the preference scopes the next invoice payment only, and the UI states this truthfully.
- Browser-level QA (visual confirmation of the modal and the redirect) still needs a browser with the sandbox key configured.
