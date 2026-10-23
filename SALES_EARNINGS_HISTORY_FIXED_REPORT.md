# SALES & EARNINGS HISTORY — FIXED

ATANY Jewelry Auction Platform — Shop Owner → Sales & Payouts

> Non-negotiable rule honoured: **no seller earning is ever called "paid out"**
> because ATANY has no recorded seller disbursement. The table is
> **Earnings History**, built only from `payments.status = 'paid'`, dated by
> `payment.paid_at`, and showing **Gross Sale / ATANY Commission / Net Earnings**.

---

## A. Duplicate Header

- **Removed** the body-level block:
  `EARNINGS` / `Sales & Payouts` / `Track your sales performance and payout history`
  from the **normal**, **loading** and **error** states.
- **Retained** the topbar (`SELLER PORTAL` / `Sales & Payouts`) rendered by
  `frontend/src/layouts/ShopOwnerLayout.jsx` — untouched.
- The page body now starts **directly with the KPI cards**
  (Gross Sales · Net Earnings · Pending Earnings · This Month).

## B. Active Listings

- The hardcoded **`35 active listings`** pill was removed completely and
  **not** replaced with another counter.
- **Authoritative source:** the active-listing count computed by
  `ShopOwnerLayout.jsx` in the topbar. That file was **not modified**.

## C. Revenue Recognition

- **Rule (unchanged):** only `payments.status = 'paid'` is recognized revenue.
  `pending` / `failed` / `expired` / unpaid winners / started-but-unpaid
  checkouts contribute **nothing** to Gross Sales, Net Earnings, This Month,
  the Revenue Trend, Top Categories or the Earnings History.
- **Date rule (new, applied everywhere):**

  ```js
  const recognizedAt =
    payment.paid_at ||   // authoritative financial date
    payment.created_at || // legacy fallback
    order.created_at;    // last-resort fallback
  ```

  Used for: Gross Sales YTD, Net Earnings YTD, This Month, Revenue Trend
  grouping and the Earnings History date.
- **Money rule (unchanged):** ATANY commission **10%**, seller earnings **90%**.
  `commission = amount − netEarnings`, so `gross = commission + net` always holds.
- **Payment query (fixed):** the summary query now selects `paid_at` alongside
  `order_id, status, payment_method, created_at, amount`.

## D. Month Grouping

- **Old bug:** month keys were built with `d.toISOString().slice(0, 7)` while
  the labels came from the local calendar. In **Asia/Manila (UTC+8)**,
  `new Date(2026, 9, 1)` → `2026-09-30T16:00Z` → key `"2026-09"` paired with
  the label `OCT 2026` — every month's revenue shifted one bucket earlier.
- **Corrected logic:** new helper `backend/src/lib/monthKey.js` with
  `localMonthKey()` (`"YYYY-MM"`) and `localMonthLabel()` (`"SEP 2026"`).
  Both are derived from the **same local calendar month**, so a key can never
  disagree with its label.
- **Verified live:** `SEP 2026 → gross 55,000 / net 49,500`, `OCT 2026 → 0 / 0`.
  The September sale is **not** shifted into October.

## E. Earnings History

- **Renamed:** `Payout History` → **Earnings History**
- **Subtitle:** `Recent releases to your preferred accounts` →
  `Your recognized seller earnings from paid auction orders`
- **New columns (8):** `TRANSACTION · DATE · ITEM · BUYER · GROSS SALE ·
  ATANY COMMISSION · NET EARNINGS · STATUS`
- **Date source:** `recognizedAt` (i.e. `payment.paid_at` when present) —
  the same date used by the Revenue Trend.
- **Gross / commission / net:** `gross = 55,000`, `commission = 5,500`,
  `net = 49,500` — all derived from the real DB record.
- **Status:** `Earned` for paid rows only. Non-paid payments are **not**
  listed at all. The fulfillment state is shown **separately** beneath the
  badge (`Pending fulfillment` / `Completed`) via `order_status`.
- `item` and `buyer` are included using the **existing batch maps**
  (products map + one batched `users` lookup) — **no per-row queries**.

## F. Removed Misleading Data

