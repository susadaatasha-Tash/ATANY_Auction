# Customer Order Details — unavailable action behavior

Implemented locally. Pay Now and Cancel Order now respond with either the existing
eligible confirmation flow or an action-specific availability dialog. Transaction
eligibility, provider verification and database readiness checks are unchanged.
Real actions remain unavailable when the backend cannot verify safety.

## Exact disabled condition and root cause

The reported message is:

> Order changes are temporarily unavailable. Please try again later or contact support.

In the current backend this exact message is emitted by `cancellationSnapshot()`
when `safety_schema_ready !== true`. That branch returns:

```json
{
  "can_request_payment": false,
  "can_request_cancellation": false,
  "action_block_code": "PAYMENT_SCHEMA_REQUIRED"
}
```

It also supplies the reported text as both block reasons. Previously Order Details
bound `disabled={!payable}` and `disabled={!eligible}` directly to those capabilities.
Both helpers require an explicit true capability. This explains both disabled buttons;
“No payment recorded” does not override readiness or establish safe provider state.

The readiness query checks:

- All three 037 cancellation columns on public.orders: cancellation_reason,
  cancelled_at and cancelled_by.
- 038's payments.provider_checked_at and payment_webhook_events.next_attempt_at.
- Presence of payment_operations, provider_collections and payment_reconciliations.

The user confirms 037/038 remain unapplied. Those missing effects block this shared
availability gate. The actual Supabase project, specific row and production browser
network/console were **not accessed**; the diagnosis matches the exact supplied
message to its code branch and the supplied migration status. It does not pretend
to have measured every missing catalog object on that project.

| Possible cause | Finding |
| --- | --- |
| Missing migrations/readiness | The exact reported message maps to the false schema-readiness branch and both false capabilities. |
| Missing API capability fields | Also fail closed, but are not the source of that exact backend message; covered by tests. |
| Incorrect frontend safety condition | The false-capability guard is intentional. The UX problem was that the only response was a disabled control and generic notice. |
| Missing PayMongo configuration | Not evaluated by this readiness branch; it cannot cause this exact message here. Actual configured values were not read. Configuration remains a separate prerequisite. |
| Paid/processing/unknown checkout | Separate existing checks remain authoritative. The schema branch returns before those payment checks, so fixing schema does not prove an order is otherwise eligible. |
| Runtime/network errors | The catch path has a different unavailable message. Production errors were not inspected; isolated browser errors and GET-only refresh behavior were checked. |

## Code changes

1. `frontend/src/roles/customer/pages/OrderDetails.jsx`: route unavailable clicks
   to information instead of attaching a transaction handler. Available payment
   still navigates to the existing payment confirmation route; available cancellation
   still opens the existing reason confirmation. Separate inline payment/cancellation
   notices describe each action. Neutral information styling, info icons, tooltips
   and accessible descriptions distinguish unavailable actions from ready actions.
2. New `frontend/src/roles/customer/purchases/OrderActionUnavailableDialog.jsx`:
   displays Payment Unavailable or Cancellation Unavailable, actual order/product,
   safe backend reason, Check Again, Back to Order Details and the existing support
   route. This component has **no checkout/cancellation API dependency**. Check Again
   only refreshes GET data; a changed capability never starts a transaction itself.
   Refresh failures remain blocked with an error. Escape/close, focus restoration,
   lower-dialog inertness and scroll locking reuse PurchaseDialog.
3. `frontend/src/roles/customer/purchases/order-dialog.css`: small availability
   dialog/notice styles within the current ATANY design.
4. `frontend/src/roles/customer/pages/__tests__/OrderModals.test.jsx`: unavailable
   clicks, action-specific reasons, no POST/PATCH, failed/read-only refresh, changed
   eligibility, missing fields and focus behavior. Existing eligible flows remain tested.

Backend code, migrations, deadlines, transaction coordination, provider behavior,
fees, payment methods, ownership checks and cancellation rules were not changed in
this phase. Existing unrelated dirty workspace changes were preserved.

## What works locally

- Eligible Pay Now opens Complete Your Payment with actual order fields. Only its
  Continue button calls `POST /customer/orders/:id/payment`; duplicate locking,
  backend-controlled session reuse/creation and validated hosted redirect remain.
- Eligible Cancel Order opens the existing order/product/reason confirmation. Only
  confirmation calls `PATCH /customer/orders/:id/cancel`. Paid, processing, unknown
  or ineligible attempts remain subject to the existing backend rejection/expiry
  verification and atomic order/audit behavior.
