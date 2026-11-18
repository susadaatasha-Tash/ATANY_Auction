# Customer cancellation availability and Pay Now modal

Implemented locally. Full frontend/backend suites and focused gates pass. Live
actions remain blocked when the backend cannot verify schema/payment eligibility.
No migration was applied, no Supabase project was queried, and no real payment or
refund was initiated. No commit, push or deployment was performed.

## Why Cancel Order was missing

The modal previously rendered Cancel Order only when `canCancelOrder()` returned
true. It did not display the backend's `cancellation_block_reason`. The existing
GET handler obtains `can_request_cancellation` through `cancellationSnapshot()`;
that snapshot fails closed if its database transaction/operation-table checks fail.
Consequently a pending order with no displayed payment could silently lose its
Cancel Order button when payment safety could not be verified.

The user has stated that migrations 037/038 are not approved for the only existing
Supabase project. Missing safety schema is a concrete supported reason for that
false capability. The actual live order, payload, ownership and historical checkout
rows were **not queried**, so this report does not claim a direct diagnosis of that
specific database row. “No payment recorded” is not proof that every historical
attempt/provider state is safe.

## Changes

- The backend's read-only availability response now supplies explicit payment and
  cancellation capabilities, shared block codes and useful explanations. It checks
  the cancellation columns/payment-safety table markers, all local paid/processing
  attempts, durable operations and unresolved gateway identities. Missing schema or
  failed verification disables both actions. This is advisory availability, not a
  substitute for a complete migration/permissions audit or provider verification.
- Customer actions require an explicit true server capability. Pending/unpaid
  details show a disabled Cancel Order with an explanation when verification fails;
  eligible orders show an enabled action. Paid/processing/terminal orders cannot
  use cancellation. Existing ownership and mutation safety checks remain authoritative.
- The confirmation displays “Cancel Order?”, the requested question, stored order
  number, product name, suggested/custom reason, Keep Order and Confirm Cancellation.
  Empty reasons disable submission. API errors retain the reason and refresh state.
- Successful cancellation reloads details and My Purchases from the server, displays
  reason/time/actor and removes payment/cancellation actions. Card-based confirmation
  now follows the **refreshed** order after a processing rejection, preventing a stale
  enabled confirmation button. Seller/Admin keep reading the same persisted data;
  existing tests cover their metadata consistency and read-only reconciliation.
- Pay Now on cards opens the existing payment URL as a confirmation modal above
  My Purchases. Eligible details also offer Pay Now. The payment dialog shows actual
  jewelry/image, order number, bid/total, deadline, payment status and pickup branch,
  with a gold Continue button and Not Now. Missing images use a labeled placeholder.
  No new fee or method selector was introduced.
- From details, payment uses the existing coordinated PurchaseDialog stack: details
  remains mounted/inert underneath. Escape/close/backdrop are blocked while creating
  checkout, and ref-based locking prevents duplicate submissions. Browser Back/Forward,
  deep links, background scroll locking and focus behavior are covered by tests.
- Purchase filters/sort/search remain mounted during modal navigation; per-user
  session storage restores those view preferences after a full provider return.
  Focus/pageshow/realtime refreshes revalidate backend state, including BFCache returns.
- The former payment/success page imports are compatibility exports of the new
  dialogs. Payment/success routes use PurchaseWorkspace. Layout routing now suppresses
  the duplicate Dashboard header for these purchase routes.

## Payment request and return behavior

| Purpose | Existing API |
| --- | --- |
| Details, payment confirmation and return verification | `GET /customer/orders/:id` |
| Purchase refresh | `GET /customer/orders` |
| Cancellation | `PATCH /customer/orders/:id/cancel` |
| Checkout creation/reuse | `POST /customer/orders/:id/payment` |

Opening/closing confirmation makes no payment request. Continue submits to the
authenticated existing endpoint with no browser amount or assumed payment method.
The existing transaction/operation service decides whether a checkout can be reused
or created and rechecks ownership, deadlines, assignment and provider state.

