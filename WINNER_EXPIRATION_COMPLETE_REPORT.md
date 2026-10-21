# 7-DAY WINNER EXPIRATION — COMPLETE IMPLEMENTATION REPORT

## A. Winner Expiration Architecture
- **Services**: `winnerExpiration.js` (rotation + notices), `winnerNotificationService.js` (new — single source of wording/deadline/markers), `auctionClosingService.js` (initial winner + explicit deadline/rank), `auctionCloser.js` (initial winner notice + email), `paymentReminder.js` (3d/1d/6h reminders), `paymentRaceGuard.js` (stale-payment protection), `notificationPreference.js` (critical flag), `payment.controller.js` + `webhook.controller.js` (payment-confirmed notice + deadline enforcement).
- **Cron**: `checkAndExpireWinners` at `'40 * * * * *'` with `onceAtATime` + `runExclusiveJob` advisory lock `910003`; reminders `'55 * * * * *'`; close `'10 * * * * *'`. One expiration job only — no second cron introduced.
- **Lock behavior**: `SELECT ... FOR UPDATE` on the order row; buyer_id / pending-status / paid-state re-checks inside the transaction; guarded `UPDATE ... WHERE status='pending' AND buyer_id=$X`; rollback on any mismatch. Emails sent post-commit only (never inside the transaction). Fail-closed on REST fallback / no direct pg.

## B. Initial Winner
- **Selection**: `closeSingleAuction` ranks bids `amount DESC, created_at ASC`, deduplicates per user (keeps each user's own highest bid) → highest DISTINCT bidder wins.
- **Amount**: winner's own highest bid (Maria ₱71,000, not Maria's lower ₱60k/₱55k).
- **Order**: exactly ONE order row per auction (`buyer_id`, `amount`, `winner_rank=1`); no duplicate orders created.
- **Deadline**: explicitly written at creation — `winner_confirmed_at = now`, `payment_deadline = now + 7 days`, `winner_rank = 1`. Legacy 42703 fallback keeps old rows working (deadline derived from `created_at`).

## C. Payment Deadline
- **Source**: one authoritative rule everywhere — stored `payment_deadline` wins, else `(winner_confirmed_at || created_at) + 7 days` (resolved via `resolveDeadline()` in `winnerNotificationService.js`, used by expiration, reminders, order/payment controllers, and checkout).
- **Stored fields**: `payment_deadline`, `winner_confirmed_at`, `winner_rank` (all already present in schema; no migration needed).
- **Checkout enforcement**: `createCheckout` verifies deadline before creating PayMongo checkout; if `now >= payment_deadline` → HTTP 409 `{ code: 'PAYMENT_DEADLINE_EXPIRED', message: 'The payment deadline for this order has expired.' }`, no external checkout created. Flat project response convention (matches `ACCOUNT_SUSPENDED` etc.).

## D. Payment Detection
- **PayMongo / online payments**: `payments.status='paid'` remains the source of truth; expiration uses `orders.status='pending'` only as a candidate filter, then re-checks paid inside the transaction.
- **Counter payment**: customer selecting counter moves order to `ready_pickup` but creates NO `payments.status='paid'` row — no revenue fabrication. Recognized revenue only counts verified payment truth.

## E. Winner #1 Expiration
- **Status/state**: `pending` → reassigned to next distinct bidder (still `pending`) at their own amount with a fresh deadline; `winner_rank` increments; same order row reused.
- **Locking**: `FOR UPDATE` + buyer/status/paid re-checks inside the transaction; stale previous-winner payment cannot pay the reassigned order.
- **Notification**: rich expired-winner notice (item, amount, expired deadline, order ref, "next eligible bidder", ATANY Support guidance) + post-commit email.