- Unavailable Pay Now opens Payment Unavailable; unavailable Cancel Order opens
  Cancellation Unavailable. Neither information dialog offers Continue/Confirm or
  attempts a mutation. Check Again uses `GET /customer/orders/:id`; successful
  revalidation also refreshes `GET /customer/orders`.
- A capability that becomes true requires the customer to close information and
  choose the action again. No automatic checkout, cancellation or payment-success
  message occurs. Missing fields and network failures do not authorize an action.
- Payment returns still read verified backend state, ignoring URL parameters as
  proof. Cancellation still refreshes details/purchases and reads consistent stored
  metadata across roles. These existing behaviors were preserved and regression tested.

## Tests and browser evidence

| Verification | Result |
| --- | --- |
| New/updated modal tests before implementation | 6 failed, 30 passed — expected missing behavior reproduced |
| Focused modal tests after implementation | **36 passed** |
| Full frontend | **795 passed**, 60 files |
| Full backend | **858 passed, 16 pre-existing opt-in skipped**, 46 files |
| Included genuine isolated PostgreSQL payment tests | **36 passed**, existing schema only |
| Frontend production build | **Passed** |
| Automated Chrome desktop/mobile interaction checks | **16 passed**, no recorded JavaScript exceptions |
| Scoped whitespace checks | **Passed** |

The full backend run used the existing private fixture on port 55438 and
`ATANY_SAFETY_USE_EXISTING_SCHEMA=1`; no migration/bootstrap file ran. Application
database URLs and Supabase keys were fixtures/unreachable localhost values, and
provider calls were mocked. The existing 16 full-schema opt-in tests remain
unverified because their separately approved schema fixture is still unavailable.
No test was newly skipped or disabled. Existing non-failing test warnings remain.

Chrome used the actual layout/workspace/components with isolated fixture I/O,
blocked external HTTPS and no production/provider connection. Desktop 1585×992 and
mobile 390×844 checks verified information dialogs, inert lower details, Escape and
close focus restoration, no horizontal overflow, and GET-only Check Again. The API
trace contains no POST or PATCH. The browser/server closed automatically afterward;
the disposable PostgreSQL server was stopped after tests.

This is isolated verification, not authenticated production E2E. No live checkout
session was created and no real payment/refund was attempted.

Evidence: [test results](verification/order-action-availability/test-results.txt),
[browser checks and API trace](verification/order-action-availability/interaction-checks.json),
[desktop payment](verification/order-action-availability/desktop-payment-unavailable.png),
[desktop cancellation](verification/order-action-availability/desktop-cancellation-unavailable.png),
[mobile payment](verification/order-action-availability/mobile-payment-unavailable.png),
[mobile cancellation](verification/order-action-availability/mobile-cancellation-unavailable.png),
[details notices](verification/order-action-availability/unavailable.png).

## What remains blocked and how to enable safely

The current project still cannot perform these real actions merely because its
buttons now respond. Migrations 037/038 remain unchanged and unapplied; hashes were
checked against the earlier source manifest. Payment configuration and actual legacy
records were not certified. There is no production-readiness claim.

Use the existing [readiness report](staging-database-readiness.md) and
[rehearsal plan](superpowers/plans/2026-11-18-staging-migration-rehearsal.md):

1. Identify a separate non-production rehearsal/restore target and obtain explicit
   approval. Do not automatically migrate the only existing project.
2. Inspect baseline migration effects/history, legacy identifiers, constraints,
   indexes, actual database roles/RLS and backend direct-PostgreSQL permissions.
3. Take a staging-only backup and prove restoration/recovery before any schema change.
4. Rehearse 037 with the enum committed before its partial index; rehearse 038 with
   reviewed transaction/ACL/history handling. Do not use the current whole-file Node
   migration execution path for a fresh 037 enum.
5. Verify all schema/permissions and synthetic data, then run full-schema opt-in,
   race/rollback, provider-mock and authenticated cross-role tests. Configure only
   approved test-mode provider credentials/webhooks/return URLs in that environment.
6. Confirm the backend truthfully returns true capabilities only for eligible orders.
   The UI will use the existing real confirmation flows without bypassing any checks.
7. Any eventual existing-project migration, production enablement or deployment needs
   separate explicit authorization, backup/recovery approval and end-to-end evidence.

No commit, push, deployment, production data access/modification or automatic
migration occurred. Work stops with the local UX fix and the live safety block intact.
