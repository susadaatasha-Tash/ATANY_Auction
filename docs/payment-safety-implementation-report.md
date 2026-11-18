# ATANY payment safety and customer modals — local implementation report

Follow-up: the 42 broad-suite failures recorded below have since been resolved.
See [the test-failure resolution report](test-failure-resolution-report.md) for the
current results: backend 831 passed/16 pre-existing skipped, frontend 771 passed,
payment gate 265 passed and focused frontend 72 passed. Production blockers remain.

Implemented locally in the existing application. Focused safety tests, isolated
PostgreSQL concurrency tests, modal tests, visual rendering and the frontend build
pass. This is **not a production-readiness claim**. Production migrations, backup
and recovery verification, provider integration and authenticated end-to-end testing
remain outstanding. No commit, push or deployment was performed.

## Payment-safety changes

- Customer and Shop Owner cancellation share one service. It validates authenticated
  ownership, pending status, reason, and **all** paid/processing payment records.
- Dedicated PostgreSQL clients perform BEGIN/COMMIT/ROLLBACK and always release.
  Durable per-order operations serialize checkout creation and cancellation. Provider
  requests occur outside transactions; final writes re-lock and revalidate the order
  and operation. The REST database fallback cannot perform safety mutations.
- Cancellation checks every locally associated historical checkout, including failed
  attempts. Active checkouts use PayMongo's documented checkout expiration endpoint,
  followed by retrieval and verification. A failed payment attempt alone is not proof
  that its checkout is closed. Unknown, paid or processing state blocks cancellation.
- Checkout creation persists the attempt before its provider request, then stores the
  returned identifiers before returning the URL. Timeout/uncertain outcomes stay
  blocked and produce reconciliation evidence. Reuse validates provider amount,
  currency, reference, mode, current assignment and deadline. Existing auction and
  winner deadlines remain authoritative.
- Webhook signatures use the timestamp plus exact raw body, the test/live signature
  field, constant-time comparison and timestamp tolerance. Authenticated receipts are
  durable before acknowledgement; failures after receipt are recoverable.
- Event identity and actual provider collections have independent deduplication.
  Duplicate/out-of-order events, extra collections and late payments retain financial
  identifiers/evidence even when fulfillment cannot proceed. Cancelled orders are not
  reactivated. Test/live mismatch and amount/currency mismatch require review.
- Recovery processes retry durable events, check known sessions and expose abandoned
  or unknown operations. Verified closures are stored. Unknown creation without a
  provider session remains blocked until evidence can correlate it; Admin cannot
  silently clear the block.
- Manual collection also respects active/unknown operations and gateway attempts.
  No automatic refund path was introduced.
- Admin has a role-protected GET endpoint and read-only reconciliation screen with
  collection/session/intent/event/operation identifiers and cancellation context.

## Connected endpoints and data

| Use | Actual endpoint |
| --- | --- |
| Purchase list | `GET /customer/orders` |
| Details and invoice data | `GET /customer/orders/:id` |
| Customer cancellation | `PATCH /customer/orders/:id/cancel` |
| Checkout | `POST /customer/orders/:id/payment` |
| Shop Owner cancellation | `PATCH /shop-owner/orders/:id/cancel` |
| Seller refresh | Existing sales endpoints |
| Admin order/cancellation view | Existing transactions endpoint |
| Admin reconciliation | `GET /admin/payment-reconciliations` |

Order totals and identifiers come from orders/payments; jewelry comes from the
associated auction product; pickup instructions/directions use the selected branch.
Cancellation actor ID, timestamp and reason come from the stored order. The trusted
actor role persisted in the completed cancellation operation is preferred; historical
records use the stored user role, without guessing missing identities. Product
condition/certificate values are shown only when recorded.

## Modal implementation status

The actual customer routes now render Order Details and Invoice above a mounted
My Purchases workspace. Direct links, refresh, Back/Forward and close are supported.
Search/filter/sort context is retained during modal navigation; mutation refreshes
the list without replacing its height with a loading screen.

The active design uses the approved branded header, image/product and payment
summary, six-stage progress, two-column order/pickup cards, jewelry accordion and
Invoice/Directions/conditional Cancel footer. The cancelled design uses the compact
header, terminal status banner, two-by-two information cards, terminal cancellation
timeline, red cancellation panel and support action. Actual status overrides the
pending values shown in the reference mockup. Expired/completed/cancelled/paid or
processing orders do not gain a cancellation action from the design.