## F. Next Bidder Selection
- **Distinct-user algorithm**: bids sorted `amount DESC, created_at ASC`; one entry per user (their own highest bid); selection moves forward in the ranked list — a previous winner can never re-enter.
- **Flagged bids**: excluded (`flagged=false OR flagged IS NULL`).
- **Ordering**: `amount DESC, created_at ASC` (earliest bid breaks amount ties). Bids remain immutable history.

## G. Reassignment Amount
- **Source**: `orders.amount` = next bidder's own highest bid (`nextBidder.amount`), never the previous order amount.
- **Maria/Britz/John proof** (verified via real service calls): ₱71,000 (Maria) → ₱65,000 (Britz) → ₱58,000 (John). Britz's lower ₱58,000 bid creates no second entry.

## H. Fresh 7-Day Window
- **Winner #2**: `payment_deadline = reassignment time + 7 days`; **Winner #3**: same rule.
- **Verified**: deadlines ≈ reassignment time + 7 days (within ±1%); they do NOT inherit the previous winner's remaining time.

## I. Initial Winner Notification
- **In-app**: "Congratulations! You won <item> for ₱X" with order ref, auction code, pickup branch, exact payment deadline, 7-day language, payment/purchases link.
- **Email** (Resend): same values — item, amount, exact deadline, order ref, purchases URL, pickup instructions, support guidance. Email failure never rolls back the order.
- **Content**: actual values only, nothing hardcoded.

## J. Payment Reminders
- **Stages**: 3 days / 1 day / 6 hours before the stored `payment_deadline`, for every current winner including #2 and #3.
- **Content**: item, amount, exact deadline, order ref, "complete payment to keep your winning claim". Idempotent via dedup marker `reminder:<orderRef>:<stage>`. Remain optional (respect `order_updates` preference).

## K. Payment Confirmation Notification
- **Content**: "Payment Confirmed" — item, amount, order ref, order status ("ready for pickup" / "being prepared").
- **Dedup**: single shared implementation `createPaymentConfirmedNotification` used by both the PayMongo webhook and the checkout-polling fallback; marker `payment-confirmed:<orderId>` prevents duplicates on repeated confirmation.

## L. Expired Winner Notification
- **Content**: item, winning amount, expired payment deadline, order ref, statement that the winning claim expired and the item was offered to "the next eligible bidder", ATANY Support guidance.
- **Privacy**: never names the next bidder, never exposes user IDs/emails. Support must not promise restoration ("contact ATANY Support" for questions/disputes only).

## M. Fallback Winner Notification
- **Content**: "You Are Now the Winning Bidder" — item, THEIR OWN amount (₱65,000 for Britz), their OWN fresh deadline, 7-day language, order ref, View Order & Pay link.
- **Privacy**: does not expose previous winner identity.

## N. Contact ATANY Support
- **Route**: `/customer/messages` (existing real support flow, reused — no dead link).
- **Prefill**: safe context via URL params `?order=TXN-1234&item=...&topic=expired-payment`; MessagesPage prefills the draft with item/order/topic. No next-bidder or internal data exposed.

## O. Winner #2 → Winner #3
- **Automated**: same `checkAndExpireWinners` job handles any number of ranks (1 → 2 → 3 → …); `winner_rank` only increments, never decrements.
- **Test proof**: `winnerExpirationChain.test.js` proves Maria → Britz (rank 2) → John (rank 3) with fresh deadlines at each step.

## P. No Bidders Remaining
- **Order**: `status = 'expired'` (terminal); no new buyer assigned.
- **Auction**: stays `ended`; no automatic relist (seller must deliberately use existing relist).
- **Customer notice**: "Auction Payment Opportunity Ended" — no more eligible bidders; does NOT claim the item moved to another bidder; support guidance.
- **Seller notice**: "Auction Winner Payment Expired" — final eligible winner didn't pay, no remaining eligible bidders, order ref, auction remains ended, manual relist option. Admin notice also sent.