- **Payout method column removed.** The old table showed either the seller's
  *subscription payment preference* (`Subscription preference •••• 4421`) or the
  *customer's checkout method* — **neither is a payout destination**.
  - `maskPaymentMethod()` deleted from the backend.
  - `formatPaymentMethod()` deleted from the frontend.
  - The `method` key is **not present** in any API row.
- **Fake payout status removed.** `Paid` / `Scheduled` / `Failed` are gone.
  A seller earning is now `Earned`; the fulfillment state is separate.
- **KPI wording corrected:** `Net Payout` → **Net Earnings**,
  `Pending Payout` → **Pending Earnings** (helper text: *"Earned, order not yet
  completed"* — no bank-transfer implication).
- **Chart legend:** `Gross sales / Net payout` → **Gross Sales / Net Earnings**
  (tooltip label updated too).
- **Loading / error copy:** `Loading sales and earnings data…` /
  `Failed to load sales and earnings data.`
- **Legacy API keys removed:** `net_payout_ytd`, `pending_payout`,
  `payout_history` → `net_earnings_ytd`, `pending_earnings`,
  `earnings_history`.

## G. CSV

- **Columns:** `Transaction ID, Date, Item, Buyer, Gross Sale,
  ATANY Commission, Net Earnings, Status`
- **Filename:** `atany-earnings-history-YYYY-MM-DD.csv` (was
  `atany-payout-history-…`).
- **No `Method` column.** Toast: `Earnings history exported`.

## H. Seller Scope

- The shop is resolved **server-side** from `req.user.id`
  (`SELECT id, user_id FROM shops WHERE user_id=$1`) — the client `shop_id` is
  never trusted.
- Orders are reached through the seller's own products → auctions → orders,
  so a seller can only ever see their own sales.
- **Data source:** `orders` (amount, status, transaction_code, buyer_id),
  `payments` (status, paid_at, created_at, amount), `products` (name,
  category), `users` (buyer name) — all real DB rows.

## I. Payout System Limitation

- **ATANY currently does NOT perform or track real seller disbursements.**
  There is no `seller_payouts` table, no release workflow, no provider
  reference, and no transfer destination. The page therefore reports
  **recognized seller earnings**, never a payout.
- **A real Payout History feature would require** (documented only — **NOT
  implemented** in this task):
  - a seller payout record (one row per disbursement),
  - a release status (`scheduled` → `processing` → `paid` / `failed`),
  - the actual payout **destination** (bank account / e-wallet),
  - a **provider reference** for the transfer,
  - `scheduled_at`, `paid_at` and `failed_at` timestamps,
  - plus reconciliation against `payments.status = 'paid'` and a release /
    admin action to actually move the money.

## J. Files Changed

**Backend**
- `backend/src/controllers/shop-owner/sales.controller.js` — renamed summary
  fields, `recognizedAt`, `localMonthKey`, new `earnings_history` rows
  (gross/commission/net/status=`Earned`/order_status/item/buyer), one batched
  buyer query, `maskPaymentMethod` removed.
- `backend/src/lib/monthKey.js` *(new)* — `localMonthKey()` / `localMonthLabel()`.
- `backend/src/tests/salesSummary.test.js` — updated to the new field names.
- `backend/src/tests/sellerSalesRevenueMonths.test.js` *(new)* — 20 tests:
  calendar-month regression, `paid_at` recognition, unpaid exclusion,
  gross/commission/net/status, no `method` key, buyer batching (no N+1).

**Frontend**
- `frontend/src/roles/shop-owner/pages/SalesPayouts.jsx` — KPI wording, chart
  legend/subtitle/tooltip, Earnings History table (8 columns), CSV, loading /
  error copy, `formatPaymentMethod` removed.
- `frontend/src/roles/shop-owner/sales-payouts.css` — added `.sp-order-status`
  (fulfillment chip); removed the dead `.sp-method` rule; fixed the status
  badge variants (`sp-badge--paid` → `sp-badge-paid`, etc.) which previously
  never matched the class names emitted by the page.
- `frontend/src/roles/shop-owner/pages/__tests__/SalesPayouts.test.jsx` —
  rewritten against the real API shape; asserts the 8 columns, the absence of
  `Method` / `Subscription preference`, `Earned` (never `Paid`), the
  fulfillment state, and the exact CSV header row + filename.
- `frontend/src/roles/shop-owner/pages/__tests__/SalesPayoutsHeader.test.jsx`
  *(new)* — no duplicate heading, no hardcoded listing count, truthful
  earnings row.

**Not touched:** `backend/src/db/pool.js`, Admin Reports/analytics, the
`ShopOwnerLayout` topbar count, any migration (no new table).

## K. Tests

- **Backend:** `47 files / 744 tests — ALL PASS` ✅
  (`node node_modules/vitest/vitest.mjs run`)
- **Frontend:** `718 passed / 723` — **5 failures, all pre-existing and
  unrelated** (admin `subscriptionSelectors` ×2, admin `Billing`,
  `SellerBilling` selectors + page). Verified by stashing all changes and
  re-running: the same 5 fail on the untouched tree.
  The Sales & Payouts suites: `21/21 PASS` ✅

## L. Build

- `npx vite build` → **✓ built in ~3.5s**, 2554 modules transformed, no
  errors ✅

## M. Browser QA

No browser automation is available in this sandbox (no Playwright / Puppeteer /
Chromium), so QA was done against the **live API with a real seller JWT**
(`contact@goldenheritage.ph`) plus DOM-level render assertions in jsdom.

**Live `GET /shop-owner/sales/summary`:**

```json
{
  "summary": {
    "gross_sales_ytd": 55000,
    "net_earnings_ytd": 49500,
    "pending_earnings": 0,
    "sales_this_month": 0,
    "lots_sold_this_month": 0,
    "commission_rate": 0.1
  },
  "revenue_trend": [
    { "month": "SEP 2026", "gross": 55000, "net": 49500 },
    { "month": "OCT 2026", "gross": 0,    "net": 0    }
  ],
  "top_categories": [ { "category": "Bracelets", "revenue": 55000, "percentage": 100 } ],
  "earnings_history": [
    {
      "id": "TXN-9002",
      "date": "2026-09-15T10:34:48.890Z",
      "item": "Rose Gold Bangle",
      "buyer": "britz Susada",
      "gross": 55000,
      "commission": 5500,
      "net": 49500,
      "status": "Earned",
      "order_status": "Completed"
    }
  ]
}
```

Checks: ✅ no `method` key · ✅ no `payout_history` · ✅ no `net_payout_ytd` ·
✅ no `pending_payout` · ✅ September not shifted to October.

**Rendered DOM (jsdom, real component):** topbar only (no duplicate heading),
no `35 active listings`, KPI `Gross Sales / Net Earnings / Pending Earnings /
This Month`, chart subtitle `Gross sales vs net earnings over 12 months`,
section `Earnings History` with the 8 headers and **no `Method` column**, row
`TXN-9002 | Sep 15, 2026 | Rose Gold Bangle | britz Susada | ₱55,000 | ₱5,500 |
₱49,500 | Earned / Completed`.

---

## Appendix — Admin Reports inconsistency (documented, NOT changed)

`backend/src/controllers/admin/analytics.controller.js` computes platform-wide
revenue with a **different rule** from the seller page:

| | Seller Sales & Payouts | Admin Analytics |
|---|---|---|
| Revenue source | `payments.status = 'paid'` | `orders` table only — **never reads `payments`** (0 queries) |
| Order filter | paid payment (any order status) | `orders.status IN ('completed','pending','ready_pickup')` |
| Date used | `payment.paid_at` | `orders.created_at` |
| Scope | one seller | whole platform |

Consequences: Admin counts **pending / ready_pickup orders as revenue** even
when the customer never paid, and dates revenue at **order creation** rather
than at payment confirmation. Seller and Admin totals therefore *cannot* be
expected to match (correctly — the seller page is seller-scoped), but the two
definitions are genuinely inconsistent.

**Not changed in this task** (per instruction). Recommended follow-up: make
Admin analytics use `payments.status = 'paid'` and `payment.paid_at` as well,
so both surfaces share one revenue definition.
