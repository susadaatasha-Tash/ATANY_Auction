# SHOP OWNER PAYMENT METHOD FLOW — COMPLETE

## A. Visual Match

**Initial modal** — `frontend/src/roles/shop-owner/subscription/PaymentMethodModal.jsx` + `payment-method-modal.css`
- Header: "Update payment method" + subtitle "Choose how you want to pay for your subscription." + close X
- Desktop: **two columns** — LEFT = plan summary (gold crown mark, plan name, interval, status chip, description, Subscription fee / Taxes & fees, Total Due, then the light info box with Billing date / Reference number / Billing cycle), RIGHT = "Payment method" + "Select a payment method to continue." + the radio rows + full-width navy Continue + the lock-icon security footer
- Every value comes from the real subscription state (plan, amount, billing date, reference, cycle) — nothing hardcoded; a missing reference renders "Not generated yet"

**Card** — "← Card" header + "Use a debit or credit card to pay for your subscription." + card-network marks, "Use a saved card" radio group with the real saved cards, "Add new card" row with a + glyph, Continue

**Add Card** — "← Add new card" header, the secure-provider screen (lock glyph, "Add a card securely", "Your card information will be entered through the secure payment provider. ATANY never stores your complete card number or security code."), "Continue securely" CTA

**E-Wallet** — "← E-Wallet" header + "Select your e-wallet provider." + provider rows with brand marks and chevrons

**QR Ph** — "← Scan QR Ph" header + "Scan the QR code using your banking or e-wallet app." + the QR Ph brand mark, the provider frame, the numbered 1–4 instructions, the expiry countdown and the reference

**Review** — "Review and continue" + "Make sure your payment method is correct." + plan card, amount, "Payment method" with an **Edit** link, the selected-method card, the info box, "Confirm payment method"

Responsive: single column under 860px, tightened padding under 560px, no horizontal overflow.