Cancellation reuses the existing authenticated endpoint and suggested/custom reason
flow. It prevents duplicate submission, preserves the reason on failure, refreshes
changed eligibility, keeps the details dialog mounted and restores focus. Dialogs
support Escape, safe backdrop dismissal, focus trapping/restoration, background
inertness, scroll locking and independent body scrolling. Mobile buttons remain
accessible above the chat widget.

The customer details hook reuses order/payment database subscriptions. Mutation
success invalidates customer data. Seller data refreshes on details opening/window
focus and mutation success. Admin reads the same stored metadata. No unsupported
socket event was invented; cross-role live delivery still depends on deployed
database realtime configuration and needs authenticated end-to-end verification.

There was no existing invoice generator: the original View Invoice action opened
Order Details. The new modal displays actual customer/order/jewelry/branch/payment
data, provides browser printing and downloads a self-contained escaped **HTML**
invoice. Its identifier is labeled Order Number. It does not fabricate an invoice
number, tax, fee or paid state. PDF generation and a separate approved invoice-only
reference were not available; exact invoice-reference matching is therefore unverified.

## Tests and results

| Check | Result |
| --- | --- |
| Final focused backend payment gate | **265 passed**, 9 files |
| Included real PostgreSQL tests | **34 passed** |
| Final focused frontend | **72 passed**, 8 files |
| Frontend production build | **Passed** |
| Backend JavaScript syntax | **Passed** |
| Broader backend regression run | 795 passed, **2 failed**, 48 skipped; 44 files |
| Broader frontend regression run | 731 passed, **40 failed**; 60 files |

The focused backend command is `bash scripts/test-payment-safety.sh` from backend.
It pins fake test-mode credentials and the disposable socket-only cluster on port
55438. It cannot use the application's DATABASE_URL or a TCP production database.
Its fixture applies **038 only**, after constructing a minimal isolated schema;
it never executes 037. Provider requests are mocked, not sent to PayMongo.
The disposable PostgreSQL server was stopped after verification. Rerunning this
script requires starting that same isolated cluster, or explicitly adapting the
fixture's hard-coded safety allowlist for another disposable cluster. It is not a
general production-database test runner.

Coverage includes actual concurrent checkout/cancellation and Customer/Seller
cancellation, transaction rollback on failed audit, processing/unknown/paid provider
state, all old sessions, expiration failure/retry, unknown creation, operation fencing,
deadline/assignment changes, webhook durability/signatures/mode, duplicate and early
events, late and additional collections, recovery fairness, manual-payment guards
and Admin evidence projection. Focused frontend coverage includes routes, modal
context/focus, terminal status, nested confirmation, reasons/errors/revalidation,
real API calls, invoice print/download and read-only Admin visibility.

The broad backend run preceded the final operation-fencing changes; the final
265-test focused run covers those changes. The two remaining backend failures use
fixed subscription proration periods that ended before the current date. The 40
frontend failures match the pre-modal baseline: missing ToastProvider in sidebar
fixtures, unavailable localStorage in seller wizard fixtures, and fixed-date
subscription expectations. They were not suppressed or changed to pass. The legacy
winner-expiration database suite is deliberately skipped without an explicit isolated
database opt-in. Detailed failing test names are in [test-failures.txt](verification/test-failures.txt).
Some passing frontend tests still emit React act/jsdom navigation warnings.

## Rendered comparison

Actual ATANY layout/workspace/modal components were bundled with isolated fixture
authentication/API/realtime I/O and rendered in local headless Chrome. This is a
verification fixture, not a replacement application or production data source.
No live backend or production account was used.

- Desktop viewport: **1585 × 992**, matching the target screenshots.
- Active dialog: **880 px** wide, branded layout and action footer.
- Cancelled dialog: **800 px** wide, compact cards/cancellation/help arrangement.
- Mobile viewport: **390 × 844**, dialog **374 × 828**, stacked content.
- All five captured states: purchases still mounted, no horizontal dialog overflow,
  no recorded JavaScript exception. See [metrics.json](verification/metrics.json).
- Iterative rendering corrected global section padding interference, compact card
  spacing and mobile action/chat stacking. Pixel-perfect equivalence is not claimed.

Captures: [active](verification/active.png), [cancelled](verification/cancelled.png),
[expired](verification/expired.png), [invoice](verification/invoice.png),
[mobile](verification/mobile.png).

