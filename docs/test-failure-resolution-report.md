# ATANY — resolution of the 42 broad-suite failures

All 42 reported failures were reproduced and resolved. Only tests and test setup
changed; PayMongo services, cancellation, pricing, deadlines, auction rules and modal
implementation were preserved. No assertions were removed or weakened, and no tests
were disabled or newly skipped.

## Root causes and exact fixes

| Group | Failures | Classification | Verified cause and correction |
| --- | ---: | --- | --- |
| Backend subscription proration | 2 | D: date/time-dependent expectation | Fixed October 1–November 1, 2026 periods had ended. The real calculation correctly returned zero. Fix the test clock at October 16, 12:00 UTC, the exact midpoint. Preserve positive-proration assertions and add exact integer-centavo expectations. |
| Customer sidebar | 5 | C: incorrect provider setup | `MyPurchases` calls `useToast`, but this integration fixture omitted `ToastProvider`. Wrap the real layout/pages with the real provider, as `App.jsx` already does. |
| Seller create/relist wizards | 30 | B: missing browser test environment dependency | Node's Web Storage globals shadow jsdom Storage in Vitest 1. `window.localStorage` was undefined and `.clear()` failed before rendering. Bind the test globals to the worker's native jsdom local/session Storage and clear both between tests. No storage mock or new dependency was necessary. |
| Frontend subscriptions | 5 | D: date/time-dependent expectation | Fixed paid periods had ended: Admin active/MRR counts dropped and Seller selected the pending renewal. Pin the test clock to October 10, 2026, when the fixtures represent the intended active/upcoming/overdue states. Real timers continue running. |

The storage root cause was verified against Node 22.22.2, jsdom 24 and Vitest 1.6.1:
native `new JSDOM(...).window.localStorage` existed, Node's global did not provide
usable localStorage, and Vitest's `populateGlobal` retained the existing Node global
then aliased `window` to that global. The shared setup now uses
`globalThis.jsdom.window[key]`, preserving actual browser Storage semantics and
per-worker isolation. Draft save/restore and validation assertions now execute.

The backend midpoint expectations are hand-derived: half of the ₱13,440
monthly-to-annual difference is **672,000 centavos**; half of the ₱500 Bronze-to-Gold
difference is **25,000 centavos**, billed as **₱250**. Production calculation functions
are unchanged. Existing ended-period/zero-proration coverage remains in place.
Only `Date` is faked in subscription fixtures, and the real clock is restored after
each test; asynchronous timers and user interaction remain real.

Every original failing test is classified by full name in
[failure-classification.json](verification/test-repair/failure-classification.json).
The groups account for all 42: D = 7, C = 5, B = 30; no category-E application
regression was identified.

## Baseline and regressions

All 42 failures existed at the start of this repair and were reproduced without
production-code changes. The available earlier `frontend-all-baseline.log` contains
the identical 40 failures before modal implementation (711 passed, 40 failed).
Earlier backend regression logs contain the same two proration failures; both test
files were unchanged during the payment/modal phase. These logs establish that the
reported failures predate this repair. There is no pristine earlier full-system run
that would establish their original introduction date.

No application regression was found in these failure groups. Existing tests now
exercise the real sidebar, wizard steps/calendar/draft persistence and subscription
selectors instead of stopping at setup or relying on the current calendar date.

## Files modified in this phase

| File | Change |
| --- | --- |
| `backend/src/tests/subscriptionHardening.test.js` | Fixed Date clock/restoration; exact 672000-centavo and integer assertions. |
| `backend/src/tests/subscriptionPlanChange.test.js` | Fixed Date clock/restoration; exact ₱250/25000-centavo preview assertions. |
| `frontend/src/layouts/__tests__/CustomerSidebar.test.jsx` | Real ToastProvider around the existing integration render. |
| `frontend/src/test/setup.js` | Native jsdom localStorage/sessionStorage binding and between-test cleanup. |
| `frontend/src/roles/admin/lib/__tests__/subscriptionSelectors.test.js` | Deterministic fixture date and restoration. |
| `frontend/src/roles/admin/pages/__tests__/Billing.test.jsx` | Deterministic fixture date and restoration. |
| `frontend/src/roles/shop-owner/subscription/__tests__/SellerBilling.test.jsx` | Deterministic fixture date and restoration. |