## Q. Race Safety
- **Payment commits first**: expiration sees `payments.status='paid'`, aborts, winner remains.
- **Expiration commits first**: buyer changes; stale old-winner payment fails `paymentRaceGuard` (BUYER_MISMATCH) → `markStalePayment` → `cancelled`; new winner unaffected; no paid status attributed to wrong buyer.
- **Guarded update**: `UPDATE ... WHERE status='pending' AND buyer_id=$X` with row-count verification prevents duplicate reassignment.

## R. Idempotency
- **Job locks**: `onceAtATime` + `runExclusiveJob` advisory lock 910003 prevent concurrent expiration runs.
- **Order guard**: same order row reused; guarded UPDATE + buyer re-check prevent duplicate reassignment / duplicate orders.
- **Notification dedup**: deterministic markers (`winner-expired:<orderId>:<rank>`, `fallback-winner:<orderId>:<rank>`, `no-bidders:<orderId>`, `seller-no-bidders:<orderId>`, `payment-confirmed:<orderId>`, `reminder:<orderRef>:<stage>`) checked via `message LIKE` before insert. Markers contain NO user IDs (customer-visible). Repeated cron runs produce exactly one notice per transition.

## S. Counter Payment
- **Current behavior**: counter selection → order `ready_pickup`, no `payments.status='paid'` row created.
- **Revenue interaction**: no fake paid row; recognized revenue only counts verified payment truth.
- **Limitation**: no staff counter-payment confirmation mechanism exists in the codebase, so a verified counter `payments.status='paid'` cannot be created; this accounting limitation is documented (not invented).