The client accepts only an HTTPS `checkout.paymongo.com` URL without embedded
credentials or a nonstandard port, and preserves its path/query/fragment. Missing
or untrusted URLs produce an error; there is no fallback navigation to success.
PayMongo documents that hostname for Checkout Session URLs.
[Checkout Session resource](https://docs.paymongo.com/reference/checkout-session-resource).

The old no-URL fallback to the success route was removed. A separate metadata fix
changes the absent-method default from `gcash` to NULL: choosing a method on the
hosted checkout must not invent a GCash selection in the local attempt. Existing
explicit hints and provider-supported methods remain unchanged.

On return, the modal reads/polls the backend; URL query parameters never establish
payment success. Pending, processing, failed, expired, paid and cancelled outcomes
are displayed separately. A cancelled order remains terminal even if historical
payment evidence exists. Successful payment does not fabricate pickup preparation.
Provider errors are displayed and followed by a revalidation; changed eligibility
disables another attempt. No iframe or automatic refund was added.

## Database restrictions and blockers

Migration files **037 and 038 are unchanged**, verified against their recorded
SHA-256 hashes. Neither file was executed in this phase, including on the local
test database. No existing Supabase project or production data was accessed.

The PostgreSQL tests reused the previously provisioned private cluster at
`/private/tmp/atany-safety-audit`, port 55438, database `atany_safety_test`, with fake
test keys and mocked provider calls. New `ATANY_SAFETY_USE_EXISTING_SCHEMA=1` mode
validates the fixture first and skips all migration/bootstrap/repair setup. The
test runner now pins this mode. Ordinary synthetic fixture truncation and temporary
test constraints still run only in that hard-coded disposable database.

Live cancellation/checkout cannot be enabled merely by showing the new UI. The
existing project still needs separately approved database readiness, migration,
role/permissions, backup/recovery and end-to-end verification. Missing safety schema
returns a safe unavailable explanation. The prior staging source manifest is a
historical snapshot; test/service changes in this phase need review before any
later staging approval. No staging migration rehearsal was performed here.

## Tests and results

| Final check | Result |
| --- | --- |
| Full frontend | **792 passed**, 60 files |
| Full backend | **843 passed, 16 pre-existing opt-in skipped**, 45 files |
| Focused customer/modal/invoice/layout/cross-role frontend | **98 passed**, 9 files |
| Focused backend controller/manual/provider/availability run | **77 passed**, 5 files |
| Expanded dedicated payment-safety gate | **277 passed**, 10 files |
| Included genuine PostgreSQL tests | **36 passed**, existing schema only |
| Frontend production build | **Passed** |
| Changed backend JS syntax and scoped whitespace checks | **Passed** |

New failing regressions were observed before fixes: missing action explanations/
payment route behavior; unverified capability handling; provider-return preference
loss; duplicate layout header; invented default method; and stale card cancellation
eligibility. New coverage checks the read-only capability SQL against real PostgreSQL,
no-payment eligibility, paid/processing/unknown rejection, cancellation reasons and
refresh, no payment on modal close, duplicate-click locking, hosted redirect validation,
API errors, terminal orders, route history, nested inert/focus behavior and verified
return status. Existing cancellation/checkout races, all-checkout expiration,
rollback, evidence, Seller/Customer consistency and Admin tests remain green.

The 16 legacy full-schema winner tests were not enabled: their separately authorized
fixture/schema prerequisites remain unmet, and migrations are explicitly prohibited
in this phase. No new test was disabled or skipped. Existing non-failing React act,
React Router future-flag and jsdom navigation warnings remain visible.

See [test-results.txt](verification/customer-payment-modal/test-results.txt).
Raw logs are preserved under `/private/tmp/atany-payment-modal/`.

## Browser verification and limits

Rendered the actual ATANY layout/workspace/components in isolated Chrome with mock
authentication/API/realtime I/O. Captured pending without payment, confirmation,
unavailable, cancelled, expired, invoice and mobile states. All seven captures kept
My Purchases mounted, recorded no JavaScript exception and had no horizontal dialog
overflow. Desktop payment width is 640px; mobile width is 374px in a 390px viewport.

Completed browser checks include provider error display, background scroll lock,
inert lower details under payment confirmation, empty reason disabling, Keep Order,
successful fixture cancellation and card-payment focus/scroll restoration. The
first nested-focus probe used programmatic clicks without focusing the trigger;
it was not valid evidence of real pointer-focus restoration. A further interaction
command was declined, so it was not repeated. Nested focus restoration is verified
by frontend tests; a corrected follow-up browser focus check remains unverified.
No authenticated live-stack E2E or real provider transaction occurred.

Evidence: [payment](verification/customer-payment-modal/payment.png),
[mobile](verification/customer-payment-modal/mobile.png),
[unavailable actions](verification/customer-payment-modal/unavailable.png),
[active details](verification/customer-payment-modal/active.png),
[cancelled](verification/customer-payment-modal/cancelled.png),
[metrics](verification/customer-payment-modal/metrics.json),
[completed browser checks](verification/customer-payment-modal/browser-checks.json).

## Files changed in this phase

- Backend: `src/services/orderPaymentSafety.js`; new
  `src/tests/orderActionSnapshot.test.js`; `src/tests/paymentSafetyDb.test.js`;
  `scripts/test-payment-safety.sh`.
- Frontend layout/routes: `src/layouts/CustomerLayout.jsx` and its sidebar test;
  `src/roles/customer/routes.jsx`; `pages/PurchaseWorkspace.jsx`.
- Customer pages: `pages/{OrderDetails,MyPurchases,CompletePayment,PaymentSuccess}.jsx`
  and `pages/__tests__/OrderModals.test.jsx`.
- Customer purchase UI: new `purchases/{PaymentDialog,PaymentReturnDialog}.jsx`;
  `purchases/{CancelOrderDialog,PurchaseCard}.jsx`; `purchases/useOrderData.js`;
  `purchases/order-dialog.css`; `lib/purchaseStatus.js`.
- Documentation: this report and `docs/verification/customer-payment-modal/`.

Customer paths above are relative to `frontend/src/roles/customer/`; existing dirty
workspace work was preserved. Temporary browser/server and PostgreSQL resources were
closed after verification. Work stops locally; production readiness is not claimed.