## B. Supported Methods
| Label | Provider value | Group |
|---|---|---|
| QR Ph | `qrph` | top-level |
| Card | `card` | top-level |
| E-Wallet | `ewallet` (UI sentinel) | top-level |
| GCash | `gcash` | e-wallet |
| Maya | `paymaya` (PayMongo's id) | e-wallet |

Single source of truth: `frontend/src/roles/shop-owner/subscription/subscriptionPaymentMethods.js` (frontend) and `backend/src/services/paymentMethodService.js` (backend) — the same canonical values.

## C. Removed Methods
**GrabPay, ShopeePay, UnionBank, BillEase, Buy Now Pay Later** are gone from the entire flow:
- Frontend option arrays: only QR Ph / Card / E-W-Wallet → GCash / Maya are defined
- Provider payload: `paymongoService.js` and `subscriptionService.js` `payment_method_types` are now `['gcash', 'card', 'paymaya', 'qrph']`
- Backend allowlist: `assertSupportedSubscriptionMethod()` rejects anything else with **400 `UNSUPPORTED_PAYMENT_METHOD`**
- Deliberately **kept** (per "do not delete historical payments"): `purchaseStatus.js` `formatPaymentMethod` still *labels* old `grab_pay` / `billease` records, and the customer counter endpoint keeps them in its denylist (that list blocks online methods from the counter route — removing entries would weaken it).

## D. Card Security
- **No raw card form exists.** The "Add new card" step is a secure-provider screen — ATANY never receives a card number or CVC.
- `assertNoSensitiveCardFields()` rejects any payload containing `card_number` / `cvc` / `cvv` / `pan` / `security_code` with **400 `SENSITIVE_CARD_DATA_REJECTED`**.
- `sanitizeMethodRow()` whitelists safe fields only — a stored row can never leak extra columns.
- **Saved cards are real or accurately absent**: the modal lists only provider-backed rows from `seller_payment_methods` (provider `paymongo`). With none, it shows the honest empty state ("No saved cards yet. Your card details are handled securely through the payment provider and are never stored directly by ATANY.") — no fake `•••• 4242` / `•••• 8888`.
- A card preference requires a real provider payment-method id.

## E. QR Ph
- **Backend flow**: `POST /billing/subscription/payment-method/session` → `createPayMongoSubscriptionCheckout()` creates a REAL PayMongo Checkout Session with `payment_method_types: ['qrph']`. The frontend only ever receives `checkout_url`, `reference`, `expires_at`, `amount` — never the secret key.
- **QR expiry**: the countdown renders only when the provider actually returns an expiry (`expires_at`); otherwise no countdown is fabricated.
- **Confirmation**: the modal never marks anything paid. Payment confirmation comes from the existing PayMongo webhook / `syncBillingWithPayMongo` polling path.

## F. GCash
- E-Wallet → GCash (`gcash`) → Continue → Review → "Confirm payment method" saves the **preference**.
- The saved preference then **scopes the real provider checkout**: `createBillingCheckoutSession()` reads the seller's preference and sets `payment_method_types: [preferred]`, so the actual invoice payment runs through the provider's GCash flow. Payment succeeds only on provider confirmation.

## G. Maya
- Identical to GCash with the real provider value `paymaya` (the UI label stays "Maya"). Same preference → same scoped provider checkout → same confirmation-only success.

## H. Review & Confirmation
- "Confirm payment method" persists a **preference** only (method type + provider reference + safe display metadata). It creates no payment row, marks nothing paid and recognises no revenue.
- "Edit" returns to the method selection without closing the modal and without creating a duplicate provider resource (the QR session is created once per modal open and reused).
- Closing before confirmation mutates nothing.

## I. Subscription Integration
- **Preference storage**: reuses the existing `seller_payment_methods` table with `provider = 'subscription_preference'` — **no migration needed**. Only one preference per seller (the previous one is replaced).
- **Next payment card** now shows the saved method ("Payment method **GCash** — you'll complete your next subscription payment using this method.") — truthful wording, no auto-charge claim, since ATANY does not auto-charge.
- **Change plan** and **Manage billing** are untouched and keep working on the existing plan-change logic.
- The preference is applied to the real checkout (`payment_method_types: methodTypes`).

## J. Backend
- **Routes** (`backend/src/routes/billing.routes.js`, reusing the existing router):
  - `GET  /billing/subscription/payment-methods` → methods + saved cards + preference
  - `POST /billing/subscription/payment-method` → save the preference
  - `POST /billing/subscription/payment-method/session` → start a real provider session (QR Ph / GCash / Maya)
- **Controller** (`backend/src/controllers/billing.controller.js`): `listSubscriptionPaymentMethods`, `saveSubscriptionPaymentMethod`, `createSubscriptionPaymentSession` — with a consistent error envelope (flat `code`/`message` **and** nested `error`).
- **Service** (`backend/src/services/paymentMethodService.js`): `SUBSCRIPTION_PAYMENT_METHOD`, `SUPPORTED_SUBSCRIPTION_METHODS`, `assertSupportedSubscriptionMethod()`, `saveSubscriptionPaymentPreference()`, `listSubscriptionPaymentPreference()`, `listSavedCardMethodsForSeller()`.
- **Provider** (`backend/src/services/paymongoService.js`): `createPayMongoSubscriptionCheckout()` — method-scoped hosted session returning only safe values.
- **Authorization**: every new route is `requireAuth` + `requireRole('shop_owner')` + `requireActiveAccount()` → unauthenticated **401**, customer/admin **403**, suspended seller **403 `ACCOUNT_SUSPENDED`**.
- **Ownership**: the seller is always `req.user.id`; a `seller_id` in the body is ignored (tested).

## K. Database
- **No migration.** The existing `seller_payment_methods` table (migration 026) is reused with `provider = 'subscription_preference'` for the preference row and `provider = 'paymongo'` for real saved cards.
- Fields reused: `seller_id`, `provider`, `provider_payment_method_id`, `type`, `brand`, `last4`, `exp_month`, `exp_year`, `is_default`.
- Nothing sensitive is stored — no PAN, no CVC, no raw QR secrets.

## L. Security
- Raw card data is rejected at the API boundary (400) and never rendered or sent.
- The PayMongo secret key stays server-side; the frontend only gets `checkout_url` / `reference` / `expires_at`.
- No developer text in the UI — the old `VITE_PAYMONGO_PUBLISHABLE_KEY` notice is gone.
- Saved-card rows expose only provider id, brand, last4, expiry and the default flag.
- Errors are customer-facing only; provider stack traces are logged server-side, never rendered.

## M. Tests
- **Backend: 698 passed / 698 (44 files)** — 23 new tests:
  - `subscriptionPaymentMethods.test.js` (13): allowlist contents, acceptance of the 4 supported values, rejection of all 9 removed variants with 400 `UNSUPPORTED_PAYMENT_METHOD`, raw-card rejection, safe-metadata sanitisation, preference persistence/replacement, card-requires-provider-id, saved-card listing excludes the preference row, provider `payment_method_types` = `['gcash','card','paymaya','qrph']`, preference-scoped checkout.
  - `subscriptionPaymentMethodRoutes.test.js` (10): 401 unauthenticated, 403 customer, 403 admin, 403 `ACCOUNT_SUSPENDED` for a suspended seller, seller allowed, catalog contains exactly the 4 supported values, accepted method saved, removed methods rejected with 400, raw card data rejected, body `seller_id` ignored.
- **Frontend: 666 passed / 671 (47 files)** — 16 new tests in `PaymentMethodModal.test.jsx` (exactly 3 top-level options and no fourth, no removed method rendered, Continue disabled until selection, real plan summary, "Not generated yet" fallback, e-wallet shows only GCash + Maya, real saved card listed, honest empty state with no fake cards, no raw card inputs, real provider session + expiry countdown, session reused on back-navigation, review shows plan/amount/method/billing data, Edit returns without closing, confirm saves the preference and creates no checkout, card confirm sends only the provider reference).
- **5 failures are pre-existing** (admin `subscriptionSelectors`, admin `Billing`, `SellerBilling` selectors/page) and fail identically on the unmodified baseline.

## N. Build
- `npx vite build` ✓ passed (3.38s) — no broken imports, no missing icons, no React errors.

## O. Browser QA
**Not executable via automation** — no Playwright, Puppeteer, WebDriver or Chromium is installed in this sandbox, so the real-browser walkthrough could not be run. Verified instead by 39 automated tests covering the whole flow (including the exact DOM the browser renders) plus a clean production build.

Manual QA to run when a browser is available: Seller → Subscription → "Update payment method" → confirm only QR Ph / Card / E-Wallet appear (no GrabPay/ShopeePay/UnionBank/BillEase/BNPL) → E-Wallet shows only GCash + Maya → Card shows the real saved card or the accurate empty state (no fake cards) → QR Ph opens the real provider page → Review shows the plan/amount/method/billing date → Confirm saves the preference and the Next payment card refreshes with "Payment method GCash".

## P. Remaining Limitations
- **QR Ph rendering**: PayMongo's hosted checkout owns the QR image; ATANY links to the provider's secure QR page (and shows the real reference + expiry) instead of embedding a provider QR payload, because the PayMongo API used by ATANY does not return a raw QR image/payload. No static or decorative QR is used.
- **Card tokenization**: PayMongo Elements (client-side tokenization) is not configured in this build, so "Add new card" routes the seller to the provider's secure hosted checkout (the reference's plain card form is intentionally not implemented, since it would send card credentials to ATANY). The "USE A SAVED CARD" section only appears when real provider-backed cards exist.
- **Recurring auto-charge** is not implemented; the preference only scopes the next invoice payment, and the UI states this truthfully.
- **PayMongo credentials**: the provider session requires `PAYMONGO_SECRET_KEY`; without it the endpoint returns 503 `PROVIDER_UNAVAILABLE` ("The payment provider is temporarily unavailable.").