## Remaining migrations and production blockers

1. **037 remains unapplied and was never executed during this work.** The existing
   local `037_order_cancellation.sql` is a separate prerequisite. It was preserved.
2. New **038_payment_safety.sql** is prepared locally and tested only on the disposable
   fixture database. No new migration was applied to production. Existing deployments
   without these tables/columns must not enable these safety mutations; they fail
   closed with a database-upgrade/unavailability error.
3. A future authorized rollout must review the actual schema, constraints/indexes,
   migration ordering and backend database-role/RLS privileges in staging. Direct
   PostgreSQL access is mandatory. A tested fixture is not a production migration
   rehearsal; schema drift and legacy payment identifiers need an explicit audit.
4. Backup, restore rehearsal, recovery objectives, rollback/forward recovery and
   deployment sequencing have **not** been verified. Prepare and approve them before
   production migration; do not use the broad migration command to bypass the 037
   restriction.
5. Verify configured webhook secret/test-live mode, durable receipt/retry after a
   restart, worker scheduling/exclusivity, monitoring and reconciliation ownership.
   Rehearse provider expiration and delayed/processing behavior using test mode only.
6. Run authenticated Customer/Seller/Admin end-to-end tests on the migrated staging
   stack, including realtime delivery, checkout cancellation races, branch directions,
   print/download, refresh and browser navigation. No such live-stack E2E run occurred.
7. Reconciliation is intentionally read-only. Unknown historical checkouts and
   externally collected money require provider/support review under an approved
   operational process. A local lock cannot guarantee a saved external payment
   instrument will never debit; any late collection must retain evidence and receive
   manual reconciliation. No automatic refund was added or tested.
8. Resolve or separately accept the 42 remaining broad-suite failures listed above.

## Files changed for this phase

The workspace already contained cancellation, Admin order, sidebar and unrelated
seller UI changes. Those were preserved; this list identifies this phase's additions
and integrations rather than claiming the entire dirty tree.

- New backend: `src/db/migrations/038_payment_safety.sql`;
  `src/services/{paymentTransaction,orderPaymentSafety,paymentEvidence,cancellationRead}.js`;
  `src/tests/{paymentSafetyDb,paymongoSafety}.test.js`;
  `scripts/test-payment-safety.sh`.
- Backend integrations: `src/services/{paymongoService,manualPayment}.js`;
  `src/controllers/customer/{order,payment}.controller.js`;
  `src/controllers/shop-owner/sales.controller.js`;
  `src/controllers/admin/transaction.controller.js`; `src/controllers/webhook.controller.js`;
  `src/routes/admin.routes.js`; `src/index.js`.
- Backend tests updated: `src/tests/customer/order.controller.test.js`;
  `src/tests/{sellerOrders,manualPayment,paymentNotifications,priority1Security,
  billingSubscription,productionReadiness,winnerExpirationDb}.test.js`.
- New customer UI: `pages/PurchaseWorkspace.jsx`;
  `purchases/{PurchaseDialog,CancelOrderDialog,OrderDetailsContent,InvoiceDialog}.jsx`;
  `purchases/{useOrderData,orderPresentation,invoice}.js`; `purchases/order-dialog.css`.
- Customer integrations: `routes.jsx`; `pages/{MyPurchases,OrderDetails,CompletePayment,
  PaymentSuccess}.jsx`; `purchases/PurchaseCard.jsx`; `lib/purchaseStatus.js`;
  `frontend/src/layouts/CustomerLayout.jsx`.
- New Admin UI: `pages/PaymentReconciliations.jsx` and its tests; integrated into
  Admin routes and the existing `pages/Orders.jsx`. Existing Admin cancellation
  actor projection and Seller `pages/WonLotsOrders.jsx` were connected to real metadata.
- Frontend tests: `pages/__tests__/{OrderModals,MyPurchases}.test.jsx`;
  `purchases/__tests__/{invoice,orderPresentation}.test.js`;
  `lib/__tests__/purchaseStatus.test.js`; Admin `pages/__tests__/Orders.test.jsx`;
  Seller `pages/__tests__/WonLotsOrders.test.jsx`.
- Documentation: this report, the implementation ledger and `docs/verification/`.

Paths in the last four customer groups are relative to
`frontend/src/roles/customer/`; Admin/Seller paths use their respective role roots.