Documentation added/updated: this report, the previous implementation report/ledger,
the historical failure inventory heading, and `docs/verification/test-repair/`.
Other existing dirty workspace changes were preserved. No production source,
package/dependency file, migration or modal design was changed in this phase.

## Reproduction and final verification

| Run | Before fixes | After fixes |
| --- | --- | --- |
| Two affected backend files | 80 passed, **2 failed** | **82 passed**, 2 files |
| Nine affected frontend files | 90 passed, **40 failed** | **130 passed**, 9 files |
| Full backend suite | Previously 2 reported failures | **831 passed, 16 pre-existing skipped**, 44 files; zero failures |
| Full frontend suite (`npm test`) | Previously 40 reported failures | **771 passed**, 60 files; zero failures |
| Dedicated PayMongo regression | Previously 265 passed | **265 passed**, 9 files; includes **34 isolated PostgreSQL tests** |
| Focused modal/cross-role frontend regression | Previously 72 passed | **72 passed**, 8 files |
| Frontend production build (`npm run build`) | Passed | **Passed** |
| Whitespace check on this phase's changes | — | **Passed** |

The focused frontend run includes OrderModals (13), invoice print/download (4),
orderPresentation (3), purchaseStatus (27), MyPurchases, Admin Orders/reconciliation
and Seller order tests. The full backend run also executes the 34 genuine PostgreSQL
tests, rather than skipping them. Its 16 skipped tests are the existing opt-in
legacy winner real-schema suite; their guard and tests were not changed or disabled
in this phase. They require a separately authorized isolated schema fixture.

Both full suites used the repository `npm test` commands. Backend adds
`--pool=forks --maxWorkers=2 --minWorkers=1` and explicit fixture environment:
the application database URL points to unreachable localhost port 1, Supabase
credentials are fixtures, PayMongo keys are fake test-mode keys, the winner-database
opt-in is absent, and the safety tests connect only to the disposable private socket.
The dedicated payment command is `bash scripts/test-payment-safety.sh`.

Evidence: [results](verification/test-repair/results.txt),
[backend reproduction](verification/test-repair/backend-red.txt),
[frontend reproduction](verification/test-repair/frontend-red.txt),
[backend targeted pass](verification/test-repair/backend-targeted.txt),
[frontend targeted pass](verification/test-repair/frontend-targeted.txt).
Full raw logs remain under `/private/tmp/atany-test-repair/` as
`backend-full.log`, `frontend-full.log`, `payment-regression.log`,
`frontend-regression.log` and `frontend-build.log`.

## Independent browser verification

Headless Chrome rendered the actual CreateAuctionWizard, RelistWizard and
ToastProvider with native browser Storage and **no component mocks**. Nine checks
passed: native storage availability; calendar Today behavior; zero-increment
rejection; valid-increment Review/persistence; increment restoration after reload;
two-step relist structure; inherited bidding rules; separate draft namespaces;
and relist Review restoration after reload.

The isolated fixture disabled final submission and provided only a local source
auction. No publish/relist backend mutation, provider request or external network
request occurred. No JavaScript exception was recorded. This verifies local browser
behavior independently of Vitest storage/provider setup, not authenticated backend
end-to-end behavior. See [browser results](verification/test-repair/browser-results.json)
and [rendered relist Review](verification/test-repair/relist-review.png).
The browser verification harness lived outside the application under
`/private/tmp/atany-test-repair/browser-check.mjs`.

## Remaining failures and blockers

There are **no remaining failures among the 42 reported tests or the executed full
suites**. Existing non-failing React act, React Router future-flag and jsdom navigation
warnings remain visible; they were not suppressed. The legacy 16-test database suite
remains unverified in this run for the reason above.

The earlier production rollout blockers remain: authorized migration review/application,
verified backup and recovery, schema/permissions and legacy-identifier audit, provider
test-mode integration, monitoring/reconciliation procedures and authenticated
Customer/Seller/Admin end-to-end verification. Passing tests do not establish
production readiness.

Migration **037 was not applied**. Migration **038 was not changed or applied to
production**; its existing isolated payment-test fixture was rerun only in the
disposable PostgreSQL database. No production database records, real payments,
refunds, commits, pushes or deployments were performed. The disposable PostgreSQL
server was stopped after verification.
