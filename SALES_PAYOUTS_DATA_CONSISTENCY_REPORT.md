# SALES & PAYOUTS DATA CONSISTENCY — FIXED

## A. Duplicate Header
- **Removed** from `SalesPayouts.jsx` (all three occurrences, so the loading and error states don't re-add them):
  - `<div className="sp-header">` with `<p className="sp-eyebrow">EARNINGS</p>` and `<h1 className="sp-title">Sales & Payouts</h1>`
  - `<p className="sp-subtitle">Track your sales performance and payout history</p>`
  - `<div className="sp-header-main">` / `<div className="sp-header-actions">` wrappers
- **Topbar retained**: "SELLER PORTAL / Sales & Payouts" still renders in the shared `PortalPageHeader` beside the hamburger — untouched.
- The page content now starts directly with the KPI cards (Gross Sales / Net Payout / Pending Payout / This Month). No empty gap: `.sp-page` is a flex column, so removing one child simply promotes the KPI row to the top.
- Dead CSS removed from `sales-payouts.css`: `.sp-header`, `.sp-header-main`, `.sp-header-actions`, `.sp-eyebrow`, `.sp-title`, `.sp-subtitle`, `.sp-active-pill`, `.sp-dot`, `.sp-count` (plus the two responsive overrides) — all verified unused elsewhere.

## B. Active Listings
- **Removed**: the hardcoded `<span className="sp-count">35</span> active listings` pill (and its whole `.sp-header-actions` container). It was **not** replaced with another counter.
- **Authoritative source**: `ShopOwnerLayout.jsx` — `listings.filter(l => (l.computed_status || l.status) !== 'ended' && !== 'rejected').length`, fed by `GET /shop-owner/sales`. **This calculation was not modified** and still drives the topbar ("1 active listings" on current data).
- No listing counter is duplicated on the page any more.

## C. September Sale Audit
The ₱55,000 recognized sale (real rows, not assumptions):

| Field | Value |
|---|---|
| Order ID | `1cb7b55f-833c-44e0-a5bf-502abd7e95b8` (`TXN-9002`, "Rose Gold Bangle", Bracelets) |
| `orders.created_at` | `2026-09-15T10:31:25.384Z` |
| `payments.status` | `paid` |
| `payments.created_at` | `2026-09-15T10:34:08.514Z` |
| **`payments.paid_at`** | **`2026-09-15T10:34:48.890Z`** |
| Gross | ₱55,000 |
| Seller payout (90%) | ₱49,500 |
| **Correct recognized month** | **September 2026** (`2026-09`) |

The database value decides: `paid_at` is in September, so the sale belongs to **SEP 2026**. Nothing was hardcoded.

## D. Month Shift Root Cause
- **Old code** (`sales.controller.js`, trend builder):
  ```js
  const d = new Date(now.getFullYear(), now.getMonth() - i, 1); // LOCAL midnight
  const key = d.toISOString().slice(0, 7);                   // UTC key  ← mismatch
  const monthYear = d.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' }); // LOCAL label
  ```
  The **label was local** but the **key was UTC**. The server runs in **Asia/Manila (UTC+8)**, so local `Oct 1 2026 00:00` = `2026-09-30T16:00:00Z` → the key came out **`2026-09`** while the label read **"OCT 2026"**. The OCT point therefore looked up the *September* bucket and the SEP point looked up *August* — shifting every month one bucket earlier.
- **Corrected** (`backend/src/lib/monthKey.js` — new):
  ```js
  export function localMonthKey(value) { const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`; }
  export function localMonthLabel(value) { /* local 'en-PH' short month + year */ }
  ```
  Both the bucket key and the displayed label now come from the **same local calendar month**, so a shift is structurally impossible.

## E. Revenue Recognition
- **Rule kept**: revenue is recognized **only** when `payments.status = 'paid'`. Pending / failed / expired / winner-unpaid orders contribute nothing.
- **Authoritative date** (new, used consistently everywhere on the page):
  ```js
  const recognizedAt = payment.paid_at || payment.created_at || o.created_at;
  ```
  `paid_at` is primary; `payment.created_at` is the documented fallback for legacy paid rows without it; `orders.created_at` is the last resort.
- `recognizedAt` now drives **Gross Sales YTD**, **Net Payout YTD**, **This Month**, **Revenue Trend** and the **Payout History date** — previously they mixed `orders.created_at` and a UTC key.
- `paid_at` was added to the sales-summary payment query (`SELECT order_id, status, payment_method, amount, paid_at, created_at FROM payments …`).
- Commission untouched: 10% platform / 90% seller (`COMMISSION_RATE = 0.10`); `pending_payout` keeps its existing rule (paid + order not completed).

## F. Revenue Trend
Verified live against the running server (real seller JWT):

```
NOV 2025 … AUG 2026   gross=0      net=0
SEP 2026              gross=55000  net=49500   ← the September sale, correctly placed
OCT 2026              gross=0      net=0
```

KPIs: `gross_ytd=55000`, `net_ytd=49500`, `pending=0`, `this_month=0` — consistent with the trend.

## G. Payout History
- **Date source**: changed from `orders.created_at` to the recognized payment date (`payment.paid_at`). Live: `TXN-9002` now shows `2026-09-15T10:34:48.890Z` (the payment confirmation) instead of the order-creation timestamp, so the financial date matches the recognized-revenue month.
- **Status semantics (audited, not changed)**: the column shows `Paid` when the **order** is `completed`, otherwise `Scheduled`. ATANY tracks seller **entitlement** (90% of a paid sale) — there is no separate payout-settlement/transfer record, so "Paid" here really means "the order is complete", not "funds were transferred". The 10%/90% split and the label behaviour were left exactly as they are to avoid broadening the task; the mismatch is documented here.

## H. Admin vs Seller Difference
- **Seller scope (changed)**: `GET /shop-owner/sales/summary` — the caller's **own shop only** (resolved server-side from `req.user.id`; a client `shop_id` is never trusted).
- **Admin scope (unchanged)**: `Admin → Reports` (`backend/src/controllers/admin/analytics.controller.js`) is platform-wide over all orders.
- **⚠ Revenue-rule inconsistency found (reported, NOT changed per the task)**: Admin Analytics computes revenue from **order statuses** — `const statusList = ['completed', 'pending', 'ready_pickup']` — and **never queries the `payments` table**. It therefore counts *unpaid* `pending` / `ready_pickup` orders as revenue, which contradicts the canonical rule used by the seller page and the rest of ATANY (`payments.status = 'paid'`). It also groups by `orders.created_at` rather than the payment date, and its `bucketKey()` uses a local **label** bucket (so it does not have the seller's UTC/local shift, but it is a different grouping basis). This is a separate platform-level consistency issue and was deliberately left untouched.
- The seller page was **not** changed to match Admin totals, and Admin was **not** changed to match the seller.

## I. Files Changed
**Backend**
- `backend/src/lib/monthKey.js` — **new**: `localMonthKey()` / `localMonthLabel()` (timezone-safe, shared key + label)
- `backend/src/controllers/shop-owner/sales.controller.js` — `paid_at` added to the summary payment query; `recognizedAt` introduced and used for YTD / This Month / trend / payout history; `localMonthKey` + `localMonthLabel` used for the trend (key and label from the same local month)

**Frontend**
- `frontend/src/roles/shop-owner/pages/SalesPayouts.jsx` — the three duplicate body-header blocks and the hardcoded "35 active listings" pill removed
- `frontend/src/roles/shop-owner/sales-payouts.css` — the now-unused header/active-pill styles removed

**Tests**
- `backend/src/tests/sellerSalesRevenueMonths.test.js` — **new** (13 tests)
- `frontend/src/roles/shop-owner/pages/__tests__/SalesPayoutsHeader.test.jsx` — **new** (6 tests)
- `frontend/src/roles/shop-owner/pages/__tests__/SalesPayouts.test.jsx` — the 3 tests that asserted the old body header now assert the topbar-only identity

**Not changed:** `ShopOwnerLayout.jsx` (authoritative active-listing count), the 10%/90% rule, the Admin analytics, the Order rows endpoint (`/shop-owner/sales`, which is an **order** table where the order date is correct), the KPI set, the Revenue Trend / Top Categories / Payout History sections, and no page redesign.

## J. Tests
- **Backend: 737 passed / 737 (47 files)** — all green. New `sellerSalesRevenueMonths.test.js` covers: `localMonthKey` keeps a September payment in September; **a local Oct 1st yields "2026-10" while the old `toISOString().slice(0,7)` yielded "2026-09"** (the regression); the label and key come from the same local month; both month boundaries; a September payment lands under **SEP 2026** with **OCT 2026 = 0**; order created Sep 30 + paid Oct 1 → **October**; legacy paid row without `paid_at` falls back to `payment.created_at`; unpaid orders excluded from YTD/trend/payout history; 10%/90% split preserved; payout-history date = the recognized payment date; This Month uses the recognized date; the payment query selects `paid_at`; the shop is resolved from the session.
- **Frontend: 712 passed / 717 (51 files)** — 5 failures, all pre-existing (admin `subscriptionSelectors` ×2, admin `Billing`, `SellerBilling` selectors + page) and unrelated.

## K. Build
`npx vite build` ✓ passed (3.38s) — no broken imports, no missing state, no blank page.

## L. Browser QA
Real-browser automation is unavailable in this sandbox (no Playwright/Puppeteer/Chromium), so the walkthrough was done against the **live server with a real Shop Owner JWT**:
- `GET /shop-owner/sales/summary` → the Revenue Trend now shows **SEP 2026 gross=55,000 / net=49,500** and **OCT 2026 gross=0 / net=0** (the shift is gone), the payout row date is the payment date, and the KPIs are unchanged.
- The duplicate body header and the "35 active listings" badge are removed from the JSX and asserted absent by the new tests, in the normal, loading **and** error states.

To confirm visually: Shop Owner → Sales & Payouts — the topbar shows "SELLER PORTAL / Sales & Payouts" and the real "1 active listings", and the content starts directly with the four KPI cards.