## T. Current Winner / Historical Highest Bid
- **Distinction preserved**: `auctions.current_bid` = "highest bid ever placed" (NOT repurposed); `orders.amount` + `winner_rank` + `payment_deadline` = current assigned winner authority.
- **Seller result modal**: shows "Current payable amount" (₱65,000), "Winner rank" (#2), payment deadline, plus a "Highest bid placed" note (₱71,000) when it differs — clearly distinguishing current winner from historical leader.
- **Admin branch card**: ended auctions show payable amount from the order; live auctions show "Highest bid".

## U. Expired Order UI
- **My Purchases**: shows "Payment Expired" for terminal expired orders.
- **Order Details**: `status='expired'` → renders "Payment Expired" (never "Payment Pending"); no Pay Now action once deadline passes (countdown hits zero disables payment immediately, refetch waits for server state); terminal state shows "no remaining eligible bidders" + Contact ATANY Support link; active winner state shows "Congratulations — You Won" + amount + deadline + live countdown.

## V. Database Changes
- **Migration**: none required (columns `winner_confirmed_at`, `payment_deadline`, `winner_rank`, `status='expired'` already exist; `audit_logs` is the only audit table — no new tables).
- **Indexes/constraints**: none added (existing schema sufficient; batched `LIMIT 100` candidate query with deterministic ORDER BY).
- `backend/src/db/pool.js` NOT modified.

## W. Backend Files Changed
- `src/services/winnerExpiration.js` — rewritten (batched candidate query, rich notices, dedup markers, seller/no-bidder notices, post-commit emails)
- `src/services/winnerNotificationService.js` — NEW (wording, deadline resolution, formatting, markers)
- `src/services/auctionClosingService.js` — writes `winner_confirmed_at`/`payment_deadline`/`winner_rank=1` at order creation
- `src/services/auctionCloser.js` — new message builders + email with exact deadline
- `src/services/paymentReminder.js` — richer reminders + markers
- `src/services/notificationPreference.js` — `critical` flag (critical notices always deliverable)
- `src/controllers/customer/payment.controller.js` — `PAYMENT_DEADLINE_EXPIRED` (409) + shared payment-confirmed notice
- `src/controllers/webhook.controller.js` — shared payment-confirmed notice (dedup)
- `src/tests/winnerExpirationChain.test.js` — NEW (20 tests: chain, fresh deadlines, exclusion, races, late checkout, reminders, counter payment, emails, seller notice)
- `src/tests/paymentNotifications.test.js` — updated mocks + wording

## X. Frontend Files Changed
- `src/roles/customer/pages/OrderDetails.jsx` — expired/winner states, countdown, deadline-passed → Pay button disappears, terminal expired state, support links, `timeLeftLabel` export
- `src/roles/customer/pages/CompletePayment.jsx` — expired state + support link
- `src/shared/components/MessagesPage.jsx` — support-context prefill from URL params
- `src/roles/shop-owner/components/AuctionResultModal.jsx` — current payable amount + winner rank + highest-bid note
- `src/roles/admin/pages/BranchDetails.jsx` — payable amount label for ended auctions
- `src/index.css` — `.order-winner-card` styles

## Y. Backend Tests
- **Total**: 675 passed / 42 files (was 655; +20 new winner-chain tests)
- **New chain tests**: Maria→Britz→John distinct-bidder chain, fresh deadlines, exclusion of lower/same-user bids, reassignment amounts, terminal expiration, notification content/privacy/dedup, duplicate-cron idempotency, payment-first race, expiration-first stale-payment race, late checkout rejection, reminders for current + fallback winners, counter payment (no fake paid row), seller no-bidder notice, email inclusion of deadline/purchases URL.

## Z. Frontend Tests
- **Total**: 599 passed / 42 files (5 pre-existing subscription-selector/Billing/SellerBilling failures unchanged from baseline; not related to this task)
- **New**: `OrderDetailsExpiration.test.jsx` (4 tests: active winner UI, deadline-passed hides Pay, terminal expired shows "Payment Expired" not "Payment Pending", support link with safe context)
- **Extended**: `AuctionResultModal.test.jsx` (reassigned-winner case: current payable amount ₱65,000, rank #2, highest-bid note)

## AA. Build
- `npx vite build` ✓ passed (frontend builds cleanly with all changes).

## AB. Browser/E2E QA
**Could not execute real browser QA in this sandbox** — no Chromium, Playwright, or Puppeteer is installed, and no browser automation tools are available. Browser/E2E QA (admin/seller/customer sessions through the UI) was therefore not run.

**Verified instead via real service calls against the live database** through `qa_chain.mjs` (create + expire steps), exercising the actual `closeSingleAuction` and `checkAndExpireWinners` services:
- Auction created & closed → **Maria ₱71,000 rank 1**, order + notification, explicit 7-day deadline (Oct 28)
- `qa_chain.mjs expire` → Maria expired → **Britz ₱65,000 rank 2**, fresh 7-day deadline; Britz gets "You Are Now the Winning Bidder" (₱65,000, own deadline); Maria gets "Payment Period Expired" (₱71,000, "next eligible bidder", support); seller + admin notified of new winner
- `qa_chain.mjs expire` → Britz expired → **John/QA Customer ₱58,000 rank 3**, fresh 7-day deadline
- `qa_chain.mjs expire` → John expired → order **`status='expired'`**, rank stays 3, auction **stays `ended`** (no auto-relist); John gets "Auction Payment Opportunity Ended" (no more eligible bidders); seller + admin get "Auction Winner Payment Expired"
- Maria's checkout rejected ("Order not found" — no longer the buyer); QA fixture data then fully deleted; temp scripts removed.

## AC. Remaining Limitations
- **Counter payment**: no staff/admin counter-payment verification mechanism exists, so `payments.status='paid'` is never created for counter selections; revenue from counter payments is not recognized as verified. Documented, not invented.
- **Email**: `RESEND_API_KEY` not configured in this environment, so winner/expired emails are skipped gracefully (reassignment remains valid; in-app notification is primary). Email code path is present and tested where mockable.
- **Browser/E2E QA**: not runnable in this sandbox (no browser automation tooling); backend E2E flow proven via real service calls, frontend behavior proven via unit tests + build.
- **Audit logging**: no new audit entries written (reuses existing `audit_logs` infrastructure only where already present; no forced new schema per task guidance).
